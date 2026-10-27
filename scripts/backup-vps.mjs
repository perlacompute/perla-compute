import { resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSqliteDatabase } from '../lib/vps/sqlite.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(resolve(root, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const db = createSqliteDatabase(resolve(process.env.PERLA_SQLITE_PATH || resolve(root, 'data/perla.sqlite')));
const destination = resolve(process.argv[2] || resolve(root, 'data/backups', 'perla-' + new Date().toISOString().replaceAll(':', '-') + '.sqlite'));
mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
try { db.backup(destination); console.log(destination); } finally { db.close(); }
