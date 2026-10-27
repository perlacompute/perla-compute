import { resolveWorkerRelease } from '@/lib/perla/worker-release-server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  return Response.json(await resolveWorkerRelease(), { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
