import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import ganache from 'ganache';
import { createPublicClient, createWalletClient, http, custom, defineChain } from 'viem';
import { compileContracts } from '../perla-rewards.mjs';
import { settleRewards } from '../reward-settle.mjs';
import { dailyBudget } from '../../lib/perla/emission.mjs';
import { createSqliteDatabase } from '../../lib/vps/sqlite.mjs';
import deployment from '../../deployments/robinhood-testnet.json' with { type: 'json' };
const root=resolve(import.meta.dirname,'../..'),scratch=resolve(root,'.sites-runtime/reward-settlement-checks');await mkdir(scratch,{recursive:true});
for(const name of ['reward-schedule','coordinator','portal'])await build({entryPoints:[resolve(root,'lib/perla/'+name+'.ts')],outfile:resolve(scratch,name+'.mjs'),bundle:true,platform:'node',format:'esm',target:'node24'});
const schedule=await import(pathToFileURL(resolve(scratch,'reward-schedule.mjs'))),{handleMiningRequest}=await import(pathToFileURL(resolve(scratch,'coordinator.mjs'))),{accountRewards}=await import(pathToFileURL(resolve(scratch,'portal.mjs')));
const db=createSqliteDatabase(':memory:');db.migrate(resolve(root,'drizzle'));
const now=Math.floor(Date.now()/1000),today=Math.floor(now/86400),start=today-3;
const env={DB:db,PERLA_OPERATOR_TOKEN:'local-test-operator-'.repeat(4),PERLA_REWARD_TOKEN:deployment.token,PERLA_DISTRIBUTOR_ADDRESS:deployment.distributor};
let passed=0;const test=async(name,fn)=>{await fn();passed++;console.log('PASS',name);};
async function call(path,payload,cfg=env,authenticated=true){return handleMiningRequest(new Request('https://perla.test/api/mining/'+path,{method:payload===undefined?'GET':'POST',headers:{'content-type':'application/json',...(authenticated?{authorization:'Bearer '+env.PERLA_OPERATOR_TOKEN}:{})},...(payload===undefined?{}:{body:JSON.stringify(payload)})}),cfg);}
async function op(path,payload,cfg=env){const r=await call(path,payload,cfg);const v=await r.json();if(!r.ok)throw Error(v.error);return v;}
async function share(epoch,address,points){const id=crypto.randomUUID();await db.prepare('INSERT INTO mining_shares(id,job_id,worker_id,address,epoch,proof_hash,accepted,points) VALUES(?,?,?,?,?,?,?,?)').bind(id,crypto.randomUUID(),crypto.randomUUID(),address.toLowerCase(),epoch,'ab'.repeat(32),epoch*86400+1,points).run();}
const server=ganache.server({logging:{quiet:true},chain:{chainId:46630},wallet:{deterministic:true}});await server.listen(0,'127.0.0.1');
const rpc='http://127.0.0.1:'+server.address().port,chain=defineChain({id:46630,name:'Local EVM',nativeCurrency:{name:'ETH',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[rpc]}}});
const client=createPublicClient({chain,transport:http(rpc)}),wallet=createWalletClient({chain,transport:http(rpc)}),[owner,alice,bob]=await wallet.getAddresses();
const privateKey=server.provider.getInitialAccounts()[owner.toLowerCase()].secretKey,wrongKey=server.provider.getInitialAccounts()[alice.toLowerCase()].secretKey;
const contracts=await compileContracts();
async function deploy(name,args=[]){const hash=await wallet.deployContract({account:owner,...contracts[name],args,gas:5000000n});const receipt=await client.waitForTransactionReceipt({hash});assert.equal(receipt.status,'success');return {address:receipt.contractAddress,hash};}
try{
 await test('reward configuration requires operator authorization',async()=>assert.equal((await call('operator/rewards/configure',{},env,false)).status,401));
 await test('configuration refuses an unactivated mining policy',async()=>assert.equal((await call('operator/rewards/configure',{})).status,409));
 await db.prepare("INSERT INTO mining_policy_state VALUES(1,'p1',?,?,?,'89','0.5.0')").bind(start,now,'local-test').run();
 await test('start epoch is derived and pinned once without a signing key',async()=>{const first=await op('operator/rewards/configure',{});assert.equal(first.start_epoch,start);assert.equal(first.token,deployment.token.toLowerCase());await db.prepare('UPDATE mining_policy_state SET start_epoch=? WHERE id=1').bind(start+1).run();assert.equal((await op('operator/rewards/configure',{})).start_epoch,start);});
 await test('pre-start and unclosed epochs cannot be allocated',async()=>{assert.equal((await call('operator/epochs',{epoch:start-1})).status,409);assert.equal((await call('operator/epochs',{epoch:today})).status,409);});
 await test('empty epoch has no allocation or rollover',async()=>{const row=await op('operator/epochs',{epoch:start});assert.equal(row.skipped,true);assert.equal(row.budget,'0');});
 await share(start,alice,2);await share(start,bob,1);
 await test('manual budget override is rejected',async()=>assert.equal((await call('operator/epochs',{epoch:start,budget:'1'})).status,409));
 await test('concurrent preparation creates one identical immutable snapshot',async()=>{const rows=await Promise.all(Array.from({length:5},()=>op('operator/epochs',{epoch:start})));assert(rows.every(row=>row.root===rows[0].root));assert.equal(rows[0].budget,dailyBudget(1).toString());assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM mining_reward_epochs').first()).n,1);assert.equal(rows[0].allocations.reduce((sum,a)=>sum+BigInt(a.amount),0n),dailyBudget(1));});
 await share(today,alice,2);await share(today,bob,1);
 await test('current estimate uses this epoch only and never grants a claim',async()=>{const row=await schedule.rewardSummary(env,now,alice);assert.equal(row.walletPoints,'2');assert.equal(row.networkPoints,'3');assert.equal(row.estimatedAmount,(dailyBudget(4)*2n/3n).toString());assert.equal(row.settlementOpensAt,(today+1)*86400+300);});
 await test('activation refuses a missing canonical funding transaction',async()=>assert.equal((await call('operator/epochs/'+start+'/activate',{})).status,409));
 await test('schedule configuration detects incompatible runtime token changes',async()=>assert.equal((await call('rewards/summary',undefined,{...env,PERLA_REWARD_TOKEN:alice})).status,409));
 // From here the accepted ledger is a fixture. These tests exercise settlement, not GPU verification.
 const token=await deploy('PerlaTestToken'),distributor=await deploy('PerlaRewards',[token.address]);
 await db.prepare('DELETE FROM mining_reward_epochs').run();
 await db.prepare('UPDATE mining_reward_policy SET token=?,distributor=? WHERE id=1').bind(token.address.toLowerCase(),distributor.address.toLowerCase()).run();
 const local={...env,PERLA_RPC_URL:rpc,PERLA_REWARD_TOKEN:token.address,PERLA_DISTRIBUTOR_ADDRESS:distributor.address,PERLA_SETTLEMENT_DIR:resolve(scratch,'journals')};
 const localDeployment={...deployment,token:token.address,distributor:distributor.address,owner,distributorTransaction:distributor.hash};
 const options={env:local,transport:http(rpc),deployment:localDeployment,operator:(path,payload)=>op(path,payload,local),log:()=>{}};
 let review;
 await test('preparation reviews complete budgets and sends no EVM transaction',async()=>{const before=await client.getTransactionCount({address:owner});review=await settleRewards({...options,action:'review'});assert.equal(await client.getTransactionCount({address:owner}),before);assert.equal(review.epochs.length,1);assert.equal(review.transactionsSent,false);});
 await test('unfunded allocation is not claimable',async()=>assert.equal((await accountRewards(local,alice.toLowerCase())).items[0].status,'pending'));
 await test('a changed plan cannot receive owner funding',async()=>await assert.rejects(settleRewards({...options,action:'settle',key:privateKey,expectedPlan:'0'.repeat(64)}),/changed after review/));
 await test('wrong owner key is rejected before approval or funding',async()=>{const before=await client.getTransactionCount({address:alice});await assert.rejects(settleRewards({...options,action:'settle',key:wrongKey,expectedPlan:review.planHash}),/Owner, token/);assert.equal(await client.getTransactionCount({address:alice}),before);});
 await test('mainnet RPC is rejected before any wallet operation',async()=>{const p=ganache.provider({logging:{quiet:true},chain:{chainId:4663},wallet:{deterministic:true}});try{await assert.rejects(settleRewards({...options,transport:custom(p),action:'settle',key:privateKey,expectedPlan:review.planHash}),/Wrong chain/);}finally{await p.disconnect();}});
 let interrupted=false;
 await test('completed funding survives an interrupted activation workflow',async()=>{await assert.rejects(settleRewards({...options,action:'settle',key:privateKey,expectedPlan:review.planHash,operator:async(path,payload)=>{if(path.endsWith('/funding')&&!interrupted){interrupted=true;throw Error('Simulated operator disconnect');}return op(path,payload,local);}}),/Simulated operator disconnect/);const state=await client.readContract({address:distributor.address,abi:contracts.PerlaRewards.abi,functionName:'epochs',args:[BigInt(start)]});assert.equal(state[1],dailyBudget(1));assert.equal((await op('operator/epochs/'+start,undefined,local)).state,'prepared');});
 await test('retry records funding and activates without duplicate token transfers',async()=>{const before=await client.getTransactionCount({address:owner});const result=await settleRewards({...options,action:'settle',key:privateKey,expectedPlan:review.planHash});assert.equal(await client.getTransactionCount({address:owner}),before);assert.equal(result.completed[0].state,'active');assert((await op('operator/epochs/'+start,undefined,local)).funding_tx);});
 let allocation;
 await test('activated account receives a freshly verified claim',async()=>{allocation=(await accountRewards(local,alice.toLowerCase())).items[0];assert.equal(allocation.status,'claimable');});
 await test('real EVM claim pays the allocated recipient and replay reverts',async()=>{const args=[BigInt(start),BigInt(allocation.index),allocation.address,BigInt(allocation.amount),allocation.proof];let hash=await wallet.writeContract({account:owner,address:distributor.address,abi:contracts.PerlaRewards.abi,functionName:'claim',args,gas:500000n});assert.equal((await client.waitForTransactionReceipt({hash})).status,'success');assert.equal(await client.readContract({address:token.address,abi:contracts.PerlaTestToken.abi,functionName:'balanceOf',args:[alice]}),BigInt(allocation.amount));hash=await wallet.writeContract({account:owner,address:distributor.address,abi:contracts.PerlaRewards.abi,functionName:'claim',args,gas:500000n});assert.equal((await client.waitForTransactionReceipt({hash})).status,'reverted');assert.equal((await accountRewards(local,alice.toLowerCase())).items[0].status,'claimed');});
 await test('completed epochs disappear from settlement and rerun sends no transaction',async()=>{const before=await client.getTransactionCount({address:owner});const row=await settleRewards({...options,action:'settle'});assert.equal(row.epochs.length,0);assert.equal(await client.getTransactionCount({address:owner}),before);});
 await test('RPC outage never becomes a funded claim',async()=>assert.equal((await accountRewards({...local,PERLA_RPC_URL:'http://127.0.0.1:1'},alice.toLowerCase())).items[0].status,'unavailable'));
 await test('additive migrations preserve contribution and epoch rows',async()=>{const before=await db.prepare('SELECT COUNT(*) AS n FROM mining_shares').first();db.migrate(resolve(root,'drizzle'));assert.deepEqual(await db.prepare('SELECT COUNT(*) AS n FROM mining_shares').first(),before);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM mining_reward_epochs').first()).n,1);});
 console.log(passed+' reward-settlement checks passed using real SQLite and a local EVM. Accepted shares were seeded fixtures; no GPU or public-chain transaction was used.');
} finally {db.close();await server.close();await rm(scratch,{recursive:true,force:true});}
