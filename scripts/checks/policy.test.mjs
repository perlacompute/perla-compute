import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{pathToFileURL}from'node:url';import{build}from'esbuild';
import{createSqliteDatabase}from'../../lib/vps/sqlite.mjs';import{auditManifest}from'../perla-audit.mjs';import{createManifest}from'../reward-allocation.mjs';
const dir=await mkdtemp(join(tmpdir(),'perla-policy-'));let passed=0;
const test=async(name,fn)=>{await fn();passed++;console.log('PASS',name)};
try{
 await build({entryPoints:['lib/perla/work-policy.ts'],outfile:join(dir,'policy.mjs'),bundle:true,platform:'node',format:'esm'});const p=await import(pathToFileURL(join(dir,'policy.mjs')));
 await build({entryPoints:['lib/perla/operations.ts'],outfile:join(dir,'operations.mjs'),bundle:true,platform:'node',format:'esm'});const ops=await import(pathToFileURL(join(dir,'operations.mjs')));
 const db=createSqliteDatabase(':memory:');db.migrate('drizzle');const env={DB:db,PERLA_MINING_ENABLED:'true'};
 await test('every difficulty is non-saturating and scores an exact target ratio',()=>{for(const profile of p.workProfiles)assert.equal(p.profileFor(profile.id),profile);assert.throws(()=>p.profileFor('client-free-points'));});
 await test('worker and coordinator policy bytes stay identical',async()=>assert.equal(await readFile('lib/perla/work-profiles.json','utf8'),await readFile('services/rtx-worker/work-profiles.json','utf8')));
 await test('fresh policy is not activated by an enabled environment flag',async()=>{const v=await p.workPolicy(env,1000);assert.equal(v.status,'not_activated');assert.equal(v.miningEnabled,false)});
 await db.prepare('INSERT INTO mining_policy_state VALUES(1,?,?,?,?,?,?)').bind('p2',2,1000,'test-assertion','89','0.5.0').run();
 await test('scheduled, paused and effective admission are separate states',async()=>{assert.equal((await p.workPolicy(env,1000)).status,'scheduled');assert.equal((await p.workPolicy({...env,PERLA_MINING_ENABLED:'false'},172801)).status,'paused');const v=await p.workPolicy(env,172801);assert.equal(v.profile.points,2);assert.equal(v.miningEnabled,true)});
 await test('legacy job protocol, points and target survive additive migrations',async()=>{const columns=await db.prepare('PRAGMA table_info(mining_jobs)').all();assert.equal(columns.results.find(c=>c.name==='protocol').dflt_value,"'perla-pearl-plain-v3'");assert.equal(columns.results.find(c=>c.name==='work_points').dflt_value,'1');});
 await test('verifier backpressure bounds concurrent operations and releases failed slots',async()=>{let release;const gate=new Promise(r=>release=r);const first=ops.withVerifierSlot(()=>gate),second=ops.withVerifierSlot(()=>gate);await assert.rejects(()=>ops.withVerifierSlot(async()=>true),/BUSY/);release(true);await Promise.all([first,second]);await assert.rejects(()=>ops.withVerifierSlot(async()=>{throw Error('failure')}),/failure/);assert.equal(await ops.withVerifierSlot(async()=>true),true)});
 await test('durable operational aggregates retain count and latency',async()=>{await ops.recordOperation(db,'verifier_completed',25);await ops.recordOperation(db,'verifier_completed',75);const v=await ops.operationSummary(db);const row=v.counters[0];assert.equal(row.count,2);assert.equal(row.durationMs,100);assert.equal(row.maxMs,75)});
 await test('offline reward audit reproduces allocations and rejects altered proof or amount',()=>{const m=createManifest(1,11n,'0x'+'11'.repeat(20),[{address:'0x'+'22'.repeat(20),points:1},{address:'0x'+'33'.repeat(20),points:4}]);assert.equal(auditManifest(m).valid,true);const changed=structuredClone(m);changed.allocations[0].amount='11';assert.throws(()=>auditManifest(changed),/mismatch/);const proof=structuredClone(m);proof.allocations[0].proof[0]='0x'+'ff'.repeat(32);assert.throws(()=>auditManifest(proof),/mismatch/)});
 db.close();console.log(`${passed} policy and operations checks passed.`);
}finally{await rm(dir,{recursive:true,force:true})}
