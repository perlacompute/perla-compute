import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const temp=await mkdtemp(join(tmpdir(),'perla-release-'));
try {
 await build({entryPoints:['lib/perla/worker-release-server.ts'],outfile:join(temp,'server.mjs'),bundle:true,platform:'node',format:'esm'});
 await build({entryPoints:['lib/perla/worker-release.ts'],outfile:join(temp,'commands.mjs'),bundle:true,platform:'node',format:'esm'});
 const {createWorkerReleaseResolver}=await import(pathToFileURL(join(temp,'server.mjs')));
 const {workerRelease:r,workerCommands,namedWorkerCommand}=await import(pathToFileURL(join(temp,'commands.mjs')));
 const hash=x=>createHash('sha256').update(x).digest('hex');
 function fixture(){
  const manifest={schema:1,repository:r.repository,version:r.version,tag:r.tag,chainId:r.chainId,protocol:r.protocol,upstreamCommit:r.upstreamCommit,profiles:{rtx:{archive:'perla-rtx-worker.tar.gz'},hopper:{archive:'perla-worker.tar.gz'}}};
  const bodies=new Map(r.assets.filter(n=>n!=='SHA256SUMS').map(n=>[n,Buffer.from(n==='worker-release.json'?JSON.stringify(manifest):'fixture '+n)]));
  bodies.set('SHA256SUMS',Buffer.from([...bodies].map(([n,b])=>hash(b)+'  '+n).join('\n')+'\n'));
  const meta={tag_name:r.tag,html_url:r.page,draft:false,assets:r.assets.map(n=>({name:n,browser_download_url:r.base+n,digest:'sha256:'+hash(bodies.get(n))}))};
  let count=0;
  const request=async(url)=>{count++;if(String(url).startsWith('https://api.github.com/'))return Response.json(meta);const b=bodies.get(String(url).slice(r.base.length));return b?new Response(b):new Response('',{status:404});};
  return {manifest,bodies,meta,request,count:()=>count};
 }
 let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS',name);}
 await test('published release verifies every required asset and manifest',async()=>{const f=fixture(),v=await createWorkerReleaseResolver({request:f.request})();assert.equal(v.state,'available');assert.equal(v.integrityVerified,true);assert.equal(f.count(),7);});
 await test('private or unpublished release is unavailable',async()=>{const v=await createWorkerReleaseResolver({request:async()=>new Response('',{status:404})})();assert.equal(v.reason,'not_public');assert.equal(v.integrityVerified,false);});
 for(const [name,mutate] of [
  ['draft',f=>f.meta.draft=true],['wrong tag',f=>f.meta.tag_name='worker-v9.0.0'],
  ['duplicate asset',f=>f.meta.assets.push(f.meta.assets[0])],['unexpected host',f=>f.meta.assets[0].browser_download_url='https://attacker.test/install.sh'],
  ['modified archive',f=>f.bodies.set('perla-rtx-worker.tar.gz',Buffer.from('tampered'))],
  ['missing file',f=>f.meta.assets.pop()],['oversized checksum',f=>{f.bodies.set('SHA256SUMS',Buffer.alloc(65537));delete f.meta.assets.at(-1).digest;}],
 ])await test(name+' fails closed',async()=>{const f=fixture();mutate(f);assert.equal((await createWorkerReleaseResolver({request:f.request})()).state,'unavailable');});
 await test('missing GitHub digests still require content checksums',async()=>{const f=fixture();f.meta.assets.forEach(a=>delete a.digest);assert.equal((await createWorkerReleaseResolver({request:f.request})()).state,'available');f.bodies.set('install.py',Buffer.from('tamper'));assert.equal((await createWorkerReleaseResolver({request:f.request})()).state,'unavailable');});
 await test('wrong network in a consistently hashed manifest is rejected',async()=>{const f=fixture();f.manifest.chainId=1;f.bodies.set('worker-release.json',Buffer.from(JSON.stringify(f.manifest)));f.bodies.set('SHA256SUMS',Buffer.from([...f.bodies].filter(([n])=>n!=='SHA256SUMS').map(([n,b])=>hash(b)+'  '+n).join('\n')));f.meta.assets.forEach(a=>a.digest='sha256:'+hash(f.bodies.get(a.name)));assert.equal((await createWorkerReleaseResolver({request:f.request})()).reason,'integrity');});
 await test('redirects cannot reach localhost',async()=>{const f=fixture();const v=await createWorkerReleaseResolver({request:async u=>String(u).startsWith(r.base)?new Response('',{status:302,headers:{location:'http://127.0.0.1/private'}}):f.request(u)})();assert.equal(v.reason,'integrity');});
 await test('official asset CDN redirects are allowed',async()=>{const f=fixture();const request=async u=>{if(String(u).startsWith(r.base))return new Response('',{status:302,headers:{location:'https://release-assets.githubusercontent.com/'+String(u).slice(r.base.length)}});if(String(u).startsWith('https://release-assets.githubusercontent.com/'))return new Response(f.bodies.get(new URL(u).pathname.slice(1)));return f.request(u);};assert.equal((await createWorkerReleaseResolver({request})()).state,'available');});
 await test('concurrent checks share one request and successful results expire',async()=>{const f=fixture();let time=0;const resolve=createWorkerReleaseResolver({request:f.request,now:()=>time});await Promise.all([resolve(),resolve(),resolve()]);assert.equal(f.count(),7);await resolve();assert.equal(f.count(),7);time=300001;await resolve();assert.equal(f.count(),14);});
 await test('rate limit backs off and network errors reveal no internal details',async()=>{let calls=0,time=0;const resolve=createWorkerReleaseResolver({request:async()=>{calls++;return new Response('',{status:429});},now:()=>time});assert.equal((await resolve()).reason,'rate_limited');time=300001;await resolve();assert.equal(calls,1);time=900001;await resolve();assert.equal(calls,2);const error=await createWorkerReleaseResolver({request:async()=>{throw Error('SECRET details');}})();assert.equal(error.reason,'unreachable');assert(!JSON.stringify(error).includes('SECRET'));});
 await test('commands are valid shell and match real installer argparse',async()=>{
  const source=process.env.PERLA_INSTALLER_SOURCE || (existsSync('scripts/perla-worker.py') ? 'scripts/perla-worker.py' : undefined);
  if(!source)console.log('NOTE installer parser check skipped: set PERLA_INSTALLER_SOURCE or include scripts/perla-worker.py');
  for(const profile of ['rtx','hopper'])for(const device of [0,1,7])for(const [name,value] of Object.entries(workerCommands(profile,device))){
   assert.equal(spawnSync('bash',['-n'],{input:value,encoding:'utf8'}).status,0,name);
   if(name==='install'){const shell=spawnSync('bash',['-c', 'curl(){ printf "%s\\n" "$@"; }; bash(){ :; };\n'+value],{encoding:'utf8'});assert.equal(shell.status,0);assert(!shell.stdout.split('\n').includes('+'));assert(shell.stdout.includes(r.base+'install.sh'));}
   if(source&&name!=='install'){
    const lines=value.replace(/\\\n/g,' ').split('\n').filter(x=>x.startsWith('"$HOME/.local/bin/perla" '));
    for(const line of lines){let args=line.replace('"$HOME/.local/bin/perla" ','').replace(/ >.*$/,'').replace(/ \\$/,'');const py="import runpy,sys; runpy.run_path(sys.argv[1])['parser']().parse_args(sys.argv[2:])";const result=spawnSync('python3',['-c',py,source,...args.trim().split(/\s+/)],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
   }
  }
 });
 await test('device injection and invalid profiles are rejected',()=>{for(const d of [-1,1.5,256,'0;id'])assert.throws(()=>workerCommands('rtx',d));assert.throws(()=>workerCommands('other'));});
 await test('named worker commands reject shell input and preserve payout routing',()=>{
  const wallet='0x'+'1'.repeat(40);const cmd=namedWorkerCommand(wallet,'home-4090',0);assert(cmd.includes('--wallet '+wallet+' --worker home-4090'));assert(!cmd.includes(' login'));
  assert.equal(spawnSync('bash',['-n'],{input:cmd,encoding:'utf8'}).status,0);
  for(const name of ['x;id','$(id)','--flag','rig\n','..','a'.repeat(49)])assert.throws(()=>namedWorkerCommand(wallet,name));
  for(const address of ['0x'+'0'.repeat(40),wallet+'\n',wallet+';id'])assert.throws(()=>namedWorkerCommand(address,'rig01'));
 });
 console.log(`${passed} worker-release checks passed.`);
} finally {await rm(temp,{recursive:true,force:true});}
