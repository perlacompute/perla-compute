import { requireRounds,legacyPin,wonRounds,roundRewardSummary } from './reward-rounds';
import { earnedManifest } from './round-math';
import { digest } from './protocol';
import type { MiningDatabase } from './database';
import { CHAIN_ID, JOB_TTL, currentEpoch } from './protocol';
import { dailyBudget, EMISSION_POLICY } from './emission.mjs';
import { createManifest } from './rewards';
import deployment from '@/deployments/robinhood-testnet.json';
import type { Address } from 'viem';

type Env = { DB?: MiningDatabase; PERLA_REWARD_TOKEN?: string; PERLA_DISTRIBUTOR_ADDRESS?: string };
type Policy = { policy: string; start_epoch: number; token: Address; distributor: Address; created: number };
export class RewardScheduleError extends Error { constructor(public status: number, message: string) { super(message); } }
const fail = (message: string): never => { throw new RewardScheduleError(409, message); };
const dbFor = (env: Env) => env.DB ?? fail('Reward storage is unavailable.');
function configured(env: Env, policy: Policy) {
  if (policy.policy !== EMISSION_POLICY || env.PERLA_REWARD_TOKEN?.toLowerCase() !== policy.token || env.PERLA_DISTRIBUTOR_ADDRESS?.toLowerCase() !== policy.distributor) fail('The pinned reward policy does not match this deployment.');
  return policy;
}
export async function pinnedRewardPolicy(env: Env) {
  const row = await dbFor(env).prepare('SELECT * FROM mining_reward_policy WHERE id=1').first<Policy>();
  return row ? configured(env, row) : null;
}
export async function configureRewardPolicy(env: Env, now: number) {
  const db = dbFor(env); const saved = await pinnedRewardPolicy(env); if (saved) return saved;
  const start = await db.prepare('SELECT start_epoch FROM mining_policy_state WHERE id=1').first<{ start_epoch: number }>();
  if (!start || !Number.isSafeInteger(start.start_epoch) || start.start_epoch < 0) fail('Activate the validated mining policy before pinning rewards.');
  const token = env.PERLA_REWARD_TOKEN?.toLowerCase(), distributor = env.PERLA_DISTRIBUTOR_ADDRESS?.toLowerCase();
  if (token !== deployment.token.toLowerCase() || distributor !== deployment.distributor.toLowerCase()) fail('Use the reviewed PERL testnet token and matching distributor.');
  const old = await db.prepare('SELECT epoch,budget,token,distributor FROM mining_reward_epochs').all<{ epoch: number; budget: string; token: string; distributor: string }>();
  for (const row of old.results) {
    if (row.epoch < start!.start_epoch || row.token.toLowerCase() !== token || row.distributor.toLowerCase() !== distributor || BigInt(row.budget) !== dailyBudget(row.epoch - start!.start_epoch + 1)) fail('An existing epoch uses a different reward schedule. Preserve it for reconciliation.');
  }
  await db.prepare('INSERT OR IGNORE INTO mining_reward_policy(id,policy,start_epoch,token,distributor,created) VALUES(1,?,?,?,?,?)').bind(EMISSION_POLICY, start!.start_epoch, token, distributor, now).run();
  return (await pinnedRewardPolicy(env))!;
}
export const rewardSummary=roundRewardSummary;
export async function prepareRewardEpoch(env:Env,epoch:number,now:number,requestedBudget?:unknown){
 const db=dbFor(env),policy=await requireRounds(env),pin=await legacyPin(env);
 if(!Number.isSafeInteger(epoch)||epoch<policy.cutover_epoch||now<(epoch+1)*86400+JOB_TTL)fail('Only closed round-reward epochs can be prepared.');
 const saved=await db.prepare('SELECT * FROM mining_reward_epochs WHERE epoch=?').bind(epoch).first<{manifest:string;snapshot:string;state:string}>();
 if(saved?.state==='cancelled')fail('This allocation was cancelled and cannot be recreated.');
 if(saved&&JSON.parse(saved.manifest).version!==2)fail('Legacy allocations are held for review; they are not funded by the round schedule.');
 const rounds=await wonRounds(env,epoch);
 if(!rounds.length)return {epoch,skipped:true,reason:'No qualifying round was won. Shares alone unlock no reward.',budget:'0'};
 const manifest=earnedManifest(epoch,pin.distributor,rounds,pin.start_epoch,policy.policy_hash);
 if(requestedBudget!==undefined&&requestedBudget!==manifest.budget)fail('Budget must equal the sum of earned round rewards.');
 const snapshot=await digest(JSON.stringify(rounds));
 if(saved){if(saved.manifest!==JSON.stringify(manifest)||saved.snapshot!==snapshot)fail('Immutable earned allocation differs from its recorded rounds.');return {...manifest,snapshot,state:saved.state};}
 await db.prepare("INSERT OR IGNORE INTO mining_reward_epochs(epoch,snapshot,manifest,root,budget,distributor,token,state,created) VALUES(?,?,?,?,?,?,?,'prepared',?)").bind(epoch,snapshot,JSON.stringify(manifest),manifest.root,manifest.budget,pin.distributor,pin.token,now).run();
 const final=await db.prepare('SELECT manifest,snapshot,state FROM mining_reward_epochs WHERE epoch=?').bind(epoch).first<{manifest:string;snapshot:string;state:string}>();
 if(final?.manifest!==JSON.stringify(manifest))fail('Concurrent allocation differs; preserve the record for review.');
 return {...manifest,snapshot,state:final!.state};
}
export async function settlementQueue(env:Env,now:number){
 const summary=await roundRewardSummary(env,now),db=dbFor(env);
 if(!summary.configured||summary.status!=='active')return {summary,items:[],more:false};
 const policy=(await requireRounds(env)),rows=await db.prepare("SELECT DISTINCT r.epoch FROM mining_reward_rounds r LEFT JOIN mining_reward_epochs e ON e.epoch=r.epoch WHERE r.state='won' AND r.epoch>=? AND r.epoch<=? AND (e.epoch IS NULL OR (e.state='prepared' AND json_extract(e.manifest,'$.version')=2)) ORDER BY r.epoch LIMIT 33").bind(policy.cutover_epoch,Math.floor((now-JOB_TTL)/86400)-1).all<{epoch:number}>();
 return {summary,items:rows.results.slice(0,32).map(r=>({epoch:r.epoch})),more:rows.results.length>32};
}
