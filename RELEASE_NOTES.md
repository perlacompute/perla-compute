Perla 0.5.0 improves the testnet mining and operations foundation.

- Guided Miner Setup with hardware selection, wallet/worker registration, doctor, offline GPU validation and first-share tracking.
- Protocol v4: non-saturating difficulty profiles, immutable per-job points/policy, native validation and legacy receipt preservation. Existing workers require the 0.5.0 package.
- Public testnet treasury snapshot, canonical-block funding checks, recorded funding transactions, reproducible allocation audit and claim inclusion/finality tracking.
- Redacted worker diagnostics, bounded verification concurrency, durable rejection/stale/duplicate counts and operator health.
- Encrypted authenticated backups, isolated SQLite restore drills and optional systemd health/backup timers.
- Pinned CI actions, CPU/native checks, CUDA compilation job, draft releases, SBOM and build provenance.

Mainnet remains on hold. Contracts, supply and existing reward roots are unchanged. The upgrade does not activate mining, fund epochs or send chain transactions. A GPU self-test report is an operator assertion, not remote hardware attestation. Physical RTX testing and the VPS install/restore drill must be completed on their respective hosts. No external audit is claimed.
