# Perla mainnet mining and reward migration

The AI Playground, API keys and USDG top-ups stay at `/platform/compute`. Mainnet mining and earned testnet migration use `/platform/network`; the wallets sign separate sessions.

## Install on your GPU machine

Linux x86-64, Python 3.12, NVIDIA driver and a matching CUDA devel toolkit are required. The worker targets RTX 30/40/50 architectures; a supported compilation target is not a report of physical GPU validation. The existing testnet worker remains separate.

```bash
curl --fail --show-error --location --proto '=https' --proto-redir '=https' \
 'https://github.com/perlacompute/perla-compute/releases/download/mainnet-worker-v1.2.0/install.sh' -o install-perla-mainnet.sh
printf '%s  %s\n' '01a33b1812bdc06b3e42ac85afd8bd0ba4050bbb045c0f4f67352f306857d80c' install-perla-mainnet.sh | sha256sum -c -
bash install-perla-mainnet.sh
"$HOME/.local/bin/perla-mainnet" start --wallet YOUR_PUBLIC_0X_ADDRESS --worker rig01 --device 0
```

The installer URL is available after the operator publishes the checked release. Your website shows commands only after its public assets match the reviewed checksums. Never supply a wallet private key to a GPU worker. The first GPU is index 0, the second is 1; on a one-GPU machine keep 0. Start without `--shares` for continuous foreground mining; add `--shares 1` only for a diagnostic. Users can keep it running with tmux or their own service.

A successful connection prints the permanent mainnet Worker ID. Later `perla-mainnet start` uses its saved connection. To move GPU machines:

```bash
"$HOME/.local/bin/perla-mainnet" reconnect --worker-id YOUR_MAINNET_WORKER_ID
```

Sign in with its reward wallet at the printed `/platform/network` link and compare the terminal code before approving. The exchange replaces the previous machine credential. History and reward wallet remain bound; the new machine must pass its own GPU checks. Worker IDs are network-specific; testnet allocations migrate by reward wallet and funded snapshot.

## What earns PERL

A task is a challenge, and accepted shares record verified mathematical work. Mining is standalone dense matrix proof work; it is distinct from customer LLM inference. A harder qualifying proof wins a round. The normal shared PPLNS pool is approximately 18,550.23 PERL, distributed across the rolling window of accepted work, rather than a fixed payment per task or a guaranteed finder reward.

The 130M PERL allocation cap defines the 1,460-day schedule and 7,008 possible rounds. The five-day limit cycles 4/5/5/5/5 rounds. The initial harder work factor is 2,048; the bounded controller retargets every 16 won rounds toward five hours. The contribution window is twice the round work factor. `/platform/network?tab=explorer` shows accepted receipts. Closed earned epochs are reconstructed, published with their funded roots and automatically relayed to each bound recipient; direct claims remain available. Unused slots do not create earnings.

## Convert earned testnet rewards

Open `/platform/network?tab=convert` and sign in with the same public reward wallet. The immutable snapshot includes only active, funded earned-round allocations up to the selected closed UTC epoch, from the pinned PERL testnet deployment. Funding must be finalized and canonical. Token purchases, arbitrary transfers, cancelled allocations and unfunded epochs do not qualify.

100 eligible testnet PERL → 7 mainnet PERL, within a 70M reserve. The shared global claim allowance is 1M mainnet PERL per UTC day. You can claim part of the remaining allocation, then return when daily capacity is available. Already-claimed entitlement cannot be claimed again. This is reward migration, not a general-purpose bridge. Users need mainnet ETH for their own claim transaction.

## Operator

Run the handoff `launch.sh` on the VPS. It prepares compatible source, checks actual GitHub CI/public worker files, accepts public token/owner/treasury/cutoff inputs locally, validates the dedicated signer and funds 1M PERL initially (650k mining + 350k migration), with 130M/70M lifetime caps. It preserves the separate API service and its ledger. The normal unsigned plan expires after 15 minutes; signed transaction plans and raw bytes are preserved for recovery.

`perla-mainnet-admin finish --execute` resumes activation and migration; `perla-mainnet-admin doctor` checks the configured contracts and authenticated verifier. If no eligible funded testnet allocation exists, no migration root is invented. If an earned testnet epoch still needs funding, settle it with the retained testnet service, then rerun finish. A software build is not a successful physical GPU or earned mainnet payout test.

## Incremental reserve funding

Initial funding is exactly 1M PERL total: 650,000 mining and 350,000 migration. The 130M mining and 70M migration figures remain lifetime caps, not up-front wallet-balance requirements. Mining checks both onchain published allocations and already-earned unpublished rounds before issuing new work; it waits for a top-up if a complete next round is not backed. The reward amount and calendar schedule are unchanged, and unfunded days are not backfilled.

To add actual PERL later, explicitly run:

```bash
perla-mainnet-admin fund --pool mining --amount 100000 --request-id mining-topup-001 --execute
# Or select --pool migration for its separate reserve.
```

This approves only the selected amount and calls the vault's capped fund method. Reuse the same request ID after interruption; the same ID cannot spend again or identify a different amount/pool. No automatic refill or recurring token spend is configured.

A migration snapshot is published only when its full entitlement is covered by its separate reserve. If it requires more than the initial 350k, the snapshot is retained and claims remain closed, while mining continues. Add the actual missing migration funds, then rerun `perla-mainnet-admin finish --execute`. A pending entitlement is not a currently claimable token balance.
