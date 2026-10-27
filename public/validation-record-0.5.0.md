# Perla 0.5.0 software validation

Scope: testnet source release. Mainnet remains on hold. No public-chain transaction, real GPU run, VPS update or GitHub publication is established by this record.

Validated locally with Node 24 and the actual Rust/PyO3 library built from Pearl commit 82e6eee7076aafe10123e08db78f100d270c0582:

| Check | Cases | Evidence boundary |
|---|---:|---|
| SQLite persistence, batch rollback, WAL backup and migration checksums | 6 | Actual SQLite |
| Reward contract behavior and Merkle replay/domain isolation | 13 | Local EVM |
| Emission previews | 5 | Integer arithmetic and CLI |
| Inference access/provider boundary | 12 | Isolated mocked upstream |
| Portal, legacy receipt labels, treasury, canonical funding traces and claims | 28 | Actual SQLite, signed requests, local EVM |
| Work profiles, activation, backpressure, metrics and allocation audit | 8 | Actual SQLite and deterministic allocation |
| Encrypted backups, restore integrity, tamper and wrong-key rejection | 4 | Actual OpenSSL/SQLite with simulated Docker transport |
| RTX noise, transcripts, native proofs and worker state machine | 19 | CPU oracle/native; no physical GPU |
| Authenticated coordinator-to-native-verifier and bridge flow | 30 | Actual native proof verification; CPU-generated proofs |
| Production pages, downloads, authorization, persistence and reverse proxy | 9 | Production Next.js HTTP server |

TypeScript checking, production build and source publication audit are required before packaging. The updater also has source preflight/rollback simulations; real Docker/Nginx/systemd rollout must be verified on the VPS. Browser checks cover the five-step setup, signed-out controls, hardware selection and narrow/tablet/desktop layouts.

The CUDA kernel and architecture targets are retained from 0.4.0-rc.1. That historical record covers compilation for sm86/sm89/sm120. This environment has no GPU or Docker daemon; it does not independently establish a rebuilt 0.5.0 CUDA image. CI includes a fresh CUDA build and CPU/native integration gate, but its remote execution requires a published repository.

Public mining stays paused. A real RTX 30, 40 and 50 host must run its own self-test and supervised receipt trial. Sustained load, live testnet epoch funding/claim, offsite backup, restore on the target host and an external security review remain separate milestones. Operator-reviewed reports are not hardware attestation. No earnings or GPU throughput benchmark is claimed.
