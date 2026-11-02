import { build } from 'esbuild';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
await build({entryPoints:[resolve(root,'lib/perla/reward-audit-entry.ts')],outfile:resolve(root,'scripts/reward-allocation.mjs'),bundle:true,platform:'node',format:'esm',packages:'external',target:'node24'});
await build({ entryPoints: [resolve(root, 'scripts/reward-settle-entry.mjs')], outfile: resolve(root, 'scripts/reward-settle.bundle.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24', minify: true });

await build({entryPoints:[resolve(root,'scripts/testnet-admin-entry.mjs')],outfile:resolve(root,'scripts/testnet-admin.bundle.mjs'),bundle:true,platform:'node',format:'esm',target:'node24',minify:true});
