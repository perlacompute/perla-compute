# Perla worker installer

The complete participant tutorial stays on the website: **https://perlacompute.xyz/platform/setup**. Requirements and validation scope: https://perlacompute.xyz/docs.

GitHub Releases distributes the versioned installer, source worker packages and SHA-256 checksums. The first release is `worker-v0.5.0`, a validation preview. The release does not establish physical GPU validation or enable public admission.

After that release is published in a public repository:

```bash
curl --fail --show-error --location --proto '=https' --proto-redir '=https' \
  https://github.com/perlacompute/perla-compute/releases/download/worker-v0.5.0/install.sh \
  -o install-perla.sh
bash install-perla.sh --profile rtx
```

Use `--profile hopper` for the separate H100/H200 vLLM adapter. This installer requires Linux x86-64, Python 3 and curl. GPU operations require Docker Buildx, NVIDIA Container Toolkit and the profile's supported hardware/driver. The installer does not install or modify GPU drivers, run a model or start mining.

The default command is `$HOME/.local/bin/perla`. If that directory is absent from PATH, invoke the printed absolute command path or add it to your shell PATH. Use `--root` and `--bin-dir` to select separate installation locations; existing unrelated commands are preserved.

The command supports `doctor`, `build`, `configure --file /path/to/worker.env`, `selftest`, `start`, `status`, `logs`, `stop`, `version`, and `update --release worker-vX.Y.Z`. The standalone `selftest` applies to RTX. The Hopper model/inference validation procedure remains in the website documentation; Hopper `start` requires an explicit `--model`.

Download `worker.env` from your signed-in dashboard. It contains only your coordinator origin and a revocable worker token. Wallet private keys and recovery phrases do not belong in worker configuration.

RTX `start` defaults to one accepted share for controlled validation. The worker checks the GPU before requesting work. A paused coordinator or a failed check may stop it without accepted work. `start` reporting a container ID is not proof of a successful share; inspect its status, logs and the website receipt. Containers do not automatically restart after an uncertain submission or failed run.

Updates require an explicit release tag and a stopped worker. Credentials remain in a separate private file. The current and previous version metadata are retained. A published release's existing assets are verified and never overwritten by the release helper.

Public installation requires a public release repository. Publication tooling retains the repository's current visibility; it never makes the application repository public automatically.
