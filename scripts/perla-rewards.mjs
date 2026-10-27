#!/usr/bin/env node
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import solc from 'solc';
import {emissionPreview} from '../lib/perla/emission.mjs';
import {createPublicClient,createWalletClient,http,defineChain,isAddress,parseAbi} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export async function compileContracts(){
 const names=['PerlaRewards','PerlaTestToken'];const sources=Object.fromEntries(await Promise.all(names.map(async n=>[n+'.sol',{content:await readFile(resolve(root,'contracts',n+'.sol'),'utf8')}])));
 const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
 const errors=(output.errors||[]).filter(e=>e.severity==='error');if(errors.length)throw Error(errors.map(e=>e.formattedMessage).join('\n'));
 return Object.fromEntries(names.map(n=>[n,{abi:output.contracts[n+'.sol'][n].abi,bytecode:'0x'+output.contracts[n+'.sol'][n].evm.bytecode.object}]));
}
const chain=defineChain({id:46630,name:'Robinhood Testnet',nativeCurrency:{name:'Test ETH',symbol:'ETH',decimals:18},rpcUrls:{default:{http:['https://rpc.testnet.chain.robinhood.com']}}});
async function clients(){
 const rpc=process.env.PERLA_RPC_URL||chain.rpcUrls.default.http[0];if(!rpc.startsWith('https://'))throw Error('Use an HTTPS testnet RPC.');
 const publicClient=createPublicClient({chain,transport:http(rpc,{retryCount:0,timeout:20000})});if(await publicClient.getChainId()!==46630)throw Error('Refusing chain operation outside Robinhood Testnet.');
 const key=process.env.PERLA_PRIVATE_KEY;if(!key||!/^0x[0-9a-fA-F]{64}$/.test(key))throw Error('Set PERLA_PRIVATE_KEY locally in the environment. Never paste it into chat or the website.');
 const account=privateKeyToAccount(key);return {publicClient,walletClient:createWalletClient({chain,account,transport:http(rpc)}),account};
}
async function operator(path,payload){
 const origin=process.env.PERLA_ENDPOINT;const token=process.env.PERLA_OPERATOR_TOKEN;if(!origin?.startsWith('https://')||!token||token.length<32)throw Error('Set PERLA_ENDPOINT and PERLA_OPERATOR_TOKEN.');
 const r=await fetch(origin.replace(/\/$/,'')+'/api/mining/'+path,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(payload??{}),redirect:'error'});const data=await r.json();if(!r.ok)throw Error(data.error||'Operator request failed.');return data;
}
async function main(){
 const [command,...args]=process.argv.slice(2);
 if(command==='emission'){if(!/^[1-9][0-9]*$/.test(args[0]||'')||args.length!==1)throw Error('Usage: emission DAY (positive integer; preview only)');console.log(JSON.stringify(emissionPreview(Number(args[0])),null,2));return;}
 if(command==='compile'){const contracts=await compileContracts();const out=resolve(root,'contracts/artifacts');await mkdir(out,{recursive:true});for(const [name,artifact] of Object.entries(contracts))await writeFile(resolve(out,name+'.json'),JSON.stringify(artifact,null,2)+'\n');console.log('Compiled PerlaRewards and PerlaTestToken. No chain transaction sent.');return;}
 if(command==='prepare'){
  if(!/^\d+$/.test(args[0]||'')||!/^\d+$/.test(args[1]||''))throw Error('Usage: prepare EPOCH BUDGET_BASE_UNITS');
  const epoch=Number(args[0]);const manifest=await operator('operator/epochs',{epoch,budget:args[1]});const file=resolve(process.cwd(),`epoch-${epoch}.json`);await writeFile(file,JSON.stringify(manifest,null,2)+'\n',{mode:0o600});console.log('Prepared allocation manifest:',file);return;
 }
 if(command==='activate'){if(!/^\d+$/.test(args[0]||''))throw Error('Usage: activate EPOCH');console.log(await operator(`operator/epochs/${args[0]}/activate`));return;}
 if(!['deploy','deploy-test-token','fund'].includes(command))throw Error('Commands: emission DAY | compile | deploy-test-token | deploy | prepare EPOCH BUDGET | fund MANIFEST | activate EPOCH');
 const {publicClient,walletClient}=await clients();const compiled=await compileContracts();
 if(command==='deploy'||command==='deploy-test-token'){
  const name=command==='deploy'?'PerlaRewards':'PerlaTestToken';const token=process.env.PERLA_REWARD_TOKEN;
  if(command==='deploy'&&(!token||!isAddress(token)))throw Error('Set PERLA_REWARD_TOKEN to the deployed test token.');
  const hash=await walletClient.deployContract({...compiled[name],args:command==='deploy'?[token]:[]});const receipt=await publicClient.waitForTransactionReceipt({hash});if(receipt.status!=='success')throw Error('Deployment reverted.');console.log(JSON.stringify({contract:name,address:receipt.contractAddress,transaction:hash,chainId:46630},null,2));return;
 }
 const manifest=JSON.parse(await readFile(resolve(args[0]||''),'utf8'));const distributor=process.env.PERLA_DISTRIBUTOR_ADDRESS;const token=process.env.PERLA_REWARD_TOKEN;
 if(manifest.chainId!==46630||manifest.distributor?.toLowerCase()!==distributor?.toLowerCase()||!isAddress(token||''))throw Error('Manifest, distributor, or token configuration mismatch.');
 const actual=await publicClient.readContract({address:distributor,abi:compiled.PerlaRewards.abi,functionName:'rewardToken'});if(actual.toLowerCase()!==token.toLowerCase())throw Error('Distributor uses another token.');
 const budget=BigInt(manifest.budget);if(budget<=0n)throw Error('Invalid budget.');
 const approve=await walletClient.writeContract({address:token,abi:parseAbi(['function approve(address,uint256) returns(bool)']),functionName:'approve',args:[distributor,budget]});
 const approvalReceipt=await publicClient.waitForTransactionReceipt({hash:approve});if(approvalReceipt.status!=='success')throw Error('Approval reverted.');
 const hash=await walletClient.writeContract({address:distributor,abi:compiled.PerlaRewards.abi,functionName:'fundEpoch',args:[BigInt(manifest.epoch),manifest.root,budget]});const receipt=await publicClient.waitForTransactionReceipt({hash});if(receipt.status!=='success')throw Error('Funding reverted.');console.log(JSON.stringify({epoch:manifest.epoch,funded:true,transaction:hash},null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.shortMessage||e.message||'Reward operation failed.');process.exitCode=1;});
