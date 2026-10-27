# Perla VPS 0.2.1 — verification

Base source commit: 62053af00ad06d90b836ca7dca61b2aa04d816d3.
VPS export adds Next.js/Node runtime, SQLite persistence and deployment files.

Passed on Node.js 24.19.0 / Linux x86-64:

- Production Next.js 16.3.4 webpack build, including TypeScript checking.
- 25 native Pearl proof/coordinator/TCP-bridge integration checks using the VPS
  SQLite adapter and the actual pinned Rust/PyO3 verifier.
- 6 SQLite checks: migration idempotency, unique credits, transaction rollback,
  close/reopen persistence, WAL-aware consistent backup, migration integrity.
- 7 production HTTP checks: rendered routes and assets, SQLite status, origin
  rejection, signed wallet registration, secret hiding/paused admission, full
  process restart persistence, HTTPS canonical domain and Secure cookies.
- 12 protected inference API boundary checks.
- 10 funded reward contract checks on a local EVM with chain ID 46630.
- Bash syntax check for deploy-vps.sh.
- Compose YAML parsed; persistent volume and loopback-only port checked.

Total: 60 behavioral checks passed, plus production build and config checks.

Not executed: Docker image builds, Docker Compose on a deployment host,
NVIDIA CUDA/GPU inference, public-chain contract deployment or funding.
The native test uses CPU-generated proof fixtures; it is not GPU evidence.
Work admission stays false by default. No wallet/private production credentials
or user database is bundled. Set PERLA_PUBLIC_ORIGIN before HTTPS wallet use.

Reproduce the HTTP check after npm run build:

    node scripts/checks/vps-http.test.mjs

See DEPLOY-VPS.md for native verifier/GPU and reward activation requirements.
