import {resetTestnet} from './testnet-reset.mjs';
import {validateSigner,inspectDeployment,contractSmoke,automaticTick,operatorClient} from './testnet-control.mjs';
import {createSqliteDatabase} from '../lib/vps/sqlite.mjs';
import {treasurySnapshot} from '../lib/perla/treasury.ts';
let input='';
try{
 for await(const p of process.stdin){input+=p;if(input.length>4000)throw Error('The local operator request is too large.');}
 const r=JSON.parse(input||'{}'),env=process.env,op=operatorClient(env);let result;
 if(r.action==='inspect'){
  const c=await inspectDeployment(env);const db=createSqliteDatabase(env.PERLA_SQLITE_PATH||'/app/data/perla.sqlite');
  try{const t=await treasurySnapshot({...env,DB:db});if(t.status!=='available')throw Error('Treasury contract read failed at '+(t.failedCheck||'configuration')+'. Check the configured testnet RPC.');result={chainId:46630,owner:c.owner,gasWei:c.gas.toString(),ownerPERLBaseUnits:c.balance.toString(),treasury:t};}finally{db.close();}
 }else if(r.action==='validate-key'){const c=await validateSigner(r.key,env);result={valid:true,chainId:46630,owner:c.owner,gasWei:c.gas.toString()};}
 else if(r.action==='reset')result=await resetTestnet({env});
 else if(r.action==='smoke'){const s=await op('operator/testnet/state');result=await contractSmoke({key:r.key,resetAt:s.reset_at,env});await op('operator/testnet/smoke',result);}
 else if(r.action==='auto')result=await automaticTick({key:r.key,env,log:()=>{}});
 else if(r.action==='readiness')result=await op('operator/testnet/readiness');
 else if(r.action==='live'){const ready=await op('operator/testnet/readiness');if(!ready.ready){console.log(JSON.stringify(ready));throw Error('Complete the pending GPU and earned-claim checks shown above before public mining opens.');}result=await op('operator/testnet/live',{});}
 else throw Error('Unknown local testnet operation.');
 console.log(JSON.stringify(result));
}catch(e){
 // Avoid serializing viem causes: they can include provider credentials or signed calls.
 const safe=e?.name==='Error'&&e.message?.length<400?e.message:'The testnet operation failed. Existing journals were retained; retry the same command.';
 console.error(safe.replace(/0x[a-fA-F0-9]{64}/g,'[redacted]'));process.exitCode=1;
}
