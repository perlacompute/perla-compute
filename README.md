# Perla Compute

## Public testnet website

Start with [miner setup](https://perlacompute.xyz/platform/setup), follow [accepted proofs](https://perlacompute.xyz/explorer), and inspect [funded rewards](https://perlacompute.xyz/rewards). The current installer is worker-v0.9.1. See [the public-site release record](docs/releases/public-site-20261104.md) for the UI, service-status and discovery changes.

## Earned testnet reward evidence

The fresh testnet completed a qualifying GPU round, funded epoch 20760 and delivered its earned allocation to the reward wallet. See [the closeout record](docs/releases/rewards-live-20261104.md) for transactions, scope and reproducible read-only checks. Public epoch funding is automatic; miners claim funded allocations in Reward Center.

Verifiable GPU mining, qualifying reward rounds and funded PERL settlement on Robinhood Testnet.

[Website](https://perlacompute.xyz) · [Miner setup](https://perlacompute.xyz/platform/setup) · [Docs](https://perlacompute.xyz/docs) · [Network status](https://perlacompute.xyz/status) · [Worker releases](https://github.com/perlacompute/perla-compute/releases)

## GPU workers

Use the website to generate the complete pinned installer and start command. Worker **0.9.1** supports Linux RTX 30 / 40 / 50 compilation targets and a separate H100/H200 integration. Native CUDA runs without Docker when the GPU host is itself a container. Actual GPU validation applies only to the models observed on Network status.

```bash
curl --fail --show-error --location --proto '=https' --proto-redir '=https' \
  'https://github.com/perlacompute/perla-compute/releases/download/worker-v0.9.1/install.sh' -o install-perla.sh
bash install-perla.sh --profile rtx
"$HOME/.local/bin/perla" start --wallet YOUR_PUBLIC_0X_ADDRESS --worker rig01 --device 0
```

GPU numbering begins at zero. A single-GPU machine uses `--device 0`. Mining continues by default; `--shares 1` is only a single-share diagnostic. Credentials and GPU reports are provisioned automatically; there is no manual worker.env transfer and no wallet private key on the GPU host.

The CLI retains the permanent Worker ID for normal restarts. Move an existing new-generation worker with `perla start --worker-id YOUR_ID --device 0`, then approve the replacement in the owner wallet browser. After the authorized fresh-network reset, update to 0.9.1 and use `start --new-worker --wallet ADDRESS --worker NAME --device 0` once. This deliberately replaces the erased connection and retains the verified CUDA build. Deleted IDs cannot reconnect.

## Work and rewards

A normal accepted share measures exact difficulty-weighted work and unlocks no token by itself. A proof must also meet a harder round target. Each winning round unlocks floor(the UTC daily cap / 446), split across the latest weighted PPLNS window. At most 446 rounds can earn daily; unused capacity remains in treasury with no rollover. Initial difficulty and retarget settings are published; they are not measured GPU earning rates.

Earned daily allocations settle after UTC close plus five minutes. The owner-authorized testnet service prepares, verifies, funds and activates exact manifests automatically. Its dedicated signer is encrypted as a systemd credential on the website VPS. Funding and claim state are checked against canonical testnet contract reads; unavailable RPC data is never treated as a payment.

The operator-only validation phase performs an isolated 1 PERL contract round trip, then a real GPU-to-earned-claim lifecycle. The isolated transaction creates no mining income or migration entitlement. Public mining opens automatically only after the fresh checks at `/status` pass.

## Network and contracts

- Robinhood Testnet: **46630**.
- Fixed testnet supply: **1,000,000,000 PERL**, 18 decimals.
- Token: `0xfeAB80c7665973D91F3f3FAB36CBB3183C8dC4F8`.
- Reward distributor: `0xa35C0Cb08279998c2948Ac340ef056d07bDC5547`.
- Mainnet and bridge remain closed. The published mainnet plan reserves 70M for eligible testnet migration and 130M for future mining; 800M remains unassigned. A transferred testnet token balance alone does not establish migration eligibility.

RTX currently performs standalone matrix mining and native proof production. It does not serve paid customer AI inference. The separate Hopper model-serving integration has a different execution path. The coordinator and native verifier remain operator-run offchain services; the distributor enforces funded immutable Merkle roots. There is no new Perla chain or EVM-native proof verifier in this release.

## Operator runbook

See [TESTNET-OPERATIONS.md](docs/TESTNET-OPERATIONS.md), [REWARD-ROUNDS.md](docs/REWARD-ROUNDS.md) and [portal-api.md](docs/portal-api.md).

```bash
cd /var/www/perla-vps
bash scripts/perla-rewards.sh health
systemctl status perla-rewards-auto.timer perla-rewards-auto.service
```

The one-time fresh-testnet installer takes a private offline backup, removes the owner-authorized old mining dataset and starts a new emission epoch with the existing contracts. Rerunning that installer never wipes new history. On a future VPS, configure the encrypted signer again; its ciphertext alone is tied to the original host.

## Development and validation

Node.js 24 and npm are required. The app uses Next.js, TypeScript and SQLite.

```bash
npm ci
npm run build
npm run check:fresh-testnet
npm run check:round-rewards
npm run check:reward-settlement
python3 -m unittest discover -s tests/worker_installer
```

SQLite and local EVM checks cover one-time reset, rollback, round accounting, funding, actual contract claims, replay rejection, interrupted transaction recovery and readiness. GPU, verifier and GitHub doubles are identified by each test. A production build or local EVM pass does not establish a physical GPU benchmark, public-chain test result or independent external audit.

## License and provenance

Perla application code is MIT licensed. Retain the upstream notices included with the native matrix/proof integrations; see the relevant `NOTICE.md` files. Internal wire identifiers and upstream source references are retained for compatibility and provenance.
