/** Exercise the real production Next.js server and its SQLite ledger over HTTP. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { privateKeyToAccount } from 'viem/accounts';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'perla-vps-http-'));
const socket = createServer().listen(0, '127.0.0.1'); await once(socket, 'listening');
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const origin = `http://127.0.0.1:${port}`;
let child, logs = '', cookie = '', workerId, workerToken;
const who = privateKeyToAccount('0x' + '33'.repeat(32));
const env = { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1', PERLA_SQLITE_PATH: resolve(temp, 'ledger.sqlite'),
  PERLA_MINING_ENABLED: 'false', PERLA_VERIFIER_URL: '', PERLA_VERIFIER_TOKEN: '', PERLA_PUBLIC_ORIGIN: '' };
const fixture={schema:1,repository:'perlacompute/perla-compute',tag:'worker-v0.7.0',version:'0.7.0',chainId:46630,protocol:'perla-pearl-plain-v4',upstreamCommit:'82e6eee7076aafe10123e08db78f100d270c0582',profiles:{rtx:{archive:'perla-rtx-worker.tar.gz'},hopper:{archive:'perla-worker.tar.gz'}}};
const preload=resolve(temp,'mock-github.mjs');
await writeFile(preload, `import {createHash} from 'node:crypto';
const base='https://github.com/perlacompute/perla-compute/releases/download/worker-v0.7.0/';
const data=new Map(['install.sh','install.py','worker-release.json','perla-rtx-worker.tar.gz','perla-worker.tar.gz'].map(n=>[n,Buffer.from(n==='worker-release.json'?JSON.stringify(${JSON.stringify(fixture)}):'fixture '+n)]));
const hash=x=>createHash('sha256').update(x).digest('hex');
data.set('SHA256SUMS',Buffer.from([...data].map(([n,b])=>hash(b)+'  '+n).join('\\n')+'\\n'));
const metadata={tag_name:'worker-v0.7.0',html_url:'https://github.com/perlacompute/perla-compute/releases/tag/worker-v0.7.0',draft:false,assets:[...data].map(([n,b])=>({name:n,browser_download_url:base+n,digest:'sha256:'+hash(b)}))};
const original=globalThis.fetch;globalThis.fetch=async(url,...args)=>String(url).startsWith('https://api.github.com/repos/perlacompute/')?Response.json(metadata):String(url).startsWith(base)?new Response(data.get(String(url).slice(base.length))):original(url,...args);`);
env.NODE_OPTIONS=(env.NODE_OPTIONS||'')+' --import='+preload;
async function start() {
  child = spawn(process.execPath, ['scripts/start-vps.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { logs = (logs + bytes).slice(-24000); });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw Error('Production server exited: ' + logs);
    try { const r = await fetch(origin + '/api/mining/status'); if (r.ok) return; } catch {}
    await delay(100);
  }
  throw Error('Production server startup timeout: ' + logs);
}
async function stop() {
  if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
}
async function call(path, { method = 'GET', body, headers = {} } = {}) {
  return fetch(origin + path, { method, headers: { origin, 'content-type': 'application/json', 'x-perla-protocol':'perla-pearl-plain-v4', ...(cookie ? { cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual' });
}
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS',name);}
try {
 await start();
 await test('real production release API validates assets and disables browser caching',async()=>{const response=await call('/api/worker-release');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const data=await response.json();assert.equal(data.state,'available',JSON.stringify(data));assert.equal(data.integrityVerified,true);assert.equal(data.tag,'worker-v0.7.0');});
 await test('URL query cannot redirect the release check',async()=>{const data=await(await call('/api/worker-release?repository=attacker/project&url=http://127.0.0.1')).json();assert.equal(data.repository,'perlacompute/perla-compute');assert.equal(data.state,'available');});
 await test('setup, docs and participant pages use one GitHub guide',async()=>{for(const path of ['/platform/setup','/docs','/participate']){const response=await call(path);assert.equal(response.status,200,path);const text=await response.text();assert(!text.includes('bash perla mine'),path);assert(!text.includes('sha256sum --ignore-missing'),path);if(path==='/docs'){assert(text.includes('id="hopper-validation"'));assert(text.includes('data-worker-install="hopper"'));assert(text.includes('data-worker-install="rtx"'));}if(path==='/participate')assert(text.includes('/releases/tag/worker-v0.7.0'));}});
 await test('readiness and account security remain unchanged',async()=>{assert.equal((await call('/')).status,200);const status=await(await call('/api/mining/status')).json();assert.equal(status.miningEnabled,false);assert.equal(status.acceptedShares,0);assert.equal((await call('/api/mining/account')).status,401);});
 await test('wallet-and-name setup persists a worker across a server restart without a browser session',async()=>{
  const html=await(await call('/platform/setup')).text();assert(html.includes('data-miner-setup="wallet-worker-v2"'));assert(html.includes('id="reward-wallet"'));assert(html.includes('id="worker-name"'));assert(!html.includes('Run <code>perla login'));
  const token='bc'.repeat(32),options={method:'POST',headers:{authorization:'Bearer '+token},body:{wallet:who.address,name:'http-4090'}};
  const response=await call('/api/mining/worker/connect',options);assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);const row=await response.json();assert.equal(row.address,who.address.toLowerCase());
  await stop();await start();const retried=await(await call('/api/mining/worker/connect',options)).json();assert.equal(retried.id,row.id);
  const status=await(await call('/api/mining/worker/status',{headers:{authorization:'Bearer '+token}})).json();assert.equal(status.name,'http-4090');assert.equal(status.address,who.address.toLowerCase());assert.equal((await call('/api/mining/account')).status,401);
 });
 await test('homepage header and sculpture contain no block labels or tooltips',async()=>{const text=await(await call('/')).text();assert(text.includes('data-perla-header="reference-v2"'));assert(text.includes('data-perla-hero="matrix-v2"'));const hero=text.match(/<section class="compute-hero"[\s\S]*?<\/section>/)?.[0];assert(hero);for(const bad of ['GPU worker','Matrix computation','Proof verification','Robinhood settlement','compute-field-tooltip','compute-scene-label','title=','Testnet'])assert(!hero.includes(bad),bad);assert(text.includes('https://github.com/perlacompute/perla-compute'));});
 await test('public X profile changes without rebuild and rejects injected links',async()=>{const url='/api/project-links';let r=await call(url);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal((await r.json()).x,null);await writeFile(resolve(temp,'site-links.json'),JSON.stringify({x:'https://twitter.com/PerlaFixture'}));assert.equal((await(await call(url)).json()).x,'https://x.com/PerlaFixture');for(const x of ['javascript:alert(1)','https://x.com.attacker.test/PerlaFixture','https://x.com/intent','https://x.com/Name?redirect=https://attacker.test']){await writeFile(resolve(temp,'site-links.json'),JSON.stringify({x}));assert.equal((await(await call(url)).json()).x,null,x);}await writeFile(resolve(temp,'site-links.json'),'invalid json');assert.equal((await(await call(url)).json()).x,null);});
 await test('public product text uses Perla while provenance and real identifiers remain intact',async()=>{
  const visible=html=>html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ');
  for(const path of ['/','/participate','/status']){const html=await(await call(path)).text();assert(!/pearl/i.test(visible(html)),path);}
  const docs=await(await call('/docs')).text(),sources=docs.match(/<section id="sources">[\s\S]*?<\/section>/)?.[0];assert(sources);assert(visible(sources).includes('Pearl Research Labs'));
  const removeTechnical=html=>html.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi,'').replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi,'');assert(!/pearl/i.test(visible(removeTechnical(docs.replace(sources,'')))));
  assert(docs.includes('pearl-ai/Llama-3.3-70B-Instruct-pearl'));assert(docs.includes('services/pearl-adapter'));
  const whitepaper=await(await call('/whitepaper')).text();assert(!/pearl/i.test(visible(removeTechnical(whitepaper))));assert(whitepaper.includes('/docs#sources'));
  const notices=await(await call('/third-party-notices.txt')).text();assert(notices.includes('Pearl integration'));assert(notices.includes('licenses or copyright notices'));
  assert.equal((await(await call('/api/mining/status')).json()).protocol,'perla-pearl-plain-v4');
 });
 await test('reward policy API exposes the agreed caps without activating a bridge',async()=>{
  const response=await call('/api/reward-policy');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const policy=await response.json();
  assert.equal(policy.migrationAllocation,'70000000');assert.equal(policy.mainnetMiningAllocation,'130000000');assert.equal(policy.totalMiningAllocation,'200000000');assert.equal(policy.unallocated,'800000000');assert.equal(policy.testnetRatioUnits,100);assert.equal(policy.mainnetRatioUnits,7);assert.equal(policy.dailyMainnetLimit,'1000000');assert.equal(policy.bridgeEnabled,false);
  assert.equal((await call('/api/reward-policy',{method:'POST',body:{bridgeEnabled:true}})).status,405);
 });
 await test('Bridge, reward plans and documentation remain truthful before mainnet',async()=>{
  for(const path of ['/bridge','/platform/bridge']){const response=await call(path);assert.equal(response.status,200);const text=await response.text();assert(text.includes('data-perla-bridge="coming-soon"'));assert(text.includes('Bridge opens with mainnet'));assert(text.includes('Maximum migration allocation'));assert(text.includes('70,000,000'));assert(text.includes('1,000,000'));assert(text.includes('disabled=""'));}
  for(const path of ['/rewards','/platform/rewards','/docs','/whitepaper']){const response=await call(path);assert.equal(response.status,200);const text=await response.text();assert(text.includes('data-reward-plan="perla-rewards-plan-v1"'));assert(text.includes('130M'));if(['/docs','/whitepaper'].includes(path))assert(text.includes('id="migration"'));}
  const setup=await(await call('/platform/setup')).text();assert(!setup.includes('THE NEXT CHAPTER'));assert(setup.includes('/platform/bridge'));assert.equal((await(await call('/api/mining/status')).json()).miningEnabled,false);
 });
 console.log(`${passed} worker website production HTTP checks passed.`);
}finally{await stop();await rm(temp,{recursive:true,force:true});}
