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
