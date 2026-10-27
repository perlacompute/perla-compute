# Security

This is a validation release. No independent external security audit is claimed.

Keep wallet private keys and seed phrases out of the website, worker credentials, issue reports and repository. A worker uses only its scoped token. Keep verifier and operator tokens separate and rotate exposed credentials.

Before reporting a vulnerability, check whether this repository has GitHub private vulnerability reporting enabled. Use that private channel when it is available. If it is unavailable, ask the repository owner for a private reporting channel without posting exploit details or secrets publicly. No private reporting channel or bounty is promised by this document.

The operator currently controls offchain verification and reward-root publication. Review [ARCHITECTURE.md](ARCHITECTURE.md) and the trust section in the README before operating a public service.
