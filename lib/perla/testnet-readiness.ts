import type {MiningDatabase} from './database';
import {workPolicy} from './work-policy';
import {roundPolicy} from './reward-rounds';
import {treasurySnapshot} from './treasury';
import {accountRewards} from './portal';
import {chainSnapshot,assertCanonical} from './chain-read';
import {parseAbi,encodeAbiParameters,keccak256,type Address,type Hex} from 'viem';
import deployment from '@/deployments/robinhood-testnet.json';
import {testnetValidationWallets} from './validation-wallet.mjs';
export type TestnetEnv={DB?:MiningDatabase;PERLA_RPC_URL?:string;PERLA_MINING_ENABLED?:string;PERLA_REWARD_TOKEN?:string;PERLA_DISTRIBUTOR_ADDRESS?:string;PERLA_TESTNET_VALIDATION_WALLET?:string};
export type LaunchState={reset_id:string;reset_at:number;phase:'testing'|'live';automation_enabled:number;automation_checked:number|null;automation_error:string|null;smoke_epoch:string|null;smoke_funding_tx:string|null;smoke_claim_tx:string|null;smoke_verified:number;launched_at:number|null};
export async function launchState(e:TestnetEnv){return e.DB?e.DB.prepare('SELECT * FROM mining_testnet_state WHERE id=1').first<LaunchState>():null;}
export async function canMine(e:TestnetEnv,address:string){const s=await launchState(e);return !s||s.phase==='live'||testnetValidationWallets(e,deployment.owner).includes(address.toLowerCase());}
const smokeAbi=parseAbi(['function epochs(uint256) view returns(bytes32,uint256,uint256)','function isClaimed(uint256,uint256) view returns(bool)','function rewardToken() view returns(address)']);
export async function verifyContractSmoke(e:TestnetEnv,input:{epoch:string;fundingTransaction:Hex;claimTransaction:Hex}){
 const s=await launchState(e);if(!s||input.epoch!==((1n<<128n)+BigInt(s.reset_at)).toString())throw Error('The smoke epoch does not belong to this reset.');
 const snapshot=await chainSnapshot(e),{client,blockNumber}=snapshot,d=deployment.distributor as Address;
 const root=keccak256(encodeAbiParameters([{type:'uint256'},{type:'address'},{type:'uint256'},{type:'uint256'},{type:'address'},{type:'uint256'}],[46630n,d,BigInt(input.epoch),0n,deployment.owner as Address,10n**18n]));
 const token=await client.readContract({address:d,abi:smokeAbi,functionName:'rewardToken',blockNumber});
 const row=await client.readContract({address:d,abi:smokeAbi,functionName:'epochs',args:[BigInt(input.epoch)],blockNumber});
 const claimed=await client.readContract({address:d,abi:smokeAbi,functionName:'isClaimed',args:[BigInt(input.epoch),0n],blockNumber});
 if(token.toLowerCase()!==deployment.token.toLowerCase()||row[0]!==root||row[1]!==10n**18n||row[2]!==0n||!claimed)throw Error('The isolated smoke claim is not confirmed on chain.');
 for(const hash of [input.fundingTransaction,input.claimTransaction]){const receipt=await client.getTransactionReceipt({hash});if(receipt.status!=='success'||receipt.to?.toLowerCase()!==d.toLowerCase()||receipt.from.toLowerCase()!==deployment.owner.toLowerCase()||(await client.getBlock({blockNumber:receipt.blockNumber})).hash!==receipt.blockHash)throw Error('A smoke receipt is unavailable or changed.');}
 await assertCanonical(snapshot);
 await e.DB!.prepare('UPDATE mining_testnet_state SET smoke_epoch=?,smoke_funding_tx=?,smoke_claim_tx=?,smoke_verified=1 WHERE id=1 AND reset_id=?').bind(input.epoch,input.fundingTransaction,input.claimTransaction,s.reset_id).run();
 return {verified:true,scope:'Isolated 1 PERL contract round trip; not GPU work or a mining reward.'};
}
type Evidence={nativeReady:boolean;releaseReady:boolean};
export async function readiness(e:TestnetEnv,evidence:Evidence,now=Math.floor(Date.now()/1000)){
 const s=await launchState(e),db=e.DB;
 if(!s||!db)return {phase:'not_initialized',ready:false,checks:[{id:'fresh_testnet',passed:false,detail:'Run the owner-authorized fresh-testnet installer.'}],chainId:46630};
 const [policy,rp,shares,rounds,validations,treasury]=await Promise.all([
  workPolicy(e,now),roundPolicy(e),db.prepare('SELECT COUNT(*) n,MIN(accepted) first,MAX(accepted) last FROM mining_shares').first<{n:number;first:number|null;last:number|null}>(),
  db.prepare("SELECT COUNT(*) n FROM mining_reward_rounds WHERE state='won'").first<{n:number}>(),
  db.prepare('SELECT report FROM mining_worker_validations').all<{report:string}>(),treasurySnapshot(e),
 ]);
 let claimed=false,claimCheckAvailable=true;
 const funded=await db.prepare("SELECT COUNT(*) n FROM mining_reward_epochs WHERE state='active'").first<{n:number}>();
 if(funded?.n){const results=await Promise.allSettled(testnetValidationWallets(e,deployment.owner).map(address=>accountRewards(e,address)));for(const result of results){if(result.status==='rejected'){claimCheckAvailable=false;continue;}claimed ||= result.value.items.some(x=>x.status==='claimed'&&x.rewardPolicy==='perla-rounds-v1');if(result.value.items.some(x=>x.status==='unavailable'))claimCheckAvailable=false;}}
 const gpuNames=validations.results.flatMap(row=>{try{const r=JSON.parse(row.report);return r.gpuSelfTestPassed===true&&r.device?.name?[String(r.device.name)]:[];}catch{return [];}});
 const duration=shares?.first!==null&&shares?.first!==undefined&&shares.last!==null?shares.last-shares.first:0;
 const checks=[
  {id:'mining',passed:policy.miningEnabled&&!!rp&&!rp.suspended,detail:'Work admission and qualifying-round rewards are enabled.'},
  {id:'verifier',passed:evidence.nativeReady,detail:'The authenticated native verifier supports the current round target.'},
  {id:'worker_release',passed:evidence.releaseReady,detail:'The public worker-v0.9.1 installer and assets pass integrity checks.'},
  {id:'gpu',passed:gpuNames.length>0,detail:'At least one fresh worker uploaded a passing GPU self-test.'},
  {id:'continuous_work',passed:(shares?.n??0)>=3&&duration>=300,detail:'At least 3 accepted shares spanning 5 minutes are required.'},
  {id:'round_winner',passed:(rounds?.n??0)>0,detail:'A real GPU proof must win the harder reward target.'},
  {id:'treasury',passed:treasury.status==='available'&&treasury.data?.coverage==='covered',detail:treasury.status==='available'?'Fresh canonical contract balances and recorded liabilities reconcile.':'The fresh treasury snapshot is unavailable; inspect operator diagnostics.'},
  {id:'automatic_settlement',passed:s.automation_enabled===1&&!!s.automation_checked&&now-s.automation_checked<=600&&!s.automation_error,detail:'The encrypted-signer settlement service must report success within 10 minutes.'},
  {id:'contract_smoke',passed:s.smoke_verified===1,detail:'An isolated 1 PERL funding and claim check must be confirmed. It creates no mining earnings.'},
  {id:'earned_reward_claim',passed:claimed,detail:claimCheckAvailable?'A real earned round allocation must close, fund and reach an approved validation wallet.':'The fresh earned-claim check is unavailable.'},
 ];
 return {chainId:46630,phase:s.phase,resetAt:s.reset_at,ready:checks.every(c=>c.passed),checks,acceptedShares:shares?.n??0,roundsWon:rounds?.n??0,observedWorkSeconds:duration,testedGpuNames:[...new Set(gpuNames)],automaticSettlement:{enabled:!!s.automation_enabled,lastChecked:s.automation_checked,error:s.automation_error},contractSmoke:{verified:!!s.smoke_verified,fundingTransaction:s.smoke_funding_tx,claimTransaction:s.smoke_claim_tx,excludedFromMiningRewards:true},checkedAt:now,mainnetEnabled:false,scope:'Only the GPU models observed here have fresh validation evidence. This is a testnet launch check, not an independent audit or an AI customer-work benchmark.'};
}
