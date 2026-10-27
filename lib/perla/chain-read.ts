import { createPublicClient, http } from 'viem';
import { CHAIN_ID } from './protocol';
export function rewardClient(env:{PERLA_RPC_URL?:string}) {
  const endpoint=env.PERLA_RPC_URL || 'https://rpc.testnet.chain.robinhood.com';
  const u=new URL(endpoint);
  if(u.username||u.password||u.hash||(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname))))throw Error('Invalid testnet RPC.');
  return createPublicClient({transport:http(endpoint,{timeout:5000,retryCount:0})});
}
export async function chainSnapshot(env:{PERLA_RPC_URL?:string}) {
  const client=rewardClient(env);
  if(await client.getChainId()!==CHAIN_ID)throw Error('Wrong chain');
  const block=await client.getBlock({blockTag:'latest'});
  if(block.number===null||!block.hash)throw Error('No canonical block');
  return {client,blockNumber:block.number,blockHash:block.hash};
}
export async function assertCanonical(snapshot:Awaited<ReturnType<typeof chainSnapshot>>) {
  const current=await snapshot.client.getBlock({blockNumber:snapshot.blockNumber});
  if(current.hash!==snapshot.blockHash)throw Error('Snapshot changed during RPC reads');
}
