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
