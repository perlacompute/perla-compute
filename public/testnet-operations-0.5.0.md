> Historical 0.5.0 release document. For the later PERL testnet deployment, read [PERL testnet](./perl-testnet.md).

# Perla 0.5.0 testnet operations

Mainnet is on hold. This release supports Robinhood Testnet 46630 only. No migration of tPERLA to a mainnet token is promised. The deployed token still identifies as tPERLA; the planned branding ticker is PERL.

## Upgrade order

Use the cumulative `perla-testnet-0.5.0.zip` updater. It accepts known 0.3.0 and 0.4.0-rc.1 source bytes, stops on local conflicts before editing, backs up source, upgrades the dual-protocol verifier with admission paused, builds the web image, runs route checks and installs health/backup timers. It never enables work or funds rewards. A web rollback retains the backward-compatible dual-protocol verifier; the verifier installer has its own rollback if its health or proof checks fail.

The database migration is additive. Historical v3 jobs retain target 0x207fffff, one point and their original protocol label. Historical shares, funded roots and contracts are not rewritten. Backups include the database and deployment environment, so they are always encrypted. The restore drill reads a separate database in an isolated container and never replaces the live volume.

## Difficulty and contribution scoring

Current work protocol: `perla-pearl-plain-v4`; native certificate remains v3 and upstream remains pinned to `82e6eee7076aafe10123e08db78f100d270c0582`.

The policy definitions are `lib/perla/work-profiles.json`, also shipped in the RTX worker. Reference target: `0x1d00ffff`. Profiles p1/p2/p4/p8/p16 award 1/2/4/8/16 points per verified job. Each target is exactly referenceTarget / points. Native PoW scales by opened tile area and K. V4 admits dense rank-128 work, K 2048..32768, tile area at most 256; this keeps the native target below uint256 overflow. Client-reported speed, GPU name, uptime and attempted work earn no points.

Each job stores its protocol, bits, points, profile and policy hash at issuance. Changing a profile does not reprice an existing job. One job can be credited once. After the UTC epoch closes and outstanding jobs expire, rewards use the existing deterministic integer allocation and largest-remainder method. The operator still chooses budgets and publishes roots; this is an offchain coordinator, not a permissionless onchain proof verifier.

Fresh policy state is inactive, even if the environment master switch says true. Before any admission trial:

1. Build worker 0.5.0 on a real RTX 30/40/50 host. Run `bash perla doctor`, then `bash perla selftest --device 0 > gpu-validation.json`.
2. Review every passing case for K=2048/4096. This is an operator-supplied assertion, not hardware attestation or Sybil protection. Never publish worker.env.
3. Inspect current state using `node scripts/perla-control.mjs policy` with private `PERLA_ENDPOINT` and `PERLA_OPERATOR_TOKEN` exported locally.
4. Register the reviewed report with `node scripts/perla-control.mjs activate-policy p1 START_UTC_EPOCH gpu-validation.json`. Start at p1 and measure share arrival times on the actual host. If the current UTC epoch contains legacy shares, schedule the next epoch. Larger point profiles reduce expected share arrival frequency; do not claim calibrated hardware throughput until measured.
5. Enabling `PERLA_MINING_ENABLED=true` is a separate operator action followed by a controlled one-share GPU trial. This update performs neither action. Pause immediately if verifier pressure or unexpected rejection appears.

No universal hashrate, earnings, AI inference throughput or one-person-one-worker guarantee is made. Rate limits bound requests per worker/wallet and global auth load; they do not prevent identities from being created outside the service.

## Worker diagnostics

The downloadable RTX package includes `perla`, `doctor.py` and all source. `bash perla doctor` reports local NVIDIA, Docker, Buildx, image and authenticated coordinator access. It requests no work and submits no share. `gpuSelfTestPassed` stays unknown until the separate offline self-test. The doctor still requires an active registered worker configuration for its authenticated check, while admission may remain paused.

