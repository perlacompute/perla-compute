# Separate the validation wallet from the treasury signer

A worker using a different reward wallet was receiving HTTP 503 during the fresh-testnet phase because work admission, the earned-claim readiness check and automatic test claim relay all assumed the contract owner was the only test recipient.

## Result

- The operator can set one public `PERLA_TESTNET_VALIDATION_WALLET` in the website VPS configuration. The contract owner remains admitted as well; other wallets remain blocked during testing.
- The worker keeps its existing Worker ID, saved credential and reward wallet. The GPU CLI remains worker-v0.9.1.
- The existing encrypted owner signer funds earned allocations and can relay the configured test wallet's exact Merkle claim to its committed recipient. The distributor owner, token and signer are unchanged.
- Readiness checks recognize a real earned claim by either admitted test wallet. Empty allocations, ordinary shares and the isolated 1 PERL smoke check cannot satisfy this check. All public-opening checks still apply.
- Includes the pending UI cleanup: the full launch panel appears only on Service Status and hides after phase live; replacement connection is under Advanced options with a correctly sized checkbox and adjacent worker-name help.

## Validation

Next.js 16.3.4 production build and TypeScript passed on Node.js 24.22.1. Fifteen automatic lifecycle checks used a real temporary SQLite ledger and local EVM, with explicit GPU/verifier/GitHub doubles. They covered admission of the configured wallet without an identity change, rejection of unrelated wallets and invalid addresses, the mining pause, funding and claim to the configured recipient, unchanged distributor ownership, smoke exclusion, readiness/public-opening conditions and idempotent settlement. Production HTTP route checks cover setup, rewards and status. No public-chain transaction or physical GPU test was performed by this patch. Browser preview was unavailable in the local preview environment.

The installer keeps a private source/configuration backup, performs no reset, rebuilds the web image and its settlement bundle, then checks the running configuration and four routes. Existing volume data, worker credentials, contract addresses and encrypted signer are retained. The deployed behavior has since been verified; GitHub synchronization is included in the rewards closeout.

## Later validation

The configured-wallet fix was subsequently observed in the deployed fresh testnet. The first earned GPU reward reached that wallet and the launch checks passed. See [the rewards closeout](rewards-live-20261104.md) for exact transactions, reproducible proof and the current X draft. The earlier testing-stage draft is superseded.
