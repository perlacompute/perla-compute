# Start Perla mainnet with 1M PERL and top up reserves as needed

Activation now deposits exactly **1M PERL total**, split into **650k mining and 350k earned testnet migration**. The 130M/70M lifetime allocation caps and the published mining/migration economics stay unchanged. The previous installer incorrectly required full lifetime funding at launch.

- Validate the owner against 1M, approve exactly 1M and fund the two initial amounts. Reject legacy 200M plans before signing; replace an unsigned saved plan safely.
- Add explicit, journaled reserve top-ups. Reusing a request ID cannot transfer twice or change its amount/pool. Refresh cached funding after confirmation.
- Include already-earned unpublished round liabilities in mining admission. Pause new work when a full next reward round lacks backing and resume after a top-up.
- Retain an eligible migration snapshot when its reserve is insufficient. Claims remain closed until the snapshot is fully backed; mining and the independent API continue.
- Preserve API keys, Playground, USDG payments, worker release assets and both lifetime reserve caps. No automatic refill or recurring token debit is introduced.

Validation: 79 Node mainnet checks (including a local EVM activation from an owner holding exactly 1M, exact reserve balances, top-up retries/caps and pending-round backpressure), 4 offline installer checks, 19 Compose checks, 6 public CLI boundary checks and the retained handoff suite. Local EVM tests are not public-chain transfers or physical GPU evidence. Publication/deployment remain pending until the operator runs the package.

## Installer correction 2026-11-06.2

The pre-upgrade SQLite probe now permits WAL sidecar coordination on the data volume while keeping both SQLite `readOnly:true` and `PRAGMA query_only=ON`. It reads committed WAL records and still blocks an upgrade when signed transaction journal entries exist. It mounts no credentials, uses no network and does not reset any database. The database/WAL data remain unchanged in the actual Node SQLite regression test; 39 handoff cases passed in that revision. Initial funding remains 1M PERL. The existing public worker tag/assets remain unchanged.

## Native CI correction 2026-11-07.1

The JavaScript integration test freezes application Date at 4 November, while its Python TCP bridge originally used real wall-clock time. Run 42256568329 on commit 2c972dad3398df674067f3cd594b11f0fd270faf therefore rejected the proof as an expired job at mining.test.mjs:196, after real native proof checks had passed earlier in that run. The bridge test child now receives the same frozen clock through a test-only Python launcher. Production bridge code, expiry checks, proof verification, reward rules and worker asset checksums are unchanged.

Local validation: the original clock mismatch was reproduced with the actual TCP bridge and an explicitly fake coordinator; aligning the test clock accepted the fixture, and an actually expired job was still rejected without forwarding its proof. JavaScript/shell syntax and guarded patch idempotency passed. These fixture checks do not claim new native proof or GPU validation. Full hosted native CI must pass on the correction before release or activation. The existing PR branch is updated without force-pushing; failure logs are printed automatically by the supplied repair command.

## Current-supply compatibility correction — 2026-11-07.2

Current total supply is no longer an activation or ongoing-health gate. Identity remains bound to the configured CA, Robinhood chain 4663, PERL symbol and 18 decimals; initial funding still requires actual owner balance and continuing operation requires reconciled vault reserves. The earlier exact-1B requirement was invalid for the observed deployed token. The operator-supplied readout showed symbol PERL, decimals 18, total supply 988,560,938 PERL and owner balance 1,008,592.531536509928891539 PERL. That readout establishes current values, not why supply changed or an independently verified burn history.

Initial funding remains exactly 1M PERL: 650k mining and 350k migration. Lifetime reserve caps remain 130M/70M; reward rounds, migration eligibility/ratio, worker assets, signer handling and API-only service isolation are unchanged. Incorrect ticker/decimals, insufficient reserves and funding above pool caps remain rejected. Total supply is not used to authorize funding or to define spendable reserves.

Validation: 85 mainnet Node tests and 29 mainnet Python checks passed; production build passed. Actual local-EVM token burns reproduce current supply of 988,560,938 PERL before a complete 1M activation and after vault funding. Invalid-metadata tests use explicitly overridden client reads. These are local EVM/software tests, not evidence of a real mainnet activation, token burn or GPU payout. Hosted CI and deployment are still checked by the launcher.

To resume, extract this updated package on the existing VPS and run launch.sh with the existing project path. Reviewed earlier source hashes are accepted, saved public token/wallet inputs and encrypted signer are reused, and both GitHub CI jobs remain required. No database reset, replacement token, immutable worker-tag move or API-only redeployment is performed by this correction.

## Installer 1.2.1: native-test conflict recovery

The archive is named perla-mainnet-v1.2.1.zip and extracts into perla-mainnet-kit-1.2.1. Its prepared web image uses tag perla-mainnet-prepared:1.2.1. These installer/web corrections do not move or alter the immutable mainnet-worker-v1.2.0 release.

Only scripts/checks/mining.test.mjs has a targeted compatibility exception: if its deployment hash is unfamiliar, full preflight still completes first, the original bytes are saved to a private sibling .perla-native-test-backup-* directory, and the reviewed clock-corrected integration test is installed. Runtime source edits and unsafe paths still stop preparation. Live test content is captured in the activation baseline and backed up by the normal source switch. Neither assertions nor the required software/native CI jobs are skipped. This recovery has 43 passing handoff tests, including backup, idempotency, runtime-edit rejection and symlink rejection.

Additional local tests prove activation and ongoing health do not call totalSupply at all. Actual funding remains exactly 650k mining plus 350k migration, with lifetime caps 130M/70M. There is no reset and no new token deployment. GitHub publication and real mainnet activation still occur only when the operator runs the launcher and required checks pass.
