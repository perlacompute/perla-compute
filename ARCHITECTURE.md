# Perla Compute architecture

Perla runs a Next.js portal and SQLite contribution ledger, an authenticated native proof verifier, and an owner-authorized reward settlement service. GPU workers connect to the coordinator; funded PERL allocations settle on Robinhood Testnet, chain 46630.

## Worker identity

A worker starts with a public reward address and display name. The coordinator issues a permanent Worker ID and a private, revocable machine credential. Dashboard management and claims use wallet authorization. Moving a worker to another host requires owner approval and replaces the prior machine credential while retaining accepted history and the reward address.

GPU checks precede online work. Normal starts reuse the saved identity and mine continuously; `--shares 1` selects a bounded diagnostic run. Native workers run in the foreground. The public CLI remains worker-v0.9.1.

## Work verification and reward rounds

Jobs bind the worker, recipient, chain, UTC epoch, round and policy. The verifier checks the native certificate and its exact challenge. Difficulty-weighted shares record work; receiving a task or an ordinary accepted share creates no token entitlement by itself.

A proof must also meet the harder round target. A winning round atomically records its winner and the weighted PPLNS recipient window. Integer rewards use deterministic largest-remainder allocation. Each UTC epoch has a declining daily ceiling and at most 446 earning rounds; unused capacity stays in treasury without rollover. See [the round rules](docs/REWARD-ROUNDS.md).

Duplicate, stale, invalid and revoked-worker submissions cannot create a second credit. Workers do not blindly retry an ambiguous proof submission. SQL transactions and immutable round snapshots preserve the allocation inputs.

## Funded settlement

After UTC close and the five-minute safety window, the configured settlement service prepares, checks, funds and activates earned allocations. Its testnet signer is encrypted as a host-bound systemd credential. Public miners claim funded allocations in Reward Center with their reward wallet.

The distributor enforces the funded Merkle root and prevents duplicate claims. Treasury and claim reads check canonical testnet state; an unavailable RPC response is not treated as a payment. The initial validation-wallet claim relay is separate from the public user claim flow. The observed epoch 20760 funding and earned claim are documented in [the reward record](docs/releases/rewards-live-20261104.md).

## GPU paths

The RTX worker contains sm86, sm89 and sm120 compilation targets for RTX 30/40/50 series. It performs standalone matrix mining and native proof production. The recorded physical test was an RTX 4090; each host must pass its own GPU checks. This path does not serve paid customer AI inference.

H100/H200 use a separate model-serving integration with its own hardware and model requirements. The pinned native proof source and component attribution are documented in [upstream provenance](docs/UPSTREAM.md). Wire identifiers remain stable for compatibility.

## Operations and trust

Persistent SQLite volumes, consistent backups, revocable credentials and bounded verifier concurrency support operation and recovery. Readiness distinguishes configuration from observed GPU work, funded allocations and an earned claim. The operator still controls offchain verification, retained contribution records and allocation publication; the reward contract does not execute the complete computation proof.

CI checks software behavior, production HTTP routes, CUDA compilation and CPU/native protocol integration. Hosted CPU checks are not physical GPU validation. Mainnet, token migration and the prepared background-worker release remain outside this change.

See [operations](docs/TESTNET-OPERATIONS.md), [security reporting](SECURITY.md), [worker installation](WORKER_INSTALLER.md) and [release notes](RELEASE_NOTES.md).
