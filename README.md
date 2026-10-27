# Perla Compute

GPU mining infrastructure for verifiable compute on Robinhood Chain. Perla connects native proof verification, a wallet-bound contribution ledger, and funded onchain reward epochs.

[Website](https://perlacompute.xyz) · [Docs](https://perlacompute.xyz/docs) · [Whitepaper](https://perlacompute.xyz/whitepaper) · [Project status](https://perlacompute.xyz/status)

## Current state

This repository contains the **0.5.0 testnet source**. Mainnet remains on hold.

| Component | State and scope |
| --- | --- |
| Network | Robinhood Testnet, chain ID 46630 |
| Testnet token | PERL, fixed 1,000,000,000 supply, 18 decimals |
| Contracts | New PERL token and matching distributor reported deployed on 27 October 2026 |
| Website integration | Prepared connector available; completion requires the VPS connection report |
| Mining admission | Paused at the latest supplied operator checkpoint |
| Physical GPU validation | Still requires real hardware self-tests and accepted coordinator receipts |
| Public reward activation | No completed funded mining epoch or live claim reported in this release record |
| Mainnet | No mainnet token deployment, mining activation or testnet conversion rule |

The PERL token is `0xfeAB80c7665973D91F3f3FAB36CBB3183C8dC4F8`; its distributor is `0xa35C0Cb08279998c2948Ac340ef056d07bDC5547`. See [the dated deployment record](deployments/robinhood-testnet.json) and [PERL integration notes](docs/PERL-TESTNET.md). The earlier tPERLA contracts remain separate historical deployments.

These are source and dated operator records. Check the live status page and current operator evidence before treating a feature as available. Passing a software test does not establish physical GPU performance or a completed public-chain mining reward.

## How it works

1. A wallet signs in and creates a scoped, revocable worker credential.
2. The coordinator assigns a short-lived challenge bound to the worker, recipient and network.
3. A worker submits its native proof. Accepted work receives a contribution record; duplicate credit is rejected.
4. After a UTC epoch closes, the operator publishes a deterministic allocation, funds its Merkle root with existing tokens, and separately activates the matching epoch.
5. A valid claim pays the recipient committed in that funded allocation.

Perla uses Robinhood for settlement. Proof submission does not mint new ERC-20 tokens. The reward contract enforces its funded allocation; the operator controls native verification, the offchain ledger and root publication. Read [the architecture and trust model](ARCHITECTURE.md).

## Software included

- Wallet authentication, worker credentials and persistent SQLite accounting.
- Native certificate verification through the pinned Pearl Rust/PyO3 binding.
- Proof Explorer, Reward Center, installation wizard and token treasury reads.
- Deterministic reward allocation, funding checks and claim tracking.
- Work policies, worker diagnostics, encrypted backups and restore drills.
- Separate RTX matrix-mining and Hopper vLLM worker paths.

The RTX validation worker targets Linux NVIDIA RTX 30 (`sm86`), RTX 40 (`sm89`) and RTX 50 (`sm120`). Compilation targets are not hardware certification. Its standalone INT8 matrix work does not require an AI model checkpoint. The separate H100/H200 (`sm90`) vLLM adapter serves models, subject to its configuration and memory needs. See [the RTX guide](services/rtx-worker/README.md) and [validation scope](docs/validation-0.4.0-rc1.md).

## Run locally

Use Node.js **24.13 or newer within the Node 24 release line**, npm, Python 3 and GNU tar.

```bash
npm ci
cp .env.example .env
npm run dev
```

Open `http://127.0.0.1:3000`. The paused application can be browsed without a wallet private key or an inference provider. Configure production secrets locally, using the blank environment example.

## Validation

```bash
npm run check
npm run package:mining
npm run build
npm run typecheck
node scripts/checks/vps-http.test.mjs
```

Software checks use isolated SQLite databases and a local EVM. They do not broadcast public-chain transactions. Native integration tests require the pinned upstream binding and the `PERLA_NATIVE_PYTHON` / `PERLA_PEARL_SOURCE` configuration described in [ARCHITECTURE.md](ARCHITECTURE.md).

GitHub Actions source is included for software checks, RTX compilation/CPU protocol checks and draft release artifacts. A successful GitHub run can be claimed only after the workflow executes on the actual repository. The workflows contain no wallet key, public-chain deployment, epoch funding or VPS deployment step.

## Operate an existing installation

- [VPS deployment](DEPLOY-VPS.md): Docker, storage, Nginx and HTTPS.
- [Testnet operations](docs/TESTNET-OPERATIONS.md): work policy, accounting and backups.
- [Current PERL deployment](docs/PERL-TESTNET.md): active contract pair and migration checks.
- [Setup tools](docs/setup-tools.md): current tooling and the retired legacy tPERLA installer.
- [Portal APIs](docs/portal-api.md): accepted-work and reward read endpoints.

The source archive is not an in-place VPS updater. Preserve the runtime environment, database volume, worker credentials, verifier configuration and deployment journals when upgrading. Admission, actual GPU validation, epoch funding and claims are separate operational steps.

## Repository map

| Path | Purpose |
| --- | --- |
| `app/`, `components/` | Website, documentation and dashboards |
| `lib/perla/` | Coordinator, proof envelopes, work policy and reward accounting |
| `lib/vps/`, `drizzle/` | SQLite runtime and migrations |
| `services/` | GPU workers, native verifier and upstream integration |
| `contracts/`, `deployments/` | Contract source and dated public deployment records |
| `scripts/`, `tools/` | Packaging, checks and operator utilities |

## Contribute and report issues

Read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [CHANGELOG.md](CHANGELOG.md) and [ROADMAP.md](ROADMAP.md). Use a reproducible, sanitized report for bugs. Security reporting should use a private channel when the repository owner has enabled one; no external audit or bounty is claimed.

## Attribution and license

Perla is an independent integration with the pinned [Pearl Research Labs source](https://github.com/pearl-research-labs/pearl/tree/82e6eee7076aafe10123e08db78f100d270c0582). See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and [the adapter notice](services/pearl-adapter/NOTICE.md). No endorsement by Pearl or Robinhood is implied.

Perla-authored material uses the [MIT License](LICENSE). Third-party components retain their own licenses. Mathematical proof acceptance does not attest GPU ownership, customer demand or the correctness of an entire AI answer.

Maintainers preparing the first repository can follow [the GitHub publication guide](docs/publishing.md).
