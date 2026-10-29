# Perla worker installation and permanent identity

Guides remain at https://perlacompute.xyz/platform/setup and /docs. GitHub distributes the pinned worker-v0.8.1 installer and archives. The Linux installer verifies checksums before execution, uses a private installation root and does not automatically start mining. A wallet private key is never required on the GPU host.

## Create a worker

After installing, run:

```bash
"$HOME/.local/bin/perla" start --wallet YOUR_PUBLIC_0X_ADDRESS --worker rig01 --device 0 --shares 1
```

The connection creates and prints a permanent Worker ID. The reward wallet and name are saved locally. Starting later with no identity flags reuses the saved connection. The default is a one-share validation run, and `--shares N` chooses a bounded larger test.

## Move an existing worker

Copy its full ID from Compute & mining. On the new machine, run:

```bash
"$HOME/.local/bin/perla" start --worker-id YOUR_WORKER_ID --device 0 --shares 1
```

Open the URL printed in the GPU terminal, connect the worker owner wallet, compare the confirmation code and authorize the new machine. The existing wallet/name stay with the ID. A completed exchange disables the prior credential and expires unfinished old jobs, while preserving accepted work and reward records. The new GPU runs its own checks before requesting work. No worker.env file transfer is needed. A public Worker ID alone cannot authorize the move.

Rerun the same command after a terminal or connection interruption. Pending secrets are retained privately for idempotent recovery. Reuse an ID for a replacement machine; independently operating rigs need distinct IDs. A previously revoked worker can be restored through fresh owner approval.

## Runtime and compatibility

CLI commands include doctor, build, selftest, start, status, logs, stop, version and update. RTX uses Docker when its daemon is reachable, otherwise the supported native CUDA path. Hopper retains its separate model-serving path and explicit model options. Proof protocol and GPU core remain 0.5.0-compatible; the raw legacy protocol identifier is preserved for API compatibility. Product labels use Perla Matrix v4. Previous releases are immutable and are not overwritten by 0.8.1.
