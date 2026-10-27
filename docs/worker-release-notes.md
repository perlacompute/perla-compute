Perla Worker 0.5.0 adds a verified GitHub installer and a local lifecycle command for the existing worker sources.

- Linux x86-64 packages: RTX 30/40/50 matrix worker and the separate H100/H200 vLLM adapter.
- Explicit version selection, checksum verification, bounded archive extraction and isolated version directories.
- Private dashboard worker configuration, diagnostics, build, controlled start, status, logs, stop and explicit updates.
- Full tutorial: https://perlacompute.xyz/platform/setup

This is a validation preview. The installer and release pipeline do not attest hardware, activate mining, fund rewards or establish an AI inference service. Physical GPU runs and supervised proof-to-receipt validation remain deployment checks. The standalone GPU self-test is for RTX; Hopper uses its documented model/inference procedure.

The kernel, proof format and pinned Pearl source remain unchanged: 82e6eee7076aafe10123e08db78f100d270c0582. Upstream and third-party license notices are retained in both worker packages.
