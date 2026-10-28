CREATE TABLE mining_device_pairings (
 id TEXT PRIMARY KEY, device_hash TEXT NOT NULL UNIQUE, code_hash TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL,
 address TEXT, consumed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX mining_pairings_expiry ON mining_device_pairings(expires);
CREATE TABLE mining_worker_validations (
 worker_id TEXT PRIMARY KEY REFERENCES mining_workers(id), report TEXT NOT NULL,
 hash TEXT NOT NULL, created INTEGER NOT NULL
);
CREATE TABLE mining_worker_trials (
 worker_id TEXT PRIMARY KEY REFERENCES mining_workers(id), created INTEGER NOT NULL,
 expires INTEGER NOT NULL, max_shares INTEGER NOT NULL CHECK(max_shares BETWEEN 1 AND 10),
 validation_hash TEXT NOT NULL
);
