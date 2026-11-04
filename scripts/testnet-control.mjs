/** Testnet-only operator automation. Secrets arrive on stdin, never argv or .env. */
import {createPublicClient,createWalletClient,http,defineChain,parseAbi,encodeFunctionData,encodeAbiParameters,keccak256} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import deploymentPin from '../deployments/robinhood-testnet.json' with {type:'json'};
import {settleRewards} from './reward-settle.mjs';
import {auditManifest} from './reward-manifest.mjs';
import {testnetValidationWallets} from '../lib/perla/validation-wallet.mjs';
export const RESET_ID='perla-fresh-testnet-20261103-v1';
export const SMOKE_AMOUNT=10n**18n;
export const SMOKE_BASE=1n<<128n;
export const tokenAbi=parseAbi(['function symbol() view returns(string)','function decimals() view returns(uint8)','function totalSupply() view returns(uint256)','function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)']);
export const distributorAbi=parseAbi(['function owner() view returns(address)','function rewardToken() view returns(address)','function epochs(uint256) view returns(bytes32,uint256,uint256)','function isClaimed(uint256,uint256) view returns(bool)','function fundEpoch(uint256,bytes32,uint256)','function claim(uint256,uint256,address,uint256,bytes32[])']);
const chain=defineChain({id:46630,name:'Robinhood Testnet',nativeCurrency:{name:'Test ETH',symbol:'ETH',decimals:18},rpcUrls:{default:{http:['https://rpc.testnet.chain.robinhood.com']}}});
const equal=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase();
const zero='0x'+'0'.repeat(64);
export function connection(env=process.env,{transport,deployment=deploymentPin}={}){
 const url=new URL(env.PERLA_RPC_URL||chain.rpcUrls.default.http[0]);
 if(!transport&&(url.protocol!=='https:'||url.username||url.password||url.hash))throw Error('Use an HTTPS Robinhood Testnet RPC.');
 const readTransport=transport||http(url.href,{timeout:20000,retryCount:1,retryDelay:500});
 return {client:createPublicClient({chain,transport:readTransport}),transport:transport||http(url.href,{timeout:30000,retryCount:0}),deployment};
}
export async function inspectDeployment(env=process.env,options={}){
 const c=connection(env,options),{client,deployment:d}=c;
 if(env.PERLA_REWARD_TOKEN&&!equal(env.PERLA_REWARD_TOKEN,d.token)||env.PERLA_DISTRIBUTOR_ADDRESS&&!equal(env.PERLA_DISTRIBUTOR_ADDRESS,d.distributor))throw Error('Runtime token or distributor differs from the reviewed testnet deployment.');
 if(await client.getChainId()!==46630)throw Error('Wrong chain. Only Robinhood Testnet 46630 is supported.');
 const block=await client.getBlock();if(block.number===null||!block.hash)throw Error('A canonical testnet block is required.');
 const at={blockNumber:block.number};
 const actual=await client.readContract({address:d.distributor,abi:distributorAbi,functionName:'rewardToken',...at});
 const owner=await client.readContract({address:d.distributor,abi:distributorAbi,functionName:'owner',...at});
 const symbol=await client.readContract({address:d.token,abi:tokenAbi,functionName:'symbol',...at});
 const decimals=await client.readContract({address:d.token,abi:tokenAbi,functionName:'decimals',...at});
 const supply=await client.readContract({address:d.token,abi:tokenAbi,functionName:'totalSupply',...at});
 if(!equal(actual,d.token)||!equal(owner,d.owner)||symbol!=='PERL'||decimals!==18||supply!==1000000000n*10n**18n)throw Error('Reviewed owner, token, distributor or 1B supply does not match.');
 const balance=await client.readContract({address:d.token,abi:tokenAbi,functionName:'balanceOf',args:[owner],...at});
 const gas=await client.getBalance({address:owner,...at});
 if((await client.getBlock({blockNumber:block.number})).hash!==block.hash)throw Error('The testnet block changed during inspection. Retry.');
 return {...c,owner,balance,gas,blockNumber:block.number,blockHash:block.hash};
}
export async function validateSigner(key,env=process.env,options={}){
 if(!/^0x[0-9a-fA-F]{64}$/.test(key||''))throw Error('A dedicated testnet owner key is required on this VPS.');
 const account=privateKeyToAccount(key),c=await inspectDeployment(env,options);
 if(!equal(account.address,c.owner))throw Error('The signer is not the reviewed testnet distributor owner.');
 if(c.gas===0n)throw Error('The dedicated owner wallet needs test ETH.');
 return {...c,account,wallet:createWalletClient({account,chain,transport:c.transport})};
}
export function operatorClient(env=process.env){return async(path,payload)=>{
 if(!env.PERLA_OPERATOR_TOKEN||env.PERLA_OPERATOR_TOKEN.length<32)throw Error('Operator authentication is not configured.');
 const r=await fetch('http://127.0.0.1:3000/api/mining/'+path,{method:payload===undefined?'GET':'POST',headers:{authorization:'Bearer '+env.PERLA_OPERATOR_TOKEN,'content-type':'application/json'},...(payload===undefined?{}:{body:JSON.stringify(payload)}),signal:AbortSignal.timeout(180000),redirect:'error'});
 const body=await r.json();if(!r.ok)throw Error(body.error||'The testnet operator request failed.');return body;
};}
async function writeJson(file,data){await mkdir(resolve(file,'..'),{recursive:true,mode:0o700});const temp=file+'.tmp';await writeFile(temp,JSON.stringify(data)+'\n',{mode:0o600});await rename(temp,file);}
async function loadJson(file){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;return null;}}
/** Persist the signed transaction BEFORE broadcast, so an interrupted tick cannot double-send. */
export async function sendOnce(c,file,address,abi,functionName,args){
 const data=encodeFunctionData({abi,functionName,args});let row=await loadJson(file);
 if(row&&(row.chainId!==46630||!equal(row.to,address)||row.data!==data||!/^0x[0-9a-f]{64}$/.test(row.hash)))throw Error('A saved testnet transaction differs from the intended call.');
 if(!row){
  await c.client.simulateContract({account:c.account,address,abi,functionName,args});
  const request=await c.wallet.prepareTransactionRequest({account:c.account,to:address,data});
  const raw=await c.account.signTransaction(request);
  row={chainId:46630,to:address,data,hash:keccak256(raw),raw};await writeJson(file,row);
 }
 let receipt;
 try{receipt=await c.client.getTransactionReceipt({hash:row.hash});}catch(e){if(e.name!=='TransactionReceiptNotFoundError')throw e;}
 if(!receipt){
  if(!row.raw)throw Error('The interrupted transaction journal is incomplete.');
  try{await c.client.sendRawTransaction({serializedTransaction:row.raw});}catch{
   // Broadcast may already have reached the node. Reconcile THIS hash, never sign a replacement.
  }
  receipt=await c.client.waitForTransactionReceipt({hash:row.hash,timeout:120000});
 }
 if(receipt.status!=='success')throw Error('The recorded testnet transaction reverted. Its journal was retained.');
 if((await c.client.getBlock({blockNumber:receipt.blockNumber})).hash!==receipt.blockHash)throw Error('The transaction receipt is no longer canonical.');
 delete row.raw;row.includedBlock=receipt.blockNumber.toString();row.blockHash=receipt.blockHash;await writeJson(file,row);
 return row.hash;
}
export async function contractSmoke({key,resetAt,env=process.env,options={}}){
 if(!Number.isSafeInteger(resetAt)||resetAt<1)throw Error('A fresh testnet reset marker is required.');
 const c=await validateSigner(key,env,options),d=c.deployment,epoch=SMOKE_BASE+BigInt(resetAt);
 const root=keccak256(encodeAbiParameters([{type:'uint256'},{type:'address'},{type:'uint256'},{type:'uint256'},{type:'address'},{type:'uint256'}],[46630n,d.distributor,epoch,0n,c.owner,SMOKE_AMOUNT]));
 const directory=resolve(env.PERLA_SETTLEMENT_DIR||'/app/data/reward-settlement','operator-smoke-'+resetAt);
 const state=await c.client.readContract({address:d.distributor,abi:distributorAbi,functionName:'epochs',args:[epoch]});
 if(state[0]!==zero&&(!equal(state[0],root)||state[1]!==SMOKE_AMOUNT))throw Error('The isolated smoke epoch already contains a different allocation.');
 if(state[0]===zero){
  if(c.balance<SMOKE_AMOUNT)throw Error('The owner needs 1 testnet PERL for the isolated round-trip smoke check.');
  const allowance=await c.client.readContract({address:d.token,abi:tokenAbi,functionName:'allowance',args:[c.owner,d.distributor]});
  if(allowance<SMOKE_AMOUNT)await sendOnce(c,resolve(directory,'approve.json'),d.token,tokenAbi,'approve',[d.distributor,SMOKE_AMOUNT]);
 }
 const funding=await sendOnce(c,resolve(directory,'fund.json'),d.distributor,distributorAbi,'fundEpoch',[epoch,root,SMOKE_AMOUNT]);
 const claim=await sendOnce(c,resolve(directory,'claim.json'),d.distributor,distributorAbi,'claim',[epoch,0n,c.owner,SMOKE_AMOUNT,[]]);
 const final=await c.client.readContract({address:d.distributor,abi:distributorAbi,functionName:'epochs',args:[epoch]});
 const claimed=await c.client.readContract({address:d.distributor,abi:distributorAbi,functionName:'isClaimed',args:[epoch,0n]});
 if(!claimed||final[2]!==0n)throw Error('The isolated testnet claim has not been confirmed.');
 return {epoch:epoch.toString(),fundingTransaction:funding,claimTransaction:claim,amount:SMOKE_AMOUNT.toString(),recipient:c.owner,scope:'operator-contract-smoke; excluded from mining earnings and migration',physicalGpuTest:false};
}
export async function automaticTick({key,env=process.env,options={},operator=operatorClient(env),log=console.log}={}){
 try{
  await validateSigner(key,env,options);
  const start=await operator('operator/testnet/state');
  if(!start.smoke_verified){const smoke=await contractSmoke({key,resetAt:start.reset_at,env,options});await operator('operator/testnet/smoke',smoke);}
  const review=await settleRewards({action:'review',env,operator,...options,log:()=>{}});
  const result=review.epochs.length?await settleRewards({action:'settle',key,expectedPlan:review.planHash,env,operator,...options,log:()=>{}}):review;
  // Relay only approved test wallets' earned allocations; the signer stays pinned.
  const queue=await operator('operator/testnet/testing-claims');
  if(queue.phase==='testing')for(const m of queue.items){
   auditManifest(m);if(m.version!==2||m.policy!=='perla-rounds-v1')throw Error('Only real round earnings enter the test claim check.');
   const c=await validateSigner(key,env,options),d=c.deployment;
   if(!equal(m.distributor,d.distributor))throw Error('Test claim distributor differs.');
   const state=await c.client.readContract({address:d.distributor,abi:distributorAbi,functionName:'epochs',args:[BigInt(m.epoch)]});
   if(!equal(state[0],m.root)||state[1]!==BigInt(m.budget))throw Error('The earned test claim is not funded.');
   const recipients=testnetValidationWallets(env,d.owner);
   for(const a of m.allocations.filter(a=>recipients.includes(a.address.toLowerCase())&&BigInt(a.amount)>0n)){
    if(await c.client.readContract({address:d.distributor,abi:distributorAbi,functionName:'isClaimed',args:[BigInt(m.epoch),BigInt(a.index)]}))continue;
    await sendOnce(c,resolve(env.PERLA_SETTLEMENT_DIR||'/app/data/reward-settlement','test-claim-'+m.epoch+'-'+a.index+'.json'),d.distributor,distributorAbi,'claim',[BigInt(m.epoch),BigInt(a.index),a.address,BigInt(a.amount),a.proof]);
   }
  }
  await operator('operator/testnet/automation',{enabled:true,error:null});
  let opened=false;
  if(start.phase==='testing'){const ready=await operator('operator/testnet/readiness');if(ready.ready){await operator('operator/testnet/live',{});opened=true;}}
  const publicResult={ok:true,publicMiningOpened:opened,chainId:46630,fundedEpochs:result.completed?.map(x=>x.epoch)||[],more:!!result.more};log(JSON.stringify(publicResult));return publicResult;
 }catch(e){try{await operator('operator/testnet/automation',{enabled:true,error:'settlement_check_failed'});}catch{}throw e;}
}
