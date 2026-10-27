export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { env } from '@/lib/vps/runtime';
import { handleMiningRequest, type MiningEnv } from '@/lib/perla/coordinator';
import { canonicalMiningRequest } from '@/lib/vps/request';
const handle=(request:Request)=>{
  try{return handleMiningRequest(canonicalMiningRequest(request),env as unknown as MiningEnv);}
  catch{return Response.json({error:'Website origin configuration is invalid. Check PERLA_PUBLIC_ORIGIN.'},{status:503,headers:{'Cache-Control':'no-store'}});}
};
export const GET=handle;
export const POST=handle;
export const DELETE=handle;
