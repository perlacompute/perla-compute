import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { normalizeProjectX } from '@/lib/perla/project-links';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
 let configured: unknown = process.env.PERLA_X_URL;
 try {
   const file = resolve(dirname(resolve(process.env.PERLA_SQLITE_PATH || 'data/perla.sqlite')), 'site-links.json');
   const body = await readFile(file, 'utf8');
   if (body.length <= 4096) { const links = JSON.parse(body); if (Object.hasOwn(links, 'x')) configured = links.x; }
 } catch { /* A social link is optional. */ }
 return Response.json({ github: 'https://github.com/perlacompute/perla-compute', x: normalizeProjectX(configured) }, { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
