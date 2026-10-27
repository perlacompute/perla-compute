import { publicRewardPlan } from '@/lib/perla/reward-plan.mjs';
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json(publicRewardPlan(), { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
