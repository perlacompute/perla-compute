import { decodeEventLog, parseAbiItem, type Address, type Hex } from 'viem';
import { chainSnapshot, assertCanonical } from './chain-read';
import { rewardsAbi } from './rewards';
const event=parseAbiItem('event EpochFunded(uint256 indexed epoch, bytes32 root, uint256 budget)');
export async function verifyFunding(env:{PERLA_RPC_URL?:string},row:{epoch:number;distributor:Address;token:Address;root:string;budget:string},hash:Hex){
  const snapshot=await chainSnapshot(env),{client,blockNumber}=snapshot;
  const receipt=await client.getTransactionReceipt({hash});
  if(receipt.status!=='success'||receipt.to?.toLowerCase()!==row.distributor.toLowerCase()||receipt.blockNumber>blockNumber)throw Error('Funding receipt does not match');
  const canonical=await client.getBlock({blockNumber:receipt.blockNumber});
  if(canonical.hash!==receipt.blockHash)throw Error('Funding receipt is no longer canonical');
  let matched=false;
  for(const log of receipt.logs){if(log.address.toLowerCase()!==row.distributor.toLowerCase())continue;try{const decoded=decodeEventLog({abi:[event],data:log.data,topics:log.topics});const a=decoded.args;if(a.epoch===BigInt(row.epoch)&&a.root.toLowerCase()===row.root.toLowerCase()&&a.budget===BigInt(row.budget))matched=true;}catch{}}
  const token=await client.readContract({address:row.distributor,abi:rewardsAbi,functionName:'rewardToken',blockNumber});
  const [root,budget]=await client.readContract({address:row.distributor,abi:rewardsAbi,functionName:'epochs',args:[BigInt(row.epoch)],blockNumber});
  if(!matched||token.toLowerCase()!==row.token.toLowerCase()||root.toLowerCase()!==row.root.toLowerCase()||budget!==BigInt(row.budget))throw Error('Funding event or contract does not match');
  await assertCanonical(snapshot);
  return {transaction:hash,block:receipt.blockNumber.toString(),blockHash:receipt.blockHash,finality:'included; finalization must be checked separately'};
}
