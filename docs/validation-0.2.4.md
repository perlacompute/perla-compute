# Source preparation validation — 0.2.4

Checked on 25 October 2026 before the initial GitHub publication.

| Check | Result |
| --- | --- |
| Production Next.js build | Passed |
| TypeScript | Passed |
| SQLite persistence and migration checks | 6 passed |
| Reward checks on a local EVM | 13 passed |
| Emission curve and CLI checks | 5 passed |
| Inference-boundary checks with simulated upstream responses | 12 passed |
| Production HTTP, wallet sign-in and restart checks | 7 passed |
| Source audit for disallowed files and recognized credential patterns | Passed |
| Deliberately staged environment-file rejection | Passed |
| Checked-in setup-tool checksums | Both passed |
| Existing deployed contract sources | Byte-for-byte unchanged from 0.2.3 |

The 43 behavioral checks above do not send transactions to a public chain. Dependencies from the existing locked development installation were reused locally. A clean `npm ci` and the included GitHub Actions workflow still need to run in GitHub after publication.

Native verifier and GPU integration were not rebuilt by this source preparation. The successful native-verifier VPS report from 24 October is separately described in the README. Real GPU inference-to-share validation and a funded public-testnet claim remain pending.

The publication guard checks specific file paths and credential patterns; it is not a comprehensive secret scanner or an independent security audit. The exported archive contains reviewed source and generated worker/operator downloads, with no prior Git history or runtime environment files.

This source preparation does not upgrade the live VPS, activate mining, fund a reward epoch, or rename the existing onchain tPERLA token.
