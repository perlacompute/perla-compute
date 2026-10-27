export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { modelCatalog } from '@/lib/auren/brand';
import { runtimeStatus } from '@/lib/auren/runtime';
export async function GET() { const status = runtimeStatus(); return Response.json({ object: 'list', mode: status.inferenceConfigured ? 'configured' : 'reference', data: modelCatalog.map(m => ({ ...m, available: status.inferenceConfigured && status.activeModel === m.id })) }, { headers: { 'Cache-Control': 'no-store' } }); }
