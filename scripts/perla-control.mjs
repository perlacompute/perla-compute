#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
const [command,...args]=process.argv.slice(2);
const endpoint=process.env.PERLA_ENDPOINT;
const secret=process.env.PERLA_OPERATOR_TOKEN;
async function call(path,payload){
 const u=new URL(endpoint);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||!secret||secret.length<32)throw Error('Set an HTTPS PERLA_ENDPOINT origin and a private PERLA_OPERATOR_TOKEN.');
 const r=await fetch(u.origin+'/api/mining/'+path,{method:payload?'POST':'GET',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(35000),redirect:'error'});
 const data=await r.json();if(!r.ok)throw Error(data.error||'Operator request failed');return data;
}
try{
 let data;
 if(command==='health')data=await call('operator/health');
 else if(command==='policy')data=await call('policy');
 else if(command==='activate-policy'){
   if(!/^p(1|2|4|8|16)$/.test(args[0]||'')||!/^\d{1,8}$/.test(args[1]||'')||!args[2])throw Error('Usage: activate-policy PROFILE START_UTC_EPOCH GPU_REPORT.json');
   const bytes=await readFile(args[2]);if(bytes.length>10000)throw Error('GPU report too large');
   data=await call('operator/policy',{profile:args[0],startEpoch:Number(args[1]),validation:JSON.parse(bytes)});
 }else if(command==='record-funding'){
   if(!/^\d{1,8}$/.test(args[0]||'')||!/^0x[a-f0-9]{64}$/i.test(args[1]||''))throw Error('Usage: record-funding EPOCH TRANSACTION_HASH');
   data=await call(`operator/epochs/${args[0]}/funding`,{transaction:args[1]});
 }else throw Error('Usage: health | policy | activate-policy PROFILE START_UTC_EPOCH GPU_REPORT.json | record-funding EPOCH TX_HASH');
 console.log(JSON.stringify(data,null,2));
}catch(e){console.error(String(e.message||'Operation failed').replaceAll(secret||'__no_secret__','[redacted]'));process.exitCode=1;}
