# Contributing

Describe the problem, expected behavior and a reproducible example in an issue or pull request. Include relevant software versions and sanitized errors. Keep unrelated changes separate.

Use Node 24.13+ within the Node 24 release line. Install with `npm ci`, then run the validation commands in the README. Changes to contribution accounting or contracts need behavioral tests covering failure paths, duplicate submission and recipient binding where relevant.

Never commit real credentials, wallet recovery material, `.env`, worker configurations, databases, model caches, production logs or deployment checkpoints. Use `.env.example` for blank configuration examples. `npm run check:source` checks common credential patterns and disallowed tracked files; it is not a comprehensive security audit.

Native proof changes must be tested with the pinned upstream implementation. CPU fixtures establish protocol behavior, not successful GPU inference. Document the exact hardware, model, upstream revision and observed results for any GPU-support claim.

Preserve upstream attribution and licenses. A source change does not rename, migrate or modify an existing onchain contract. Changes affecting reward assets require an explicit migration plan.
