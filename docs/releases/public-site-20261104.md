# A clearer public testnet website

The public website now leads visitors through the working mining flow: choose a worker identity, run GPU checks, follow accepted work and qualifying rounds, then claim a funded allocation. The established cream, coral and dark palette and interactive hero are retained.

## User-facing changes

- A shorter homepage connects the compute purpose, four-step contribution flow, observed earned-reward proof, hardware requirements and a focused FAQ. The obsolete receipt link and pending-validation roadmap are replaced by the verified epoch 20760 result.
- A live network strip reads actual coordinator state. Failed, unknown, paused and validation-only states do not advertise public admission. Counts remain unknown until a valid response arrives.
- Navigation gives Mining a direct entry and retains Docs, Whitepaper, GitHub and the configured X profile, with the verified Perla profile as a safe default. Workspace labels and admission status follow the current service rather than the old worker-configuration flag.
- Miner setup keeps new-worker and existing-ID flows, improves help/checkbox typography and adds an optional tmux guide for native foreground sessions. The CLI and pinned installer remain **worker-v0.9.1**.
- Reward Center explains earn, automatic epoch funding and wallet claiming before the technical details. Treasury checks load when expanded; planned mainnet allocations remain available in that section. Recent round details and the daily ceiling are separated from the primary reward metrics.
- Service Status leads with current configuration, verifier/release/treasury/settlement checks and earned-claim evidence. Historical software records remain in a separate expandable archive. The old validation panel remains confined to status and hides after the live phase.
- Docs and whitepaper reflect the observed RTX 4090 result and current funding/claim behavior. Other GPU models still require their own self-test and validation; no new inference service is claimed.
- Canonical URLs, a public sitemap, robots rules and a branded PNG share image improve public discovery. Account-management routes remain outside the sitemap and platform pages default to noindex; the public setup guide is explicitly indexable.

## Existing reward evidence

Epoch **20760** delivered **1,532.570312341986489842 PERL** to the committed recipient on Robinhood Testnet, chain **46630**. The homepage amount is a recorded payout, not an earnings estimate.

- [Earned claim transaction](https://explorer.testnet.chain.robinhood.com/tx/0xa6e376f0e7562251e19939307e1d3a82a4e0698768333058e3c1b3a58359b9cd)
- [Complete prior verification record](rewards-live-20261104.md)
- [Allocation, receipts and reusable read-only checker evidence](../evidence)

## Compatibility and scope

The existing worker, GPU/proof implementation, protocol, reward rules, contract addresses, contribution history, database generation and encrypted settlement signer are retained. The prepared background worker is held. This website update does not release new worker assets, create a reward, reset data, deploy a mainnet token or open migration.

Public users claim funded allocations through Reward Center. The automatic claim relay used during validation is not a promise of automatic payouts to all public wallets. Mainnet and bridge plans remain separate.

## Validation

The full existing `npm run check` suite passed, including four public-admission state checks and eight earned-receipt rejection checks. Seventeen production HTTP checks cover the homepage, setup/reuse, rewards, status, metadata, sitemap/robots, PNG image and the retained wallet/worker protections. Production build and TypeScript checks passed on Node 24.22.1 / Next 16.3.4.

Visual review uses real browser rendering of sanitized static SSR snapshots for layout. Client JavaScript and live API behavior are disabled in that visual harness; production HTTP and software checks cover the corresponding application routes. It is not a live browser wallet/claim or physical GPU test. Exact scope and updater checks are recorded in `docs/evidence/public-site-20261104.json`.

The operator's updater builds while the existing container serves, publishes the reviewed GitHub source, then switches and checks the site. It compares mining/reward policy hashes, admission, reset generation and accepted-history counters. Failed post-switch checks restore the previous web image without rolling the database back. Its actual GitHub commit and deployment report are produced only when run on the website VPS.

## X draft — for after successful deployment; not posted

From GPU setup to funded rewards, the Perla workspace now gives every step a clearer place.

Create or reconnect a worker, follow accepted proofs, and claim eligible PERL from the same reward wallet.

https://perlacompute.xyz/platform/setup
