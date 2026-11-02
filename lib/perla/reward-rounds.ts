import type { MiningDatabase } from './database';
import deployment from '@/deployments/robinhood-testnet.json';
import { currentEpoch, digest } from './protocol';
import { dailyBudget, EMISSION_POLICY } from './emission.mjs';
import { ROUND_RULES as R, ROUND_POLICY, roundPolicyHash, roundTarget, nextRoundWeight, rewardPerRound, earnedManifest, splitRound, type WonRound, type WorkRow } from './round-math';
import type { Address } from 'viem';
export type RoundEnv={DB?:MiningDatabase;PERLA_REWARD_TOKEN?:string;PERLA_DISTRIBUTOR_ADDRESS?:string};
export class RoundError extends Error{constructor(public status:number,message:string){super(message);}}
const fail=(s:number,m:string):never=>{throw new RoundError(s,m);};
const database=(e:RoundEnv)=>e.DB??fail(503,'Reward storage is unavailable.');
export type RoundPolicy={policy_hash:string;started:number;cutover_epoch:number;suspended:number};
export type RewardRound=WonRound&{epoch:number;policy_hash:string;opened:number;closed:number|null;state:string};
export async function legacyPin(e:RoundEnv){
 const row=await database(e).prepare('SELECT * FROM mining_reward_policy WHERE id=1').first<{policy:string;start_epoch:number;token:Address;distributor:Address}>();
 if(!row||row.policy!==EMISSION_POLICY||row.token!==deployment.token.toLowerCase()||row.distributor!==deployment.distributor.toLowerCase()||e.PERLA_REWARD_TOKEN?.toLowerCase()!==row.token||e.PERLA_DISTRIBUTOR_ADDRESS?.toLowerCase()!==row.distributor)fail(409,'The reviewed testnet token and emission start must be pinned before round rewards.');
 return row!;
}
export async function roundPolicy(e:RoundEnv){
 const row=await database(e).prepare('SELECT * FROM mining_round_policy WHERE id=1').first<RoundPolicy>();
 if(row&&row.policy_hash!==await roundPolicyHash())fail(409,'Round policy differs from this release; reward work is held for review.');
 return row;
}
export async function requireRounds(e:RoundEnv){const p=await roundPolicy(e);if(!p||p.suspended)fail(503,'Round rewards are not active. Your worker identity is retained.');await legacyPin(e);return p!;}
export async function activateRounds(e:RoundEnv,now:number){
 const pin=await legacyPin(e);const db=database(e),hash=await roundPolicyHash(),saved=await roundPolicy(e);
 if(pin.start_epoch>currentEpoch(now))fail(409,'The emission start is in the future.');
 if(!saved&&await db.prepare('SELECT epoch FROM mining_reward_epochs WHERE epoch=?').bind(currentEpoch(now)).first())fail(409,'This UTC epoch already has a legacy allocation. Activate in the next UTC epoch.');
 // Do not backfill historical shares. Expire pre-cutover jobs in the same transaction.
 await db.batch([
  db.prepare('INSERT OR IGNORE INTO mining_round_policy(id,policy_hash,started,cutover_epoch,suspended) VALUES(1,?,?,?,0)').bind(hash,now,currentEpoch(now)),
  db.prepare('UPDATE mining_jobs SET expires=MIN(expires,?) WHERE created < (SELECT started FROM mining_round_policy WHERE id=1) AND NOT EXISTS(SELECT 1 FROM mining_shares s WHERE s.job_id=mining_jobs.id)').bind(now),
  db.prepare('UPDATE mining_round_policy SET suspended=0 WHERE id=1 AND policy_hash=?').bind(hash),
 ]);
 return {...await roundPolicy(e),policy:ROUND_POLICY,rules:R,alreadyConfigured:!!saved};
}
export async function openRewardRound(e:RoundEnv,now:number){
 const policy=await requireRounds(e),pin=await legacyPin(e),db=database(e),epoch=currentEpoch(now);
 if(epoch<policy.cutover_epoch||now>=(epoch+1)*86400-5)fail(503,'The UTC reward window is closing. Retry in the next epoch.');
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO mining_round_epoch_recipients(epoch,address) SELECT ?,address FROM (
   SELECT address,work_units,SUM(work_units) OVER(ORDER BY sequence DESC) AS running FROM (
    SELECT s.sequence,s.address,s.work_units FROM mining_round_shares s JOIN mining_reward_rounds r ON r.id=s.round_id WHERE r.policy_hash=? ORDER BY s.sequence DESC LIMIT 4096
   )
  ) WHERE running-work_units<? AND NOT EXISTS(SELECT 1 FROM mining_round_epoch_state WHERE epoch=?)`).bind(epoch,policy.policy_hash,R.maximumWorkUnits*R.windowMultiplier,epoch),
  db.prepare('INSERT OR IGNORE INTO mining_round_epoch_state(epoch,started) VALUES(?,?)').bind(epoch,now),
 ]);
 const reward=rewardPerRound(dailyBudget(epoch-pin.start_epoch+1));if(reward<=0n)fail(503,'No round budget is available.');
 for(let attempt=0;attempt<4;attempt++){
  await db.prepare("UPDATE mining_reward_rounds SET state='expired',closed=? WHERE state='open' AND epoch<?").bind(now,epoch).run();
  const open=await db.prepare("SELECT * FROM mining_reward_rounds WHERE epoch=? AND policy_hash=? AND state='open'").bind(epoch,policy.policy_hash).first<RewardRound>();if(open)return open;
  const count=await db.prepare("SELECT COUNT(*) AS n FROM mining_reward_rounds WHERE epoch=? AND state='won'").bind(epoch).first<{n:number}>();if((count?.n??0)>=R.dailyRoundLimit)fail(503,'The daily reward-round cap is reached. New paid work resumes next UTC epoch.');
  const total=await db.prepare("SELECT COUNT(*) AS n FROM mining_reward_rounds WHERE policy_hash=? AND state='won'").bind(policy.policy_hash).first<{n:number}>();
  const recent=await db.prepare("SELECT difficulty_weight,opened,closed FROM mining_reward_rounds WHERE policy_hash=? AND state='won' ORDER BY rowid DESC LIMIT ?").bind(policy.policy_hash,R.retargetRounds).all<{difficulty_weight:number;opened:number;closed:number}>();
  let weight=recent.results[0]?.difficulty_weight??R.minimumWorkUnits;
  if(total!.n>0&&total!.n%R.retargetRounds===0)weight=nextRoundWeight(weight,recent.results.map(r=>Math.max(1,r.closed-r.opened)));
  const target=roundTarget(weight),id=crypto.randomUUID();
  await db.prepare("INSERT OR IGNORE INTO mining_reward_rounds(id,epoch,policy_hash,difficulty_weight,target_bits,reward,opened,state) SELECT ?,?,?,?,?,?,?,'open' WHERE EXISTS(SELECT 1 FROM mining_round_policy WHERE id=1 AND policy_hash=? AND suspended=0) AND (SELECT COUNT(*) FROM mining_reward_rounds WHERE policy_hash=? AND state='won')=? AND (SELECT COUNT(*) FROM mining_reward_rounds WHERE epoch=? AND state='won')<?").bind(id,epoch,policy.policy_hash,weight,target.bits,reward.toString(),now,policy.policy_hash,policy.policy_hash,total!.n,epoch,R.dailyRoundLimit).run();
  const created=await db.prepare("SELECT * FROM mining_reward_rounds WHERE id=? AND state='open'").bind(id).first<RewardRound>();if(created)return created;
 }
 return fail(503,'The reward round changed. Request a fresh challenge.');
}
export function roundInfo(r:RewardRound){return {id:r.id,epoch:r.epoch,policy:ROUND_POLICY,policyHash:r.policy_hash,bits:r.target_bits,workUnits:r.difficulty_weight,windowWorkUnits:r.difficulty_weight*R.windowMultiplier,rewardBaseUnits:r.reward,opened:r.opened,state:r.state};}
export async function roundForJob(e:RoundEnv,job:string){return database(e).prepare('SELECT r.* FROM mining_round_jobs j JOIN mining_reward_rounds r ON r.id=j.round_id WHERE j.job_id=?').bind(job).first<RewardRound>();}
export async function creditRoundShare(e:RoundEnv,input:{id:string;jobId:string;workerId:string;tokenHash:string;proofHash:string;accepted:number;round:RewardRound;won:boolean;admission:boolean}){
 const {id,jobId,workerId,tokenHash,proofHash,accepted,round,won,admission}=input,db=database(e);
 if(!admission)fail(503,'Paid round work is paused. Offline GPU checks create no rewards.');
 const statements=[
  db.prepare("INSERT OR IGNORE INTO mining_shares(id,job_id,worker_id,address,epoch,proof_hash,accepted,points) SELECT ?,j.id,w.id,w.address,j.epoch,?,?,j.work_points FROM mining_jobs j JOIN mining_workers w ON w.id=j.worker_id JOIN mining_round_jobs q ON q.job_id=j.id JOIN mining_reward_rounds r ON r.id=q.round_id JOIN mining_round_policy p ON p.id=1 WHERE j.id=? AND w.id=? AND w.token_hash=? AND w.revoked IS NULL AND j.expires>? AND j.epoch=? AND r.id=? AND r.state='open' AND r.policy_hash=p.policy_hash AND p.suspended=0 AND j.created>=p.started AND NOT EXISTS(SELECT 1 FROM mining_reward_epochs x WHERE x.epoch=j.epoch) AND EXISTS(SELECT 1 FROM mining_policy_state m WHERE m.id=1 AND m.start_epoch<=j.epoch) AND (EXISTS(SELECT 1 FROM mining_round_epoch_recipients s WHERE s.epoch=j.epoch AND s.address=w.address) OR (SELECT COUNT(*) FROM mining_round_epoch_recipients s WHERE s.epoch=j.epoch)<?)").bind(id,proofHash,accepted,jobId,workerId,tokenHash,accepted,currentEpoch(accepted),round.id,R.maximumRecipients),
  db.prepare('INSERT OR IGNORE INTO mining_round_shares(share_id,round_id,epoch,address,work_units) SELECT s.id,q.round_id,s.epoch,s.address,s.points FROM mining_shares s JOIN mining_round_jobs q ON q.job_id=s.job_id WHERE s.id=? AND s.job_id=? AND s.worker_id=?').bind(id,jobId,workerId),
 ];
 // Snapshot and winner CAS are part of the same BEGIN IMMEDIATE batch as credit.
 statements.push(db.prepare(`UPDATE mining_reward_rounds SET state='won',closed=?,winner_share=?,snapshot=(
  SELECT json_group_array(json_object('address',address,'workUnits',units)) FROM (
   SELECT address,SUM(MIN(work_units,MAX(0,?-(running-work_units)))) AS units FROM (
    SELECT address,work_units,SUM(work_units) OVER(ORDER BY sequence DESC) AS running FROM (
     SELECT s.sequence,s.address,s.work_units FROM mining_round_shares s JOIN mining_reward_rounds r ON r.id=s.round_id
     WHERE s.sequence<=(SELECT sequence FROM mining_round_shares WHERE share_id=? AND round_id=?) AND r.policy_hash=? ORDER BY s.sequence DESC LIMIT 4096
    )
   ) WHERE running-work_units<? GROUP BY address ORDER BY address
  )
 ) WHERE id=? AND state='open' AND ?=1 AND EXISTS(SELECT 1 FROM mining_round_shares WHERE share_id=? AND round_id=?)`).bind(accepted,id,round.difficulty_weight*R.windowMultiplier,id,round.id,round.policy_hash,round.difficulty_weight*R.windowMultiplier,round.id,won?1:0,id,round.id));
 statements.push(db.prepare('INSERT OR IGNORE INTO mining_round_epoch_recipients(epoch,address) SELECT epoch,address FROM mining_round_shares WHERE share_id=? AND round_id=?').bind(id,round.id));
 const results=await db.batch(statements);
 if(results[0].meta.changes!==1)fail(409,'Round closed, job expired, credential changed, recipient limit reached, or epoch already prepared. No new share was credited.');
 return {roundWon:results[2].meta.changes===1,workWeight:await db.prepare('SELECT points FROM mining_shares WHERE id=?').bind(id).first<{points:number}>()};
}
export async function wonRounds(e:RoundEnv,epoch:number){const rows=await database(e).prepare("SELECT id,reward,snapshot,difficulty_weight,target_bits,winner_share FROM mining_reward_rounds WHERE epoch=? AND state='won' ORDER BY rowid LIMIT ?").bind(epoch,R.dailyRoundLimit+1).all<WonRound>();return rows.results;}
const earnedCache=new WeakMap<MiningDatabase,{key:string;amounts:Map<string,bigint>}>();
export async function roundRewardSummary(e:RoundEnv,now:number,address?:string){
 const db=database(e),policy=await roundPolicy(e),epoch=currentEpoch(now);
 if(!policy)return {configured:false,policy:ROUND_POLICY,chainId:46630,epoch,status:'not_activated',rules:R};
 const pin=await legacyPin(e),rows=await wonRounds(e,epoch),cap=dailyBudget(epoch-pin.start_epoch+1);
 let earned=0n;if(address){const key=String(epoch)+':'+rows.map(r=>r.id).join(',');let cached=earnedCache.get(db);if(!cached||cached.key!==key){const amounts=new Map<string,bigint>();for(const row of rows)for(const a of splitRound(BigInt(row.reward),JSON.parse(row.snapshot) as WorkRow[]))amounts.set(a.address,(amounts.get(a.address)??0n)+BigInt(a.amount));cached={key,amounts};earnedCache.set(db,cached);}earned=cached.amounts.get(address.toLowerCase())??0n;}
 const totals=await db.prepare('SELECT COUNT(*) AS shares,COALESCE(SUM(work_units),0) AS units FROM mining_round_shares WHERE epoch=?').bind(epoch).first<{shares:number;units:number}>();
 const active=await db.prepare("SELECT * FROM mining_reward_rounds WHERE epoch=? AND state='open'").bind(epoch).first<RewardRound>();
 return {configured:true,policy:ROUND_POLICY,policyHash:policy.policy_hash,chainId:46630,token:pin.token,distributor:pin.distributor,startEpoch:pin.start_epoch,cutoverEpoch:policy.cutover_epoch,started:policy.started,epoch,day:epoch-pin.start_epoch+1,status:policy.suspended?'suspended':'active',dailyCap:cap.toString(),budget:rows.reduce((sum,r)=>sum+BigInt(r.reward),0n).toString(),earnedAmount:address?earned.toString():null,estimatedAmount:address?earned.toString():null,roundReward:rewardPerRound(cap).toString(),roundsWon:rows.length,roundLimit:R.dailyRoundLimit,acceptedShares:totals?.shares??0,workUnits:String(totals?.units??0),currentRound:active?roundInfo(active):null,closesAt:(epoch+1)*86400,settlementOpensAt:(epoch+1)*86400+300,latestClosedEpoch:Math.floor((now-300)/86400)-1,rules:R,funding:'Earned round allocations require a matching funded epoch before claims. Unused daily capacity stays in treasury; no rollover.',calibration:'Conservative initial difficulty floor; the target interval is a controller parameter, not a measured GPU performance claim.'};
}
