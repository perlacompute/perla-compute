import type { MiningDatabase } from './database';
import { chainSnapshot, assertCanonical } from './chain-read';
import { createManifest,rewardsAbi } from './rewards';
import { dailyBudget } from './emission.mjs';
import deployment from '@/deployments/robinhood-testnet.json';
import { RoundError } from './reward-rounds';
import type { Address } from 'viem';
const EPOCH=20754,RECIPIENT=deployment.owner.toLowerCase(),BUDGET=dailyBudget(1).toString();
export async function cancelOwnerValidationAllocation(env:{DB?:MiningDatabase;PERLA_RPC_URL?:string},now:number){
 const db=env.DB;if(!db)throw new RoundError(503,'Reward storage is unavailable.');
 const row=await db.prepare('SELECT * FROM mining_reward_epochs WHERE epoch=?').bind(EPOCH).first<{epoch:number;state:string;manifest:string;root:string;budget:string;token:Address;distributor:Address;funding_tx:string|null;funding_block:string|null;funding_block_hash:string|null}>();
 if(!row)throw new RoundError(409,'The specific owner validation allocation is absent. Nothing was cancelled.');
 const m=JSON.parse(row.manifest);
 if(!['prepared','cancelled'].includes(row.state)||row.funding_tx||row.funding_block||row.funding_block_hash||row.budget!==BUDGET||row.token.toLowerCase()!==deployment.token.toLowerCase()||row.distributor.toLowerCase()!==deployment.distributor.toLowerCase()||m.version!==1||m.allocations?.length!==1||m.allocations[0].address.toLowerCase()!==RECIPIENT||m.allocations[0].amount!==BUDGET||m.allocations[0].points!==11||m.totalPoints!=='11')throw new RoundError(409,'This record differs from the authorized unfunded owner allocation. It was preserved.');
 const rebuilt=createManifest(EPOCH,BigInt(BUDGET),row.distributor,[{address:RECIPIENT as Address,points:11}]);
 if(JSON.stringify(rebuilt)!==JSON.stringify(m)||row.root!==rebuilt.root)throw new RoundError(409,'The original allocation integrity check failed.');
 let snapshot:Awaited<ReturnType<typeof chainSnapshot>>;
 try{
  snapshot=await chainSnapshot(env);const {client,blockNumber}=snapshot;
  const token=await client.readContract({address:row.distributor,abi:rewardsAbi,functionName:'rewardToken',blockNumber});
  const state=await client.readContract({address:row.distributor,abi:rewardsAbi,functionName:'epochs',args:[BigInt(EPOCH)],blockNumber});
  if(token.toLowerCase()!==row.token.toLowerCase()||state[0]!=='0x'+'0'.repeat(64)||state[1]!==0n||state[2]!==0n)throw Error('Funded or mismatched');
  await assertCanonical(snapshot);
 }catch{throw new RoundError(409,'Fresh canonical-chain reads did not prove this allocation is unfunded. Nothing was cancelled.');}
 const reason='Owner-authorized cancellation of the unfunded validation allocation. Accepted shares retained.';
 await db.batch([
  db.prepare("INSERT OR IGNORE INTO mining_allocation_cancellations(epoch,root,budget,recipient,reason,cancelled,block_number,block_hash) SELECT epoch,root,budget,?,?, ?,?,? FROM mining_reward_epochs WHERE epoch=? AND state='prepared' AND funding_tx IS NULL AND root=? AND budget=?").bind(RECIPIENT,reason,now,snapshot!.blockNumber.toString(),snapshot!.blockHash,EPOCH,row.root,BUDGET),
  db.prepare("UPDATE mining_reward_epochs SET state='cancelled' WHERE epoch=? AND state='prepared' AND funding_tx IS NULL AND root=? AND budget=? AND EXISTS(SELECT 1 FROM mining_allocation_cancellations c WHERE c.epoch=mining_reward_epochs.epoch AND c.root=mining_reward_epochs.root)").bind(EPOCH,row.root,BUDGET),
 ]);
 const result=await db.prepare('SELECT c.*,e.state FROM mining_allocation_cancellations c JOIN mining_reward_epochs e ON e.epoch=c.epoch WHERE c.epoch=?').bind(EPOCH).first<{state:string}>();
 if(result?.state!=='cancelled')throw new RoundError(409,'The allocation changed during cancellation; preserve it for review.');
 return {...result,acceptedHistoryRetained:true,onchainTransactionSent:false,observedUnfundedAtBlock:snapshot!.blockNumber.toString()};
}
