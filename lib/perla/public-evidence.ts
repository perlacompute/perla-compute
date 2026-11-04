import record from '@/docs/evidence/rewards-20760.json';
import {formatUnits} from 'viem';
export const publicEvidence={
 epoch:record.epoch,chainId:record.chainId,gpu:record.gpu,
 amount:Number(formatUnits(BigInt(record.amountBaseUnits),record.decimals)).toLocaleString('en-US',{maximumFractionDigits:4}),
 claim:'https://explorer.testnet.chain.robinhood.com/tx/'+record.claim.transaction,
 funding:'https://explorer.testnet.chain.robinhood.com/tx/'+record.funding.transaction,
 source:'https://github.com/perlacompute/perla-compute/blob/1aef6072c499b096fa20ddfb195bd948358a6f25/docs/releases/rewards-live-20261104.md',
 receipt:'/explorer/36435cf0-efaf-4e47-a349-a08323659230',
} as const;
