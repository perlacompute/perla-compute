// Executed inside the existing web container; operator credentials never leave it.
const action=process.argv[2]||'review',worker=process.argv[3];
const secret=process.env.PERLA_OPERATOR_TOKEN;
if(!secret||secret.length<32)throw Error('Operator authentication is not configured.');
async function call(path,payload){
 const r=await fetch('http://127.0.0.1:3000/api/mining/operator/'+path,{method:payload?'POST':'GET',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(35000),redirect:'error'});
 const value=await r.json();if(!r.ok)throw Error(value.error||'Operator request failed');return value;
}
try{
 const {validations}=await call('validations');
 if(action==='review')console.log(JSON.stringify({validations},null,2));
 else if(action==='start'){
  const rows=validations.filter(v=>!v.revoked&&v.created>Math.floor(Date.now()/1000)-86400&&(!worker||v.worker_id===worker));
  if(rows.length!==1)throw Error('Choose one reviewed worker ID. Run review to inspect uploaded reports; '+rows.length+' candidates match.');
  const selected=rows[0];console.log(JSON.stringify({reviewedWorker:selected.worker_id,wallet:selected.address,device:selected.report.device,validationHash:selected.hash},null,2));
  console.log(JSON.stringify(await call('trials',{workerId:selected.worker_id,validationHash:selected.hash}),null,2));
 }else if(action==='stop'&&worker)console.log(JSON.stringify(await call('trials/stop',{workerId:worker}),null,2));
 else throw Error('Usage: review | start [WORKER_ID] | stop WORKER_ID');
}catch(e){console.error(String(e.message||'Trial operation failed').replaceAll(secret,'[redacted]'));process.exitCode=1;}
