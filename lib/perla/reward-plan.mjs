/** Published mainnet plan. Allocation caps are not funded balances or deployed bridge limits. */
export const REWARD_PLAN = Object.freeze({
  version: 'perla-rewards-plan-v1',
  testnetChainId: 46630, mainnetChainId: 4663, decimals: 18,
  testnetSupply: '1000000000', mainnetSupply: '1000000000',
  totalMiningAllocation: '200000000', migrationAllocation: '70000000',
  mainnetMiningAllocation: '130000000', unallocated: '800000000',
  testnetRatioUnits: 100, mainnetRatioUnits: 7,
  dailyMainnetLimit: '1000000', epochSeconds: 86400,
  migrationStatus: 'coming_soon', mainnetStatus: 'on_hold',
});
export const TOKEN_SCALE = 10n ** BigInt(REWARD_PLAN.decimals);
/** @param {string} text */
export function parseTestnetAmount(text) {
  if (typeof text !== 'string' || !/^(?:0|[1-9]\d{0,9})(?:\.\d{1,18})?$/.test(text)) throw Error('Enter a non-negative amount with up to 18 decimal places.');
  const [whole, fraction = ''] = text.split('.');
  const value = BigInt(whole) * TOKEN_SCALE + BigInt(fraction.padEnd(18, '0'));
  if (value > BigInt(REWARD_PLAN.testnetSupply) * TOKEN_SCALE) throw Error('Amount exceeds the total testnet supply.');
  return value;
}
/** Arithmetic preview only; this does not determine eligibility or reserve a migration slot. @param {bigint} eligible */
export function mainnetEquivalent(eligible) {
  if (typeof eligible !== 'bigint' || eligible < 0n || eligible > BigInt(REWARD_PLAN.testnetSupply) * TOKEN_SCALE) throw Error('Invalid eligible testnet amount.');
  return eligible * BigInt(REWARD_PLAN.mainnetRatioUnits) / BigInt(REWARD_PLAN.testnetRatioUnits);
}
/** @param {bigint} value @param {number} digits */
export function formatPlanAmount(value, digits = 3) {
  const whole = (value / TOKEN_SCALE).toLocaleString('en-US');
  const fraction = (value % TOKEN_SCALE).toString().padStart(18, '0').slice(0, digits).replace(/0+$/, '');
  return whole + (fraction ? '.' + fraction : '');
}
export function publicRewardPlan() {
  return { ...REWARD_PLAN, bridgeEnabled: false, contractsDeployedByThisRelease: false,
    limitScope: 'Global mainnet PERL output per UTC epoch; not per wallet.',
    eligibility: 'Verified mining reward records; an arbitrary token balance or transfer is not sufficient.',
    funding: 'Planned allocations only. Mainnet reserves must be obtained, funded and verified before opening.' };
}
