import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSqliteDatabase } from '../lib/vps/sqlite.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(resolve(root, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const filename = resolve(process.env.PERLA_SQLITE_PATH || resolve(root, 'data/perla.sqlite'));
const db = createSqliteDatabase(filename);
try { db.migrate(resolve(root, 'drizzle')); console.log('SQLite migrations applied. Existing records preserved.'); }
finally { db.close(); }
