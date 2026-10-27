# Perla 0.2.3 — navigation, layout and testnet supply

This cumulative update supports the supplied VPS 0.2.1 source and the 0.2.2 explanation patch. It refuses to overwrite files that differ from both known versions. It does not edit server environment variables, database contents or deployment addresses.

## Website

- Explicit Docs and Whitepaper links in the public header, mobile menu, footer and workspace resources.
- Whitepaper route titled Whitepaper; architecture and trust limitations retained.
- Consistent spacing, readable text, responsive grids, scrollable tables and code blocks.
- Collapsible mobile contents for Docs, Whitepaper and participation instructions.
- Supply explanations and an interactive, clearly labelled testnet emission illustration.

## Token and reward policy

The PerlaTestToken deployment source now creates exactly **1,000,000,000 tPERLA**, with 18 decimals, once to the deployer. It has no additional mint entrypoint and its constructor rejects chain IDs other than 46630. Updating website source does not change a deployed token. If an older test token was already deployed, use a new deployment and review distributor/configuration changes separately; do not erase historical records.

The planned mainnet Pons supply is **1,000,000,000 PERLA**. Mainnet supply does not establish a mining reserve. A reserve must be allocated or acquired and funded before mainnet rewards. No mainnet deployment is included. Testnet and mainnet assets are distinct; no 1:1 conversion is established.

Pearl's official node source uses a 2.1B native supply cap and a declining block subsidy, with an approximately four-year constant. Perla retains Robinhood settlement and adapts the cumulative curve to UTC-day budgets for a testnet reference policy:

`C(d) = floor(1B × 10^18 × d / (d + 1460))`

`B(d) = C(d) - C(d - 1)`, for one-based day `d`.

The operator must publish a UTC start epoch before applying these day numbers. There is no automatic schedule activation, contract enforcement of this curve, background funding or rollover for empty epochs. Existing operator APIs still accept explicit budgets. A valid-share points snapshot determines each wallet's proportional amount within a funded epoch, with largest-remainder integer allocation. This daily service is a Perla adaptation, not Pearl block consensus.

Preview only, with no wallet key or transaction:

```bash
node scripts/perla-rewards.mjs emission 1
node scripts/perla-rewards.mjs emission 1460
```

The operator download includes the same updated token source and preview module. SHA-256 package checksums have been regenerated.

## Validation

- Production Next.js build and TypeScript passed.
- 13 local EVM reward checks passed, including fixed 1B supply and rejection on mainnet chain ID.
- 5 emission checks passed, including conservation through 1,460 days, supply cap and CLI input errors.
- 7 production HTTP checks passed, including account signature, persistence and HTTPS session behavior.
- These checks did not deploy public contracts, run a GPU workload, fund a reward epoch or modify the VPS.

## Installation

Upload the patch ZIP to `/root`:

```bash
cd /root
unzip perla-0.2.3-patch.zip
bash /root/perla-0.2.3-patch/apply.sh /var/www/perla-vps
```

The installer backs up affected source, builds before replacing the web container, and restores source if the build fails. Manual source customizations are reported before any patch writes. Keep the displayed backup path for rollback. `.env`, SQLite volumes, mining admission and reward contract addresses are unchanged by installation.

Contract deployment remains a separate explicit operation using a dedicated test wallet. Never send the private key through chat. The web update alone does not activate rewards.
