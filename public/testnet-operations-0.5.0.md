# Perla testnet operations — worker 0.9.1

The current operator workflow is the fresh-testnet installer. Mainnet and migration remain closed.

## Fresh generation and reset

The installer is authorized to remove the old testnet dataset: all worker IDs and credentials, pairing/reconnect requests, wallet sessions, jobs, accepted shares, counters, reward rounds, allocations and cancellation history. It takes a private offline SQLite backup before deletion. The active database restarts from zero, with a new UTC emission start and the existing token/distributor. It is a one-time operation: rerunning the same installer preserves every new worker and contribution. Applied migrations are never rewritten. Public blockchain transactions are immutable; removing local history cannot erase them.

## Install and start a GPU

Use https://perlacompute.xyz/platform/setup. Linux NVIDIA RTX 30/40/50 targets are included. GPU 0 is the first visible GPU; one-GPU machines keep 0. The installer automatically chooses native CUDA when Docker is unavailable. No worker.env or validation report transfer is required.

After the reset, update once and create a fresh connection:

```bash
"$HOME/.local/bin/perla" update --release worker-v0.9.1
"$HOME/.local/bin/perla" start --new-worker --wallet YOUR_PUBLIC_0X_ADDRESS --worker rig01 --device 0
```

Stop an existing miner before update. `--new-worker` deliberately replaces this host connection and retains the verified CUDA build. Use it once. Normal restarts:

```bash
"$HOME/.local/bin/perla" start --device 0
```

Continuous operation is the default. `--shares 1` is only a single-share test and cannot complete the sustained-operation check. Stop native mining with Ctrl+C; use `perla stop` for Docker. New IDs can later move to another host with `perla start --worker-id ID --device 0` and owner-wallet approval. IDs erased by this reset cannot reconnect.

## Work, rounds and earning

A normal share records exact work weight; it is not a points balance or a token payout. The original native proof must also meet the harder round target to win a reward. The PPLNS window includes the latest weighted shares up to twice round difficulty. Initial difficulty is 256 reference work units, bounded to 2048; the controller considers 16 completed rounds around a 194-second target. These parameters are not a hardware throughput benchmark. The daily cap declines using the published emission curve. Each qualifying round earns floor(daily cap / 446), up to 446 rounds daily. No winner means zero reward. Unused capacity stays in treasury, with no rollover. Tasks are issued immediately; receiving one earns no tokens.

## Automatic settlement

The installer reads the dedicated testnet owner key silently on the website VPS, validates the reviewed 46630 contracts and encrypts it with `systemd-creds --with-key=host`. The application environment, GitHub source and GPU hosts receive no wallet private key. The encrypted systemd service prepares, checks, funds and activates earned closed epochs every two minutes, starting from UTC close plus five minutes. It approves exact budgets only. Transaction journals reconcile interrupted operations before a new payment. Only the pinned PERL token and distributor on chain 46630 are accepted.

```bash
cd /var/www/perla-vps
bash scripts/perla-rewards.sh health
systemctl status perla-rewards-auto.timer perla-rewards-auto.service
journalctl -u perla-rewards-auto.service -n 40 --no-pager
```

Manual review and recovery remain available with `bash scripts/perla-rewards.sh review` and `bash scripts/perla-rewards.sh settle`. The owner wallet needs test ETH. Signer encryption is tied to this VPS: on a future host, configure the credential again with the owner key; copying its encrypted file alone is insufficient.

## Contract smoke and public opening

The initial service run performs an isolated 1 PERL fund-and-claim round trip back to the owner in a separate uint256 namespace. It is recorded separately and creates no mining reward, contribution or migration entitlement. During testing only the operator reward wallet receives work. Actual owner-earned allocations are automatically relayed after daily settlement, providing evidence for the real GPU-to-wallet lifecycle.

Public mining opens automatically only after all fresh checks pass: native verifier and release integrity, a passing GPU report, at least three accepted shares spanning five minutes, a qualifying reward-round win, fresh treasury reconciliation, a recent successful scheduler heartbeat, the isolated contract check and a real earned reward claim. No fabricated winner, backdated production epoch or early mutable Merkle root is used to bypass the daily settlement window. Inspect /status or /api/mining/readiness. The initial check validates only the hardware actually exercised, not every compiled GPU target, AI inference, external security audit or mainnet readiness.

## RPC diagnostics

Treasury uses a single canonical block and serial contract reads, with bounded transient-read retries. Failed reads return their check stage without exposing provider credentials. Balances are never invented. A failing inspection blocks reset and public opening. Restore an HTTPS Robinhood Testnet provider in PERLA_RPC_URL; the updater can request an alternate URL privately before resetting. Wrong-chain and mismatched-contract endpoints are rejected.

## Backups and recovery

The updater retains a private source/image backup and consistent pre-reset SQLite copy. A committed reset marker prevents accidental repeat deletion. After reset, failures retain the fresh database and new reward code for idempotent recovery; rerun the same installer. Old full-budget code must not be restored over the fresh generation. Existing encrypted data backups and health monitoring remain separate from the reward service. Offsite delivery and notification require an operator destination; they are not inferred from source code.
