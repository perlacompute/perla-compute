/** Testnet reference policy. Funding and publication remain explicit operator actions. */
export const TESTNET_SUPPLY = 1_000_000_000n * 10n ** 18n;
export const EMISSION_DAYS = 1460;
export const EMISSION_POLICY = 'perla-testnet-daily-v1';

/** @param {number} day Number of completed daily windows since an explicitly chosen start. */
export function cumulativeBudget(day) {
  if (!Number.isSafeInteger(day) || day < 0) throw Error('Day must be a non-negative safe integer.');
  const d = BigInt(day);
  return TESTNET_SUPPLY * d / (d + BigInt(EMISSION_DAYS));
}

/** @param {number} day One-based testnet emission day. */
export function dailyBudget(day) {
  if (!Number.isSafeInteger(day) || day < 1) throw Error('Day must be a positive safe integer.');
  return cumulativeBudget(day) - cumulativeBudget(day - 1);
}

/** @param {number} day */
export function emissionPreview(day) {
  return { policy: EMISSION_POLICY, network: 'Robinhood Testnet', chainId: 46630,
    day, supplyBaseUnits: TESTNET_SUPPLY.toString(), decimals: 18,
    dailyBudgetBaseUnits: dailyBudget(day).toString(), cumulativeBudgetBaseUnits: cumulativeBudget(day).toString(),
    status: 'Reference budget only; not a funded or activated reward epoch.' };
}
