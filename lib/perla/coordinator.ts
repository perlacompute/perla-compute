import {launchState,canMine,readiness,verifyContractSmoke} from './testnet-readiness';
import {resolveWorkerRelease} from './worker-release-server';
import { roundPolicy,requireRounds,activateRounds,openRewardRound,roundInfo,roundForJob,creditRoundShare,RoundError } from './reward-rounds';
import { ROUND_POLICY } from './round-math';
import { cancelOwnerValidationAllocation } from './reward-cancellation';
import { configureRewardPolicy, prepareRewardEpoch, rewardSummary, settlementQueue, RewardScheduleError } from './reward-schedule';
import { onboardingRequest, trialFor } from './onboarding';
import type { MiningDatabase } from './database';
import { recoverMessageAddress, isAddress, createPublicClient, http, type Address } from 'viem';
import { CERT_VERSION, CHAIN_ID, JOB_TTL, MAX_PROOF_BYTES, PROTOCOL, SHARE_BITS, UPSTREAM_COMMIT, compactTarget, currentEpoch, digest, fromBase64, makeJobHeader, randomToken } from './protocol';
import { treasurySnapshot } from './treasury';
import { verifyFunding } from './funding';
import { createManifest, rewardsAbi } from './rewards';
import { workPolicy, profileFor, policyHash, canonical } from './work-policy';
import { withVerifierSlot, recordOperation, recordWorker, operationSummary } from './operations';
import { publicPortalResponse, accountRewards } from './portal';

