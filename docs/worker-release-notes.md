# Worker 0.9.1 — fresh testnet and complete reward operations

- Explicit `--new-worker` creates a new connection after the owner-authorized network reset, retaining the verified CUDA build.
- Existing Worker IDs can still reconnect after registration in the new generation.
- Continuous mining remains the default; `--shares 1` is a bounded diagnostic only.
- Installation selects native CUDA when Docker is unavailable; validation reports upload automatically.
- The website now shows fresh GPU-to-reward readiness and automatic testnet settlement. No wallet private key is needed on a GPU host.
- RTX 30/40/50 CUDA targets remain included. Physical validation is per observed device; no new GPU benchmark is claimed by publishing this release.

Guide: https://perlacompute.xyz/platform/setup
Status: https://perlacompute.xyz/status
