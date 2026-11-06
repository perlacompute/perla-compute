import test from 'node:test';
import assert from 'node:assert/strict';
import {ComputeStore} from '../../../lib/compute/store.mjs';
import {miningCapacity} from '../../../lib/compute/chain.mjs';
import {roundReward,TOKEN_UNIT,PLAN_HASH} from '../../../lib/compute/config.mjs';
test('earned unpublished rounds consume reserve capacity; insufficient capacity pauses until top-up',()=>{
 const s=new ComputeStore(),c={startEpoch:100},normal=roundReward(100,100),report={miningFunded:String(650000n*TOKEN_UNIT),miningAllocated:'0'};
 try{
  for(let i=0;i<34;i++)s.run("INSERT INTO compute_rounds(id,epoch,state,bits,work_units,opened,reward,policy_hash) VALUES(?,100,'won',1,2048,1,?,?)",'budget-fixture-'+i,normal.toString(),PLAN_HASH);
  const capacity=miningCapacity(s,c,report,100);assert.equal(capacity.earnedBaseUnits,(normal*34n).toString());
  s.run("INSERT INTO compute_rounds(id,epoch,state,bits,work_units,opened,reward,policy_hash) VALUES('budget-fixture-last',100,'won',1,2048,1,?,?)",normal.toString(),PLAN_HASH);
  assert.throws(()=>miningCapacity(s,c,report,100),{code:'funding'});
  report.miningFunded=(BigInt(report.miningFunded)+normal).toString();assert.doesNotThrow(()=>miningCapacity(s,c,report,100));
  const before=miningCapacity(s,c,report,100);report.miningAllocated=(normal*35n).toString();assert.deepEqual(miningCapacity(s,c,report,100),before);
 }finally{s.close()}
});