`bash perla mine --device 0 --shares 1` runs the GPU self-test before online work, retries non-winning matrix attempts and refreshes work approximately every 15 seconds. Expired attempts are discarded. Ambiguous share POSTs are not automatically retried; inspect the job in the ledger first. Rejected/stale/duplicate counters reflect requests observed by the coordinator; local non-winning attempts and local expiry discards are miner logs, not accepted work.

## Treasury and claims

`GET /api/mining/treasury` reads token supply, distributor balance, owner holdings and the remaining budget of published matching epochs at one canonical latest block. Owner holdings are uncommitted. The mapping can contain epochs outside this coordinator; the displayed liability sum explicitly covers only published records. RPC failure is unavailable, never zero. This testnet release reconciles up to 32 published epochs per request; extend/paginate that bound before exceeding it.

`node scripts/perla-audit.mjs epoch-N.json` reproduces allocation ordering, amounts, root and proofs offline. This validates the manifest, not the underlying GPU or chain funding. Download manifests from the epoch page. The existing fund command sends real testnet transactions only when explicitly invoked locally with the dedicated wallet; installation does not invoke it.

Record a known funding transaction with `node scripts/perla-control.mjs record-funding EPOCH TX_HASH`. The server verifies its canonical successful receipt, distributor, EpochFunded event, token, root and budget before recording the trace. The epoch page labels it as recorded, not irrevocably final. Re-run record-funding after a suspected reorg; inspect the explorer as well. Reward availability is read from current contracts independently of this trace.

The Reward Center tracks pending, included, finalized and reverted transactions. Inclusion is a sequencer/block receipt and can change before finalization. If `finalized` RPC tags are unavailable, the UI retains included status. Contract claim state is refreshed, and reorged/missing receipts return to pending. RPC failures never authorize a duplicate claim automatically.

## Health, backups and recovery

```bash
python3 scripts/perla-ops.py health --project /var/www/perla-vps
python3 scripts/perla-ops.py backup --project /var/www/perla-vps
python3 scripts/perla-ops.py restore-check --project /var/www/perla-vps --archive /var/backups/perla/ARCHIVE.tar.enc
systemctl list-timers 'perla-*'
journalctl -u perla-health.service -u perla-backup.service --since today
```

The installer runs an initial backup and isolated restore drill before enabling timers. Health runs every five minutes; backup and restore drill run daily at 03:15 UTC and retain 14 authenticated archive pairs. Failures are visible in systemd/journal. External notification and offsite destinations are not configured. Arrange an offsite copy of encrypted archives and a separate private copy of `/etc/perla/backup.key`; losing that key prevents restore. Never paste the key into chat or an issue.

Backups use consistent SQLite VACUUM INTO, AES-256-CBC with PBKDF2 (600,000 iterations, random salt), and an HMAC-SHA256 verified before decryption. A root-owned 600 key file is generated locally. The database and deployment environment are enclosed in one authenticated encrypted archive. A second container, network disabled and filesystem read-only, checks database integrity, foreign keys and ledger counts.

The restore-check command deliberately does not restore into production. For an actual recovery, pause admission, stop the web writer, preserve the current volume, decrypt privately, verify the archive and restore drill, restore into a fresh volume, then compare counts/epochs/contracts before switching the service. Keep the original volume until validation completes. Never restore an old reward database without reconciling funded roots and claims against the chain.

## GitHub and releases

GitHub account access is required to create/push the repository. No remote repository is assumed by this source. After connecting, select the actual account/repository, run the publication audit, and push a clean source-only tree. Keep data, environment files, backups, credentials and GPU reports private. Enable GitHub private vulnerability reporting and branch protection in that repository before advertising them.

CI checks software and CUDA compilation on CPU runners; it does not prove physical GPU compatibility. Actions are pinned to reviewed tag commits. A matching version tag triggers checks, a CycloneDX SBOM, checksummed artifacts, build provenance and a draft release. The workflow performs no chain operation or public mining activation. GitHub attestations require the repository/plan to support the feature; review workflow results before publishing a draft.
