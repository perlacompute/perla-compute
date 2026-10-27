import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

export function createSqliteDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const native = new DatabaseSync(filename);
  native.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const result = (rows = [], changes = 0, id = 0) => ({
    results: rows, success: true, meta: { changes: Number(changes), last_row_id: Number(id) },
  });
  class Statement {
    constructor(sql, params = []) { this.sql = sql; this.params = params; }
    bind(...params) { return new Statement(this.sql, params); }
    async first(column) {
      const row = native.prepare(this.sql).get(...this.params);
      return row === undefined ? null : column === undefined ? { ...row } : row[column];
    }
    async all() { return result(native.prepare(this.sql).all(...this.params).map(row => ({ ...row }))); }
    execute() {
      const row = native.prepare(this.sql).run(...this.params);
      return result([], row.changes, row.lastInsertRowid);
    }
    async run() { return this.execute(); }
  }
  return {
    prepare: sql => new Statement(sql),
    async batch(statements) {
      // All statements execute synchronously before yielding; nonce consumption is atomic.
      native.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(statement => statement.execute());
        native.exec('COMMIT');
        return results;
      } catch (error) { native.exec('ROLLBACK'); throw error; }
    },
    migrate(directory) {
      native.exec('CREATE TABLE IF NOT EXISTS _perla_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied INTEGER NOT NULL)');
      for (const name of readdirSync(directory).filter(name => /^\d.*\.sql$/.test(name)).sort()) {
        const sql = readFileSync(resolve(directory, name), 'utf8');
        const checksum = createHash('sha256').update(sql).digest('hex');
        native.exec('BEGIN IMMEDIATE');
        try {
          const applied = native.prepare('SELECT checksum FROM _perla_migrations WHERE name=?').get(name);
          if (applied && applied.checksum !== checksum) throw Error('Applied database migration was modified: ' + name);
          if (!applied) {
            native.exec(sql);
            native.prepare('INSERT INTO _perla_migrations VALUES (?,?,?)').run(name, checksum, Math.floor(Date.now() / 1000));
          }
          native.exec('COMMIT');
        } catch (error) { native.exec('ROLLBACK'); throw error; }
      }
    },
    backup(destination) {
      // VACUUM INTO captures committed WAL data in a consistent standalone file.
      native.prepare('VACUUM INTO ?').run(destination);
    },
    close() { native.close(); },
  };
}
