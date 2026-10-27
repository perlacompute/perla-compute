# Participation portal validation — 0.3.0

Checked on 25 October 2026. This record covers source preparation and an isolated production preview, not an upgrade of the operator's VPS.

| Check | Result |
| --- | --- |
| Production Next.js build and TypeScript | Passed |
| SQLite persistence, backup and migration checks | 6 passed |
| Existing funded-reward contract checks on a local EVM | 13 passed |
| Emission curve and CLI checks | 5 passed |
| Inference boundary checks with simulated upstream responses | 12 passed |
| Portal API, receipt privacy, pagination, manifest integrity and reward state checks | 25 passed |
| Production HTTP, session and process-restart checks | 8 passed |
| Source publication guard | Passed |
| Updater checks | 10 passed, with Docker and deployment probes simulated |

The 69 behavioral checks include a real local-EVM funding/claim lifecycle and detection of the resulting claim bit. Unfunded, unactivated, wrong-chain, wrong-token, unavailable-RPC and modified-manifest cases do not enable claims. Seeded ledger rows in these checks are fixtures, not GPU/native-proof evidence.

Browser QA used the production build through the supported managed preview. Eight pages were checked at 1280, 768, 390 and 320 CSS-pixel frame widths. Populated receipt and epoch detail pages were additionally checked at all four widths using a separate synthetic QA database. These 40 page/width observations had no page-level horizontal overflow. A miner-step CSS collision was found and repaired; the repaired mobile setup and mobile sidebar navigation were inspected again. Epoch-to-explorer navigation, invalid-search feedback and reset to the accepted-record list were exercised.

Synthetic QA records and browser controls are not included in the release or source archives. No production contribution, epoch, secret or database was created or rewritten by QA.

The updater was exercised against the reviewed 0.2.3 and prepared 0.2.4 source baselines. Checks cover idempotence, source rollback, conflict/symlink refusal, protected runtime state, build-before-switch ordering and recovery paths for failed build, switch, health and route probes. Docker operations in those checks were simulated because no Docker daemon was available in the development runtime.

Dependencies from the existing locked development installation were reused. A clean GitHub Actions run remains pending publication of the repository. The native verifier was not rebuilt here, and no real GPU run or public-chain transaction was performed. The operator's successful native CPU-verifier deployment report remains separate evidence. A supported GPU inference-to-share run and a real funded public-testnet claim still need deployment-host validation.
