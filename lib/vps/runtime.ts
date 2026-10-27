import { resolve } from 'node:path';
import { createSqliteDatabase } from './sqlite.mjs';
import type { MiningDatabase } from '@/lib/perla/database';

type Connection = ReturnType<typeof createSqliteDatabase>;
const state = globalThis as typeof globalThis & { __perlaSqlite?: Connection };
function database(): MiningDatabase {
  if (!state.__perlaSqlite) {
    const db = createSqliteDatabase(resolve(process.env.PERLA_SQLITE_PATH || 'data/perla.sqlite'));
    db.migrate(resolve(process.env.PERLA_MIGRATION_DIR || 'drizzle'));
    state.__perlaSqlite = db;
  }
  return state.__perlaSqlite as unknown as MiningDatabase;
}
// Server modules only; secrets never enter client-side configuration.
export const env = {
  ...process.env,
  get DB() { return database(); },
};
