/** Real SQLite transactions. Proof-validity inputs are explicit doubles, not GPU evidence. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp,rm } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID,createHash } from 'node:crypto';
import { createSqliteDatabase } from '../../lib/vps/sqlite.mjs';
import deployment from '../../deployments/robinhood-testnet.json' with {type:'json'};
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(resolve(root,'.sites-runtime-rounds-'));
await build({entryPoints:[resolve(root,'lib/perla/reward-rounds.ts')],outfile:join(temp,'engine.mjs'),bundle:true,platform:'node',format:'esm',packages:'external'});
await build({entryPoints:[resolve(root,'lib/perla/reward-schedule.ts')],outfile:join(temp,'schedule.mjs'),bundle:true,platform:'node',format:'esm',packages:'external'});
await build({entryPoints:[resolve(root,'lib/perla/round-math.ts')],outfile:join(temp,'math.mjs'),bundle:true,platform:'node',format:'esm',packages:'external'});
const engine=await import(pathToFileURL(join(temp,'engine.mjs'))),schedule=await import(pathToFileURL(join(temp,'schedule.mjs'))),math=await import(pathToFileURL(join(temp,'math.mjs')));
const NOW=20760*86400+1000,EPOCH=Math.floor(NOW/86400),A='0x'+'11'.repeat(20),B='0x'+'22'.repeat(20);
const hash=x=>createHash('sha256').update(x).digest('hex');
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS',name);}
const databases=[];
async function fixture(){
 const db=createSqliteDatabase(':memory:');databases.push(db);db.migrate(resolve(root,'drizzle'));
 await db.prepare('INSERT INTO mining_policy_state(id,profile_id,start_epoch,activated_at,validation_hash,validation_family,validation_version) VALUES(1,?,?,?,?,?,?)').bind('p1',20754,NOW-100,'fixture','89','0.5.0').run();
 await db.prepare('INSERT INTO mining_reward_policy(id,policy,start_epoch,token,distributor,created) VALUES(1,?,?,?,?,?)').bind('perla-testnet-daily-v1',20754,deployment.token.toLowerCase(),deployment.distributor.toLowerCase(),NOW-100).run();
 const env={DB:db,PERLA_REWARD_TOKEN:deployment.token,PERLA_DISTRIBUTOR_ADDRESS:deployment.distributor};
 await engine.activateRounds(env,NOW);return {db,env};
}
async function worker(f,address=A){const id=randomUUID(),tokenHash=hash(id);await f.db.prepare('INSERT INTO mining_workers(id,address,name,token_hash,created) VALUES(?,?,?,?,?)').bind(id,address,'fixture',tokenHash,NOW).run();return {id,address,tokenHash};}
async function job(f,w,round,units=1){
 const id=randomUUID();await f.db.batch([
  f.db.prepare('INSERT INTO mining_jobs(id,worker_id,epoch,header,created,expires,protocol,share_bits,work_points,policy_hash,profile_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,w.id,round.epoch,'test-only-unused-envelope',NOW,NOW+300,'perla-pearl-plain-v4',486604799,units,'fixture','p1'),
  f.db.prepare('INSERT INTO mining_round_jobs(job_id,round_id) VALUES(?,?)').bind(id,round.id),
 ]);return id;
}
async function credit(f,w,round,{units=1,won=false,jobId,accepted=NOW+1}={}){
 return engine.creditRoundShare(f.env,{id:randomUUID(),jobId:jobId??await job(f,w,round,units),workerId:w.id,tokenHash:w.tokenHash,proofHash:hash(randomUUID()),accepted,round,won,admission:true});
}
try{
 await test('policy hashes and exact difficulty ratios match the published rules',async()=>{
  assert.equal(await math.roundPolicyHash(),math.ROUND_POLICY_HASH);
  for(const r of math.ROUND_RULES.targets)assert.equal(math.roundTarget(r.workUnits).bits,r.bits);
  assert.equal(math.nextRoundWeight(256,Array(16).fill(1)),512);
  assert.equal(math.nextRoundWeight(256,Array(16).fill(10000)),256);
  assert.equal(math.nextRoundWeight(2048,Array(16).fill(1)),2048);
 });
 await test('eleven ordinary accepted shares unlock zero PERL, even with one wallet',async()=>{
  const f=await fixture(),w=await worker(f),r=await engine.openRewardRound(f.env,NOW);
  for(let i=0;i<11;i++)await credit(f,w,r);
  const summary=await engine.roundRewardSummary(f.env,NOW+20,A);
  assert.equal(summary.acceptedShares,11);assert.equal(summary.roundsWon,0);assert.equal(summary.budget,'0');assert.equal(summary.earnedAmount,'0');assert(BigInt(summary.dailyCap)>0n);
  const prepared=await schedule.prepareRewardEpoch(f.env,EPOCH,(EPOCH+1)*86400+301);
  assert.equal(prepared.skipped,true);assert.equal(prepared.budget,'0');
 });
 await test('a harder qualifying proof unlocks one fixed round reward, not the daily cap',async()=>{
  const f=await fixture(),w=await worker(f),r=await engine.openRewardRound(f.env,NOW);
  const result=await credit(f,w,r,{won:true});assert.equal(result.roundWon,true);
  const summary=await engine.roundRewardSummary(f.env,NOW+20,A);
  assert.equal(summary.roundsWon,1);assert.equal(summary.earnedAmount,r.reward);assert.equal(summary.budget,r.reward);
  assert(BigInt(r.reward)*446n<=BigInt(summary.dailyCap));assert(BigInt(r.reward)<BigInt(summary.dailyCap));
  const manifest=await schedule.prepareRewardEpoch(f.env,EPOCH,(EPOCH+1)*86400+301);
  assert.equal(manifest.version,2);assert.equal(manifest.budget,r.reward);assert.equal(manifest.allocations[0].amount,r.reward);
  assert.deepEqual(await schedule.prepareRewardEpoch(f.env,EPOCH,(EPOCH+1)*86400+301),manifest);
 });
 await test('concurrent winners close one round and create only one winning credit',async()=>{
  const f=await fixture(),a=await worker(f),b=await worker(f,B),r=await engine.openRewardRound(f.env,NOW);
  const jobs=await Promise.all([job(f,a,r),job(f,b,r)]);
  const results=await Promise.allSettled([credit(f,a,r,{won:true,jobId:jobs[0]}),credit(f,b,r,{won:true,jobId:jobs[1]})]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM mining_shares').first()).n,1);
  assert.equal((await engine.wonRounds(f.env,EPOCH)).length,1);
 });
 await test('PPLNS truncates a partial oldest weighted share and conserves every base unit',async()=>{
  const f=await fixture(),a=await worker(f),b=await worker(f,B),r=await engine.openRewardRound(f.env,NOW);
  await credit(f,a,r,{units:16});for(let i=0;i<31;i++)await credit(f,b,r,{units:16});await credit(f,b,r,{units:1,won:true});
  const rows=await engine.wonRounds(f.env,EPOCH),snapshot=JSON.parse(rows[0].snapshot);
  assert.equal(snapshot.find(x=>x.address===A).workUnits,15);assert.equal(snapshot.find(x=>x.address===B).workUnits,497);
  const m=await schedule.prepareRewardEpoch(f.env,EPOCH,(EPOCH+1)*86400+301);
  assert.equal(m.totalWork,'512');assert.equal(m.allocations.reduce((sum,a)=>sum+BigInt(a.amount),0n),BigInt(r.reward));
 });
 await test('duplicate jobs, rotated credentials and old-day submissions cannot credit',async()=>{
  const f=await fixture(),w=await worker(f),r=await engine.openRewardRound(f.env,NOW),id=await job(f,w,r);
  await credit(f,w,r,{jobId:id});await assert.rejects(()=>credit(f,w,r,{jobId:id}));
  const next=await job(f,w,r);await f.db.prepare('UPDATE mining_workers SET token_hash=? WHERE id=?').bind('rotated',w.id).run();
  await assert.rejects(()=>credit(f,w,r,{jobId:next,won:true}));
  await f.db.prepare('UPDATE mining_workers SET token_hash=? WHERE id=?').bind(w.tokenHash,w.id).run();
  await assert.rejects(()=>credit(f,w,r,{jobId:next,won:true,accepted:(EPOCH+1)*86400}));
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM mining_shares').first()).n,1);
 });
 await test('suspending rounds holds new credits and activation never backfills legacy work',async()=>{
  const f=await fixture(),w=await worker(f),r=await engine.openRewardRound(f.env,NOW),id=await job(f,w,r);
  await f.db.prepare('UPDATE mining_round_policy SET suspended=1 WHERE id=1').run();
  await assert.rejects(()=>credit(f,w,r,{jobId:id,won:true}));
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM mining_round_shares').first()).n,0);
  const original=await f.db.prepare('SELECT started FROM mining_round_policy').first();await engine.activateRounds(f.env,NOW+100);
  assert.equal((await f.db.prepare('SELECT started FROM mining_round_policy').first()).started,original.started);
 });
 await test('activation expires only unfinished old jobs and preserves accepted receipts',async()=>{
  const f=await fixture(),w=await worker(f),r=await engine.openRewardRound(f.env,NOW),done=await job(f,w,r),pending=await job(f,w,r);
  await f.db.prepare('UPDATE mining_jobs SET created=?,expires=? WHERE id IN (?,?)').bind(NOW-1,NOW+300,done,pending).run();
  await f.db.prepare('INSERT INTO mining_shares(id,job_id,worker_id,address,epoch,proof_hash,accepted,points) VALUES(?,?,?,?,?,?,?,1)').bind(randomUUID(),done,w.id,w.address,EPOCH,hash('legacy'),NOW-1).run();
  const before=await f.db.prepare('SELECT * FROM mining_shares').all();await engine.activateRounds(f.env,NOW+100);
  assert.equal((await f.db.prepare('SELECT expires FROM mining_jobs WHERE id=?').bind(done).first()).expires,NOW+300);
  assert.equal((await f.db.prepare('SELECT expires FROM mining_jobs WHERE id=?').bind(pending).first()).expires,NOW+100);
  assert.deepEqual(await f.db.prepare('SELECT * FROM mining_shares').all(),before);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM mining_round_shares').first()).n,0);
 });
 await test('cancelled and legacy prepared allocations do not enter the round funding queue',async()=>{
  const f=await fixture();await f.db.prepare("INSERT INTO mining_reward_epochs(epoch,snapshot,manifest,root,budget,distributor,token,state,created) VALUES(20754,'fixture','{}','fixture','1',?,?,'cancelled',?)").bind(deployment.distributor,deployment.token,NOW).run();
  const queue=await schedule.settlementQueue(f.env,(EPOCH+1)*86400+301);assert.deepEqual(queue.items,[]);
  await assert.rejects(()=>schedule.prepareRewardEpoch(f.env,20754,(EPOCH+1)*86400+301));
 });
 await test('the 446-round ceiling never spends more than the daily cap; unused days pay zero',async()=>{
  const f=await fixture(),w=await worker(f);
  for(let i=0;i<446;i++){const r=await engine.openRewardRound(f.env,NOW);await credit(f,w,r,{won:true});}
  await assert.rejects(()=>engine.openRewardRound(f.env,NOW),/daily reward-round cap/);
  const summary=await engine.roundRewardSummary(f.env,NOW,A);assert.equal(summary.roundsWon,446);assert(BigInt(summary.budget)<=BigInt(summary.dailyCap));
  const tomorrow=await engine.roundRewardSummary(f.env,(EPOCH+1)*86400+20,A);assert.equal(tomorrow.budget,'0');assert.equal(tomorrow.earnedAmount,'0');
 });
 await test('an epoch recipient limit rejects a new wallet before any share credit',async()=>{
  const f=await fixture(),w=await worker(f),r=await engine.openRewardRound(f.env,NOW);
  for(let i=1;i<=5000;i++)await f.db.prepare('INSERT INTO mining_round_epoch_recipients(epoch,address) VALUES(?,?)').bind(EPOCH,'0x'+i.toString(16).padStart(40,'0')).run();
  await assert.rejects(()=>credit(f,w,r,{won:true}),/recipient limit/);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM mining_shares').first()).n,0);
 });
 await test('version-2 audit rejects altered snapshots, policy hashes and round rewards',async()=>{
  const f=await fixture(),w=await worker(f),r=await engine.openRewardRound(f.env,NOW);await credit(f,w,r,{won:true});
  const m=await schedule.prepareRewardEpoch(f.env,EPOCH,(EPOCH+1)*86400+301);
  assert.deepEqual(math.rebuildRoundManifest(m),Object.fromEntries(Object.entries(m).filter(([k])=>!['snapshot','state'].includes(k))));
  for(const change of [{policyHash:'0'.repeat(64)},{rounds:[{...m.rounds[0],reward:'999'}]}])assert.throws(()=>math.rebuildRoundManifest({...m,...change}));
 });
 console.log(`${passed} round reward checks passed with real SQLite; proof validity was a deliberate test double.`);
}finally{for(const db of databases)db.close();await rm(temp,{recursive:true,force:true});}
