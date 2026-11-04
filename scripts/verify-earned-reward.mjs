/** Read-only verification of the recorded earned reward. Never signs or submits a transaction. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createPublicClient,http,decodeEventLog,parseAbi,formatUnits} from 'viem';
import {auditManifest} from './reward-manifest.mjs';

const root=new URL('../',import.meta.url);
const lower=value=>String(value).toLowerCase();
const abi=parseAbi([
 'event EpochFunded(uint256 indexed epoch, bytes32 root, uint256 budget)',
 'event Claimed(uint256 indexed epoch, uint256 index, address indexed recipient, uint256 amount)',
 'event Transfer(address indexed from, address indexed to, uint256 value)',
 'function owner() view returns (address)',
 'function rewardToken() view returns (address)',
 'function isClaimed(uint256 epoch,uint256 index) view returns (bool)',
 'function epochs(uint256 epoch) view returns (bytes32 root,uint256 budget,uint256 remaining)',
]);
function events(receipt,address,eventName){
 return receipt.logs.filter(log=>lower(log.address)===lower(address)).flatMap(log=>{
  try {const value=decodeEventLog({abi,data:log.data,topics:log.topics});return value.eventName===eventName?[value.args]:[];}
  catch{return [];}
 });
}
export function verifyRecordedReward(evidence,manifest,receipts,deployment){
 assert.equal(evidence.chainId,46630);assert.equal(manifest.version,2);auditManifest(manifest);
 assert.equal(manifest.epoch,evidence.epoch);assert.equal(manifest.root,evidence.root);
 assert.equal(manifest.budget,evidence.amountBaseUnits);assert(BigInt(evidence.amountBaseUnits)>0n);
 assert.equal(lower(evidence.token),lower(deployment.token));assert.equal(lower(evidence.distributor),lower(deployment.distributor));
 assert.equal(lower(manifest.distributor),lower(evidence.distributor));assert.equal(evidence.smokeExcluded,true);
 const allocation=manifest.allocations.find(row=>row.index===evidence.allocationIndex);
 assert(allocation,'Recorded allocation is missing.');assert.equal(lower(allocation.address),lower(evidence.recipient));
 assert.equal(allocation.amount,evidence.amountBaseUnits);
 for(const name of ['funding','claim']){
  const receipt=receipts[name],record=evidence[name];assert.equal(receipt.status,'success',name+' receipt failed.');
  assert.equal(lower(receipt.transactionHash),lower(record.transaction));assert.equal(String(receipt.blockNumber),record.block);
  assert.equal(lower(receipt.blockHash),lower(record.blockHash));assert.equal(lower(receipt.to),lower(evidence.distributor));
 }
 assert(BigInt(receipts.claim.blockNumber)>=BigInt(receipts.funding.blockNumber));
 const funded=events(receipts.funding,evidence.distributor,'EpochFunded').filter(x=>x.epoch===BigInt(evidence.epoch));
 assert.equal(funded.length,1);assert.equal(funded[0].root,evidence.root);assert.equal(funded[0].budget,BigInt(evidence.amountBaseUnits));
 const claims=events(receipts.claim,evidence.distributor,'Claimed').filter(x=>x.epoch===BigInt(evidence.epoch));
 assert.equal(claims.length,1);assert.equal(claims[0].index,BigInt(evidence.allocationIndex));
 assert.equal(lower(claims[0].recipient),lower(evidence.recipient));assert.equal(claims[0].amount,BigInt(evidence.amountBaseUnits));
 const transfers=events(receipts.claim,evidence.token,'Transfer').filter(x=>lower(x.from)===lower(evidence.distributor)&&lower(x.to)===lower(evidence.recipient));
 assert.equal(transfers.length,1);assert.equal(transfers[0].value,BigInt(evidence.amountBaseUnits));
 return {chainId:46630,epoch:evidence.epoch,recipient:evidence.recipient,amount:formatUnits(BigInt(evidence.amountBaseUnits),evidence.decimals),symbol:'PERL',claimTransaction:evidence.claim.transaction};
}
async function load(name){return JSON.parse(await readFile(new URL(name,root),'utf8'));}
export async function verifyLiveReward(evidence,manifest,deployment){
 const client=createPublicClient({transport:http('https://rpc.testnet.chain.robinhood.com',{timeout:15000,retryCount:1})});
 assert.equal(await client.getChainId(),46630);
 const [funding,claim,snapshot]=await Promise.all([
  client.getTransactionReceipt({hash:evidence.funding.transaction}),client.getTransactionReceipt({hash:evidence.claim.transaction}),client.getBlock({blockTag:'latest'}),
 ]);
 const result=verifyRecordedReward(evidence,manifest,{funding,claim},deployment);
 const [owner,token,claimed,epoch,fundingBlock,claimBlock]=await Promise.all([
  client.readContract({address:evidence.distributor,abi,functionName:'owner',blockNumber:snapshot.number}),
  client.readContract({address:evidence.distributor,abi,functionName:'rewardToken',blockNumber:snapshot.number}),
  client.readContract({address:evidence.distributor,abi,functionName:'isClaimed',args:[BigInt(evidence.epoch),BigInt(evidence.allocationIndex)],blockNumber:snapshot.number}),
  client.readContract({address:evidence.distributor,abi,functionName:'epochs',args:[BigInt(evidence.epoch)],blockNumber:snapshot.number}),
  client.getBlock({blockNumber:funding.blockNumber}),client.getBlock({blockNumber:claim.blockNumber}),
 ]);
 assert.equal(lower(owner),lower(deployment.owner));assert.equal(lower(token),lower(evidence.token));assert.equal(claimed,true);
 assert.equal(epoch[0],evidence.root);assert.equal(epoch[1],BigInt(evidence.amountBaseUnits));assert.equal(epoch[2],0n);
 assert.equal(fundingBlock.hash,funding.blockHash);assert.equal(claimBlock.hash,claim.blockHash);
 assert.equal((await client.getBlock({blockNumber:snapshot.number})).hash,snapshot.hash,'Canonical snapshot changed. Retry the check.');
 return {...result,mode:'fresh-chain-read',earnedRewardConfirmed:true,block:snapshot.number.toString(),checkedAt:new Date().toISOString(),scope:'Verifies the allocation, canonical funding/claim receipts and token transfer. Does not independently attest to physical GPU execution.'};
}
async function main(){
 const args=process.argv.slice(2);assert(args.length===0||args.length===1&&args[0]==='--recorded','Use no arguments for live verification, or --recorded for offline receipt checks.');
 const [evidence,manifest,deployment]=await Promise.all([load('docs/evidence/rewards-20760.json'),load('docs/evidence/rewards-20760-manifest.json'),load('deployments/robinhood-testnet.json')]);
 const result=args[0]==='--recorded'?{...verifyRecordedReward(evidence,manifest,await load('docs/evidence/rewards-20760-receipts.json'),deployment),mode:'recorded-receipts',freshChainRead:false}:await verifyLiveReward(evidence,manifest,deployment);
 console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Earned-reward proof verification failed. Check the recorded evidence and RPC availability; no transaction was sent.');process.exitCode=1;});
