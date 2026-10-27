import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import './migrate-vps.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = existsSync(resolve(root, 'server.js')) ? resolve(root, 'server.js') : resolve(root, '.next/standalone/server.js');
if (!existsSync(file)) throw Error('Production build missing. Run npm ci and npm run build first.');
const child = spawn(process.execPath, [file], {
  cwd: dirname(file), stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production', PORT: process.env.PORT || '3109', HOSTNAME: process.env.HOSTNAME || '127.0.0.1',
    PERLA_SQLITE_PATH: resolve(process.env.PERLA_SQLITE_PATH || resolve(root, 'data/perla.sqlite')),
    PERLA_MIGRATION_DIR: resolve(root, 'drizzle') },
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
