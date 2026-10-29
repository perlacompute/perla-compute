import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setImmediate as flush } from 'node:timers/promises';

const folder = await mkdtemp(join(tmpdir(), 'perla-reconnect-monitor-'));
try {
  const output = join(folder, 'monitor.mjs');
  await build({ entryPoints: ['lib/perla/reconnect-monitor.ts'], outfile: output,
    bundle: true, platform: 'node', format: 'esm' });
  const { monitorReconnect } = await import(pathToFileURL(output));
  function clock() {
    let serial = 0;
    const tasks = new Map();
    return {
      schedule: (callback, milliseconds) => { const id = ++serial; tasks.set(id, { callback, milliseconds }); return id; },
      cancel: id => tasks.delete(id),
      pending: () => [...tasks.values()].map(t => t.milliseconds).sort((a,b) => a-b),
      next: async () => {
        const next = [...tasks].sort((a,b) => a[1].milliseconds-b[1].milliseconds)[0];
        assert(next, 'No scheduled request'); tasks.delete(next[0]); next[1].callback(); await flush();
      },
    };
  }
  function fixture(load) {
    const time = clock(), values = [], errors = [];
    const watcher = monitorReconnect({ load, value: v => values.push(v),
      error: (...args) => errors.push(args), schedule: time.schedule, cancel: time.cancel });
    return { time, values, errors, watcher };
  }
  let passed = 0;
  async function test(name, fn) { await fn(); passed++; console.log('PASS', name); }
  await test('network recovery clears the error and confirms completion without losing approved identity', async () => {
    const responses = [{ completed: false, approved: true, workerId: 'same-id' },
      new TypeError('Failed to fetch'), { completed: true, approved: true, workerId: 'same-id' }];
    const r = fixture(async () => { const value=responses.shift(); if(value instanceof Error) throw value; return value; });
    await flush(); await r.time.next();
    assert.equal(r.values.at(-1).workerId, 'same-id'); assert.equal(r.errors.at(-1)[1], true);
    assert(!r.errors.at(-1)[0].includes('Failed to fetch')); assert.deepEqual(r.time.pending(), [8000]);
    await r.time.next(); assert.equal(r.values.at(-1).completed, true);
    assert.equal(r.errors.at(-1)[0], ''); assert.deepEqual(r.time.pending(), []); r.watcher.stop();
  });
  await test('an initially unapproved request continues polling for its result', async () => {
    const r = fixture(async () => ({ completed: false, approved: false }));
    await flush(); assert.deepEqual(r.time.pending(), [4000]); r.watcher.stop();
  });
  for (const status of [401, 403, 404, 409, 410]) await test('HTTP '+status+' stops retries and reports a terminal condition', async () => {
    const r=fixture(async()=>{throw Object.assign(Error('Request expired or unavailable'),{status});});
    await flush(); assert.equal(r.errors.at(-1)[1], false); assert.equal(r.errors.at(-1)[2], status);
    assert.deepEqual(r.time.pending(), []); r.watcher.stop();
  });
  await test('rate limits wait thirty seconds before another request', async () => {
    const r=fixture(async()=>{throw Object.assign(Error('Rate limit'),{status:429});});
    await flush(); assert.deepEqual(r.time.pending(), [30000]); r.watcher.stop();
  });
  await test('repeated server failures back off without abandoning the request', async () => {
    const r=fixture(async()=>{throw Object.assign(Error('Server unavailable'),{status:503});});
    await flush(); for(const wait of [8000,16000,30000,30000]) {assert.deepEqual(r.time.pending(),[wait]);await r.time.next();}
    r.watcher.stop(); assert.deepEqual(r.time.pending(),[]);
  });
  await test('changing wallet or code aborts the previous fetch and ignores its late response', async () => {
    let resolve, signal;
    const r=fixture(s=>{signal=s;return new Promise(done=>resolve=done);});
    r.watcher.stop(); assert.equal(signal.aborted,true); resolve({completed:true}); await flush();
    assert.deepEqual(r.values,[]); assert.deepEqual(r.errors,[]); assert.deepEqual(r.time.pending(),[]);
  });
  await test('refresh after approval supersedes a read started before approval', async () => {
    let resolve, attempts=0;
    const r=fixture(async()=> ++attempts===1 ? await new Promise(done=>resolve=done) : {completed:true,approved:true});
    await r.watcher.refresh(); resolve({completed:false,approved:false}); await flush();
    assert.deepEqual(r.values,[{completed:true,approved:true}]);assert.deepEqual(r.time.pending(),[]);r.watcher.stop();
  });
  await test('a hung request times out and can recover automatically', async () => {
    let attempts=0;
    const r=fixture(signal=>++attempts===1 ? new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Timeout','AbortError')))) : Promise.resolve({completed:true}));
    assert.deepEqual(r.time.pending(),[20000]);await r.time.next();assert.deepEqual(r.time.pending(),[8000]);
    await r.time.next();assert.equal(r.values.at(-1).completed,true);assert.deepEqual(r.time.pending(),[]);r.watcher.stop();
  });
  console.log(passed+' reconnect-monitor checks passed.');
} finally { await rm(folder, { recursive: true, force: true }); }
