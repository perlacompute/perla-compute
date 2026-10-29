# Perla Worker 0.8.0

- Create a new worker with a public reward wallet and display name. The CLI prints its permanent Worker ID.
- Reuse that ID on a different machine with `perla start --worker-id YOUR_WORKER_ID --device 0`.
- Sign in with the owner wallet on the approval website, compare the code, and authorize replacement access. No wallet key or file transfer is required on the GPU host.
- A completed move retains ID, name, reward wallet and accepted history, replaces the old credential, expires unfinished old jobs, and repeats GPU validation on the new machine.
- Lost responses resume using a privately saved pending credential; an ID alone grants no access.
- Existing worker 0.7.0 credentials remain usable until revoked or replaced. This release does not change native proof mathematics, the mining policy, reward budgets or mainnet status. The GPU/proof core remains version 0.5.0.
- The default validation command stops after one accepted share. `--shares N` chooses a bounded larger test. It does not add a continuous unattended mining mode.

Installer/session/release tests, signed wallet + SQLite reconnect scenarios, production build and browser checks cover the stated software behavior. This release does not claim a new physical GPU validation or independent security audit. Reconnection itself creates no contribution points or token rewards.
