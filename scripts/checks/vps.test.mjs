import assert from 'node:assert/strict';
import { mkdtemp, rm, copyFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createSqliteDatabase } from '../../lib/vps/sqlite.mjs';
const temp = await mkdtemp(resolve(tmpdir(), 'perla-vps-check-'));
const migrationDir = resolve('drizzle');
const file = resolve(temp, 'ledger.sqlite');
let db = createSqliteDatabase(file), passed = 0;
const test = async (name, fn) => { await fn(); console.log('PASS', name); passed++; };
try {
  await test('schema migration is idempotent without losing accepted work', async () => {
    db.migrate(migrationDir);
    await db.prepare('INSERT INTO mining_shares (id,job_id,worker_id,address,epoch,proof_hash,accepted,points) VALUES (?,?,?,?,?,?,?,?)').bind('share', 'job', 'worker', 'wallet', 1, 'hash', 1, 1).run();
    db.migrate(migrationDir);
    assert.equal((await db.prepare('SELECT SUM(points) AS points FROM mining_shares').first()).points, 1);
  });
  await test('a duplicate job cannot increase the persistent contribution total', async () => {
    await assert.rejects(db.prepare('INSERT INTO mining_shares SELECT ?,job_id,worker_id,address,epoch,proof_hash,accepted,points FROM mining_shares').bind('duplicate').run());
    assert.equal((await db.prepare('SELECT SUM(points) AS points FROM mining_shares').first()).points, 1);
  });
  await test('a failed batch rolls back all statements', async () => {
    await assert.rejects(db.batch([
      db.prepare('INSERT INTO mining_rate_limits VALUES (?,1,9)').bind('rolled-back'),
      db.prepare('INSERT INTO mining_shares SELECT * FROM mining_shares'),
    ]));
    assert.equal(await db.prepare('SELECT * FROM mining_rate_limits WHERE key=?').bind('rolled-back').first(), null);
  });
  await test('records survive database close and process reopen', async () => {
    db.close(); db = createSqliteDatabase(file);
    assert.equal((await db.prepare('SELECT points FROM mining_shares WHERE job_id=?').bind('job').first()).points, 1);
  });
  await test('online backup includes WAL records and can be opened independently', async () => {
    const backup = resolve(temp, 'backup.sqlite'); db.backup(backup);
    const restored = createSqliteDatabase(backup);
    try { assert.equal((await restored.prepare('SELECT points FROM mining_shares').first()).points, 1); }
    finally { restored.close(); }
  });
  await test('migration checksums reject accidental rewrites of applied schema', async () => {
    const altered = resolve(temp, 'schema');
    const { mkdir, writeFile } = await import('node:fs/promises'); await mkdir(altered);
    const name = '0000_shallow_xorn.sql';
    await writeFile(resolve(altered, name), await readFile(resolve(migrationDir, name), 'utf8') + '\n-- changed\n');
    assert.throws(() => db.migrate(altered), /modified/);
  });
  console.log(`${passed} VPS persistence checks passed.`);
} finally { db.close(); await rm(temp, { recursive: true, force: true }); }
