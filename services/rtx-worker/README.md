## Worker 0.5.0

Use `bash perla doctor`, `bash perla selftest --device 0`, then `bash perla mine --device 0 --shares 1` after operator admission. Protocol v4 uses non-saturating server targets and immutable job scores; old v3 workers require this upgrade. A non-winning attempt continues until work expires or a proof is found.

# Perla RTX worker 0.5.0

Experimental standalone matrix miner for Linux NVIDIA RTX 30, 40 and 50 series.
The build contains native CUDA targets **sm86, sm89 and sm120**, including the
RTX 50-series target from the start. Physical GPU validation remains required.

| Family | CUDA target | Release state |
| --- | --- | --- |
| RTX 30 series | sm86 / 8.6 | Implemented; physical GPU test pending |
| RTX 40 series | sm89 / 8.9 | Implemented; physical GPU test pending |
| RTX 50 series | sm120 / 12.0 | Implemented; physical GPU test pending |

This is a dense INT8 Tensor Core matrix-mining workload with fixed 128x128
outputs, rank128, K2048 (or K4096), and certificate-v3 PlainProofs. It does not
need a model checkpoint or serve AI inference. The separate H100/H200 vLLM
adapter remains the model-serving path. Matrix mining alone is not evidence
that a customer's AI computation was performed. This preview is for testnet
validation; it is not a performance or profitability release.

## Prerequisites

- Linux x86-64, Docker Buildx, NVIDIA Container Toolkit, a driver compatible
  with CUDA 13.1, and an actual sm86/sm89/sm120 NVIDIA device.
- A wallet-authorized Perla worker registration and private `worker.env` for
  the online stage only. Never add a wallet key or seed phrase.
- The complete `perla-rtx-worker.tar.gz` download and its `SHA256SUMS`.
- The operator's native verifier and mining admission for online testing.
  The offline self-test does not require a coordinator, wallet or token.

Install this on a GPU host. The CPU-only website/verifier VPS cannot run it.
Building an image on a CPU host does not provide a GPU.

## 1. Verify and build

Put the archive and checksum list in the same folder:

```bash
sha256sum --ignore-missing -c SHA256SUMS
tar -xzf perla-rtx-worker.tar.gz
cd perla-rtx-worker
bash setup-worker.sh
```

The first build downloads CUDA tooling and compiles native Rust bindings from
the exact commit above. It can take several minutes. The image runs as a
non-root user. `.dockerignore` excludes worker credentials from build context.
No kernel or GPU clock, power, voltage or fan setting is changed.

## 2. Validate the actual GPU without admission

```bash
nvidia-smi --query-gpu=index,name,memory.total,compute_cap,driver_version --format=csv
docker run --rm --gpus all perla-rtx-worker:0.5.0 selftest --device 0 > gpu-validation.json
```

An exit code of 0 and `gpuSelfTestPassed: true` are required. The report includes
actual device/driver information, K2048 and K4096 cases, every GEMM output and
transcript compared with an independent CPU oracle, signed extrema, a native
V3 accepted proof, an independently rejected PoW, and changed-challenge rejection.
The K4096 case exercises transcript rotation beyond 16 reductions. No network
is contacted and no ledger points or rewards are created by this command.

A failed or interrupted self-test is a failure; an empty report is not success.
Never replace the CUDA backend with the CPU oracle to get a passing report.
Repeat on at least one physical GPU of **each** target family. One 4090 pass
cannot validate a 3090, 5090, all other models, or a multi-GPU rig.

For another visible GPU, change `--device 0` to its index. The worker uses one
selected GPU; each concurrent installation needs a separate worker registration.

## 3. One accepted testnet contribution

After offline validation, save the registered worker's downloaded config here:

```bash
chmod 600 worker.env
docker run --rm --gpus all --env-file worker.env \
  perla-rtx-worker:0.5.0 run --device 0 --shares 1
```

The worker repeats a GPU correctness test before contacting the coordinator.
It validates chain46630, protocol/certificate/target/challenge/expiry, computes
on the selected GPU, recomputes the opened tile independently, locally checks
its native proof, and submits at most one proof for each job. A successful
coordinator receipt is printed as `accepted_share` with an Explorer URL.

Paused admission exits with an explanation. A build or offline self-test never
enables admission or funds a reward. An accepted point is not a token payment.
If an HTTP submission outcome is unknown, the worker stops instead of blindly
retrying it. Check the account ledger before restarting.

For a supervised run after the first receipt is reviewed:

```bash
docker run --rm --gpus all --env-file worker.env \
  perla-rtx-worker:0.5.0 run --device 0 --shares 100 --interval 10
```

The interval is at least 5 seconds. This is a controlled validation profile,
not a competitive high-throughput miner. Press Ctrl+C to stop; already accepted
records remain in the server ledger. A fresh process runs the correctness gate
again. It never falls back to CPU mining.

## Validation gates before public release

1. Image build and offline self-test on one actual RTX30, RTX40 and RTX50 GPU.
2. Native verifier accepts a genuine GPU-originated proof from each family;
   the real coordinator records the receipt exactly once for its wallet.
3. Wrong challenge, expired job, revoked worker and duplicate proof fail;
   verifier outage creates no new credit.
4. Supervised sustained run, GPU memory/error inspection and clean stop/restart.
5. Closed test epoch, reproducible allocation, funded contract, one successful
   wallet claim and a rejected replay. No mainnet conversion is implied.

Do not advertise a model as tested until its hardware report and receipt have
been reviewed. Software tests with an injected CPU oracle remain software tests.

## Current work policy

V4 uses the server profiles in `work-profiles.json`, reference nbits `0x1d00ffff`,
and exact target-ratio points p1/p2/p4/p8/p16. Targets do not saturate native PoW.
The legacy v3 target `0x207fffff` is rejected by this worker. Each job retains
its own bits, profile and points; the client cannot select a cheaper target.
A non-winning matrix attempt continues, and expired work is discarded. The
operator must measure real GPU share arrival times before public admission.
This release makes no hashrate or earnings claim.

## Source and tests

`protocol.py` constructs native V3 proofs; `rtx.cu` performs full INT8 WMMA GEMM
and partial-sum transcript folding; `cuda_backend.py` rejects unavailable or
unsupported devices; `reference.py` is an independent CPU test oracle;
`miner.py` enforces the GPU gate and worker flow. `test_protocol.py` tests the
software/native paths with an explicitly injected CPU oracle and cannot claim
hardware validation. The same scoped HTTPS client is reused from Perla's
existing bridge; it does not forward credentials through redirects.

See `NOTICE.md` and the included Perla MIT license for attribution.
