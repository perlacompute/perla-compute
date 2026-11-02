/** Offline, owner-authorized mining DB reset. Must run with the web/timers stopped. */
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,existsSync,lstatSync,writeFileSync,chmodSync,renameSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {RESET_ID,inspectDeployment,distributorAbi} from './testnet-control.mjs';
import {ROUND_POLICY_HASH} from '../lib/perla/round-math.ts';
import {EMISSION_POLICY} from '../lib/perla/emission.mjs';
const identifier=n=>{if(!/^[A-Za-z0-9_]+$/.test(n))throw Error('Unexpected SQLite identifier.');return '"'+n+'"';};
export async function resetTestnet({env=process.env,now=Math.floor(Date.now()/1000),directory,options={},inspect=inspectDeployment,injectFailure}={}){
 const filename=resolve(env.PERLA_SQLITE_PATH||'/app/data/perla.sqlite');
 if(!existsSync(filename)||lstatSync(filename).isSymbolicLink())throw Error('Use the existing regular Perla SQLite database.');
 const db=new DatabaseSync(filename);db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;PRAGMA secure_delete=ON;');
 try{
  const saved=db.prepare('SELECT reset_id,reset_at,phase FROM mining_testnet_state WHERE id=1').get();
  if(saved?.reset_id===RESET_ID)return {alreadyReset:true,...saved,deletedAgain:false};
  if(saved)throw Error('Another fresh-testnet generation exists. This installer will not reset it again.');
  const policy=db.prepare('SELECT * FROM mining_policy_state WHERE id=1').get();
  if(!policy||!policy.validation_hash||!['86','89','90','120'].includes(policy.validation_family))throw Error('The existing validated work policy is required.');
  const epochs=db.prepare('SELECT epoch,root,budget,state,funding_tx FROM mining_reward_epochs ORDER BY epoch').all();
  const c=await inspect(env,options),epoch=Math.floor(now/86400);
  const current=await c.client.readContract({address:c.deployment.distributor,abi:distributorAbi,functionName:'epochs',args:[BigInt(epoch)],blockNumber:c.blockNumber});
  if(current[1]!==0n)throw Error('This UTC epoch already has immutable onchain funding. A fresh reset cannot reuse it.');
  if(epochs.length>10000)throw Error('The old epoch inventory exceeds the reviewed reset bound.');
  const observations=[];
  for(const old of epochs){const state=await c.client.readContract({address:c.deployment.distributor,abi:distributorAbi,functionName:'epochs',args:[BigInt(old.epoch)],blockNumber:c.blockNumber});observations.push({epoch:old.epoch,budget:old.budget,action:state[1]===0n?'cancelled_and_removed':'removed_from_active_database_onchain_payment_immutable',onchainBudget:state[1].toString(),onchainRemaining:state[2].toString()});}
  if((await c.client.getBlock({blockNumber:c.blockNumber})).hash!==c.blockHash)throw Error('The reset chain snapshot changed. No database rows were deleted.');
  const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'mining_*'").all().map(r=>r.name);
  const counts=Object.fromEntries(names.map(n=>[n,db.prepare('SELECT COUNT(*) AS n FROM '+identifier(n)).get().n]));
  const folder=resolve(directory||dirname(filename)+'/backups/fresh-testnet-'+now);mkdirSync(folder,{recursive:true,mode:0o700});
  if(lstatSync(folder).isSymbolicLink())throw Error('Use a regular reset backup directory.');
  const backup=resolve(folder,'before-reset.sqlite');
  if(!existsSync(backup)){db.prepare('VACUUM INTO ?').run(backup);chmodSync(backup,0o600);}
  const report={resetId:RESET_ID,resetAt:now,chainId:46630,blockNumber:c.blockNumber.toString(),blockHash:c.blockHash,backup,previousCounts:counts,oldAllocations:observations,oldWorkersInvalidated:true};
  writeFileSync(resolve(folder,'reset-intent.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  // Delete children before parents, including auth sessions, pairings and counters.
  const remaining=new Set(names),order=[];
  while(remaining.size){const leaves=[...remaining].filter(parent=>![...remaining].some(child=>child!==parent&&db.prepare('PRAGMA foreign_key_list('+identifier(child)+')').all().some(f=>f.table===parent)));
   if(!leaves.length)throw Error('The mining schema has an unexpected foreign-key cycle.');for(const n of leaves){order.push(n);remaining.delete(n);}}
  db.exec('BEGIN IMMEDIATE');
  try{
   for(const n of order)db.exec('DELETE FROM '+identifier(n));
   if(db.prepare("SELECT name FROM sqlite_master WHERE name='sqlite_sequence'").get())db.exec("DELETE FROM sqlite_sequence WHERE name GLOB 'mining_*'");
   db.prepare('INSERT INTO mining_policy_state(id,profile_id,start_epoch,activated_at,validation_hash,validation_family,validation_version) VALUES(1,?,?,?,?,?,?)').run(policy.profile_id,epoch,now,policy.validation_hash,policy.validation_family,policy.validation_version);
   db.prepare('INSERT INTO mining_reward_policy(id,policy,start_epoch,token,distributor,created) VALUES(1,?,?,?,?,?)').run(EMISSION_POLICY,epoch,c.deployment.token.toLowerCase(),c.deployment.distributor.toLowerCase(),now);
   db.prepare('INSERT INTO mining_round_policy(id,policy_hash,started,cutover_epoch,suspended) VALUES(1,?,?,?,0)').run(ROUND_POLICY_HASH,now,epoch);
   db.prepare("INSERT INTO mining_testnet_state(id,reset_id,reset_at,phase) VALUES(1,?,?,'testing')").run(RESET_ID,now);
   if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('The reset would leave inconsistent foreign keys.');
   if(injectFailure)injectFailure();db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);VACUUM;PRAGMA wal_checkpoint(TRUNCATE);');
  const completed={...report,completed:true,newEmissionStartEpoch:epoch,phase:'testing',mainnetChanged:false};
  const temp=resolve(folder,'reset-complete.json.tmp');writeFileSync(temp,JSON.stringify(completed,null,2)+'\n',{mode:0o600});renameSync(temp,resolve(folder,'reset-complete.json'));
  return completed;
 }finally{db.close();}
}
