# Perla 0.3.0 — participation portal

This is one cumulative VPS update for the reviewed 0.2.3 source or the prepared 0.2.4 GitHub source. The planned mainnet ticker is PERL. The existing testnet asset remains tPERLA.

## Install

Upload `perla-0.3.0-patch.zip` to `/root`, then:

```bash
cd /root
unzip perla-0.3.0-patch.zip
bash /root/perla-0.3.0-patch/apply.sh /var/www/perla-vps
```

The updater checks source hashes and all payload checksums before changing source. Local changes to affected files are refused for review. It backs up affected source privately, builds the new web image before replacing the running container, waits for container health, and probes the new public APIs. A failed build restores source. A failed switch attempts to restore the previous image and source.

The environment file, SQLite volume, token/distributor addresses, verifier credentials, Nginx configuration and separate native-verifier container are retained. No wallet key is required. No contract is deployed, no epoch is funded, and mining admission is not changed.

One additive SQLite index is created by the existing migration runner to support receipt pagination. Existing contribution, worker, session and reward records are not rewritten. If source is rolled back, the additional index and migration record can remain safely in the database.

## New pages

- `/explorer`: accepted contribution search, cursor pagination, recorded activity and actual UTC contribution windows.
- `/explorer/RECEIPT_ID`: public accepted-work receipt with wallet/worker/job identifiers and proof/challenge hashes.
- `/rewards`: public epoch list and signed-in wallet allocations.
- `/rewards/EPOCH`: allocation details, current contract funding check and manifest download.
- `/platform/rewards`: wallet reward status and claim transactions.
- `/platform/setup`: guided wallet, worker, installation, connection and first-share milestones.

The mining dashboard links each accepted contribution to its public receipt. Header, footer and workspace navigation expose the new destinations while retaining Docs and Whitepaper.

## Reward status

The server checks Robinhood Testnet chain ID, the distributor's reward token, root, budget and remaining amount. An allocation becomes claimable only when the published epoch is activated, matching funding is read successfully, its amount is nonzero and its claim bit is unset. Missing RPC results or mismatches do not produce a claimable status.

Funding metadata is cached for up to 15 seconds. Individual claim bits are refreshed on account requests. The wallet sends the claim transaction; the UI tracks its returned receipt and refreshes the server-side contract state. Local tracking does not automatically detect replacement transactions. Users can dismiss local tracking after checking wallet activity; this does not cancel or resend a transaction.

The account and public epoch views cover 20 published epochs per page and support navigation to earlier windows. Public records expose accepted contribution identifiers and recipient addresses; worker names, credentials, native challenge bytes, unaccepted jobs and account sessions remain private.

## Evidence boundaries

A public receipt records the operator's native-verification decision and its stored hashes. The full native proof is not retained by the existing ledger, and this release does not publish an EVM-native verification certificate. The downloadable manifest allows allocation inspection; it does not prove that the operator's offchain ledger is complete.

The portal does not generate sample contributions in production. Until accepted shares and funded epochs exist, those views show an explicit empty state. The UTC countdown does not create points or tokens.

GPU inference-to-share validation and a real public-testnet funded claim still require deployment-host testing. Existing CPU-verifier validation is not a GPU validation claim.
