import { dailyBudget } from '../../lib/perla/emission.mjs';
/** Real SQLite, signed-wallet API and local-EVM tests. Seeded ledger rows are test fixtures, not native GPU evidence. */
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import ganache from 'ganache';
import { createPublicClient, createWalletClient, http, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createSqliteDatabase } from '../../lib/vps/sqlite.mjs';
import { compileContracts } from '../perla-rewards.mjs';

const root = resolve(new URL('../..', import.meta.url).pathname);
const temp = await mkdtemp(join(tmpdir(), 'perla-portal-check-'));
await build({ entryPoints: [join(root, 'lib/perla/coordinator.ts')], outfile: join(temp, 'coordinator.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24', tsconfig: join(root, 'tsconfig.json') });
const { handleMiningRequest } = await import(pathToFileURL(join(temp, 'coordinator.mjs')));
await build({ entryPoints: [join(root, 'lib/perla/rewards.ts')], outfile: join(temp, 'rewards.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24' });
const { createManifest } = await import(pathToFileURL(join(temp, 'rewards.mjs')));

const db = createSqliteDatabase(':memory:'); db.migrate(join(root, 'drizzle'));
const chain = defineChain({ id: 46630, name: 'Local portal validation', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['http://localhost'] } } });
const server = ganache.server({ logging: { quiet: true }, chain: { chainId: 46630 }, wallet: { deterministic: true } });
await server.listen(0, '127.0.0.1');
const endpoint = 'http://127.0.0.1:' + server.address().port;
const client = createPublicClient({ chain, transport: http(endpoint) }); const wallet = createWalletClient({ chain, transport: http(endpoint) });
const [owner] = await wallet.getAddresses(); const who = privateKeyToAccount('0x' + '44'.repeat(32));
const env = { DB: db, PERLA_MINING_ENABLED: 'false', PERLA_RPC_URL: endpoint, PERLA_OPERATOR_TOKEN: 'test-only-portal-operator-'.repeat(3) };
const compiled = await compileContracts(); let passed = 0; let cookie = '';
const test = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };
const call = (path, { method = 'GET', body, authenticated = false, operator = false } = {}, cfg = env) => handleMiningRequest(new Request('https://perla.test/api/mining/' + path, { method, headers: { origin: 'https://perla.test', 'content-type': 'application/json', ...(authenticated ? { cookie } : {}), ...(operator ? { authorization: 'Bearer ' + env.PERLA_OPERATOR_TOKEN } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), cfg);
const value = async (path, options, cfg) => { const response = await call(path, options, cfg); assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
async function deploy(name, args = []) { const hash = await wallet.deployContract({ account: owner, ...compiled[name], args, gas: 5_000_000n }); const r = await client.waitForTransactionReceipt({ hash }); assert.equal(r.status, 'success'); return r.contractAddress; }
async function send(address, abi, functionName, args) { const hash = await wallet.writeContract({ account: owner, address, abi, functionName, args, gas: 2_500_000n }); const r = await client.waitForTransactionReceipt({ hash }); assert.equal(r.status, 'success'); return r; }
const today = Math.floor(Date.now() / 86400000); const epoch = today - 2;
const worker = randomUUID(); const privateJob = randomUUID(); const rows = [];
try {
  await test('empty overview has zero activity and a real UTC closing time', async () => { const v = await value('overview'); assert.equal(v.shares, 0); assert.equal(v.points, 0); assert.equal(v.daily.length, 14); assert(v.daily.every(d => d.shares === 0)); assert.equal(v.closesAt, (today + 1) * 86400); assert.equal(v.earliestPreparationAt - v.closesAt, 300); assert.equal(v.miningEnabled, false); });
  await test('public explorer is readable without an account and has no fabricated rows', async () => assert.deepEqual((await value('explorer')).items, []));
  await db.prepare('INSERT INTO mining_workers (id,address,name,token_hash,created) VALUES (?,?,?,?,?)').bind(worker, who.address.toLowerCase(), 'PRIVATE WORKER NAME', 'PRIVATE TOKEN HASH', epoch * 86400).run();
  await db.prepare('INSERT INTO mining_jobs (id,worker_id,epoch,header,created,expires) VALUES (?,?,?,?,?,?)').bind(privateJob, worker, epoch, Buffer.alloc(76).toString('base64'), epoch * 86400, epoch * 86400 + 300).run();
  await test('unaccepted jobs are absent from the public explorer and receipt lookup', async () => { assert.deepEqual((await value('explorer?q=' + privateJob)).items, []); assert.equal((await call('explorer/' + privateJob)).status, 404); });
  for (let i = 0; i < 26; i++) {
    const id = randomUUID(), job = randomUUID(), proofHash = createHash('sha256').update('local-test-fixture-' + i).digest('hex');
    const accepted = (epoch + 1) * 86400 - 1;
    await db.prepare('INSERT INTO mining_jobs (id,worker_id,epoch,header,created,expires) VALUES (?,?,?,?,?,?)').bind(job, worker, epoch, Buffer.alloc(76, i).toString('base64'), accepted - 10, accepted + 290).run();
    await db.prepare('INSERT INTO mining_shares (id,job_id,worker_id,address,epoch,proof_hash,accepted,points) VALUES (?,?,?,?,?,?,?,?)').bind(id, job, worker, who.address.toLowerCase(), epoch, proofHash, accepted, 1).run();
    rows.push({ id, job, proofHash, accepted });
  }
  await test('pagination with tied timestamps returns each accepted receipt exactly once', async () => { const a = await value('explorer'); assert.equal(a.items.length, 20); assert(a.next); const b = await value('explorer?before=' + a.next); assert.equal(b.items.length, 6); assert.equal(b.next, null); assert.equal(new Set([...a.items, ...b.items].map(s => s.id)).size, 26); });
  await test('wallet, worker, job and proof-hash searches select the expected records', async () => { assert.equal((await value('explorer?q=' + who.address)).items.length, 20); assert.equal((await value('explorer?q=' + worker)).items.length, 20); assert.equal((await value('explorer?q=' + rows[0].job)).items[0].id, rows[0].id); assert.equal((await value('explorer?q=0x' + rows[0].proofHash)).items[0].id, rows[0].id); });
  await test('invalid search, cursor and epoch inputs fail validation', async () => { for (const path of ['explorer?q=short', 'explorer?q=%27%20OR%201=1', 'explorer?before=bad', 'explorer?epoch=-1']) assert.equal((await call(path)).status, 400, path); });
  await test('an epoch filter excludes other UTC contribution windows', async () => { assert.equal((await value('explorer?epoch=' + epoch)).items.length, 20); assert.equal((await value('explorer?epoch=' + today)).items.length, 0); });
  await test('public rows do not expose worker names, credentials or native challenge bytes', async () => { const text = JSON.stringify(await value('explorer')); for (const secret of ['PRIVATE WORKER NAME', 'PRIVATE TOKEN HASH', 'token_hash', 'header', 'plain_proof']) assert(!text.includes(secret)); });
  await test('receipt details bind the accepted job and publish only its challenge digest', async () => { const v = await value('explorer/' + rows[0].id); assert.equal(v.job_id, rows[0].job); assert.equal(v.headerHash, createHash('sha256').update(Buffer.alloc(76)).digest('hex')); assert.equal(v.proof_hash, rows[0].proofHash); assert.equal(v.points, 1); assert.equal(v.protocol,'perla-pearl-plain-v3'); assert(!('header' in v)); assert.match(v.evidence, /Operator-recorded/); });
  await test('overview totals come from the stored ledger without changing admission', async () => { const v = await value('overview'); assert.equal(v.shares, 26); assert.equal(v.points, 26); assert.equal(v.contributors, 1); assert.equal(v.daily.find(d => d.epoch === epoch).shares, 26); assert.equal(v.activeWorkers, 0); assert.equal(v.miningEnabled, false); });
  await test('account rewards require a signed browser session', async () => assert.equal((await call('rewards/account')).status, 401));
  const challenge = await (await call('auth/challenge', { method: 'POST', body: { address: who.address } })).json();
  const signature = await who.signMessage({ message: challenge.message });
  const login = await call('auth/verify', { method: 'POST', body: { id: challenge.id, signature } }); assert.equal(login.status, 200); cookie = login.headers.get('set-cookie').split(';')[0];
  const token = await deploy('PerlaTestToken'), distributor = await deploy('PerlaRewards', [token]);
  env.PERLA_REWARD_TOKEN = token; env.PERLA_DISTRIBUTOR_ADDRESS = distributor;
  await db.prepare('INSERT INTO mining_reward_policy(id,policy,start_epoch,token,distributor,created) VALUES(1,?,?,?,?,?)').bind('perla-testnet-daily-v1',epoch,token.toLowerCase(),distributor.toLowerCase(),Math.floor(Date.now()/1000)).run();
  const prepared = await call('operator/epochs', { method: 'POST', operator: true, body: { epoch, budget: dailyBudget(1).toString() } }); assert.equal(prepared.status, 200, await prepared.clone().text()); const manifest = await prepared.json();
  await test('published epoch overview exposes the exact allocation budget and recipient count', async () => { const v = await value('epochs'); assert.equal(v.items[0].budget, manifest.budget); assert.equal(v.items[0].recipients, 1); assert.equal(v.items[0].state, 'prepared'); });
  await test('manifest download preserves a reproducible Merkle allocation', async () => { const r = await call('epochs/' + epoch + '/manifest'); assert.equal(r.status, 200); assert.match(r.headers.get('content-disposition'), /attachment/); const m = await r.json(); assert.equal(m.root, manifest.root); assert.equal(m.allocations.reduce((sum, a) => sum + BigInt(a.amount), 0n).toString(), m.budget); assert(!('snapshot' in m)); });
  await test('an unfunded allocation stays pending and cannot become claimable', async () => { const v = await value('rewards/account', { authenticated: true }); assert.equal(v.items[0].status, 'pending'); assert.equal(v.items[0].verification, 'unfunded'); assert.equal(v.items[0].tokenInfo.symbol, 'PERL'); });
  await test('a receipt links to its published reward epoch', async () => assert.equal((await value('explorer/' + rows[0].id)).rewardEpoch.epoch, epoch));
  await test('tampered allocation data is rejected rather than downloaded or used for claims', async () => { const stored = await db.prepare('SELECT manifest FROM mining_reward_epochs WHERE epoch=?').bind(epoch).first(); const changed = JSON.parse(stored.manifest); changed.allocations[0].amount = '1'; await db.prepare('UPDATE mining_reward_epochs SET manifest=? WHERE epoch=?').bind(JSON.stringify(changed), epoch).run(); assert.equal((await call('epochs/' + epoch + '/manifest')).status, 503); await db.prepare('UPDATE mining_reward_epochs SET manifest=? WHERE epoch=?').bind(stored.manifest, epoch).run(); });
  await send(token, compiled.PerlaTestToken.abi, 'approve', [distributor, BigInt(manifest.budget)]);
  const funding=await send(distributor, compiled.PerlaRewards.abi, 'fundEpoch', [BigInt(epoch), manifest.root, BigInt(manifest.budget)]);
  await test('canonical funding trace requires the real matching event',async()=>{assert.equal((await call('operator/epochs/'+epoch+'/funding',{method:'POST',operator:true,body:{transaction:'0x'+'99'.repeat(32)}})).status,409);const r=await call('operator/epochs/'+epoch+'/funding',{method:'POST',operator:true,body:{transaction:funding.transactionHash}});assert.equal(r.status,200,await r.clone().text());const row=await db.prepare('SELECT funding_tx FROM mining_reward_epochs WHERE epoch=?').bind(epoch).first();assert.equal(row.funding_tx,funding.transactionHash);});
  await test('treasury balances and published liabilities use real local contracts',async()=>{const v=await value('treasury');assert.equal(v.status,'available');assert.equal(v.data.distributorBalance,manifest.budget);assert.equal(v.data.publishedRemaining,manifest.budget);assert.equal(v.data.coverage,'covered');assert.equal(v.data.tokenInfo.symbol,'PERL');});

  const fresh = { ...env, PERLA_RPC_URL: endpoint + '/' };
  await test('funding alone does not bypass coordinator activation', async () => { const v = await value('rewards/account', { authenticated: true }, fresh); assert.equal(v.items[0].status, 'funded'); });
  await db.prepare("UPDATE mining_reward_epochs SET state='active' WHERE epoch=?").bind(epoch).run();
  await test('matching funded and activated allocations become claimable', async () => { const v = await value('rewards/account', { authenticated: true }, fresh); assert.equal(v.items[0].status, 'claimable'); assert.equal(v.items[0].address.toLowerCase(), who.address.toLowerCase()); });
  await test('status reports active claim records instead of hardcoded false', async () => assert.equal((await value('status')).claimsEnabled, true));
  const allocation = manifest.allocations[0];
  await send(distributor, compiled.PerlaRewards.abi, 'claim', [BigInt(epoch), BigInt(allocation.index), allocation.address, BigInt(allocation.amount), allocation.proof]);
  await test('a real local-EVM claim is detected even when funding metadata is cached', async () => { const v = await value('rewards/account', { authenticated: true }, fresh); assert.equal(v.items[0].status, 'claimed'); const balance = await client.readContract({ address: token, abi: compiled.PerlaTestToken.abi, functionName: 'balanceOf', args: [who.address] }); assert.equal(balance.toString(), allocation.amount); });
  await test('an unavailable RPC never reports claimable rewards', async () => { const v = await value('rewards/account', { authenticated: true }, { ...env, PERLA_RPC_URL: 'http://127.0.0.1:9' }); assert.equal(v.items[0].status, 'unavailable'); });
  await test('RPC failure never fabricates treasury zero balances',async()=>{const v=await value('treasury',{}, {...env,PERLA_RPC_URL:'http://127.0.0.1:9'});assert.equal(v.status,'unavailable');assert.equal(v.data,null)});
  await test('a wrong reward token is reported as a contract mismatch', async () => { const other = await deploy('PerlaTestToken'); await db.prepare('UPDATE mining_reward_epochs SET token=? WHERE epoch=?').bind(other, epoch).run(); const v = await value('rewards/account', { authenticated: true }, fresh); assert.equal(v.items[0].status, 'unavailable'); assert.equal(v.items[0].verification, 'mismatch'); await db.prepare('UPDATE mining_reward_epochs SET token=? WHERE epoch=?').bind(token, epoch).run(); });
  await test('a wrong-chain RPC fails closed for epoch and account checks', async () => {
    const wrong = createServer(async (req, res) => { for await (const chunk of req) {} res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc:'2.0',id:1,result:'0x1237' })); });
    await new Promise(resolve => wrong.listen(0, '127.0.0.1', resolve));
    try { const cfg = { ...env, PERLA_RPC_URL:'http://127.0.0.1:' + wrong.address().port }; const v = await value('rewards/account', { authenticated:true }, cfg); assert.equal(v.items[0].status,'unavailable'); assert.equal(v.items[0].verification,'mismatch'); }
    finally { await new Promise(resolve => wrong.close(resolve)); }
  });
  await test('account epoch pagination reaches older windows and rejects malformed cursors', async () => {
    for (let i=1;i<=20;i++) {
      const oldEpoch=epoch-i, m=createManifest(oldEpoch,1n,distributor,[{address:owner.toLowerCase(),points:1}]);
      await db.prepare('INSERT INTO mining_reward_epochs (epoch,snapshot,manifest,root,budget,distributor,token,state,created) VALUES (?,?,?,?,?,?,?,?,?)').bind(oldEpoch,'local-pagination-fixture',JSON.stringify(m),m.root,m.budget,distributor,token,'prepared',oldEpoch*86400).run();
    }
    const first=await value('rewards/account',{authenticated:true},fresh);assert.equal(first.items.length,1);assert.equal(first.next,epoch-19);
    const older=await value('rewards/account?before='+first.next,{authenticated:true},fresh);assert.deepEqual(older.items,[]);assert.equal(older.next,null);
    assert.equal((await call('rewards/account?before=invalid',{authenticated:true})).status,400);
  });
  await test('public read endpoints never change worker secrets, contribution counts or mining admission', async () => { const row = await db.prepare('SELECT token_hash FROM mining_workers WHERE id=?').bind(worker).first(); assert.equal(row.token_hash, 'PRIVATE TOKEN HASH'); assert.equal((await value('overview')).shares, 26); assert.equal(env.PERLA_MINING_ENABLED, 'false'); });
  console.log(`${passed} portal checks passed with SQLite, signed requests and a local EVM. No GPU run or public-chain transaction was performed.`);
} finally { db.close(); await server.close(); await rm(temp, { recursive: true, force: true }); }
