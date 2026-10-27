import type { MiningDatabase } from './database';

// One coordinator process per SQLite volume. The verifier independently limits
// native children to two. Excess requests fail closed without an unbounded queue.
let active = 0;
export async function withVerifierSlot<T>(run: () => Promise<T>): Promise<T> {
  if (active >= 2) throw Error('VERIFIER_BUSY');
  active++;
  try { return await run(); } finally { active--; }
}
export async function recordOperation(db: MiningDatabase | undefined, kind: string, duration = 0) {
  if (!db) return;
  const now = Math.floor(Date.now() / 1000), bucket = Math.floor(now / 60) * 60;
  try {
    await db.prepare('INSERT INTO mining_operation_counts(bucket,kind,count,duration_ms,max_ms) VALUES(?,?,1,?,?) ON CONFLICT(bucket,kind) DO UPDATE SET count=count+1,duration_ms=duration_ms+excluded.duration_ms,max_ms=MAX(max_ms,excluded.max_ms)').bind(bucket, kind, duration, duration).run();
    await db.prepare('DELETE FROM mining_operation_counts WHERE bucket<?').bind(now - 86400 * 7).run();
  } catch { /* Telemetry failure must not change the outcome of a share commit. */ }
}
export async function recordWorker(db: MiningDatabase, id: string, kind: string) {
  try {
    if(['stale','duplicate','rejected'].includes(kind))await db.prepare('UPDATE mining_workers SET last_error=? WHERE id=?').bind(kind,id).run();
    if(kind==='accepted')await db.prepare('UPDATE mining_workers SET last_error=NULL WHERE id=?').bind(id).run();
    await db.prepare('INSERT INTO mining_worker_counts(worker_id,epoch,kind,count) VALUES(?,?,?,1) ON CONFLICT(worker_id,epoch,kind) DO UPDATE SET count=count+1').bind(id, Math.floor(Date.now()/86400000), kind).run();
    await db.prepare('DELETE FROM mining_worker_counts WHERE epoch<?').bind(Math.floor(Date.now()/86400000)-30).run();
  } catch { /* Operational counters are not the reward ledger. */ }
}
export async function operationSummary(db: MiningDatabase, now = Math.floor(Date.now()/1000)) {
  const rows = await db.prepare('SELECT kind,SUM(count) AS count,SUM(duration_ms) AS durationMs,MAX(max_ms) AS maxMs FROM mining_operation_counts WHERE bucket>=? GROUP BY kind').bind(now-3600).all();
  return { windowSeconds:3600, verifierActive:active, verifierConcurrency:2, counters:rows.results, checkedAt:now };
}