export interface MiningEnv {
  DB?: MiningDatabase; PERLA_MINING_ENABLED?:string; PERLA_VERIFIER_URL?:string;
  PERLA_VERIFIER_TOKEN?:string; PERLA_OPERATOR_TOKEN?:string; PERLA_RPC_URL?:string;
  PERLA_REWARD_TOKEN?:string; PERLA_DISTRIBUTOR_ADDRESS?:string; PERLA_TESTNET_VALIDATION_WALLET?:string;
}
class HttpError extends Error { constructor(public status:number, message:string){super(message);} }
const fail=(status:number,message:string):never=>{throw new HttpError(status,message);};
const json=(data:unknown,status=200,extra:Record<string,string>={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...extra}});
const seconds=()=>Math.floor(Date.now()/1000);
const bearer=(r:Request)=>r.headers.get('authorization')?.replace(/^Bearer /,'')||'';
const wallet=(v:unknown)=>typeof v==='string'&&isAddress(v)?v.toLowerCase():fail(400,'A valid EVM address is required.');
const dbFor=(e:MiningEnv)=>e.DB??fail(503,'Mining storage is not configured.');
function originCheck(r:Request){if(r.headers.get('origin')!==new URL(r.url).origin)fail(403,'Use this website to authorize account changes.');}
async function body(r:Request,limit=12000):Promise<Record<string,unknown>> {
  if(!r.headers.get('content-type')?.startsWith('application/json'))fail(415,'JSON is required.');
  if(Number(r.headers.get('content-length'))>limit)fail(413,'Request too large.');
  const reader=r.body?.getReader();if(!reader)fail(400,'Empty request.');
  const parts:Uint8Array[]=[];let size=0;
  while(true){const {value,done}=await reader!.read();if(done)break;size+=value.length;if(size>limit){await reader!.cancel();fail(413,'Request too large.');}parts.push(value);}
  const bytes=new Uint8Array(size);let i=0;for(const part of parts){bytes.set(part,i);i+=part.length;}
  try {const value=JSON.parse(new TextDecoder().decode(bytes));if(!value||typeof value!=='object'||Array.isArray(value))return fail(400,'Invalid object.');return value;}catch{return fail(400,'Invalid JSON.');}
}
async function throttle(db:MiningDatabase,key:string,max:number,now:number,window=60){
  const bucket=`${key}:${Math.floor(now/window)}`;
  const row=await db.prepare('INSERT INTO mining_rate_limits (key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(bucket,now+window*2).first<{count:number}>();
  if(!row||row.count>max)fail(429,'Please wait before trying again.');
  await db.prepare('DELETE FROM mining_rate_limits WHERE key IN (SELECT key FROM mining_rate_limits WHERE expires<? LIMIT 20)').bind(now).run();
}
async function account(r:Request,db:MiningDatabase,now:number){
  const token=r.headers.get('cookie')?.match(/(?:^|;\s*)perla_account=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(!token)fail(401,'Sign in with your wallet first.');
  const a=await db.prepare('SELECT address FROM mining_auth_sessions WHERE hash=? AND expires>?').bind(await digest(token!),now).first<{address:string}>();
  return a?.address??fail(401,'Your wallet session expired.');
}
type Worker={id:string;address:string;name:string;revoked:number|null;token_hash:string};
async function worker(r:Request,db:MiningDatabase,now:number){
  const token=bearer(r);if(!/^[a-f0-9]{64}$/.test(token))fail(401,'A worker token is required.');
  const w=await db.prepare('SELECT id,address,name,revoked,token_hash FROM mining_workers WHERE token_hash=? AND revoked IS NULL').bind(await digest(token)).first<Worker>();
  if(!w)fail(401,'Worker token is invalid or revoked.');
  return w!;
}
function verifierConfig(e:MiningEnv){
  if(!e.PERLA_VERIFIER_URL||!e.PERLA_VERIFIER_TOKEN||e.PERLA_VERIFIER_TOKEN.length<32)fail(503,'Native proof verifier is not configured.');
  let u:URL;try{u=new URL(e.PERLA_VERIFIER_URL!);}catch{fail(503,'Native proof verifier configuration is invalid.');}
  if(u!.username||u!.password||u!.search||u!.hash || (u!.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(u!.hostname)))fail(503,'Verifier requires HTTPS.');
  return {url:u!.href.replace(/\/$/,''),token:e.PERLA_VERIFIER_TOKEN!};
}
async function verifierCall(e:MiningEnv,path:string,payload?:unknown){
  const c=verifierConfig(e); const started=Date.now();
  try {
    return await withVerifierSlot(async()=>{
      const response=await fetch(c.url+path,{method:payload?'POST':'GET',headers:{authorization:`Bearer ${c.token}`,'content-type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(25000),redirect:'error'});
      if(!response.ok) throw Error('VERIFIER_UNAVAILABLE');
      const data=await response.json() as Record<string,unknown>;
      const supported=path==='/health' ? Array.isArray(data.supported_protocols)&&data.supported_protocols.includes(PROTOCOL) : data.protocol===PROTOCOL;
      if(!supported||data.upstream_commit!==UPSTREAM_COMMIT)fail(503,'Native verifier protocol does not match this release.');
      await recordOperation(e.DB,'verifier_completed',Date.now()-started);
      return data;
    });
  } catch(error) {
    await recordOperation(e.DB,error instanceof Error&&error.message==='VERIFIER_BUSY'?'verifier_busy':'verifier_unavailable',Date.now()-started);
    if(error instanceof HttpError)throw error;
    return fail(503,'Native proof verifier is busy or unavailable. No contribution was credited. Retry after 10 seconds.');
  }
}
async function operator(r:Request,e:MiningEnv){
  if(!e.PERLA_OPERATOR_TOKEN||e.PERLA_OPERATOR_TOKEN.length<32||await digest(bearer(r))!==await digest(e.PERLA_OPERATOR_TOKEN))fail(401,'Operator authorization is required.');
}
export async function miningSummary(e:MiningEnv){
  if(!e.DB)return {storage:false,miningEnabled:false,workers:0,acceptedWork:0,claimsEnabled:false,protocol:PROTOCOL,verifier:'not_configured'};
  const totals=await e.DB.prepare('SELECT COUNT(*) AS shares, COALESCE(SUM(points),0) AS points FROM mining_shares').first<{shares:number;points:number}>();
  const w=await e.DB.prepare('SELECT COUNT(*) AS n FROM mining_workers WHERE revoked IS NULL AND last_seen>?').bind(seconds()-90).first<{n:number}>();
  const active=await e.DB.prepare("SELECT COUNT(*) AS n FROM mining_reward_epochs WHERE state='active'").first<{n:number}>();
  const registered=await e.DB.prepare('SELECT COUNT(*) AS n FROM mining_workers WHERE revoked IS NULL').first<{n:number}>();
  const policy=await workPolicy(e),rp=await roundPolicy(e);const effective=policy.miningEnabled&&!!rp&&!rp.suspended;
  return {storage:true,registeredWorkers:registered?.n??0,activeWorkers:w?.n??0,policy:{...policy,miningEnabled:effective},workAdmissionEnabled:policy.miningEnabled,launch:await launchState(e).then(s=>s?{phase:s.phase,resetAt:s.reset_at,automaticSettlement:!!s.automation_enabled}:null),rewardPolicy:{policy:ROUND_POLICY,configured:!!rp,ready:!!rp&&!rp.suspended,policyHash:rp?.policy_hash??null},miningEnabled:effective,workers:w?.n??0,acceptedWork:totals?.points??0,acceptedShares:totals?.shares??0,claimsEnabled:(active?.n??0)>0,protocol:PROTOCOL,verifier:e.PERLA_VERIFIER_URL&&e.PERLA_VERIFIER_TOKEN?'configured':'not_configured'};
}
export async function handleMiningRequest(r:Request,e:MiningEnv):Promise<Response>{
 try{
  const url=new URL(r.url);const path=url.pathname.replace(/^\/api\/mining\/?/,'');const now=seconds();
  if(path==='status'&&r.method==='GET'){
   return json({...await miningSummary(e),chainId:CHAIN_ID,upstreamCommit:UPSTREAM_COMMIT,claimStatusSource:'active allocation records; individual claims require a fresh onchain check'});
  }
  if(e.DB&&r.method==='GET'&&/^(treasury|epochs\/\d+)$/.test(path))await throttle(e.DB,'public-rpc-global',120,now);
  const portal=await publicPortalResponse(r,e);if(portal)return portal;
  const db=dbFor(e);
  const setup=await onboardingRequest(r,{db,now,path,body:()=>body(r),origin:()=>originCheck(r),account:()=>account(r,db,now),worker:()=>worker(r,db,now),operator:()=>operator(r,e),health:()=>verifierCall(e,'/health'),throttle:(key,max,window)=>throttle(db,key,max,now,window),fail});if(setup)return setup;
  if(path==='readiness'&&r.method==='GET'||path==='operator/testnet/readiness'&&r.method==='GET'||path==='operator/testnet/live'&&r.method==='POST'){
   const privileged=path.startsWith('operator/');if(privileged)await operator(r,e);else await throttle(db,'public-readiness',20,now);
   let nativeReady=false;try{const h=await verifierCall(e,'/health');nativeReady=h.ready===true&&h.round_target_policy===ROUND_POLICY;}catch{}
   const release=await resolveWorkerRelease();
   const state=await readiness(e,{nativeReady,releaseReady:release.state==='available'&&release.tag==='worker-v0.9.1'&&release.integrityVerified===true},now);
   if(r.method==='POST'){
    if(!state.ready)return json({error:'The fresh GPU-to-earned-claim checks are incomplete.',...state},409);
    const launch=await launchState(e);await verifyContractSmoke(e,{epoch:launch!.smoke_epoch!,fundingTransaction:launch!.smoke_funding_tx as `0x${string}`,claimTransaction:launch!.smoke_claim_tx as `0x${string}`});
    await db.prepare("UPDATE mining_testnet_state SET phase='live',launched_at=? WHERE id=1 AND phase='testing'").bind(now).run();
    return json({...state,phase:'live',publicWorkAdmission:true});
   }
   return json(state);
  }
  if(path.startsWith('operator/testnet/')){
   await operator(r,e);const state=await launchState(e);if(!state)fail(409,'Run the fresh-testnet reset before enabling automation.');
   if(path==='operator/testnet/state'&&r.method==='GET')return json(state);
   if(path==='operator/testnet/testing-claims'&&r.method==='GET'){
    const rows=state!.phase==='testing'?await db.prepare("SELECT manifest FROM mining_reward_epochs WHERE state='active' ORDER BY epoch DESC LIMIT 10").all<{manifest:string}>():{results:[]};
    return json({phase:state!.phase,items:rows.results.map(x=>JSON.parse(x.manifest))});
   }
   if(path==='operator/testnet/automation'&&r.method==='POST'){
    const b=await body(r);if(b.enabled!==true||![null,'settlement_check_failed'].includes(b.error as null|string))fail(400,'Invalid settlement heartbeat.');
    await db.prepare('UPDATE mining_testnet_state SET automation_enabled=1,automation_checked=?,automation_error=? WHERE id=1').bind(now,b.error).run();return json({recorded:true});
   }
   if(path==='operator/testnet/smoke'&&r.method==='POST'){
    const b=await body(r);if(typeof b.epoch!=='string'||!/^\d{1,50}$/.test(b.epoch)||![b.fundingTransaction,b.claimTransaction].every(x=>typeof x==='string'&&/^0x[0-9a-fA-F]{64}$/.test(x)))fail(400,'Invalid smoke receipt.');
    return json(await verifyContractSmoke(e,b as unknown as {epoch:string;fundingTransaction:`0x${string}`;claimTransaction:`0x${string}`}));
   }
  }
  if(path==='rounds'&&r.method==='GET'){const rows=await db.prepare('SELECT id,epoch,state,difficulty_weight,target_bits,reward,opened,closed,winner_share FROM mining_reward_rounds ORDER BY rowid DESC LIMIT 20').all();return json({items:rows.results,policy:ROUND_POLICY,chainId:CHAIN_ID});}
  if(path==='operator/reward-rounds/activate'&&r.method==='POST'){
   await operator(r,e);const health=await verifierCall(e,'/health');if(health.round_target_policy!==ROUND_POLICY)fail(503,'Upgrade the native verifier before activating round rewards.');
   const old=await db.prepare('SELECT state FROM mining_reward_epochs WHERE epoch=20754').first<{state:string}>();if(old?.state==='prepared')fail(409,'Cancel the authorized owner validation allocation before activating round rewards.');
   await configureRewardPolicy(e,now);return json(await activateRounds(e,now));
  }
  if(path==='operator/reward-rounds/suspend'&&r.method==='POST'){await operator(r,e);await db.prepare('UPDATE mining_round_policy SET suspended=1 WHERE id=1').run();return json({suspended:true,ledgerPreserved:true});}
  if(path==='operator/epochs/20754/cancel'&&r.method==='POST'){await operator(r,e);return json(await cancelOwnerValidationAllocation(e,now));}
  if(path==='policy'&&r.method==='GET')return json(await workPolicy(e));
  if(path==='operator/health'&&r.method==='GET'){await operator(r,e);let native:unknown;try{native=await verifierCall(e,'/health');}catch{native={ready:false};}return json({operations:await operationSummary(db),policy:await workPolicy(e),native,treasury:await treasurySnapshot(e)});}
  if(path==='operator/policy'&&r.method==='POST'){
   await operator(r,e);const b=await body(r);let profile;try{profile=profileFor(String(b.profile));}catch{fail(400,'Unknown work profile.');}
   const start=Number(b.startEpoch);const report=b.validation as Record<string,unknown>;
   const device=report?.device as Record<string,unknown>;const cases=report?.cases as Record<string,unknown>[];
   if(!Number.isSafeInteger(start)||start<currentEpoch(now)||!report||report.version!=='0.5.0'||report.protocol!==PROTOCOL||report.upstreamCommit!==UPSTREAM_COMMIT||report.gpuSelfTestPassed!==true||!Array.isArray(cases)||cases.length!==2||!device||![86,89,120].includes(Number(device.computeCapability))||cases.some(c=>c.fullGemmMatchesReference!==true||c.allTranscriptsMatchReference!==true||c.nativeV3ProofAccepted!==true||c.nonWinningPowRejected!==true||c.changedChallengeRejected!==true)||!cases.some(c=>c.k===2048)||!cases.some(c=>c.k===4096))fail(400,'A current RTX GPU self-test report and a current or future UTC epoch are required. The report is an operator assertion, not hardware attestation.');
   if(start===currentEpoch(now)&&await db.prepare('SELECT s.id FROM mining_shares s JOIN mining_jobs j ON j.id=s.job_id WHERE s.epoch=? AND j.protocol<>? LIMIT 1').bind(start,PROTOCOL).first())fail(409,'This epoch contains legacy work. Schedule the policy for the next UTC epoch.');
   await db.prepare('INSERT INTO mining_policy_state(id,profile_id,start_epoch,activated_at,validation_hash,validation_family,validation_version) VALUES(1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET profile_id=excluded.profile_id,start_epoch=excluded.start_epoch,activated_at=excluded.activated_at,validation_hash=excluded.validation_hash,validation_family=excluded.validation_family,validation_version=excluded.validation_version').bind(profile!.id,start,now,await digest(canonical(report)),String(device.computeCapability),'0.5.0').run();
   return json(await workPolicy(e));
  }
  if(path==='worker/status'&&r.method==='GET'){const w=await worker(r,db,now);await throttle(db,`diagnostics:${w.id}`,12,now);await db.prepare('UPDATE mining_workers SET last_seen=? WHERE id=? AND token_hash=? AND revoked IS NULL').bind(now,w.id,w.token_hash).run();const counts=await db.prepare('SELECT kind,SUM(count) AS count FROM mining_worker_counts WHERE worker_id=? GROUP BY kind').bind(w.id).all();const raw=await workPolicy(e),rp=await roundPolicy(e);return json({id:w.id,address:w.address,name:w.name,protocol:PROTOCOL,policy:{...raw,miningEnabled:raw.miningEnabled&&!!rp&&!rp.suspended},rewardPolicy:ROUND_POLICY,rewardPolicyReady:!!rp&&!rp.suspended,trial:null,counts:counts.results,credentialValid:true,ledgerCredit:0});}
  if(path==='rewards/summary'&&r.method==='GET')return json(await rewardSummary(e,now));
  if(path==='operator/rewards/configure'&&r.method==='POST'){await operator(r,e);return json(await configureRewardPolicy(e,now));}
  if(path==='operator/rewards'&&r.method==='GET'){await operator(r,e);return json(await settlementQueue(e,now));}
  if(path==='rewards/account'&&r.method==='GET'){
   const address=await account(r,db,now);const before=url.searchParams.get('before');
   if(before!==null&&!/^\d{1,15}$/.test(before))fail(400,'Invalid reward page cursor.');
   return json({...await accountRewards(e,address,before===null?undefined:Number(before)),current:await rewardSummary(e,now,address)});
  }
  if(path==='auth/challenge'&&r.method==='POST'){
   originCheck(r);const b=await body(r);const address=wallet(b.address);
   // Request-supplied proxy headers are not a trusted identity. Bound global load and each wallet.
   await throttle(db,'challenge-global',1200,now);
   await throttle(db,`challenge-wallet:${address}`,8,now);
   const id=crypto.randomUUID();const nonce=randomToken();const expires=now+300;
   const message=`${url.host} wants you to sign in to Perla:\n${address}\n\nAuthorize this browser to manage mining workers. This does not authorize a transaction or token transfer.\n\nURI: ${url.origin}\nVersion: 1\nChain ID: ${CHAIN_ID}\nNonce: ${nonce}\nIssued At: ${new Date(now*1000).toISOString()}\nExpiration Time: ${new Date(expires*1000).toISOString()}`;
   await db.batch([db.prepare('DELETE FROM mining_auth_challenges WHERE expires<?').bind(now),db.prepare('INSERT INTO mining_auth_challenges (id,address,message,expires,used) VALUES (?,?,?,?,0)').bind(id,address,message,expires)]);
   return json({id,message,expires});
  }
  if(path==='auth/verify'&&r.method==='POST'){
   originCheck(r);await throttle(db,'verify-global',1200,now);const b=await body(r);if(typeof b.id!=='string'||typeof b.signature!=='string'||!/^0x[0-9a-fA-F]{130}$/.test(b.signature))fail(400,'Invalid wallet authorization.');
   const c=await db.prepare('SELECT * FROM mining_auth_challenges WHERE id=? AND used=0 AND expires>?').bind(b.id,now).first<{id:string;address:string;message:string}>();
   if(!c)fail(401,'Authorization challenge expired or was already used.');
   let recovered:string;try{recovered=await recoverMessageAddress({message:c!.message,signature:b.signature as `0x${string}`});}catch{fail(401,'Signature verification failed.');}
   if(recovered!.toLowerCase()!==c!.address)fail(401,'Signature does not match this wallet.');
   const token=randomToken();const hash=await digest(token);
   const changes=await db.batch([
    db.prepare('INSERT INTO mining_auth_sessions (hash,address,expires) SELECT ?,address,? FROM mining_auth_challenges WHERE id=? AND used=0 AND expires>?').bind(hash,now+86400,b.id,now),
    db.prepare('UPDATE mining_auth_challenges SET used=1 WHERE id=? AND used=0').bind(b.id),
   ]);
   if(changes[0].meta.changes!==1)fail(401,'Authorization challenge was already used.');
   const secure=url.protocol==='https:'?'; Secure':'';
   return json({address:c!.address},200,{'Set-Cookie':`perla_account=${token}; HttpOnly; SameSite=Strict; Path=/api/mining; Max-Age=86400${secure}`});
  }
  if(path==='auth/logout'&&r.method==='POST'){
   originCheck(r);const token=r.headers.get('cookie')?.match(/perla_account=([a-f0-9]{64})/)?.[1];
   if(token)await db.prepare('DELETE FROM mining_auth_sessions WHERE hash=?').bind(await digest(token)).run();
   return json({ok:true},200,{'Set-Cookie':'perla_account=; HttpOnly; SameSite=Strict; Path=/api/mining; Max-Age=0'});
  }
  if(path==='account'&&r.method==='GET'){
   const address=await account(r,db,now);
   const workers=await db.prepare('SELECT id,name,created,last_seen,revoked,miner_version,architecture,last_error FROM mining_workers WHERE address=? ORDER BY created DESC LIMIT 100').bind(address).all();
   const history=await db.prepare('SELECT id,job_id,worker_id,epoch,proof_hash,accepted,points FROM mining_shares WHERE address=? ORDER BY accepted DESC LIMIT 50').bind(address).all();
   const totals=await db.prepare('SELECT COUNT(*) AS shares, COALESCE(SUM(points),0) AS points FROM mining_shares WHERE address=?').bind(address).first();
   const epochRows=await db.prepare("SELECT epoch,manifest,state,token FROM mining_reward_epochs WHERE state='active' ORDER BY epoch DESC LIMIT 100").all<{epoch:number;manifest:string;state:string;token:string}>();
   const rewards=epochRows.results.flatMap(row=>{const m=JSON.parse(row.manifest);const a=m.allocations.find((a:{address:string})=>a.address===address);return a?[{...a,epoch:row.epoch,root:m.root,distributor:m.distributor,token:row.token,chainId:CHAIN_ID}]:[];});
   const diagnostics=await db.prepare('SELECT c.worker_id,c.kind,SUM(c.count) AS count FROM mining_worker_counts c JOIN mining_workers w ON w.id=c.worker_id WHERE w.address=? GROUP BY c.worker_id,c.kind').bind(address).all();
   const summary=await miningSummary(e);return json({diagnostics:diagnostics.results,...summary,address,networkWorkers:summary.workers,workers:workers.results,history:history.results,totals,rewards});
  }
  if(path==='workers'&&r.method==='POST'){
   originCheck(r);const address=await account(r,db,now);const b=await body(r);
   await throttle(db,`new-worker:${address}`,8,now,3600);
   if(typeof b.name!=='string'||!b.name.trim()||b.name.trim().length>48)fail(400,'Worker name must be 1–48 characters.');
   const count=await db.prepare('SELECT COUNT(*) AS n FROM mining_workers w WHERE address=? AND revoked IS NULL AND NOT EXISTS(SELECT 1 FROM mining_public_workers p WHERE p.worker_id=w.id)').bind(address).first<{n:number}>();if((count?.n??0)>=32)fail(409,'Revoke an unused worker before creating another. The authenticated-worker limit is 32 per wallet.');
   const name=(b.name as string).trim();const id=crypto.randomUUID();const token=randomToken();
   await db.prepare('INSERT INTO mining_workers (id,address,name,token_hash,created) VALUES (?,?,?,?,?)').bind(id,address,name,await digest(token),now).run();
   return json({id,token,address,name,endpoint:url.origin,protocol:PROTOCOL,upstreamCommit:UPSTREAM_COMMIT},201);
  }
  if(path.startsWith('workers/')&&r.method==='DELETE'){
   originCheck(r);const address=await account(r,db,now);const id=path.slice(8);
   await db.batch([db.prepare('UPDATE mining_workers SET revoked=? WHERE id=? AND address=? AND revoked IS NULL').bind(now,id,address),db.prepare('UPDATE mining_worker_reconnects SET expires=0 WHERE worker_id=? AND consumed=0 AND EXISTS(SELECT 1 FROM mining_workers w WHERE w.id=? AND w.address=?)').bind(id,id,address)]);return json({ok:true});
  }
  if(path==='work'&&r.method==='GET'){
   const w=await worker(r,db,now);await throttle(db,`work:${w.id}`,120,now);
   if(!await canMine(e,w.address))fail(503,'This reward wallet is not admitted for validation. Work is limited to the configured validation wallets until the complete GPU and reward checks pass.');
   if(r.headers.get('x-perla-protocol')!==PROTOCOL||r.headers.get('x-perla-reward-policy')!==ROUND_POLICY)fail(426,'Upgrade the GPU CLI to worker 0.9.1 for round rewards.');
   const policy=await workPolicy(e);if(!policy.miningEnabled)fail(503,'Mining admission is paused. Your worker identity is retained.');
   await requireRounds(e);const round=await openRewardRound(e,now);
   if(!await db.prepare('SELECT address FROM mining_round_epoch_recipients WHERE epoch=? AND address=?').bind(round.epoch,w.address).first()&&(await db.prepare('SELECT COUNT(*) n FROM mining_round_epoch_recipients WHERE epoch=?').bind(round.epoch).first<{n:number}>())!.n>=5000)fail(503,'The epoch recipient limit is reached. New reward wallets can request work next UTC epoch.');
   const h=await verifierCall(e,'/health');if(h.ready!==true||h.round_target_policy!==ROUND_POLICY)fail(503,'The round-target native verifier is not ready.');
   if(!await db.prepare('SELECT id FROM mining_workers WHERE id=? AND token_hash=? AND revoked IS NULL').bind(w.id,w.token_hash).first())fail(401,'Worker access changed.');
   const version=r.headers.get('x-perla-version'),arch=r.headers.get('x-perla-architecture');
   await db.prepare('UPDATE mining_workers SET last_seen=?,miner_version=?,architecture=? WHERE id=? AND token_hash=? AND revoked IS NULL').bind(now,version&&/^[0-9.a-z-]{1,24}$/.test(version)?version:null,arch&&/^(86|89|90|120)$/.test(arch)?arch:null,w.id,w.token_hash).run();
   let job=await db.prepare('SELECT j.* FROM mining_jobs j JOIN mining_round_jobs q ON q.job_id=j.id LEFT JOIN mining_shares s ON s.job_id=j.id WHERE j.worker_id=? AND j.expires>? AND q.round_id=? AND s.id IS NULL ORDER BY j.created DESC LIMIT 1').bind(w.id,now,round.id).first<{id:string;header:string;expires:number;epoch:number;created:number;policy_hash:string;profile_id:string;work_points:number;share_bits:number}>();
   if(!job){
    const id=crypto.randomUUID(),epoch=currentEpoch(now),expires=Math.min(now+JOB_TTL,(epoch+1)*86400),header=await makeJobHeader(url.origin,w.id,w.address,epoch,id,now,policy.profile.bits,{id:round.id,policyHash:round.policy_hash});
    const changes=await db.batch([
     db.prepare("INSERT INTO mining_jobs(id,worker_id,epoch,header,created,expires,protocol,share_bits,work_points,policy_hash,profile_id) SELECT ?,w.id,?,?,?,?,?,?,?,?,? FROM mining_workers w WHERE w.id=? AND w.token_hash=? AND w.revoked IS NULL AND EXISTS(SELECT 1 FROM mining_reward_rounds r JOIN mining_round_policy p ON p.policy_hash=r.policy_hash WHERE r.id=? AND r.state='open' AND p.suspended=0)").bind(id,epoch,header,now,expires,PROTOCOL,policy.profile.bits,policy.profile.points,policy.hash,policy.profile.id,w.id,w.token_hash,round.id),
     db.prepare('INSERT INTO mining_round_jobs(job_id,round_id) SELECT id,? FROM mining_jobs WHERE id=?').bind(round.id,id),
    ]);
    if(changes[0].meta.changes!==1)fail(409,'Round or worker access changed. Request a new challenge.');
    job={id,epoch,header,created:now,expires,share_bits:policy.profile.bits,work_points:policy.profile.points,policy_hash:policy.hash,profile_id:policy.profile.id};
   }
   if(!await db.prepare('SELECT id FROM mining_workers WHERE id=? AND token_hash=? AND revoked IS NULL').bind(w.id,w.token_hash).first())fail(401,'Worker access changed.');
   return json({id:job.id,epoch:job.epoch,expires:job.expires,protocol:PROTOCOL,chainId:CHAIN_ID,recipient:w.address,workerId:w.id,created:job.created,round:roundInfo(round),workPolicy:{hash:job.policy_hash,profile:job.profile_id,points:job.work_points,bits:job.share_bits},mining_job:{incomplete_header_bytes:job.header,target:compactTarget(job.share_bits).toString(),cert_version:CERT_VERSION}});
  }
  if(path==='shares'&&r.method==='POST'){
   const w=await worker(r,db,now);await throttle(db,`share:${w.id}`,30,now);
   if(r.headers.get('x-perla-protocol')!==PROTOCOL||r.headers.get('x-perla-reward-policy')!==ROUND_POLICY)fail(426,'Upgrade the GPU CLI to worker 0.9.1.');
   await requireRounds(e);const admission=(await workPolicy(e)).miningEnabled;if(!admission)fail(503,'Paid round work is paused.');
   const b=await body(r,Math.ceil(MAX_PROOF_BYTES*4/3)+4096);
   if(typeof b.jobId!=='string'||typeof b.plainProof!=='string')fail(400,'A job and native plain proof are required.');
   const proof=b.plainProof as string;let bytes:Uint8Array;try{bytes=fromBase64(proof);}catch{fail(400,'Invalid proof encoding.');}
   if(bytes!.length<64||bytes!.length>MAX_PROOF_BYTES)fail(400,'Invalid proof size.');
   const j=await db.prepare('SELECT * FROM mining_jobs WHERE id=? AND worker_id=?').bind(b.jobId,w.id).first<{id:string;header:string;epoch:number;protocol:string;work_points:number;expires:number}>();
   if(!j)fail(409,'Job does not belong to this worker.');
   if(await db.prepare('SELECT id FROM mining_shares WHERE job_id=?').bind(j!.id).first())fail(409,'This job was already credited.');
   if(j!.expires<=now||j!.epoch!==currentEpoch(now))return json({error:'Job expired. Request a new challenge.',code:'job_expired',credited:false},409);
   const round=await roundForJob(e,j!.id);if(!round||round.state!=='open')return json({error:'Reward round closed. Request a new challenge.',code:'round_closed',credited:false},409);
   const proofHash=await digest(bytes!),headerHash=await digest(fromBase64(j!.header));
   const result=await verifierCall(e,'/verify',{header:j!.header,plain_proof:proof,cert_version:CERT_VERSION,protocol:PROTOCOL,round_bits:round.target_bits});
   if(result.valid!==true){await recordWorker(db,w.id,'rejected');fail(422,'Native proof was rejected. No work was credited.');}
   if(result.proof_hash!==proofHash||result.header_hash!==headerHash||result.round_target_policy!==ROUND_POLICY||result.round_bits!==round.target_bits||typeof result.round_valid!=='boolean')fail(503,'Round verifier response binding failed.');
   const id=crypto.randomUUID();let receipt;
   try{receipt=await creditRoundShare(e,{id,jobId:j!.id,workerId:w.id,tokenHash:w.token_hash,proofHash,accepted:seconds(),round,won:result.round_valid===true,admission});}
   catch(error){if(error instanceof RoundError&&error.status===409&&!await db.prepare('SELECT id FROM mining_shares WHERE job_id=?').bind(j!.id).first()){const latest=await roundForJob(e,j!.id);if(latest&&latest.state!=='open')return json({error:'Reward round closed. Request a new challenge.',code:'round_closed',credited:false},409);if(j!.expires<=seconds()||j!.epoch!==currentEpoch(seconds()))return json({error:'Job expired during verification. Request a new challenge.',code:'job_expired',credited:false},409);}throw error;}
   await recordWorker(db,w.id,'accepted');
   return json({id,accepted:true,workWeight:j!.work_points,epoch:j!.epoch,proofHash,roundId:round.id,roundWon:receipt.roundWon,roundReward:receipt.roundWon?round.reward:'0',tokenReward:null},201);
  }
  if(path.match(/^operator\/epochs\/\d+\/funding$/)&&r.method==='POST'){
   await operator(r,e);const epoch=Number(path.split('/')[2]);const b=await body(r);if(typeof b.transaction!=='string'||!/^0x[a-f0-9]{64}$/i.test(b.transaction))fail(400,'A funding transaction hash is required.');
   const row=await db.prepare('SELECT * FROM mining_reward_epochs WHERE epoch=?').bind(epoch).first<{epoch:number;distributor:Address;token:Address;root:string;budget:string;state:string}>();if(row?.state==='cancelled')fail(409,'Cancelled allocation cannot be funded.');if(!row)fail(404,'Epoch not found.');
   let trace;try{trace=await verifyFunding(e,row!,b.transaction as `0x${string}`);}catch{fail(409,'The canonical funding transaction, event and contract must match this manifest.');}
   const updated=await db.prepare('UPDATE mining_reward_epochs SET funding_tx=?,funding_block=?,funding_block_hash=? WHERE epoch=? AND state<>\'cancelled\'').bind(trace!.transaction,trace!.block,trace!.blockHash,epoch).run();if(updated.meta.changes!==1)fail(409,'Allocation was cancelled while recording funding.');return json(trace);
  }
  if(path==='operator/epochs'&&r.method==='POST'){
   await operator(r,e);const b=await body(r);return json(await prepareRewardEpoch(e,Number(b.epoch),now,b.budget));
  }
  if(path.match(/^operator\/epochs\/\d+$/)&&r.method==='GET'){
   await operator(r,e);const row=await db.prepare('SELECT * FROM mining_reward_epochs WHERE epoch=?').bind(Number(path.split('/').at(-1))).first();return row?json(row):json({error:'Epoch not found.'},404);
  }
  if(path.match(/^operator\/epochs\/\d+\/activate$/)&&r.method==='POST'){
   await operator(r,e);const epoch=Number(path.split('/')[2]);const row=await db.prepare('SELECT * FROM mining_reward_epochs WHERE epoch=?').bind(epoch).first<{epoch:number;root:`0x${string}`;budget:string;distributor:Address;token:Address;funding_tx:`0x${string}`|null;state:string}>();if(row?.state==='cancelled')fail(409,'Cancelled allocation cannot be activated.');if(!row)fail(404,'Epoch not found.');
   if(!row!.funding_tx)fail(409,'Record the canonical funding transaction before activation.');
   try{await verifyFunding(e,row!,row!.funding_tx!);}catch{fail(409,'The recorded funding transaction is not canonical or does not match.');}
   const activated=await db.prepare("UPDATE mining_reward_epochs SET state='active' WHERE epoch=? AND state<>'cancelled'").bind(epoch).run();if(activated.meta.changes!==1)fail(409,'Allocation was cancelled while activating.');return json({epoch,state:'active'});
  }
  return json({error:'Endpoint not found.'},404);
 }catch(error){if(error instanceof HttpError||error instanceof RewardScheduleError||error instanceof RoundError)return json({error:error.message},error.status,error.status===503||error.status===429?{'Retry-After':'10'}:{});return json({error:'Mining service could not complete this request. No unverified work was credited.'},503);}
}
