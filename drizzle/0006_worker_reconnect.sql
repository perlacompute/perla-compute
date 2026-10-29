CREATE TABLE IF NOT EXISTS mining_worker_reconnects (
 id TEXT PRIMARY KEY NOT NULL,
 worker_id TEXT NOT NULL,
 new_token_hash TEXT NOT NULL UNIQUE,
 code_hash TEXT NOT NULL UNIQUE,
 created INTEGER NOT NULL,
 expires INTEGER NOT NULL,
 approved_at INTEGER,
 approved_address TEXT,
 prior_token_hash TEXT,
 consumed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS mining_worker_reconnect_expiry ON mining_worker_reconnects(expires);
