import type { MiningDatabase } from './database';
import { digest, randomToken, PROTOCOL, UPSTREAM_COMMIT } from './protocol';
import { canonical } from './work-policy';
import { isAddress } from 'viem';
type Context = {
 db: MiningDatabase; now: number; path: string;
 body: () => Promise<Record<string,unknown>>; origin: () => void;
 account: () => Promise<string>; worker: () => Promise<{id:string;address:string}>;
 operator: () => Promise<void>; health: () => Promise<Record<string,unknown>>;
 throttle: (key:string,max:number,window?:number)=>Promise<void>;
 fail: (code:number,message:string)=>never;
};
export function validGpuReport(value:unknown): value is Record<string,unknown> {
 const r=value as Record<string,unknown>; const device=r?.device as Record<string,unknown>;const cases=r?.cases as Record<string,unknown>[];
 return !!r&&r.version==='0.5.0'&&r.protocol===PROTOCOL&&r.upstreamCommit===UPSTREAM_COMMIT&&r.gpuSelfTestPassed===true&&r.coordinatorContacted===false&&r.ledgerCredit===0&&!!device&&[86,89,120].includes(Number(device.computeCapability))&&Array.isArray(cases)&&cases.length===2&&cases.some(c=>c.k===2048)&&cases.some(c=>c.k===4096)&&cases.every(c=>['fullGemmMatchesReference','allTranscriptsMatchReference','signedExtremesMatchReference','nativeV3ProofAccepted','nonWinningPowRejected','changedChallengeRejected'].every(k=>c[k]===true));
}
export async function trialFor(db:MiningDatabase,workerId:string,now:number){
 return db.prepare('SELECT t.* FROM mining_worker_trials t JOIN mining_workers w ON w.id=t.worker_id WHERE t.worker_id=? AND t.expires>? AND w.revoked IS NULL AND (SELECT COUNT(*) FROM mining_shares s WHERE s.worker_id=t.worker_id AND s.accepted>=t.created)<t.max_shares').bind(workerId,now).first<{worker_id:string;created:number;expires:number;max_shares:number}>();
}
const respond=(v:unknown,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function onboardingRequest(r:Request,c:Context):Promise<Response|null>{
 const {db,now,path}=c; const url=new URL(r.url);
 if(path==='worker/connect'&&r.method==='POST'){
  // Public payout routing grants no wallet session, management rights or claim authority.
  // A client-generated secret makes a lost-response retry idempotent without exposing it.
  const token=r.headers.get('authorization')?.replace(/^Bearer /,'')||'';
  if(!/^[a-f0-9]{64}$/.test(token))c.fail(401,'A new private worker credential is required.');
  const b=await c.body();
  if(typeof b.wallet!=='string'||!isAddress(b.wallet)||/^0x0{40}$/i.test(b.wallet))c.fail(400,'Enter a nonzero EVM reward address.');
  if(typeof b.name!=='string'||b.name.length>48||!/^[A-Za-z0-9]/.test(b.name)||/[^A-Za-z0-9._-]/.test(b.name))c.fail(400,'Use 1–48 letters, digits, dots, underscores or hyphens for the worker name.');
  const address=(b.wallet as string).toLowerCase(),name=b.name as string,hash=await digest(token);
  let row=await db.prepare('SELECT id,address,name,revoked FROM mining_workers WHERE token_hash=?').bind(hash).first<{id:string;address:string;name:string;revoked:number|null}>();
  if(!row){
   // Do not trust caller-provided proxy headers or impose a public per-wallet quota
   // that could block a wallet owner from registering their own authenticated rigs.
   await c.throttle('public-worker-connect-global',120,3600);
   const id=crypto.randomUUID();
   await db.batch([
    db.prepare('INSERT INTO mining_workers(id,address,name,token_hash,created) VALUES(?,?,?,?,?) ON CONFLICT(token_hash) DO NOTHING').bind(id,address,name,hash,now),
    db.prepare('INSERT INTO mining_public_workers(worker_id,created) SELECT id,? FROM mining_workers WHERE token_hash=? AND address=? AND name=? ON CONFLICT(worker_id) DO NOTHING').bind(now,hash,address,name)
   ]);
   row=await db.prepare('SELECT id,address,name,revoked FROM mining_workers WHERE token_hash=?').bind(hash).first();
  }
  if(!row||row.revoked!==null||row.address!==address||row.name!==name)c.fail(409,'This credential belongs to a different or revoked worker. Existing payout settings were retained.');
  return respond({state:'connected',id:row!.id,address,name,endpoint:url.origin,protocol:PROTOCOL,upstreamCommit:UPSTREAM_COMMIT,walletOwnershipVerified:false});
 }
 if(path==='pairing/start'&&r.method==='POST'){
  await c.throttle('pairing-start-global',120);const b=await c.body();
  if(typeof b.name!=='string'||!b.name.trim()||b.name.trim().length>48)c.fail(400,'Use a worker name of 1–48 characters.');
  const name=(b.name as string).trim(),device=randomToken(),code=randomToken().slice(0,12).toUpperCase(),id=crypto.randomUUID();
  await db.batch([db.prepare('DELETE FROM mining_device_pairings WHERE expires<?').bind(now),db.prepare('INSERT INTO mining_device_pairings(id,device_hash,code_hash,name,created,expires) VALUES(?,?,?,?,?,?)').bind(id,await digest(device),await digest(code),name,now,now+600)]);
  return respond({deviceSecret:device,userCode:code,verificationUrl:url.origin+'/platform/setup?pair='+code,expires:now+600,interval:5},201);
 }
 if(path==='pairing/info'&&r.method==='POST'){
  c.origin();await c.account();await c.throttle('pairing-info-global',120);const b=await c.body();
  if(typeof b.code!=='string'||!/^[A-F0-9]{12}$/.test(b.code))c.fail(400,'Enter the 12-character code shown by your CLI.');
  const row=await db.prepare('SELECT name,expires,address,consumed FROM mining_device_pairings WHERE code_hash=? AND expires>?').bind(await digest(b.code as string),now).first();
  if(!row)c.fail(404,'This pairing expired. Run perla login again.');
  return respond({name:row!.name,expires:row!.expires,approved:!!row!.address,consumed:!!row!.consumed});
 }
 if(path==='pairing/approve'&&r.method==='POST'){
  c.origin();const address=await c.account();await c.throttle('pairing-approve:'+address,12);const b=await c.body();
  if(typeof b.code!=='string'||!/^[A-F0-9]{12}$/.test(b.code))c.fail(400,'Invalid pairing code.');
  const changed=await db.prepare('UPDATE mining_device_pairings SET address=? WHERE code_hash=? AND expires>? AND address IS NULL AND consumed=0').bind(address,await digest(b.code as string),now).run();
  if(changed.meta.changes!==1)c.fail(409,'Pairing expired or was already approved.');
  return respond({approved:true});
 }
 if(path==='pairing/exchange'&&r.method==='POST'){
  const secret=r.headers.get('authorization')?.replace(/^Bearer /,'')||'';
  if(!/^[a-f0-9]{64}$/.test(secret))c.fail(401,'A device secret is required.');
  const hash=await digest(secret);await c.throttle('pairing-poll:'+hash,15);
  const pair=await db.prepare('SELECT * FROM mining_device_pairings WHERE device_hash=? AND expires>?').bind(hash,now).first<{id:string;name:string;address:string|null;consumed:number}>();
  if(!pair)c.fail(410,'Pairing expired; run perla login again.');
  if(pair!.consumed)c.fail(410,'Pairing was already claimed; run perla login again if the response was lost.');
  if(!pair!.address)return respond({state:'pending'},202);
  const id=crypto.randomUUID(),token=randomToken(),tokenHash=await digest(token);
  const result=await db.batch([
   db.prepare('INSERT INTO mining_workers(id,address,name,token_hash,created) SELECT ?,address,name,?,? FROM mining_device_pairings p WHERE p.id=? AND p.consumed=0 AND p.expires>? AND p.address IS NOT NULL AND (SELECT COUNT(*) FROM mining_workers w WHERE w.address=p.address AND w.revoked IS NULL AND NOT EXISTS(SELECT 1 FROM mining_public_workers pw WHERE pw.worker_id=w.id))<32').bind(id,tokenHash,now,pair!.id,now),
   db.prepare('UPDATE mining_device_pairings SET consumed=1 WHERE id=? AND EXISTS(SELECT 1 FROM mining_workers WHERE id=? AND token_hash=?)').bind(pair!.id,id,tokenHash)
  ]);
  if(result[0].meta.changes!==1)c.fail(409,'Pairing was claimed or the active-worker limit was reached.');
  return respond({state:'connected',id,token,address:pair!.address,name:pair!.name,endpoint:url.origin,protocol:PROTOCOL,upstreamCommit:UPSTREAM_COMMIT},201);
 }
 if(path==='worker/validation'&&r.method==='POST'){
  const w=await c.worker();await c.throttle('worker-validation:'+w.id,6);const b=await c.body();
  if(!validGpuReport(b.report))c.fail(400,'Both actual GPU cases and all correctness/proof checks must pass.');
  const report=canonical(b.report),hash=await digest(report);
  await db.prepare('INSERT INTO mining_worker_validations(worker_id,report,hash,created) VALUES(?,?,?,?) ON CONFLICT(worker_id) DO UPDATE SET report=excluded.report,hash=excluded.hash,created=excluded.created').bind(w.id,report,hash,now).run();
  return respond({uploaded:true,workerId:w.id,hash,review:'worker-reported; operator review required',ledgerCredit:0});
 }
 if(path==='operator/validations'&&r.method==='GET'){
  await c.operator();const rows=await db.prepare('SELECT v.worker_id,v.hash,v.created,v.report,w.address,w.name,w.revoked FROM mining_worker_validations v JOIN mining_workers w ON w.id=v.worker_id ORDER BY v.created DESC LIMIT 100').all();
  return respond({validations:rows.results.map(v=>({...v,report:JSON.parse(v.report as string)}))});
 }
 if(path==='operator/trials'&&r.method==='POST'){
  await c.operator();const b=await c.body();if(typeof b.workerId!=='string')c.fail(400,'A reviewed worker ID is required.');
  const row=await db.prepare('SELECT v.* FROM mining_worker_validations v JOIN mining_workers w ON w.id=v.worker_id WHERE v.worker_id=? AND w.revoked IS NULL').bind(b.workerId).first<{report:string;hash:string;created:number}>();
  if(!row||!validGpuReport(JSON.parse(row.report))||row.created<now-86400)c.fail(409,'A current uploaded GPU report must be reviewed first.');
  if(b.validationHash!==row!.hash)c.fail(409,'Validation changed; review the latest report before starting a trial.');
  const health=await c.health();if(health.ready!==true)c.fail(503,'Native verifier is not ready.');
  // One contribution, one named worker, 15 minutes. Never changes public admission.
  await db.batch([db.prepare('UPDATE mining_jobs SET expires=? WHERE worker_id=? AND expires>?').bind(now,b.workerId,now),db.prepare('INSERT INTO mining_worker_trials(worker_id,created,expires,max_shares,validation_hash) VALUES(?,?,?,1,?) ON CONFLICT(worker_id) DO UPDATE SET created=excluded.created,expires=excluded.expires,max_shares=1,validation_hash=excluded.validation_hash').bind(b.workerId,now,now+900,row!.hash)]);
  return respond({workerId:b.workerId,maxShares:1,expires:now+900,publicAdmissionChanged:false});
 }
 if(path==='operator/trials/stop'&&r.method==='POST'){
  await c.operator();const b=await c.body();if(typeof b.workerId!=='string')c.fail(400,'Worker ID required.');
  await db.prepare('DELETE FROM mining_worker_trials WHERE worker_id=?').bind(b.workerId).run();return respond({stopped:true});
 }
 return null;
}
