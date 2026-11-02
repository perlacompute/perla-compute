/** Fresh JSON-RPC doubles exercise cancellation guards; no public-chain calls. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {encodeAbiParameters,toFunctionSelector} from 'viem';
import {createSqliteDatabase} from '../../lib/vps/sqlite.mjs';
import deployment from '../../deployments/robinhood-testnet.json' with {type:'json'};
const root=resolve(import.meta.dirname,'../..'),temp=await mkdtemp(resolve(root,'.sites-runtime-cancellation-'));
for(const n of ['reward-cancellation','rewards'])await build({entryPoints:[resolve(root,'lib/perla/'+n+'.ts')],outfile:join(temp,n+'.mjs'),bundle:true,platform:'node',format:'esm',packages:'external'});
const {cancelOwnerValidationAllocation:cancel}=await import(pathToFileURL(join(temp,'reward-cancellation.mjs'))),{createManifest}=await import(pathToFileURL(join(temp,'rewards.mjs')));
let funded=false,outage=false,reorg=false,blocks=0,wrongToken=false;const requests=[];
const server=createServer(async(req,res)=>{let raw='';for await(const p of req)raw+=p;const q=JSON.parse(raw);requests.push(q);if(outage){res.writeHead(503);res.end('outage');return;}let result;
 if(q.method==='eth_chainId')result='0x'+(46630).toString(16);
 else if(q.method==='eth_getBlockByNumber'){blocks++;result={number:'0x64',hash:'0x'+(reorg&&blocks>1?'bb':'aa').repeat(32),parentHash:'0x'+'00'.repeat(32),timestamp:'0x1',transactions:[]};}
 else if(q.method==='eth_call'){assert.equal(q.params[0].to.toLowerCase(),deployment.distributor.toLowerCase());assert.equal(q.params[1],'0x64');result=q.params[0].data.startsWith(toFunctionSelector('rewardToken()'))?encodeAbiParameters([{type:'address'}],[wrongToken?'0x'+'22'.repeat(20):deployment.token]):encodeAbiParameters([{type:'bytes32'},{type:'uint256'},{type:'uint256'}],['0x'+(funded?'11':'00').repeat(32),funded?1n:0n,funded?1n:0n]);}
 else throw Error('Unexpected RPC '+q.method);
 res.setHeader('content-type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const rpc='http://127.0.0.1:'+server.address().port;
const dbs=[];async function fixture({recipient=deployment.owner,points=11,state='prepared',funding=null}={}){funded=false;outage=false;reorg=false;wrongToken=false;blocks=0;requests.length=0;const db=createSqliteDatabase(':memory:');dbs.push(db);db.migrate(resolve(root,'drizzle'));const budget='684462696783025325119780',m=createManifest(20754,BigInt(budget),deployment.distributor,[{address:recipient.toLowerCase(),points}]);
 await db.prepare('INSERT INTO mining_reward_epochs(epoch,snapshot,manifest,root,budget,distributor,token,state,created,funding_tx) VALUES(20754,?,?,?,?,?,?,?,1,?)').bind('original',JSON.stringify(m),m.root,budget,deployment.distributor,deployment.token,state,funding).run();
 for(let i=0;i<11;i++)await db.prepare('INSERT INTO mining_shares(id,job_id,worker_id,address,epoch,proof_hash,accepted,points) VALUES(?,?,?,?,20754,?,1,1)').bind(crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID(),deployment.owner.toLowerCase(),'11'.repeat(32)).run();return {db,env:{DB:db,PERLA_RPC_URL:rpc},m};}
let passed=0;async function test(n,f){await f();passed++;console.log('PASS',n);}
try{
 await test('only the exact unfunded owner validation allocation is cancelled; history and manifest survive',async()=>{const f=await fixture(),r=await cancel(f.env,200);assert.equal(r.state,'cancelled');assert.equal(r.budget,'684462696783025325119780');assert.equal(r.onchainTransactionSent,false);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM mining_shares').first()).n,11);assert.equal((await f.db.prepare('SELECT manifest FROM mining_reward_epochs').first()).manifest,JSON.stringify(f.m));assert(!requests.some(q=>q.method.includes('send')));});
 await test('repeat cancellation retains the original audit event',async()=>{const f=await fixture(),a=await cancel(f.env,200),b=await cancel(f.env,300);assert.equal(a.cancelled,b.cancelled);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM mining_allocation_cancellations').first()).n,1);});
 await test('funded onchain root prevents cancellation',async()=>{const f=await fixture();funded=true;await assert.rejects(()=>cancel(f.env,200),/did not prove/);assert.equal((await f.db.prepare('SELECT state FROM mining_reward_epochs').first()).state,'prepared');});
 await test('RPC failure or a reorg cannot be treated as unfunded',async()=>{for(const kind of ['outage','reorg']){const f=await fixture();if(kind==='outage')outage=true;else reorg=true;await assert.rejects(()=>cancel(f.env,200),/did not prove/);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM mining_allocation_cancellations').first()).n,0);}});
 await test('wrong recipient, work total, funded metadata and active state are preserved',async()=>{for(const changes of [{recipient:'0x'+'22'.repeat(20)},{points:12},{funding:'0x'+'11'.repeat(32)},{state:'active'}]){const f=await fixture(changes);await assert.rejects(()=>cancel(f.env,200),/differs/);assert.equal(requests.length,0);}});
 await test('tampered original root and mismatched reward token are rejected',async()=>{const f=await fixture();await f.db.prepare('UPDATE mining_reward_epochs SET root=?').bind('0x'+'33'.repeat(32)).run();await assert.rejects(()=>cancel(f.env,200),/integrity/);const g=await fixture();wrongToken=true;await assert.rejects(()=>cancel(g.env,200),/did not prove/);});
 console.log(passed+' cancellation checks passed with real SQLite and explicit RPC doubles.');
}finally{for(const db of dbs)db.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});}
