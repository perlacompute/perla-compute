# Perla Compute · 0.5.0 testnet architecture

The VPS runs a Next.js portal and a single SQLite writer process. A separate, authenticated CPU service verifies native Pearl PlainProof certificates. Participants run CUDA workers on their own Linux GPU hosts. Settlement uses the existing ERC-20 token and Merkle distributor on Robinhood Testnet 46630. Mainnet is on hold; no separate chain is created.

## Work and identity

Wallet authorization creates a single-use signed nonce and short-lived HttpOnly session. Worker credentials are revocable, wallet-scoped random tokens, stored only as hashes. The 76-byte synthetic work header binds the site, chain, epoch, worker, recipient and random job ID. It is a work-domain container, not a Pearl block.

Protocol v4 uses target profiles from `lib/perla/work-profiles.json`. Each job permanently stores its bits, profile, policy fingerprint and points. Reward score is the exact reference-target ratio, not client-reported speed. The coordinator checks ownership, canonical encoding, expiry, revocation, proof/header hash binding and epoch finalization. A unique job index and commit-time conditions make concurrent submissions idempotent.

The native verifier supports v3 for backward-compatible installation/rollback, and v4 for current work. V4 admits dense rank-128 certificates, bounded K and tile area, with no uint256 saturation. Two resource-limited child processes are allowed; coordinator backpressure separately bounds simultaneous verifier calls. No unverified work earns credit. Metrics failure cannot undo or duplicate an accepted share.

Policy activation records an operator-reviewed GPU self-test report hash and a UTC start epoch. It is an operator assertion, not remote hardware attestation. Fresh state is inactive; master environment admission alone cannot open mining. Legacy receipts, points and reward roots remain unchanged.

## Worker modes

The RTX path targets sm86, sm89 and sm120 (RTX 30/40/50). Its CUDA kernel and independent CPU reference compare full GEMM, all partial-sum transcripts, signed extremes, native proof acceptance and negative vectors. This is synthetic standalone matrix mining, not AI model inference. Software/native tests and compiled architecture targets do not establish physical GPU validation.

H100/H200 use the separate pinned vLLM integration, sm90, model memory and inference requirements. Both paths use the same scoped bridge/client and native certificate format. Upstream is pinned to `82e6eee7076aafe10123e08db78f100d270c0582`; see retained licenses and NOTICE files. CPU test oracles are never a runtime mining fallback.

The RTX loop continues after non-winning attempts, refreshes work, drops stale work, and stops instead of retrying ambiguous share POSTs. Host doctor checks do not issue work or submit proofs. Runtime self-tests precede online mining.

## Accounting and trust

SQLite WAL stores workers, issued jobs, verified contribution records, epoch manifests, policy state and bounded operational aggregates. Migrations are additive and checksummed. Epoch manifests use deterministic integer allocation, sorted recipients, largest remainders, chain/contract-bound leaves and sorted-pair Merkle proofs. Once published, the snapshot is closed to further credits.

The operator chooses budgets, controls the offchain verifier and publishes roots. EVM contracts verify allocation proofs, not the full Pearl computation. No permissionless validation, Sybil resistance, customer demand, hardware attestation, earnings guarantee or external audit is claimed.

Treasury and reward checks verify chain ID, token, root and budget at canonical blocks. RPC failure remains unavailable. Published liabilities cover the coordinator's known epochs, not every possible entry in the contract mapping. A funding trace must match a canonical receipt and EpochFunded event. Claim UI differentiates pending, included and finalized; unsupported finality tags never become guessed confirmation.

## Operations and releases

Consistent database backups and deployment environment are encrypted together and authenticated before decryption. The restore drill validates a separate read-only SQLite copy in a network-isolated container. Systemd timers run authenticated health and daily backup/restore checks. No offsite destination or external alert recipient is configured.

The cumulative updater preflights known source hashes, creates rollback copies, upgrades the dual-protocol verifier before web rollout, checks routes and installs timers only after an initial successful restore drill. It preserves contracts, existing runtime credentials and the persistent data volume. Work stays paused.

GitHub CI checks source publication boundaries, SQLite, local EVM, APIs, policy, backups, CUDA compilation and CPU/native protocol paths. Versioned draft releases include checksums, a CycloneDX SBOM and build provenance. Workflows do not deploy contracts, fund epochs or enable mining. Repository publication and actual CI evidence require a connected GitHub account.

See [operator runbook](docs/TESTNET-OPERATIONS.md), [security reporting](SECURITY.md) and [release notes](RELEASE_NOTES.md).
