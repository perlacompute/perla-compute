CREATE TABLE mining_testnet_state (
 id INTEGER PRIMARY KEY CHECK(id=1), reset_id TEXT NOT NULL UNIQUE,
 reset_at INTEGER NOT NULL, phase TEXT NOT NULL CHECK(phase IN ('testing','live')),
 automation_enabled INTEGER NOT NULL DEFAULT 0 CHECK(automation_enabled IN (0,1)),
 automation_checked INTEGER, automation_error TEXT,
 smoke_epoch TEXT, smoke_funding_tx TEXT, smoke_claim_tx TEXT,
 smoke_verified INTEGER NOT NULL DEFAULT 0 CHECK(smoke_verified IN (0,1)),
 launched_at INTEGER
);
