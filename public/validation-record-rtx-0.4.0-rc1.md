# Perla 0.4.0-rc.1 — RTX validation preview evidence

Recorded 26 October 2026. This source release implements an experimental worker
for RTX30/sm86, RTX40/sm89 and RTX50/sm120. Physical-device validation has not
been performed in the implementation environment, which has no NVIDIA GPU or
Docker daemon. This file distinguishes software evidence from that missing gate.

## Confirmed compilation

- CUDA compiler **13.1.115**, runtime developer library **13.1.80**.
- The actual `rtx.cu` source compiled and linked as a native shared library with
  `-gencode` for **sm86, sm89 and sm120**, using static CUDA runtime linkage.
- `cuobjdump --list-elf` reported native images for all three targets.
- Generated sm120 PTX contains signed INT8 `wmma.mma.sync` instructions and
  targets `sm_120`; it does not call the Hopper-only WGMMA/TMA implementation.
- On the CPU-only host, the real compiled library refuses initialization with
  a CUDA driver-unavailable error. No CPU fallback or coordinator submission runs.
- The CUDA 13.1.1 Ubuntu24.04 image tag and immutable index digest were resolved
  from NVIDIA's container registry. Full Docker image assembly/runtime execution
  still needs validation on a Docker host. Direct compiler success is not that
  full image-build test.

CUDA redist developer archives were SHA256-verified against NVIDIA's redistrib
manifest. Toolchains, native wheels, temporary binaries and research clones are
not included in release source or public downloads. The supplied worker image
builds its GPU binary and exact native proof binding from source.

## Confirmed native/software checks

The native Python binding was built **with its locked dependencies** from
Pearl commit `82e6eee7076aafe10123e08db78f100d270c0582`, using Rust1.99.1 and
maturin1.13.0. `test_protocol.py` passed **19 software/native checks**, including:

- Output-pattern partitioning covers every one of 16,384 GEMM outputs once.
- Sparse noise construction equals an independent dense integer construction.
- Native V3 proof construction at multiple nonzero opened offsets.
- A non-saturating offline target accepts the independently predicted winning
  proof and rejects a non-winning proof at K2048 and K4096. This binds V3 salted
  seeds, noise and transcript hashing to the native mathematical verifier.
- A changed challenge fails native verification.
- K4096 exercises transcript rotation after the first sixteen rank128 chunks.
- Wrong chain/protocol/certificate/target/header/expiry fails validation.
- GPU unavailability or a failing self-test causes zero coordinator calls.
- Corrupted selected transcripts fail before a proof can be submitted.
- A worker-flow harness submits a real native proof and uses the returned
  receipt, while explicitly substituting a CPU test oracle for CUDA.
- Paused admission, expiry during computation and ambiguous POST outcomes fail
  without a submission or blind retry as applicable.
- Offline self-tests have no coordinator access, ledger credit or AI inference.

The injected oracle is test-only. Those tests **do not establish GPU execution,
physical hardware support, server-admitted GPU receipts or mining performance**.
The production CLI exposes no CPU backend option and never trusts an editable
saved report instead of executing its startup CUDA gate.

## Web/ledger regression scope

The existing local suites passed: 6 SQLite persistence, 13 local-EVM reward,
5 emission, 12 inference-boundary and 25 portal checks (**61 total**), plus
9 production HTTP checks, including RTX download integrity. Production build and TypeScript checks passed.
Contracts and database migrations remain unchanged. No public-chain transaction,
public coordinator write or mainnet operation was performed for this release.

Browser QA checked setup, docs, whitepaper, participant guide and home at
1280, 768, 390 and 320 pixel iframe widths (20 observations), with no root
horizontal overflow. RTX/Hopper selection was exercised and the mobile setup
was visually inspected. The QA harness and SQLite data are isolated from release
source and are not included in the patch. Wallet/ledger behavior was covered
by the production HTTP tests, not a live wallet extension in browser QA.

The updater passed six source/preflight checks (apply with private-state
preservation, idempotence, rollback, conflict refusal, symlink refusal and version
refusal) and five Docker-simulated control-flow cases (success, failed build,
failed switch, unhealthy container and failed route probes). No actual VPS update
or real Docker rollback was performed during implementation.

The new source-level RTX CI job builds the downloadable image and runs its
native/software tests on a CPU runner. This workflow has been authored; a real
GitHub-hosted execution has not been observed. CPU CI cannot establish a GPU pass.

## Remaining required evidence

For at least one actual device in **each** of RTX30, RTX40 and RTX50:

1. Docker image build, GPU passthrough and compatible driver.
2. Offline `selftest` exit0 with actual device metadata, exact full GPU GEMM and
   transcripts, signed extrema, native positive/negative PoW and changed-header
   rejection at both supported K values.
3. One genuine GPU-computed proof accepted by the deployed native verifier and
   coordinator, with exactly one receipt and the correct recipient wallet.
4. Duplicate/expired/revoked/tampered submissions and verifier failure reject
   without additional ledger credit.
5. A supervised sustained run, memory/error inspection, stop/restart and
   separate-device selection checks.
6. A closed epoch, reviewed allocation, funded testnet root, successful claim
   and rejected replay.

Do not extrapolate a 4090 pass to other families or every model. No throughput,
energy-saving, income or useful-customer-AI claim is supported by this record.

## Important existing difficulty and workload limits

The fixed validation nbits `0x207fffff` saturates when native consensus scales
by `tile_size * dot_product_length`. The worker explicitly matches that native
rule. This is correctness testing; competitive work difficulty, reward fairness,
abuse resistance and mainnet emissions need a separately reviewed policy before
public mining. This patch does not change server difficulty or reward rules.

The RTX workload is standalone synthetic dense matrix mining. It is not a model
server, proof of paying AI demand or hardware attestation. The existing separate
Hopper vLLM adapter is the inference path; its original GPU gate remains pending.
Mining admission and reward funding are preserved, not automatically enabled.
