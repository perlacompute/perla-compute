import type { Context } from './onboarding';
import { digest, PROTOCOL, UPSTREAM_COMMIT } from './protocol';
type Worker = { id: string; address: string; name: string; token_hash: string; revoked: number | null };
type RequestRow = { id: string; worker_id: string; new_token_hash: string; code_hash: string; expires: number; approved_at: number | null; approved_address: string | null; prior_token_hash: string | null; consumed: number };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const codePattern = /^[A-F0-9]{12}$/;
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
export async function reconnectRequest(r: Request, c: Context): Promise<Response | null> {
  if (!c.path.startsWith('worker/reconnect/')) return null;
  if (r.method !== 'POST') return json({ error: 'Use a POST request.' }, 405);
  const { db, now } = c, action = c.path.slice('worker/reconnect/'.length), origin = new URL(r.url).origin;
  const connected = (w: Worker) => json({ state: 'connected', id: w.id, address: w.address, name: w.name, endpoint: origin, protocol: PROTOCOL, upstreamCommit: UPSTREAM_COMMIT, reusedWorker: true, ledgerCredit: 0 });
  if (action === 'start' || action === 'exchange') {
    const token = r.headers.get('authorization')?.replace(/^Bearer /, '') || '';
    if (!/^[a-f0-9]{64}$/.test(token)) c.fail(401, 'A private credential from the new machine is required.');
    const hash = await digest(token), b = await c.body();
    if (typeof b.workerId !== 'string' || !uuid.test(b.workerId)) c.fail(400, 'Enter the full permanent Worker ID.');
    const id = b.workerId as string;
    // Possession of the already-rotated credential also recovers a lost final response.
    const w = await db.prepare('SELECT id,address,name,token_hash,revoked FROM mining_workers WHERE id=?').bind(id).first<Worker>();
    if (!w) c.fail(404, 'This Worker ID does not exist. Copy it from the mining dashboard.');
    if (w!.token_hash === hash && w!.revoked === null) return connected(w!);
    const used = await db.prepare('SELECT id FROM mining_workers WHERE token_hash=? AND id<>?').bind(hash, id).first();
    if (used) c.fail(409, 'This credential already belongs to another worker. Use a fresh machine credential.');
    let request = await db.prepare('SELECT * FROM mining_worker_reconnects WHERE new_token_hash=?').bind(hash).first<RequestRow>();
    if (request && request.worker_id !== id) c.fail(409, 'This pending credential belongs to another Worker ID. Its settings were retained.');
    if (action === 'start') {
      if (typeof b.code !== 'string' || !codePattern.test(b.code)) c.fail(400, 'A 12-character confirmation code is required.');
      const codeHash = await digest(b.code as string);
      if (request?.consumed) c.fail(410, 'This reconnect was superseded. Start a fresh request.');
      if (request && request.code_hash !== codeHash) c.fail(409, 'The confirmation code differs from the saved reconnect request.');
      if (!request || request.expires <= now) {
        await c.throttle('worker-reconnect-start-global', 120, 3600);
        const duplicate = await db.prepare('SELECT id FROM mining_worker_reconnects WHERE code_hash=? AND new_token_hash<>?').bind(codeHash, hash).first();
        if (duplicate) c.fail(409, 'The confirmation code is already in use. Start a fresh request.');
        await db.batch([
          db.prepare('DELETE FROM mining_worker_reconnects WHERE id IN (SELECT id FROM mining_worker_reconnects WHERE expires<? LIMIT 100)').bind(now - 86400),
          db.prepare('INSERT INTO mining_worker_reconnects(id,worker_id,new_token_hash,code_hash,created,expires) VALUES(?,?,?,?,?,?) ON CONFLICT(new_token_hash) DO UPDATE SET created=excluded.created,expires=excluded.expires,approved_at=NULL,approved_address=NULL,prior_token_hash=NULL WHERE mining_worker_reconnects.consumed=0 AND mining_worker_reconnects.expires<=excluded.created').bind(crypto.randomUUID(), id, hash, codeHash, now, now + 600),
        ]);
        request = await db.prepare('SELECT * FROM mining_worker_reconnects WHERE new_token_hash=?').bind(hash).first<RequestRow>();
      }
      return json({ state: 'pending', workerId: id, userCode: b.code, verificationUrl: origin + '/platform/reconnect?code=' + b.code, expires: request!.expires, interval: 5 });
    }
    await c.throttle('worker-reconnect-poll:' + hash, 15);
    if (!request || request.expires <= now) c.fail(410, 'Reconnect approval expired. Run the same start command again.');
    if (request!.consumed) c.fail(410, 'This reconnect was superseded. Start a fresh request.');
    if (request!.approved_at === null) return json({ state: 'pending', workerId: id }, 202);
    if (request!.approved_address !== w!.address || request!.prior_token_hash !== w!.token_hash) c.fail(409, 'The worker moved after approval. Run the same start command for a fresh approval.');
    const match = 'EXISTS(SELECT 1 FROM mining_worker_reconnects p JOIN mining_workers w ON w.id=p.worker_id WHERE p.id=? AND p.consumed=0 AND p.expires>? AND p.approved_address=w.address AND w.token_hash=?)';
    const changes = await db.batch([
      db.prepare('UPDATE mining_workers SET token_hash=?,revoked=NULL,last_seen=NULL,miner_version=NULL,architecture=NULL,last_error=NULL WHERE id=? AND token_hash=? AND EXISTS(SELECT 1 FROM mining_worker_reconnects p WHERE p.id=? AND p.worker_id=mining_workers.id AND p.new_token_hash=? AND p.consumed=0 AND p.expires>? AND p.approved_address=mining_workers.address)').bind(hash, id, request!.prior_token_hash, request!.id, hash, now),
      db.prepare('UPDATE mining_jobs SET expires=0 WHERE worker_id=? AND NOT EXISTS(SELECT 1 FROM mining_shares s WHERE s.job_id=mining_jobs.id) AND ' + match).bind(id, request!.id, now, hash),
      db.prepare('DELETE FROM mining_worker_validations WHERE worker_id=? AND ' + match).bind(id, request!.id, now, hash),
      db.prepare('DELETE FROM mining_worker_trials WHERE worker_id=? AND ' + match).bind(id, request!.id, now, hash),
      db.prepare('UPDATE mining_worker_reconnects SET consumed=1 WHERE id=? AND consumed=0 AND ' + match).bind(request!.id, request!.id, now, hash),
    ]);
    const result = await db.prepare('SELECT id,address,name,token_hash,revoked FROM mining_workers WHERE id=?').bind(id).first<Worker>();
    if (result?.token_hash === hash && result.revoked === null) return connected(result);
    if (changes[0].meta.changes !== 1) c.fail(409, 'The worker moved after approval. Run the same start command for a fresh approval.');
    c.fail(409, 'The reconnect could not be confirmed. Retry the same request.');
  }
  if (action === 'info' || action === 'approve') {
    c.origin(); const address = await c.account(), b = await c.body();
    await c.throttle('worker-reconnect-owner:' + address, 30);
    if (typeof b.code !== 'string' || !codePattern.test(b.code)) c.fail(400, 'Enter the confirmation code shown on the new GPU machine.');
    const row = await db.prepare('SELECT p.*,w.address,w.name,w.revoked,w.token_hash FROM mining_worker_reconnects p JOIN mining_workers w ON w.id=p.worker_id WHERE p.code_hash=? AND p.expires>? AND w.address=?').bind(await digest(b.code as string), now, address).first<RequestRow & Worker>();
    if (!row) c.fail(404, 'This reconnect request is expired or belongs to another wallet.');
    if (action === 'approve' && !row!.consumed && row!.approved_at === null) {
      await db.prepare('UPDATE mining_worker_reconnects SET approved_at=?,approved_address=?,prior_token_hash=(SELECT token_hash FROM mining_workers w WHERE w.id=mining_worker_reconnects.worker_id AND w.address=?) WHERE id=? AND expires>? AND approved_at IS NULL AND consumed=0 AND EXISTS(SELECT 1 FROM mining_workers w WHERE w.id=mining_worker_reconnects.worker_id AND w.address=?)').bind(now, address, address, row!.id, now, address).run();
    }
    const approved = await db.prepare('SELECT approved_at,consumed FROM mining_worker_reconnects WHERE id=?').bind(row!.id).first<{ approved_at: number | null; consumed: number }>();
    return json({ workerId: row!.worker_id, name: row!.name, address: row!.address, expires: row!.expires, approved: approved!.approved_at !== null, completed: !!approved!.consumed, replacesOldMachine: true });
  }
  return json({ error: 'Reconnect endpoint not found.' }, 404);
}
