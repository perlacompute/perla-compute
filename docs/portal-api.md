# Round-reward API additions — worker 0.9.0

Amounts named budget, amount, reward, roundReward, roundRewardBaseUnits or rewardBaseUnits are **integer token base-unit strings** (18 decimals for reviewed PERL), unless a field explicitly ends in PERL. A task or accepted share does not mint or transfer tokens. Old technical `points` fields describe work weight for compatibility; they are not a points/token balance.

- `GET /api/mining/rounds`: latest 20 rounds, with ID, UTC epoch, open/won/expired state, target, reward pool and winning receipt. Open-round rewards are conditional; expired rounds pay zero.
- `GET /api/mining/rewards/summary`: policy/configuration status, dailyCap, earned network budget, roundReward, roundsWon/roundLimit, current round and UTC close/settlement times. No full-day proportional estimate is produced from ordinary shares.
- `GET /api/mining/rewards/account`: signed wallet session required. Includes current earned round allocation and paginated published allocations with fresh claim status. Cancelled epochs are excluded. Unfunded legacy version-1 records are held for review; already active funded claims remain supported.
- Worker work and share requests require `X-Perla-Protocol: perla-pearl-plain-v4` and `X-Perla-Reward-Policy: perla-rounds-v1`. The public protocol label is Perla Matrix v4.
- Job `round` metadata includes ID, policy hash, bits, workUnits, windowWorkUnits and rewardBaseUnits. The original header commits to the exact round ID and reward-policy hash.
- Accepted-share receipts include workWeight, roundId, roundWon and roundReward (base units; zero for an ordinary share). tokenReward is null: settlement remains separate.
- An explicit HTTP 409 with `code: round_closed` or `code: job_expired` and `credited: false` can discard the old challenge and fetch fresh work. A duplicate receipt or ambiguous lost POST response never supplies a false safe-retry signal. GET work can wait and retry temporary server/rate-limit conditions; POST submissions are not blindly replayed.
- Operator-only `POST /api/mining/operator/epochs/20754/cancel` performs the exact authorized owner validation cancellation with fresh canonical RPC checks and an audit tombstone. It cannot cancel arbitrary allocations or funded roots.
- Operator-only `POST /api/mining/operator/reward-rounds/activate` pins/resumes the reviewed policy after native override readiness and legacy checks. It never backfills accepted history. `.../suspend` holds new round credits without rewriting history.
- Version-2 manifests sum immutable per-round PPLNS allocations. Their policy hash, emission start, exact cap, round target/reward pairs, snapshots, Merkle root and individual proofs can be recomputed by the audit tooling. Version-1 funded claims retain their original leaf format and domain.

See [complete round rules and deployment](REWARD-ROUNDS.md). Earlier endpoint documentation follows; the rules above supersede old full-budget/points explanations.

# Participation portal API

All routes are under `/api/mining`, return `Cache-Control: no-store`, and use the existing mining ledger. Public read routes expose only published contribution or allocation data.

| GET route | Behavior |
| --- | --- |
| `overview` | Recorded contribution totals, current online-worker count, 14 UTC activity windows and epoch closing/preparation times. |
| `explorer?q=QUERY&epoch=EPOCH&before=CURSOR` | Up to 20 accepted shares. Search accepts a full wallet address, worker/job/receipt UUID, or SHA-256 proof hash. `epoch` and `before` are optional. |
| `explorer/RECEIPT_OR_JOB_UUID` | One accepted contribution, its challenge/proof hashes and any published reward epoch. Unaccepted jobs return 404. |
| `epochs?before=EPOCH` | Up to 20 prepared or activated epoch summaries, with a cursor for older entries. Publication is separate from a live funding check. |
| `epochs/EPOCH` | Validated allocation summary and current funding check against chain 46630. |
| `epochs/EPOCH/manifest` | Validated allocation JSON with an attachment filename. |
| `rewards/account` | Requires the existing signed browser session. Returns allocations for the recipient in a window of 20 published epochs, with current claim status and an older-page cursor. Use optional `?before=EPOCH` for earlier windows. |

Use the same signed-message authentication as the existing mining dashboard. Worker credentials do not authorize account reward reads.

Public receipt search uses bound SQL parameters and a bounded page size. Cursor ordering includes both accepted time and receipt ID so tied timestamps paginate without duplicate or skipped records. Worker names, worker tokens/hashes, browser sessions, full native headers and proof bytes are not public response fields.

Epoch manifests are reconstructed from their points, budget and distributor and compared before publication or account use. A chain mismatch, token mismatch, root/budget mismatch, malformed manifest or unavailable RPC cannot enable a claim.

The public `status` route now derives `claimsEnabled` from activated allocation records. This is a publication/configuration signal; an individual claim still requires the fresh account-level chain check.


## Worker identity and machine replacement

A Worker ID is permanent, while a machine credential can be replaced. POST `worker/reconnect/start` uses a new client-generated credential plus a target Worker ID and confirmation code. POST `worker/reconnect/info` and `worker/reconnect/approve` require the same-origin authenticated owner-wallet session. POST `worker/reconnect/exchange` uses the new machine credential, rotates it atomically into the existing worker, expires unfinished old jobs, and clears old validation/trial state. Retries are idempotent for the same request. No private token is returned by these endpoints. The worker ID, wallet, name, creation time and accepted work are retained. Revocation invalidates unconsumed approvals. Code approval expires after 10 minutes.

## Fresh generation and launch readiness

- `GET /api/mining/readiness`: public, no-store launch evidence and pending checks. It never creates contributions or promotes the deployment.
- `GET /api/mining/operator/testnet/state`: authenticated fresh-generation state.
- `POST /api/mining/operator/testnet/automation`: authenticated scheduler heartbeat; failures never become successful checks.
- `POST /api/mining/operator/testnet/smoke`: verifies the isolated 1 PERL funding/claim receipts independently against canonical chain state.
- `GET /api/mining/operator/testnet/testing-claims`: real funded daily manifests for the owner-only test phase. The signer relays only its own committed recipient allocation.
- `POST /api/mining/operator/testnet/live`: opens public work only after fresh GPU, sustained-work, qualifying-round, treasury, scheduler and real earned-claim evidence passes. The automatic service invokes it when ready.

The fresh reset itself is an offline operator operation with stopped web writers and a consistent backup; it is deliberately unavailable as a public or browser API. It clears old worker/auth/work/reward rows once and retains only schema and re-pinned configuration. Old worker credentials return 401. `--new-worker` replaces a GPU host connection after an explicit CLI request without deleting its verified CUDA build.
