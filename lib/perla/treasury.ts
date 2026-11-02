import { isAddress, parseAbi, type Address } from 'viem';
import type { MiningDatabase } from './database';
import { CHAIN_ID } from './protocol';
import { rewardsAbi } from './rewards';
import { chainSnapshot, assertCanonical } from './chain-read';
const tokenAbi=parseAbi(['function totalSupply() view returns(uint256)','function balanceOf(address) view returns(uint256)','function symbol() view returns(string)','function decimals() view returns(uint8)']);
const ownerAbi=parseAbi(['function owner() view returns(address)']);
type Env={DB?:MiningDatabase;PERLA_RPC_URL?:string;PERLA_REWARD_TOKEN?:string;PERLA_DISTRIBUTOR_ADDRESS?:string};
async function readSnapshot(env:Env,before?:number) {
  const checkedAt=Math.floor(Date.now()/1000), token=env.PERLA_REWARD_TOKEN,distributor=env.PERLA_DISTRIBUTOR_ADDRESS;
  const base={chainId:CHAIN_ID,token:token||null,distributor:distributor||null,checkedAt,scope:'Testnet only. Owner balance is uncommitted. Liabilities cover up to 32 published coordinator epochs in this page; they are not a global enumeration of the contract mapping.',allocationControl:'The coordinator enforces a pinned daily budget after reward-schedule activation. The operator funds and publishes allocations; verification and the contribution ledger remain offchain.',mainnet:'on_hold'};
  if(!env.DB||!isAddress(token||'')||!isAddress(distributor||''))return {...base,status:'not_configured',data:null};
  let stage='snapshot';
  try {
    const snapshot=await chainSnapshot(env),{client,blockNumber}=snapshot;
    const d=distributor as Address,t=token as Address;
    // Contract reads are serial at one pinned block. Public RPCs can reject bursts.
    stage='distributor_token';const actual=await client.readContract({address:d,abi:rewardsAbi,functionName:'rewardToken',blockNumber});
    stage='distributor_owner';const owner=await client.readContract({address:d,abi:ownerAbi,functionName:'owner',blockNumber});
    stage='token_supply';const totalSupply=await client.readContract({address:t,abi:tokenAbi,functionName:'totalSupply',blockNumber});
    stage='distributor_balance';const balance=await client.readContract({address:t,abi:tokenAbi,functionName:'balanceOf',args:[d],blockNumber});
    stage='token_symbol';const symbol=await client.readContract({address:t,abi:tokenAbi,functionName:'symbol',blockNumber});
    stage='token_decimals';const decimals=await client.readContract({address:t,abi:tokenAbi,functionName:'decimals',blockNumber});
    if(actual.toLowerCase()!==t.toLowerCase()||decimals!==18||symbol!=='PERL'||totalSupply!==1000000000n*10n**18n)throw Error('Contract mismatch');
    stage='owner_balance';const ownerBalance=await client.readContract({address:t,abi:tokenAbi,functionName:'balanceOf',args:[owner],blockNumber});
    const rows=await env.DB.prepare('SELECT epoch,root,budget FROM mining_reward_epochs WHERE epoch<? ORDER BY epoch DESC LIMIT 33').bind(before??Number.MAX_SAFE_INTEGER).all<{epoch:number;root:string;budget:string}>();
    const page=rows.results.slice(0,32),next=rows.results.length>32?page[31].epoch:null;
    let remaining=0n,fundedEpochs=0,mismatchedEpochs=0;
    // Sequential bounded reads avoid flooding the RPC as history grows.
    stage='epoch_liabilities';
    for(const row of page){const [root,budget,unclaimed]=await client.readContract({address:d,abi:rewardsAbi,functionName:'epochs',args:[BigInt(row.epoch)],blockNumber});if(budget===0n)continue;if(root.toLowerCase()!==row.root.toLowerCase()||budget!==BigInt(row.budget)||unclaimed>budget){mismatchedEpochs++;continue;}fundedEpochs++;remaining+=unclaimed;}
    stage='canonical_block';await assertCanonical(snapshot);
    return {...base,status:'available',next,data:{blockNumber:blockNumber.toString(),blockHash:snapshot.blockHash,totalSupply:totalSupply.toString(),distributorBalance:balance.toString(),owner,ownerBalance:ownerBalance.toString(),publishedRemaining:remaining.toString(),fundedEpochs,mismatchedEpochs,coverage:balance>=remaining&&mismatchedEpochs===0?'covered':'attention',tokenInfo:{symbol,decimals}}};
  }catch{return {...base,status:'unavailable',data:null,failedCheck:stage,retryAfterSeconds:15,message:'The fresh contract snapshot failed. No balance or funded status was inferred.'};}
}

const pending=new Map<string,Promise<Awaited<ReturnType<typeof readSnapshot>>>>();
export async function treasurySnapshot(env:Env,before?:number){
 const key=[env.PERLA_RPC_URL,env.PERLA_REWARD_TOKEN,env.PERLA_DISTRIBUTOR_ADDRESS,before].join('|');
 let request=pending.get(key);if(request)return request;
 request=readSnapshot(env,before).finally(()=>pending.delete(key));pending.set(key,request);return request;
}
