import { build } from 'esbuild';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
await build({ entryPoints: [resolve(root, 'scripts/reward-settle-entry.mjs')], outfile: resolve(root, 'scripts/reward-settle.bundle.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24', minify: true });
