import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import ganache from 'ganache';
import {createPublicClient,createWalletClient,http,defineChain} from 'viem';
import {compileContracts} from '../perla-rewards.mjs';
import {inspectDeployment,validateSigner,contractSmoke,SMOKE_BASE,sendOnce,distributorAbi,tokenAbi} from '../testnet-control.mjs';
import {createSqliteDatabase} from '../../lib/vps/sqlite.mjs';
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(resolve(root,'.sites-runtime-fresh-'));
await build({entryPoints:[resolve(root,'scripts/testnet-reset.mjs')],outfile:join(temp,'reset.mjs'),bundle:true,platform:'node',format:'esm',packages:'external'});
const {resetTestnet}=await import(pathToFileURL(join(temp,'reset.mjs')));
const server=ganache.server({logging:{quiet:true},chain:{chainId:46630},wallet:{deterministic:true}});await server.listen(0,'127.0.0.1');
const rpc='http://127.0.0.1:'+server.address().port,transport=http(rpc),chain=defineChain({id:46630,name:'Local testnet fixture',nativeCurrency:{name:'ETH',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[rpc]}}});
const client=createPublicClient({chain,transport}),wallet=createWalletClient({chain,transport}),[owner,other]=await wallet.getAddresses();
const key=server.provider.getInitialAccounts()[owner.toLowerCase()].secretKey,wrong=server.provider.getInitialAccounts()[other.toLowerCase()].secretKey;
const contracts=await compileContracts();let pass=0;async function test(n,fn){await fn();pass++;console.log('PASS',n);}
async function deploy(name,args=[]){const h=await wallet.deployContract({account:owner,...contracts[name],args,gas:5000000n});return (await client.waitForTransactionReceipt({hash:h})).contractAddress;}
try{
 const token=await deploy('PerlaTestToken'),distributor=await deploy('PerlaRewards',[token]),deployment={chainId:46630,token,distributor,owner},options={transport,deployment},env={PERLA_SETTLEMENT_DIR:join(temp,'journals')};
 await test('runtime token drift is rejected before the reset or signer setup',async()=>await assert.rejects(()=>inspectDeployment({...env,PERLA_REWARD_TOKEN:other},options),/Runtime token/));
 await test('wrong testnet owner cannot configure automatic signing',async()=>await assert.rejects(()=>validateSigner(wrong,env,options),/not the reviewed/));
 await test('reviewed fixed-supply contracts and test ETH are checked before signing',async()=>{const x=await validateSigner(key,env,options);assert.equal(x.balance,10n**27n);assert.equal(x.owner.toLowerCase(),owner.toLowerCase());});
 let smoke;
 await test('isolated real EVM smoke funds 1 PERL and claims it back, without mining allocations',async()=>{smoke=await contractSmoke({key,resetAt:1793647000,env,options});assert.equal(BigInt(smoke.epoch),SMOKE_BASE+1793647000n);assert.equal(smoke.amount,'1000000000000000000');assert.equal(await client.readContract({address:token,abi:tokenAbi,functionName:'balanceOf',args:[owner]}),10n**27n);assert.equal((await client.readContract({address:distributor,abi:distributorAbi,functionName:'epochs',args:[BigInt(smoke.epoch)]}))[2],0n);});
 await test('smoke rerun reconciles the same receipts with no duplicate transactions',async()=>{const before=await client.getTransactionCount({address:owner});const again=await contractSmoke({key,resetAt:1793647000,env,options});assert.equal(again.claimTransaction,smoke.claimTransaction);assert.equal(await client.getTransactionCount({address:owner}),before);const journal=JSON.parse(await readFile(join(temp,'journals/operator-smoke-1793647000/claim.json'),'utf8'));assert.equal(journal.raw,undefined);});
 await test('mainnet is refused before deployment reads or signing',async()=>{const wrongProvider=ganache.provider({logging:{quiet:true},chain:{chainId:4663}});try{const {custom}=await import('viem');await assert.rejects(()=>inspectDeployment(env,{...options,transport:custom(wrongProvider)}),/Wrong chain/);}finally{await wrongProvider.disconnect();}});
 const filename=join(temp,'ledger.sqlite'),db=createSqliteDatabase(filename);db.migrate(resolve(root,'drizzle'));
 await db.prepare("INSERT INTO mining_policy_state VALUES(1,'p1',20754,1,'validated-fixture','89','0.5.0')").run();
 await db.prepare("INSERT INTO mining_workers VALUES('old-worker',?,'old-rig','old-hash',1,1,NULL,'0.5.0','89',NULL)").bind(owner.toLowerCase()).run();
 await db.prepare("INSERT INTO mining_worker_validations VALUES('old-worker','{}','hash',1)").run();
 await db.prepare("INSERT INTO mining_public_workers VALUES('old-worker',1)").run();
 await db.prepare("INSERT INTO mining_auth_sessions VALUES('old-session',?,9999999999)").bind(owner.toLowerCase()).run();
 await db.prepare("INSERT INTO mining_jobs VALUES('old-job','old-worker',20754,'header',1,2,'perla-pearl-plain-v4',486604799,1,'hash','p1')").run();
 await db.prepare("INSERT INTO mining_shares VALUES('old-share','old-job','old-worker',?,20754,'proof',1,11)").bind(owner.toLowerCase()).run();
 await db.prepare("INSERT INTO mining_reward_epochs(epoch,snapshot,manifest,root,budget,distributor,token,state,created) VALUES(20754,'snapshot','{}',?,'684462696783025325119780',?,?,'prepared',1)").bind('0x'+'11'.repeat(32),distributor,token).run();
 db.close();const resetEnv={PERLA_SQLITE_PATH:filename,...env};
 await test('failure inside the destructive transaction rolls back all deleted workers and shares',async()=>{await assert.rejects(()=>resetTestnet({env:resetEnv,now:1793648000,directory:join(temp,'failed-backup'),options,injectFailure:()=>{throw Error('injected commit failure');}}),/injected/);const d=createSqliteDatabase(filename);try{assert.equal((await d.prepare('SELECT COUNT(*) n FROM mining_workers').first()).n,1);assert.equal((await d.prepare('SELECT COUNT(*) n FROM mining_shares').first()).n,1);}finally{d.close();}});
 let reset;
 await test('authorized reset removes old identities, sessions, work and allocations and restarts emission',async()=>{reset=await resetTestnet({env:resetEnv,now:1793648000,directory:join(temp,'reset-backup'),options});assert.equal(reset.oldAllocations[0].action,'cancelled_and_removed');const d=createSqliteDatabase(filename);try{for(const table of ['mining_workers','mining_jobs','mining_shares','mining_auth_sessions','mining_reward_epochs','mining_worker_validations','mining_public_workers'])assert.equal((await d.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0,table);assert.equal((await d.prepare('SELECT start_epoch FROM mining_reward_policy').first()).start_epoch,Math.floor(1793648000/86400));assert.equal((await d.prepare('PRAGMA foreign_key_check').all()).results.length,0);await d.prepare("INSERT INTO mining_workers(id,address,name,token_hash,created) VALUES('new-worker',?,'new-rig','new-hash',1793648001)").bind(owner.toLowerCase()).run();}finally{d.close();}});
 await test('rerunning the same installer never resets new testing history',async()=>{const result=await resetTestnet({env:resetEnv,now:1793649000,options});assert.equal(result.alreadyReset,true);assert.equal(result.deletedAgain,false);const d=createSqliteDatabase(filename);try{assert.equal((await d.prepare('SELECT id FROM mining_workers').first()).id,'new-worker');}finally{d.close();}});
 await test('offline backup retains the pre-reset state while active database is clean',async()=>{const d=createSqliteDatabase(reset.backup);try{assert.equal((await d.prepare('SELECT COUNT(*) n FROM mining_shares').first()).n,1);assert.equal((await d.prepare('SELECT COUNT(*) n FROM mining_workers').first()).n,1);}finally{d.close();}});
 console.log(pass+' fresh-testnet checks passed using SQLite and a local EVM. No public-chain or GPU test was performed.');
}finally{await server.close();await rm(temp,{recursive:true,force:true});}
