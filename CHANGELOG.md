# Worker 0.7.0 — Wallet and rig-name setup

- Added public reward-address and worker-name connection with private local credentials; browser login remains for dashboard management and claims.
- Miner Setup now generates an install-and-start command. GPU checks and report uploads are automatic.
- Registration retries reuse the same identity; matching rig labels cannot overwrite another worker. Public connections do not consume the signed-wallet worker quota.
- Preserved native proof checks, existing verified RTX runtime reuse, paused public admission, immutable earlier releases and the agreed reward plan. This remains a one-share validation release.

# Unreleased — Rewards and Miner Setup

- Published the mainnet mining allocation plan: 70M PERL migration cap and 130M future mainnet mining, within the planned fixed 1B supply.
- Added a closed Bridge preview with 100:7 arithmetic and a planned global 1M mainnet PERL daily output cap. No migration contract, reserve funding or transaction path is activated.
- Replaced manual setup checks with wallet-and-name command generation; work remains gated by server admission and funded reward status.
- Removed the sidebar promotion and aligned Rewards, Docs, Whitepaper and participant guidance. Existing worker releases, mining rules and funded testnet claims remain unchanged.

# 0.4.0-rc.1 — RTX validation preview

- Added an independent dense INT8 WMMA matrix worker with native sm86, sm89 and
  sm120 CUDA targets for RTX30/40/50; no model checkpoint is required.
- Kept native certificate v3 and the existing coordinator/verifier/reward flow.
- Added actual-GPU self-tests, a non-saturating PoW positive/negative oracle,
  native proof checks, wrong-challenge rejection and fail-closed startup.
- Added the RTX download, checksums, installation guide, worker-mode selection
  and a CPU-only CI job for compilation/protocol tests. Physical GPU validation
  remains required for each family; no hashrate or profitability claim is made.
- Documented the existing validation difficulty saturation and the separate
  standalone-matrix versus AI-inference scope. Admission and reward funding
  are not activated by the web patch or worker build.

# Changelog

## 0.3.0 — 25 October 2026

- Add public Proof Explorer search, stable receipt pagination and accepted-contribution detail pages.
- Add public epoch details and validated manifest downloads.
- Add wallet Reward Center with contract funding checks, fresh claim bits and wallet transaction tracking.
- Add guided miner setup with milestones derived from account/worker/contribution records.
- Refresh mining, header, footer and workspace navigation; retain Docs and Whitepaper.
- Add one non-destructive SQLite receipt lookup index and portal behavior tests.
- Preserve existing contracts, deployment state, verifier configuration and paused admission settings.

See [UPDATE-0.3.0.md](UPDATE-0.3.0.md) and [docs/portal-api.md](docs/portal-api.md).

## 0.2.4 — 25 October 2026

- Select `PERL` as the planned mainnet ticker while retaining Perla as the project name.
- Update current token-policy copy and shared brand configuration.
- Preserve the deployed `tPERLA` test-token source and setup fingerprint. No onchain migration is performed.
- Prepare a source-only repository with README, licensing, contribution/security guidance, roadmap and CI workflow.
- Include the testnet and native-verifier setup utilities used for the current VPS deployment.
- Add a source audit for common credentials and disallowed runtime files.

The existing deployment has not been automatically upgraded by this source preparation. No mining admission, reward funding or public-chain transaction is triggered by these changes.

## Earlier validation releases

See [UPDATE-0.2.3.md](UPDATE-0.2.3.md), [DOCS-UPDATE-0.2.2.md](DOCS-UPDATE-0.2.2.md) and [VERIFICATION.md](VERIFICATION.md) for historical scope. Historical token names in those records describe the version reviewed at that time.
