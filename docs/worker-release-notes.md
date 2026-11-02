# Round rewards update

Worker-v0.9.0 is required for round work. See [the complete round rules](https://github.com/perlacompute/perla-compute/blob/main/docs/REWARD-ROUNDS.md). Shares alone unlock no tokens; UTC budgets are caps. Earlier daily full-budget examples below are historical and superseded.

# Perla Worker 0.9.0

- Mining continues after accepted shares by default. `--shares 0` means continuous; `--shares 1` remains an explicit single-share test.
- Session logs identify continuous/bounded mode, task assignment and a normal share-limit stop. Receiving a task is not earning a token reward.
- Website setup commands no longer insert the single-share test limit. Native Ctrl+C and Docker `perla stop` are documented separately.
- A previously verified native build can reuse its pinned proof bindings and CUDA binary when only the reviewed Python mining loop changes. Source and binary hash checks remain required.
- Existing wallet credentials, permanent Worker IDs and accepted history remain intact. No reward policy, funding transaction, mainnet or migration setting is changed by this release.

Update an existing GPU installation:

```bash
"$HOME/.local/bin/perla" update --release worker-v0.9.0
"$HOME/.local/bin/perla" start --device 0
```

For a bounded validation run, append `--shares 1`. Stop a running worker before updating. A fresh GPU self-test remains mandatory before online work. No physical GPU validation is claimed by these software tests.
