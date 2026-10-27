const base=process.env.PERLA_VERIFIER_URL;
const token=process.env.PERLA_VERIFIER_TOKEN;
if(!base||!token)throw Error('Verifier environment did not load in the web container.');
const response=await fetch(base.replace(/\/$/,'')+'/health',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(15000),redirect:'error'});
if(!response.ok)throw Error('Authenticated verifier request from web failed: '+response.status);
const data=await response.json();
if(data.ready!==true||!data.supported_protocols?.includes('perla-pearl-plain-v4')||data.protocol!=='perla-pearl-plain-v3'||data.upstream_commit!=='82e6eee7076aafe10123e08db78f100d270c0582')throw Error('Native verifier profile mismatch.');
console.log(JSON.stringify({ready:true,protocol:data.protocol,upstreamCommit:data.upstream_commit,authenticatedRequestFromWeb:true,miningEnabled:process.env.PERLA_MINING_ENABLED==='true'}));
