#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createManifest } from './reward-allocation.mjs';
export function auditManifest(m){
 if(!m||m.chainId!==46630||!Array.isArray(m.allocations)||m.allocations.length>5000||!/^0x[a-f0-9]{40}$/i.test(m.distributor||''))throw Error('Invalid testnet manifest');
 const rebuilt=createManifest(m.epoch,BigInt(m.budget),m.distributor,m.allocations.map(a=>({address:a.address,points:a.points})));
 // Ignore operator metadata such as state/snapshot while checking every canonical allocation field.
 for(const key of Object.keys(rebuilt))if(JSON.stringify(m[key])!==JSON.stringify(rebuilt[key]))throw Error('Allocation mismatch: '+key);
 return {valid:true,chainId:46630,epoch:m.epoch,root:m.root,budget:m.budget,totalPoints:m.totalPoints,recipients:m.allocations.length,scope:'Checks deterministic allocation, Merkle root and every proof. Does not attest to underlying mining or onchain funding.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{const bytes=await readFile(process.argv[2]||'');if(bytes.length>8*1024*1024)throw Error('Manifest too large');console.log(JSON.stringify(auditManifest(JSON.parse(bytes)),null,2));}catch(e){console.error(e.message||'Audit failed');process.exitCode=1;}}
