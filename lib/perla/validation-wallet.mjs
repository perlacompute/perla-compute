/** Test recipients are separate from the contract owner and encrypted signer.
 * @param {{PERLA_TESTNET_VALIDATION_WALLET?: string}} env
 * @param {string} owner
 * @returns {string[]}
 */
export function testnetValidationWallets(env, owner) {
  const extra = (env.PERLA_TESTNET_VALIDATION_WALLET || '').trim().toLowerCase();
  if (extra && (!/^0x[0-9a-f]{40}$/.test(extra) || /^0x0{40}$/.test(extra))) {
    throw Error('PERLA_TESTNET_VALIDATION_WALLET must be one nonzero public EVM address.');
  }
  return [...new Set([owner.toLowerCase(), ...(extra ? [extra] : [])])];
}
