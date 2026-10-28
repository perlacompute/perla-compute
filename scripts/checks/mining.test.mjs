/** Real SQLite/D1 + signed wallet + native Pearl verification integration.
 * Native fixture generation uses CPU mathematics, not a GPU performance test. */
import assert from 'node:assert/strict';
import {readFile,mkdir,rm,realpath} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createConnection} from 'node:net';
import {createInterface} from 'node:readline';
import {once} from 'node:events';
import {build} from 'esbuild';
import {privateKeyToAccount} from 'viem/accounts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const nativePython=process.env.PERLA_NATIVE_PYTHON;
const source=process.env.PERLA_PEARL_SOURCE;
if(!nativePython||!source)throw Error('Set PERLA_NATIVE_PYTHON and PERLA_PEARL_SOURCE for the native integration test.');
const scratch=resolve(root,'.sites-runtime/mining-checks');await mkdir(scratch,{recursive:true});
await build({entryPoints:[resolve(root,'lib/perla/coordinator.ts')],outfile:resolve(scratch,'coordinator.mjs'),bundle:true,platform:'node',format:'esm',target:'node22'});
const {handleMiningRequest}=await import(pathToFileURL(resolve(scratch,'coordinator.mjs')));
const {createSqliteDatabase}=await import(pathToFileURL(resolve(root,'lib/vps/sqlite.mjs')));
const db=createSqliteDatabase(':memory:');
db.migrate(resolve(root,'drizzle'));
const secret='test-only-native-verifier-secret-'.repeat(2);
const verifier=spawn(nativePython,[resolve(root,'services/pearl-adapter/verifier.py'),'--port','0'],{env:{...process.env,PERLA_PEARL_SOURCE:source,PERLA_VERIFIER_TOKEN:secret},stdio:['ignore','pipe','pipe']});
let nativeLog='';verifier.stderr.on('data',d=>nativeLog+=d);
const nativePort=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Native verifier startup timeout: '+nativeLog)),20000);verifier.on('exit',()=>{clearTimeout(timer);reject(Error('Native verifier failed: '+nativeLog));});verifier.stdout.on('data',d=>{const m=String(d).match(/127\.0\.0\.1:(\d+)/);if(m){clearTimeout(timer);resolve(Number(m[1]));}});});
const env={DB:db,PERLA_MINING_ENABLED:'true',PERLA_VERIFIER_URL:`http://127.0.0.1:${nativePort}`,PERLA_VERIFIER_TOKEN:secret,PERLA_OPERATOR_TOKEN:'operator-test-secret-'.repeat(3)};
const a=privateKeyToAccount('0x'+'11'.repeat(32));const b=privateKeyToAccount('0x'+'22'.repeat(32));
const cookies=new Map();let passed=0;
const test=async(name,fn)=>{await fn();passed++;console.log('PASS',name);};
function req(path,{method='GET',body,cookie,address=a.address,token,origin='https://perla.test'}={}){
 const headers={'content-type':'application/json',origin,'x-perla-protocol':'perla-pearl-plain-v4'};if(cookie)headers.cookie=cookie;if(token)headers.authorization='Bearer '+token;
 return new Request('https://perla.test/api/mining/'+path,{method,headers,...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
}
const call=(path,options={},cfg=env)=>handleMiningRequest(req(path,options),cfg);
async function login(who){const challenge=await (await call('auth/challenge',{method:'POST',body:{address:who.address}})).json();const signature=await who.signMessage({message:challenge.message});const response=await call('auth/verify',{method:'POST',body:{id:challenge.id,signature}});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];cookies.set(who.address,cookie);return cookie;}
async function add(who=a){const response=await call('workers',{method:'POST',cookie:cookies.get(who.address),body:{name:'Native integration worker'}});assert.equal(response.status,201);return response.json();}
async function job(w){const response=await call('work',{token:w.token});assert.equal(response.status,200,JSON.stringify(await response.clone().json()));return response.json();}
function fixture(j){const p=spawnSync(nativePython,[resolve(root,'services/pearl-adapter/native-fixture.py')],{input:JSON.stringify({header:j.mining_job.incomplete_header_bytes}),encoding:'utf8',timeout:60000});assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout);}
const share=(w,j,p)=>call('shares',{method:'POST',token:w.token,body:{jobId:j.id,plainProof:p.plain_proof}});
try{
 await test('unconfigured storage fails closed',async()=>assert.equal((await call('account',{},{})).status,503));
 await test('account requires wallet authorization',async()=>assert.equal((await call('account')).status,401));
 await test('cross-origin authorization is rejected',async()=>assert.equal((await call('auth/challenge',{method:'POST',origin:'https://attacker.test',body:{address:a.address}})).status,403));
 await test('malformed JSON fails validation',async()=>assert.equal((await call('auth/challenge',{method:'POST',body:'{'})).status,400));
 await test('one-time signed nonce cannot be replayed concurrently',async()=>{
  const c=await(await call('auth/challenge',{method:'POST',body:{address:a.address}})).json();const signature=await a.signMessage({message:c.message});const results=await Promise.all([call('auth/verify',{method:'POST',body:{id:c.id,signature}}),call('auth/verify',{method:'POST',body:{id:c.id,signature}})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);
 });
 await test('another wallet cannot sign an account challenge',async()=>{const c=await(await call('auth/challenge',{method:'POST',body:{address:a.address}})).json();const signature=await b.signMessage({message:c.message});assert.equal((await call('auth/verify',{method:'POST',body:{id:c.id,signature}})).status,401);});
 await login(a);await login(b);
 await test('worker creation requires the authenticated cookie',async()=>assert.equal((await call('workers',{method:'POST',body:{name:'No auth'}})).status,401));
 const w=await add();const other=await add(b);
 await test('public wallet-and-name registration is idempotent and grants no account session',async()=>{
  const token='ab'.repeat(32),opts={method:'POST',token,body:{wallet:a.address,name:'home-4090'}};
  const rs=await Promise.all([call('worker/connect',opts),call('worker/connect',opts)]);
  assert(rs.every(r=>r.status===200));const first=await rs[0].json(),second=await rs[1].json();assert.equal(first.id,second.id);assert.equal(first.address,a.address.toLowerCase());assert.equal(first.walletOwnershipVerified,false);
  assert.equal(rs[0].headers.get('set-cookie'),null);assert(!JSON.stringify(first).includes(token));assert.equal((await call('account',{token})).status,401);
  const stored=await db.prepare('SELECT token_hash FROM mining_workers WHERE id=?').bind(first.id).first();assert.notEqual(stored.token_hash,token);
  const dashboard=await(await call('account',{cookie:cookies.get(a.address)})).json();assert(dashboard.workers.some(x=>x.id===first.id&&x.name==='home-4090'));
  assert.equal((await call('worker/connect',{...opts,body:{wallet:b.address,name:'home-4090'}})).status,409);
  assert.equal((await call('worker/connect',{...opts,body:{wallet:a.address,name:'renamed'}})).status,409);
  assert.equal((await call('work',{token})).status,503);
  await call('workers/'+first.id,{method:'DELETE',cookie:cookies.get(a.address)});
  assert.equal((await call('worker/connect',opts)).status,409);assert.equal((await call('worker/status',{token})).status,401);
  await db.prepare('DELETE FROM mining_public_workers WHERE worker_id=?').bind(first.id).run();await db.prepare('DELETE FROM mining_workers WHERE id=?').bind(first.id).run();
 });
 await test('worker names do not grant access to another rig with the same label',async()=>{
  const rows=[];for(const token of ['ac'.repeat(32),'ad'.repeat(32)]){
   const response=await call('worker/connect',{method:'POST',token,body:{wallet:a.address,name:'rig01'}});assert.equal(response.status,200);rows.push(await response.json());
  }
  assert.notEqual(rows[0].id,rows[1].id);
  for(const row of rows){await db.prepare('DELETE FROM mining_public_workers WHERE worker_id=?').bind(row.id).run();await db.prepare('DELETE FROM mining_workers WHERE id=?').bind(row.id).run();}
 });
 await test('public connection validates address, secret and shell-safe rig names',async()=>{
  assert.equal((await call('worker/connect',{method:'POST',body:{wallet:a.address,name:'rig01'}})).status,401);
  for(const name of ['rig;touch-x','$(whoami)','--flag','rig01\n','..'])assert.equal((await call('worker/connect',{method:'POST',token:'ae'.repeat(32),body:{wallet:a.address,name}})).status,400);
  assert.equal((await call('worker/connect',{method:'POST',token:'af'.repeat(32),body:{wallet:'0x'+'0'.repeat(40),name:'rig01'}})).status,400);
 });
 await test('public registrations cannot exhaust the signed-wallet worker quota',async()=>{
  for(let i=0;i<32;i++){
   await db.prepare('INSERT INTO mining_workers(id,address,name,token_hash,created) VALUES(?,?,?,?,?)').bind('quota-fixture-'+i,a.address.toLowerCase(),'fixture-'+i,'quota-token-'+i,0).run();
   await db.prepare('INSERT INTO mining_public_workers(worker_id,created) VALUES(?,0)').bind('quota-fixture-'+i).run();
  }
  const signed=await add();assert(signed.id);
  for(let i=0;i<32;i++){await db.prepare('DELETE FROM mining_public_workers WHERE worker_id=?').bind('quota-fixture-'+i).run();await db.prepare('DELETE FROM mining_workers WHERE id=?').bind('quota-fixture-'+i).run();}
  await db.prepare('DELETE FROM mining_workers WHERE id=?').bind(signed.id).run();
 });
 await test('fresh policy keeps admission closed even when the master switch is enabled',async()=>{assert.equal((await(await call('status')).json()).miningEnabled,false);assert.equal((await call('work',{token:w.token})).status,503);});
 const validation={version:'0.5.0',protocol:'perla-pearl-plain-v4',upstreamCommit:'82e6eee7076aafe10123e08db78f100d270c0582',gpuSelfTestPassed:true,device:{computeCapability:89,name:'TEST ASSERTION ONLY'},cases:[2048,4096].map(k=>({k,fullGemmMatchesReference:true,allTranscriptsMatchReference:true,nativeV3ProofAccepted:true,nonWinningPowRejected:true,changedChallengeRejected:true}))};

 await test('CLI pairing requires wallet approval and permits only one credential exchange',async()=>{
  const init=await call('pairing/start',{method:'POST',body:{name:'Paired CLI'}});assert.equal(init.status,201);const pair=await init.json();
  assert.equal((await call('pairing/exchange',{method:'POST',token:pair.deviceSecret,body:{}})).status,202);
  assert.equal((await call('pairing/approve',{method:'POST',body:{code:pair.userCode}})).status,401);
  assert.equal((await call('pairing/approve',{method:'POST',cookie:cookies.get(a.address),origin:'https://evil.test',body:{code:pair.userCode}})).status,403);
  assert.equal((await call('pairing/approve',{method:'POST',cookie:cookies.get(a.address),body:{code:pair.userCode}})).status,200);
  const results=await Promise.all([call('pairing/exchange',{method:'POST',token:pair.deviceSecret,body:{}}),call('pairing/exchange',{method:'POST',token:pair.deviceSecret,body:{}})]);
  assert.equal(results.filter(r=>r.status===201).length,1);const value=await results.find(r=>r.status===201).json();
  assert.equal(value.address,a.address.toLowerCase());assert.equal((await call('worker/status',{token:value.token})).status,200);
  const read=await(await call('account',{cookie:cookies.get(a.address)})).text();assert(!read.includes(value.token));
  await call('workers/'+value.id,{method:'DELETE',cookie:cookies.get(a.address)});await db.prepare('DELETE FROM mining_workers WHERE id=?').bind(value.id).run();
 });
 await test('expired device pairing cannot be claimed and never creates a worker',async()=>{
  const pair=await(await call('pairing/start',{method:'POST',body:{name:'Expired'}})).json();await db.prepare('UPDATE mining_device_pairings SET expires=0').run();
  assert.equal((await call('pairing/exchange',{method:'POST',token:pair.deviceSecret,body:{}})).status,410);
 });
 await test('validation upload is authenticated and does not open public admission',async()=>{
  const report={...validation,coordinatorContacted:false,ledgerCredit:0,cases:validation.cases.map(c=>({...c,signedExtremesMatchReference:true}))};
  assert.equal((await call('worker/validation',{method:'POST',body:{report}})).status,401);
  assert.equal((await call('worker/validation',{method:'POST',token:w.token,body:{report:{}}})).status,400);
  const r=await call('worker/validation',{method:'POST',token:w.token,body:{report}});assert.equal(r.status,200);assert.equal((await r.json()).uploaded,true);
  assert.equal((await(await call('status')).json()).miningEnabled,false);
 });
 await test('operator-controlled trial admits only its named worker and one genuine native proof',async()=>{
  const cfg={...env,PERLA_MINING_ENABLED:'false'};
  assert.equal((await call('operator/validations')).status,401);
  const rows=await(await call('operator/validations',{token:env.PERLA_OPERATOR_TOKEN})).json();const report=rows.validations.find(v=>v.worker_id===w.id);
  assert.equal((await call('operator/trials',{method:'POST',token:env.PERLA_OPERATOR_TOKEN,body:{workerId:w.id,validationHash:'stale'}})).status,409);
  assert.equal((await call('operator/trials',{method:'POST',token:env.PERLA_OPERATOR_TOKEN,body:{workerId:w.id,validationHash:report.hash}},cfg)).status,200);
  assert.equal((await call('work',{token:other.token},cfg)).status,503);
  const jr=await call('work',{token:w.token},cfg);assert.equal(jr.status,200);const j=await jr.json();const proof=fixture(j);
  await db.prepare("UPDATE mining_jobs SET protocol='test-hold' WHERE id=?").bind(j.id).run();const jr2=await call('work',{token:w.token},cfg);assert.equal(jr2.status,200);const j2=await jr2.json();const proof2=fixture(j2);await db.prepare("UPDATE mining_jobs SET protocol='perla-pearl-plain-v4' WHERE id=?").bind(j.id).run();
  const rs=await Promise.all([call('shares',{method:'POST',token:w.token,body:{jobId:j.id,plainProof:proof.plain_proof}},cfg),call('shares',{method:'POST',token:w.token,body:{jobId:j2.id,plainProof:proof2.plain_proof}},cfg)]);
  assert.equal(rs.filter(r=>r.status===201).length,1);assert.equal((await call('work',{token:w.token},cfg)).status,503);
  assert.equal((await(await call('status',{},cfg)).json()).miningEnabled,false);
  // Isolate the pre-existing integration expectations from this explicit trial fixture.
  await db.prepare('DELETE FROM mining_shares WHERE worker_id=?').bind(w.id).run();await db.prepare('DELETE FROM mining_worker_trials').run();await db.prepare('DELETE FROM mining_jobs').run();
 });
 await test('policy activation requires an authenticated current GPU report',async()=>{assert.equal((await call('operator/policy',{method:'POST',body:{profile:'p1',startEpoch:Math.floor(Date.now()/86400000),validation}})).status,401);assert.equal((await call('operator/policy',{method:'POST',token:env.PERLA_OPERATOR_TOKEN,body:{profile:'p1',startEpoch:Math.floor(Date.now()/86400000),validation:{}}})).status,400);const r=await call('operator/policy',{method:'POST',token:env.PERLA_OPERATOR_TOKEN,body:{profile:'p1',startEpoch:Math.floor(Date.now()/86400000),validation}});assert.equal(r.status,200,await r.clone().text());});

 await test('worker secrets are hashed and never returned by account reads',async()=>{const result=await(await call('account',{cookie:cookies.get(a.address)})).json();assert.equal(result.workers.length,1);assert(!JSON.stringify(result).includes(w.token));const row=await db.prepare('SELECT token_hash FROM mining_workers WHERE id=?').bind(w.id).first();assert.notEqual(row.token_hash,w.token);});
 await test('paused admission does not create a job',async()=>assert.equal((await call('work',{token:w.token},{...env,PERLA_MINING_ENABLED:'false'})).status,503));
 await test('missing native verifier does not create work',async()=>assert.equal((await call('work',{token:w.token},{...env,PERLA_VERIFIER_URL:undefined})).status,503));
 let j=await job(w);let proof=fixture(j);
 await test('native job envelope binds wallet and fixed certificate version',async()=>{assert.equal(Buffer.from(j.mining_job.incomplete_header_bytes,'base64').length,76);assert.equal(j.recipient,a.address.toLowerCase());assert.equal(j.mining_job.cert_version,3);assert.equal(j.chainId,46630);});
 await test('another worker cannot submit a valid proof for this job',async()=>assert.equal((await share(other,j,proof)).status,409));
 await test('altered native proof is rejected without credit',async()=>{const raw=Buffer.from(proof.plain_proof,'base64');raw[Math.floor(raw.length/2)]^=1;const response=await share(w,j,{plain_proof:raw.toString('base64')});assert([422,503].includes(response.status));const total=await db.prepare('SELECT COUNT(*) AS n FROM mining_shares').first();assert.equal(total.n,0);});
 await test('valid native Pearl proof creates one durable contribution',async()=>{const response=await share(w,j,proof);assert.equal(response.status,201,JSON.stringify(await response.clone().json()));const result=await(await call('account',{cookie:cookies.get(a.address)})).json();assert.equal(result.totals.points,1);assert.equal(result.history.length,1);});
 await test('duplicate proof never credits twice',async()=>assert.equal((await share(w,j,proof)).status,409));
 const next=await job(w);
 await test('a proof cannot be replayed on a new work envelope',async()=>assert.equal((await share(w,next,proof)).status,422));
 const fresh=fixture(next);
 await test('concurrent native submissions credit a job exactly once',async()=>{const responses=await Promise.all([share(w,next,fresh),share(w,next,fresh)]);assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);});
 j=await job(w);proof=fixture(j);
 await test('expired native work is rejected',async()=>{await db.prepare('UPDATE mining_jobs SET expires=0 WHERE id=?').bind(j.id).run();assert.equal((await share(w,j,proof)).status,409);});
 await test('revoked worker cannot request new work',async()=>{await call('workers/'+other.id,{method:'DELETE',cookie:cookies.get(b.address)});assert.equal((await call('work',{token:other.token})).status,401);});
 await test('one account cannot revoke another account’s worker',async()=>{await call('workers/'+w.id,{method:'DELETE',cookie:cookies.get(b.address)});assert.equal((await call('work',{token:w.token})).status,200);});
 await test('reward preparation requires operator authorization',async()=>assert.equal((await call('operator/epochs',{method:'POST',body:{epoch:1,budget:'100'}})).status,401));
 await test('an open epoch cannot be finalized',async()=>assert.equal((await call('operator/epochs',{method:'POST',token:env.PERLA_OPERATOR_TOKEN,body:{epoch:Math.floor(Date.now()/86400000),budget:'100'}})).status,400));
 await test('contribution points do not fabricate token rewards',async()=>{const account=await(await call('account',{cookie:cookies.get(a.address)})).json();assert.equal(account.totals.points,2);assert.deepEqual(account.rewards,[]);});
 await test('upstream-compatible TCP JSON-RPC bridge completes the native work-to-ledger flow',async()=>{
  const server=createServer(async(incoming,outgoing)=>{try{const parts=[];for await(const chunk of incoming)parts.push(chunk);const response=await handleMiningRequest(new Request(`http://127.0.0.1:${server.address().port}${incoming.url}`,{method:incoming.method,headers:incoming.headers,...(parts.length?{body:Buffer.concat(parts)}:{})}),env);outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(Buffer.from(await response.arrayBuffer()));}catch{outgoing.writeHead(500);outgoing.end('{}');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const bridge=spawn(nativePython,[resolve(root,'services/pearl-adapter/perla_bridge.py'),'--port','0'],{env:{...process.env,PERLA_ENDPOINT:`http://127.0.0.1:${server.address().port}`,PERLA_WORKER_TOKEN:w.token},stdio:['ignore','pipe','pipe']});
  let socket,reader;
  try{
   const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Bridge startup timeout')),10000);bridge.on('exit',()=>reject(Error('Bridge stopped')));bridge.stdout.on('data',d=>{const m=String(d).match(/127\.0\.0\.1:(\d+)/);if(m){clearTimeout(timer);resolve(Number(m[1]));}});});
   socket=createConnection({host:'127.0.0.1',port});await once(socket,'connect');reader=createInterface({input:socket});
   const receive=()=>once(reader,'line').then(([line])=>line);
   let response=receive();socket.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'getMiningInfo',params:{}})+'\n');const raw=await response;const miningJob=JSON.parse(raw).result;assert(miningJob?.incomplete_header_bytes);
   const targetDigits=raw.match(/"target"\s*:\s*(\d+)/)[1];const proof=fixture({mining_job:miningJob});
   const wire=JSON.stringify({jsonrpc:'2.0',id:2,method:'submitPlainProof',params:{plain_proof:proof.plain_proof,mining_job:{...miningJob,target:'__PERLA_TARGET__'}}}).replace('"__PERLA_TARGET__"',targetDigits);
   response=receive();socket.write(wire+'\n');const receipt=JSON.parse(await response);assert.equal(receipt.result?.accepted,true,JSON.stringify(receipt));
   const row=await db.prepare('SELECT id FROM mining_shares WHERE id=?').bind(receipt.result.receipt).first();assert(row);
  }finally{reader?.close();socket?.destroy();bridge.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 });
 await test('job difficulty and scoring remain immutable across a profile change',async()=>{
  const before=await job(w);const now=Math.floor(Date.now()/86400000);const activated=await call('operator/policy',{method:'POST',token:env.PERLA_OPERATOR_TOKEN,body:{profile:'p4',startEpoch:now,validation}});assert.equal(activated.status,200);const same=await job(w);assert.equal(same.id,before.id);assert.equal(same.workPolicy.points,1);await db.prepare('UPDATE mining_jobs SET expires=0 WHERE id=?').bind(same.id).run();const weighted=await job(w);assert.equal(weighted.workPolicy.points,4);const submitted=await share(w,weighted,fixture(weighted));assert.equal(submitted.status,201,await submitted.clone().text());assert.equal((await submitted.json()).points,4);
 });
 await test('legacy worker requests fail with an explicit upgrade status',async()=>{const request=req('work',{token:w.token});request.headers.delete('x-perla-protocol');assert.equal((await handleMiningRequest(request,env)).status,426);});
 await test('operational worker counts never expose credentials',async()=>{const response=await call('worker/status',{token:w.token});assert.equal(response.status,200);const data=await response.json();assert.equal(data.ledgerCredit,0);assert(!JSON.stringify(data).includes(w.token));assert(data.counts.some(c=>c.kind==='accepted'));});
 await test('public miner identity earns only after a genuine bound proof reaches the wallet ledger',async()=>{
  const token='ba'.repeat(32);const connected=await(await call('worker/connect',{method:'POST',token,body:{wallet:b.address,name:'public-4090'}})).json();
  const publicWorker={id:connected.id,token};const j=await job(publicWorker);assert.equal(j.recipient,b.address.toLowerCase());
  const receipt=await share(publicWorker,j,fixture(j));assert.equal(receipt.status,201,await receipt.clone().text());
  const account=await(await call('account',{cookie:cookies.get(b.address)})).json();assert.equal(account.totals.shares,1);assert(account.history.some(s=>s.worker_id===connected.id));
  assert.equal((await call('rewards/account',{token})).status,401);
 });
 await test('logout invalidates the browser session',async()=>{await call('auth/logout',{method:'POST',cookie:cookies.get(b.address)});assert.equal((await call('account',{cookie:cookies.get(b.address)})).status,401);});
 console.log(`${passed} mining integration checks passed. Real native PlainProof verification; CPU fixture generation only.`);
}finally{verifier.kill();db.close();await rm(scratch,{recursive:true,force:true});}
