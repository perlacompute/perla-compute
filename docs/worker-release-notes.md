# Perla Worker 0.8.1

- Fix native RTX startup after installer upgrades and worker reconnection. Verified 0.8.0 and 0.8.1 installations are now recognized while the pinned GPU/proof core and file integrity checks remain enforced.
- Reuse a matching verified native build cache. A fresh GPU host builds locally and must pass its own GPU self-test. No historical GPU result is substituted.
- After a successful reconnect, rerun `perla start --device 0 --shares 1` using the connection already saved on the new machine. No second approval or worker recreation is required.
- Website reconnect checks retry transient network failures, clear recovered errors, stop after completion, and cancel stale requests when the wallet or code changes.
- The owning wallet can confirm a completed active transfer after the approval deadline. Cancelled, superseded and expired pending requests cannot authorize a transfer.
- Worker IDs, reward wallets, accepted history, proof mathematics, mining policy and reward budgets are retained. The GPU/proof core remains 0.5.0. Old releases and assets remain immutable. Mainnet and Bridge remain closed.

Software tests exercise installation, native-source verification, cache reuse, reconnect authorization and network recovery. Physical GPU mining after this fix remains a deployment validation; no new GPU run or independent security audit is claimed.
