import assert from 'node:assert/strict';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdir,rm} from 'node:fs/promises';
import {build} from 'esbuild';
import ganache from 'ganache';
import {createPublicClient,createWalletClient,custom,defineChain,keccak256,concat} from 'viem';
import {compileContracts} from '../perla-rewards.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');const scratch=resolve(root,'.sites-runtime/reward-checks');await mkdir(scratch,{recursive:true});
await build({entryPoints:[resolve(root,'lib/perla/rewards.ts')],outfile:resolve(scratch,'rewards.mjs'),bundle:true,platform:'node',format:'esm',target:'node22'});
const {createManifest,rewardLeaf}=await import(pathToFileURL(resolve(scratch,'rewards.mjs')));
const provider=ganache.provider({logging:{quiet:true},chain:{chainId:46630},wallet:{deterministic:true}});
const chain=defineChain({id:46630,name:'Local validation EVM',nativeCurrency:{name:'ETH',symbol:'ETH',decimals:18},rpcUrls:{default:{http:['http://localhost']}}});
const publicClient=createPublicClient({chain,transport:custom(provider)});const wallet=createWalletClient({chain,transport:custom(provider)});const [owner,alice,bob]=await wallet.getAddresses();
const contracts=await compileContracts();let passed=0;const test=async(name,fn)=>{await fn();passed++;console.log('PASS',name);};
async function send(address,abi,functionName,args,account=owner){const hash=await wallet.writeContract({account,address,abi,functionName,args,gas:2500000n});return publicClient.waitForTransactionReceipt({hash});}
async function deploy(name,args=[]){const hash=await wallet.deployContract({account:owner,...contracts[name],args,gas:5000000n});const r=await publicClient.waitForTransactionReceipt({hash});assert.equal(r.status,'success');return r.contractAddress;}
try{
 const token=await deploy('PerlaTestToken');const rewards=await deploy('PerlaRewards',[token]);
 await test('test token has exactly 1B supply held by its initial funder',async()=>{const supply=await publicClient.readContract({address:token,abi:contracts.PerlaTestToken.abi,functionName:'totalSupply'});assert.equal(supply,1_000_000_000n*10n**18n);assert.equal(await publicClient.readContract({address:token,abi:contracts.PerlaTestToken.abi,functionName:'balanceOf',args:[owner]}),supply);});
 await test('test token cannot transfer more than the fixed available supply',async()=>assert.equal((await send(token,contracts.PerlaTestToken.abi,'transfer',[alice,1_000_000_000n*10n**18n+1n])).status,'reverted'));
 await test('test token deployment rejects the mainnet chain ID',async()=>{const p=ganache.provider({logging:{quiet:true},chain:{chainId:4663},wallet:{deterministic:true}});try{const c={...chain,id:4663};const w=createWalletClient({chain:c,transport:custom(p)}),r=createPublicClient({chain:c,transport:custom(p)});const [account]=await w.getAddresses();const hash=await w.deployContract({account,...contracts.PerlaTestToken,gas:5000000n});assert.equal((await r.waitForTransactionReceipt({hash})).status,'reverted');}finally{await p.disconnect();}});
 const manifest=createManifest(3,101n,rewards,[{address:alice.toLowerCase(),points:2},{address:bob.toLowerCase(),points:1}]);
 await test('integer allocations sum exactly to the funded budget',async()=>assert.equal(manifest.allocations.reduce((s,a)=>s+BigInt(a.amount),0n),101n));
 await test('every generated Merkle proof resolves to the same root',async()=>{for(const a of manifest.allocations){let h=rewardLeaf(rewards,3,a.index,a.address,BigInt(a.amount));for(const b of a.proof)h=keccak256(concat(h.toLowerCase()<b.toLowerCase()?[h,b]:[b,h]));assert.equal(h,manifest.root);}});
 await test('epoch cannot be funded without an actual token allowance',async()=>assert.equal((await send(rewards,contracts.PerlaRewards.abi,'fundEpoch',[3n,manifest.root,101n])).status,'reverted'));
 await send(token,contracts.PerlaTestToken.abi,'approve',[rewards,101n]);
 await test('funded epoch stores the exact root and backed budget',async()=>{assert.equal((await send(rewards,contracts.PerlaRewards.abi,'fundEpoch',[3n,manifest.root,101n])).status,'success');const state=await publicClient.readContract({address:rewards,abi:contracts.PerlaRewards.abi,functionName:'epochs',args:[3n]});assert.equal(state[0],manifest.root);assert.equal(state[1],101n);});
 await test('published roots cannot be replaced',async()=>assert.equal((await send(rewards,contracts.PerlaRewards.abi,'fundEpoch',[3n,manifest.root,101n])).status,'reverted'));
 const a=manifest.allocations[0];
 await test('changed recipient is rejected',async()=>assert.equal((await send(rewards,contracts.PerlaRewards.abi,'claim',[3n,BigInt(a.index),owner,BigInt(a.amount),a.proof])).status,'reverted'));
 await test('changed amount is rejected',async()=>assert.equal((await send(rewards,contracts.PerlaRewards.abi,'claim',[3n,BigInt(a.index),a.address,BigInt(a.amount)+1n,a.proof])).status,'reverted'));
 await test('a valid relayed claim pays only its committed recipient',async()=>{assert.equal((await send(rewards,contracts.PerlaRewards.abi,'claim',[3n,BigInt(a.index),a.address,BigInt(a.amount),a.proof])).status,'success');assert.equal(await publicClient.readContract({address:token,abi:contracts.PerlaTestToken.abi,functionName:'balanceOf',args:[a.address]}),BigInt(a.amount));});
 await test('a previously claimed allocation cannot be replayed',async()=>assert.equal((await send(rewards,contracts.PerlaRewards.abi,'claim',[3n,BigInt(a.index),a.address,BigInt(a.amount),a.proof])).status,'reverted'));
 await test('an epoch proof cannot move to another distributor',async()=>{const other=await deploy('PerlaRewards',[token]);await send(token,contracts.PerlaTestToken.abi,'approve',[other,101n]);await send(other,contracts.PerlaRewards.abi,'fundEpoch',[3n,manifest.root,101n]);assert.equal((await send(other,contracts.PerlaRewards.abi,'claim',[3n,BigInt(a.index),a.address,BigInt(a.amount),a.proof])).status,'reverted');});
 console.log(`${passed} reward checks passed on a local EVM. No public-chain transaction was sent.`);
}finally{await provider.disconnect();await rm(scratch,{recursive:true,force:true});}
