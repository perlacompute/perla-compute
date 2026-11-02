import { isAddress, type Address } from 'viem';
import rules from './round-rules.json';
import { compactTarget, SHARE_BITS, digest } from './protocol';
function canonical(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
 return JSON.stringify(value);
}
import { createManifest, createAmountManifest } from './rewards';
import { dailyBudget } from './emission.mjs';
export const ROUND_RULES=rules;
export const ROUND_POLICY=rules.policy;
export const ROUND_POLICY_HASH="815efedf86e62a15e709bddfb4bad13569ddc24e714614e56fdcccaba8bc15d5";
export const roundPolicyHash=()=>digest(canonical(rules));
export type WorkRow={address:Address;workUnits:number};
export type WonRound={id:string;reward:string;snapshot:string;difficulty_weight:number;target_bits:number;winner_share:string};
export function roundTarget(weight:number){
 const target=rules.targets.find(t=>t.workUnits===weight);
 if(!target||compactTarget(SHARE_BITS)/compactTarget(target.bits)!==BigInt(weight)||compactTarget(SHARE_BITS)%compactTarget(target.bits)!==0n)throw Error('Invalid round target');
 return target;
}
export function nextRoundWeight(weight:number,durations:number[]){
 roundTarget(weight);if(durations.length!==rules.retargetRounds||durations.some(n=>!Number.isSafeInteger(n)||n<1))return weight;
 const sum=durations.reduce((a,b)=>a+b,0),expected=rules.targetSeconds*rules.retargetRounds;
 return sum<expected/2?Math.min(rules.maximumWorkUnits,weight*2):sum>expected*2?Math.max(rules.minimumWorkUnits,weight/2):weight;
}
export const rewardPerRound=(cap:bigint)=>cap/BigInt(rules.dailyRoundLimit);
export function splitRound(reward:bigint,rows:WorkRow[]){
 if(!Array.isArray(rows)||!rows.length||rows.length>4096||rows.some(r=>!isAddress(r.address)||r.address!==r.address.toLowerCase()||!Number.isSafeInteger(r.workUnits)||r.workUnits<1))throw Error('Invalid PPLNS snapshot');
 return createManifest(0,reward,'0x0000000000000000000000000000000000000001',rows.map(r=>({address:r.address,points:r.workUnits}))).allocations.map(r=>({address:r.address,workUnits:r.points,amount:r.amount}));
}
export function earnedManifest(epoch:number,distributor:Address,rounds:WonRound[],startEpoch:number,policyHash:string){
 if(!Number.isSafeInteger(startEpoch)||startEpoch<0||epoch<startEpoch||!Array.isArray(rounds)||!rounds.length||rounds.length>rules.dailyRoundLimit||new Set(rounds.map(r=>r.id)).size!==rounds.length||policyHash!==ROUND_POLICY_HASH)throw Error('Invalid earned round set');
 const cap=dailyBudget(epoch-startEpoch+1),perRound=rewardPerRound(cap),totals=new Map<string,WorkRow&{amount:string}>();
 for(const r of rounds){
  if(!/^[a-f0-9-]{36}$/.test(r.id)||!/^[a-f0-9-]{36}$/.test(r.winner_share)||r.target_bits!==roundTarget(r.difficulty_weight).bits||r.reward!==perRound.toString())throw Error('Invalid round reward');
  const rows=JSON.parse(r.snapshot) as WorkRow[];
  const units=Array.isArray(rows)?rows.reduce((sum,row)=>sum+row.workUnits,0):0;
  if(!Number.isSafeInteger(units)||units<1||units>r.difficulty_weight*rules.windowMultiplier)throw Error('PPLNS window exceeds policy');
  for(const row of splitRound(perRound,rows)){const prior=totals.get(row.address);totals.set(row.address,{address:row.address,workUnits:row.workUnits+(prior?.workUnits??0),amount:(BigInt(row.amount)+BigInt(prior?.amount??'0')).toString()});}
 }
 const manifest=createAmountManifest(epoch,distributor,[...totals.values()]);
 if(BigInt(manifest.budget)>cap)throw Error('Daily cap exceeded');
 return {...manifest,policy:ROUND_POLICY,policyHash,emissionStartEpoch:startEpoch,dailyCap:cap.toString(),rounds};
}
export function rebuildRoundManifest(m:ReturnType<typeof earnedManifest>){return earnedManifest(m.epoch,m.distributor,m.rounds,m.emissionStartEpoch,m.policyHash);}
