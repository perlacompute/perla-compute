import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REWARD_PLAN as plan, TOKEN_SCALE as unit, parseTestnetAmount, mainnetEquivalent, formatPlanAmount, publicRewardPlan } from '../../lib/perla/reward-plan.mjs';
test('mainnet allocations conserve the fixed planned supply without double counting mining',()=>{
  assert.equal(BigInt(plan.migrationAllocation)+BigInt(plan.mainnetMiningAllocation),BigInt(plan.totalMiningAllocation));
  assert.equal(BigInt(plan.totalMiningAllocation)+BigInt(plan.unallocated),BigInt(plan.mainnetSupply));
  assert.equal(plan.testnetSupply,'1000000000');assert.equal(plan.mainnetSupply,'1000000000');
});
test('the entire eligible testnet supply converts to the 70M mainnet cap',()=>{
  assert.equal(mainnetEquivalent(BigInt(plan.testnetSupply)*unit),BigInt(plan.migrationAllocation)*unit);
  for(const [input,output] of [['100','7'],['1000','70'],['50000','3500'],['1000000','70000']])assert.equal(mainnetEquivalent(parseTestnetAmount(input)),parseTestnetAmount(output));
});
test('decimal conversion stays exact in base units and floors sub-unit dust',()=>{
  assert.equal(mainnetEquivalent(parseTestnetAmount('100.123')),7008610000000000000n);
  assert.equal(mainnetEquivalent(1n),0n);assert.equal(mainnetEquivalent(100n),7n);
  for(let i=0n;i<100n;i++)assert(mainnetEquivalent(i)<=mainnetEquivalent(i+1n));
});
test('invalid, negative, over-supply and imprecise amounts are rejected',()=>{
  for(const value of ['-1','1e9','1,000','01','NaN','Infinity','1000000001','1.0000000000000000001','<script>'])assert.throws(()=>parseTestnetAmount(value),value);
  assert.throws(()=>mainnetEquivalent(-1n));assert.throws(()=>mainnetEquivalent(1000000001n*unit));
});
test('the planned daily cap is global mainnet output and requires 70 full epochs',()=>{
  assert.equal(plan.dailyMainnetLimit,'1000000');assert.equal(plan.epochSeconds,86400);
  assert.equal(BigInt(plan.migrationAllocation)/BigInt(plan.dailyMainnetLimit),70n);
  assert.match(publicRewardPlan().limitScope,/Global mainnet PERL output/);
});
test('the public policy never reports a deployed or enabled migration',()=>{
  const publicPlan=JSON.parse(JSON.stringify(publicRewardPlan()));
  assert.equal(publicPlan.bridgeEnabled,false);assert.equal(publicPlan.migrationStatus,'coming_soon');
  assert.equal(publicPlan.mainnetStatus,'on_hold');assert.equal(publicPlan.contractsDeployedByThisRelease,false);
});
test('display formatting does not round a preview upward',()=>{
  assert.equal(formatPlanAmount(1234567899999999999n,8),'1.23456789');
  assert.equal(formatPlanAmount(70000000n*unit,8),'70,000,000');
});
