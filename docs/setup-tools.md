# Setup tools and current PERL deployment

The active testnet token is PERL. See [PERL testnet](PERL-TESTNET.md) for the token/distributor pair and dated deployment evidence.

The standalone perla-perl-testnet-1.0.0 toolkit deployed PERL and a matching distributor. Its journal and public report live under data/perl-testnet-deployment. Repeating that deployment toolkit with the same wallet resumes the saved transactions; do not delete its state to handle a timeout.

The perla-perl-connect toolkit checks receipts, runtime bytecode, supply and distributor binding, creates an encrypted backup/restore drill, checks the stopped database read-only, and installs both runtime addresses together. It preserves verifier and worker settings. It never requests a private key, broadcasts a transaction, funds an epoch, or activates mining.

The original tools/perla-testnet-setup directory is retained as historical tPERLA setup. Its start command is retired and exits without sending any transaction. The old deployment fingerprint is not rewritten to pretend that tPERLA and PERL are the same contract.

After integration, use the operator CLI with the configured token/distributor pair to review a closed epoch, fund it with test PERL, record its funding trace where supported, and activate it only after a real mining contribution has passed validation. Downloaded operator archives include the current PERL token source and deployment notes.

Mainnet remains on hold. Do not use a mainnet RPC or fund a mainnet token through these testnet tools.
