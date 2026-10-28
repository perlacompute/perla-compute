import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSqliteDatabase } from '../../lib/vps/sqlite.mjs';
import deployment from '../../deployments/robinhood-testnet.json' with { type: 'json' };
const root=resolve(import.meta.dirname,'../..');await mkdir(resolve(root,'.sites-runtime'),{recursive:true});const dir=await mkdtemp(resolve(root,'.sites-runtime/reward-production-check-')),file=resolve(dir,'fixture.sqlite');
const db=createSqliteDatabase(file);db.migrate(resolve(root,'drizzle'));const epoch=Math.floor(Date.now()/86400000)-1;
await db.prepare("INSERT INTO mining_policy_state VALUES(1,'p1',?,?,?,'89','0.5.0')").bind(epoch,Math.floor(Date.now()/1000),'production-http-fixture').run();
await db.prepare('INSERT INTO mining_shares(id,job_id,worker_id,address,epoch,proof_hash,accepted,points) VALUES(?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID(),deployment.owner.toLowerCase(),epoch,'ab'.repeat(32),epoch*86400+100,11).run();db.close();
const environment={...process.env,HOSTNAME:'127.0.0.1',PORT:'3000',PERLA_SQLITE_PATH:file,PERLA_MIGRATION_DIR:resolve(root,'drizzle'),PERLA_OPERATOR_TOKEN:'fixture-only-production-http-token-'.repeat(2),PERLA_REWARD_TOKEN:deployment.token,PERLA_DISTRIBUTOR_ADDRESS:deployment.distributor,PERLA_MINING_ENABLED:'false'};
const web=spawn(process.execPath,[resolve(root,'.next/standalone/server.js')],{cwd:root,env:environment,stdio:['ignore','pipe','pipe']});const exited=new Promise(r=>web.once('exit',r));let output='';web.stdout.on('data',part=>output+=part);web.stderr.on('data',part=>output+=part);
try{
 for(let i=0;i<80;i++){if(web.exitCode!==null)throw Error('Production server exited: '+output);if(output.includes('Ready'))try{const r=await fetch('http://127.0.0.1:3000/api/mining/status');if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
 for(const path of ['/rewards','/platform/rewards','/whitepaper','/docs','/explorer']){const r=await fetch('http://127.0.0.1:3000'+path);assert.equal(r.status,200,path);const html=await r.text();if(path==='/whitepaper'){assert(html.includes('Perla Matrix v4'));assert(!html.includes('perla-pearl-plain-v4'));}if(path==='/docs')assert(html.includes('bash scripts/perla-rewards.sh'));console.log('PASS production route '+path);}
 const configure=await fetch('http://127.0.0.1:3000/api/mining/operator/rewards/configure',{method:'POST',headers:{authorization:'Bearer '+environment.PERLA_OPERATOR_TOKEN,'content-type':'application/json'},body:'{}'});assert.equal(configure.status,200);
 const current=await fetch('http://127.0.0.1:3000/api/mining/rewards/summary').then(r=>r.json());assert.equal(current.configured,true);assert.equal(current.startEpoch,epoch);assert.equal(current.day,2);console.log('PASS production reward schedule reads the pinned fixture');
 const bundle=spawn(process.execPath,[resolve(root,'scripts/reward-settle.bundle.mjs')],{cwd:resolve(root,'.next/standalone'),env:environment,stdio:['pipe','pipe','pipe']});let out='',err='';bundle.stdout.on('data',b=>out+=b);bundle.stderr.on('data',b=>err+=b);bundle.stdin.end('{"action":"prepare"}\n');const code=await new Promise(r=>bundle.on('exit',r));assert.equal(code,0,err);const report=JSON.parse(out.trim());assert.equal(report.epochs[0].points,'11');assert.equal(report.transactionsSent,false);assert.equal(report.epochs[0].recipients,1);console.log('PASS packaged standalone settlement prepares an exact manifest without a key or transaction');
 const account=await fetch('http://127.0.0.1:3000/api/mining/rewards/account');assert.equal(account.status,401);console.log('PASS production private reward endpoint requires wallet authorization');
}finally{web.kill('SIGTERM');await exited;await rm(dir,{recursive:true,force:true});}
