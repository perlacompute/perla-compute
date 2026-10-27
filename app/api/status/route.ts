export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { runtimeStatus } from '@/lib/auren/runtime';
import { brand } from '@/lib/auren/brand';
import {env} from '@/lib/vps/runtime';
import {miningSummary,type MiningEnv} from '@/lib/perla/coordinator';
export async function GET() { try{return Response.json({ ...runtimeStatus(), ...await miningSummary(env as unknown as MiningEnv), network: brand.network, tokenAddress: brand.token.address, updatedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });}catch{return Response.json({error:'Status unavailable'},{status:503});} }
