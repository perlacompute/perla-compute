/** Exercise the real production Next.js server and its SQLite ledger over HTTP. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
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
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS', name); }
try {
  await start();
  await test('production pages render and standalone assets are included', async () => {
    for (const path of ['/', '/docs', '/participate', '/whitepaper', '/status', '/validation-record-v0.2.1.md', '/platform/mining', '/platform/setup', '/platform/rewards', '/explorer', '/rewards', '/favicon.svg', '/downloads/perla-worker.tar.gz']) {
      const response = await call(path); assert.equal(response.status, 200, path);
      if (path === '/status') {
        const html = await response.text();
        assert(html.includes('Service configuration'));
        assert(html.includes('Paused'));
        assert.equal((html.match(/<h1(?:\s|>)/g) || []).length, 1);
      } else await response.arrayBuffer();
    }
  });
  await test('RTX download matches published checksum and contains complete credential-free build sources', async () => {
    const checksums = await (await call('/downloads/SHA256SUMS')).text();
    const response = await call('/downloads/perla-rtx-worker.tar.gz'); assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    const expected = checksums.split('\n').find(line => line.endsWith('  perla-rtx-worker.tar.gz'))?.split('  ')[0];
    assert(expected); assert.equal(createHash('sha256').update(bytes).digest('hex'), expected);
    const listing = spawnSync('tar', ['-tzf', '-'], { input: bytes, encoding: 'utf8' }); assert.equal(listing.status, 0);
    for (const name of ['rtx.cu', 'build-cuda.sh', 'Dockerfile', '.dockerignore', 'miner.py', 'protocol.py', 'perla_bridge.py', 'README.md', 'NOTICE.md', 'PERLA-MIT-LICENSE.txt']) assert(listing.stdout.includes('perla-rtx-worker/' + name), name);
    assert(!listing.stdout.split('\n').some(path => /(?:worker\.env|\.sqlite|\.so$|__pycache__)/.test(path)));
    assert.equal((await call('/validation-record-rtx-0.4.0-rc1.md')).status, 200);
  });
  await test('production status uses SQLite and keeps admission paused', async () => {
    const status = await (await call('/api/mining/status')).json();
    assert.equal(status.storage, true); assert.equal(status.miningEnabled, false); assert.equal(status.acceptedShares, 0);
  });
  await test('public portal endpoints expose empty records and protect account rewards', async () => {
    for (const path of ['/api/mining/overview', '/api/mining/explorer', '/api/mining/epochs']) assert.equal((await call(path)).status, 200, path);
    assert.deepEqual((await (await call('/api/mining/explorer')).json()).items, []);
    assert.equal((await call('/api/mining/rewards/account')).status, 401);
    assert.equal((await call('/api/mining/explorer?q=invalid')).status, 400);
  });
  await test('wallet authorization rejects a different website origin', async () => {
    assert.equal((await call('/api/mining/auth/challenge', { method: 'POST', body: { address: who.address }, headers: { origin: 'https://attacker.test' } })).status, 403);
  });
  await test('a signed wallet can register a worker through the production API', async () => {
    const challengeResponse = await call('/api/mining/auth/challenge', { method: 'POST', body: { address: who.address } });
    assert.equal(challengeResponse.status, 200, await challengeResponse.clone().text());
    const c = await challengeResponse.json();
    const signature = await who.signMessage({ message: c.message });
    const authorized = await call('/api/mining/auth/verify', { method: 'POST', body: { id: c.id, signature } });
    assert.equal(authorized.status, 200); cookie = authorized.headers.get('set-cookie').split(';')[0];
    const r = await call('/api/mining/workers', { method: 'POST', body: { name: 'VPS smoke worker' } });
    assert.equal(r.status, 201, await r.clone().text()); const worker = await r.json(); workerId = worker.id; workerToken = worker.token;
    assert.equal(worker.endpoint, origin); assert.equal(worker.token.length, 64);
  });
  await test('account reads hide worker secrets and paused workers receive no work', async () => {
    const r = await call('/api/mining/account'); assert.equal(r.status, 200);
    const raw = await r.text(); assert(!raw.includes(workerToken)); assert.equal(JSON.parse(raw).workers.length, 1);
    assert.equal((await call('/api/mining/work', { headers: { authorization: 'Bearer ' + workerToken } })).status, 503);
  });
  await stop(); await start();
  await test('wallet sessions and worker records survive a complete web process restart', async () => {
    const r = await call('/api/mining/account'); assert.equal(r.status, 200);
    const account = await r.json(); assert.equal(account.workers[0].id, workerId); assert.equal(account.workers[0].name, 'VPS smoke worker');
  });
  await stop(); env.PERLA_PUBLIC_ORIGIN = 'https://perla.test'; await start();
  await test('HTTPS reverse-proxy headers preserve the wallet-signing domain', async () => {
    const r = await call('/api/mining/auth/challenge', { method: 'POST', body: { address: who.address },
      headers: { host: 'perla.test', origin: 'https://perla.test', 'x-forwarded-host': 'perla.test', 'x-forwarded-proto': 'https' } });
    assert.equal(r.status, 200, await r.clone().text());
    const challenge = await r.json(); assert(challenge.message.includes('URI: https://perla.test'));
    const signature = await who.signMessage({ message: challenge.message });
    const authorized = await call('/api/mining/auth/verify', { method: 'POST', body: { id: challenge.id, signature },
      headers: { host: 'perla.test', origin: 'https://perla.test', 'x-forwarded-host': 'perla.test', 'x-forwarded-proto': 'https' } });
    assert.equal(authorized.status, 200); assert(authorized.headers.get('set-cookie').includes('; Secure'));
  });
  console.log(`${passed} production VPS HTTP checks passed.`);
} finally { await stop(); await rm(temp, { recursive: true, force: true }); }
