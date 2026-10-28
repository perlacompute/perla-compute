-- Public miner payout routing. A supplied address is not proof of wallet ownership.
CREATE TABLE mining_public_workers (
 worker_id TEXT PRIMARY KEY REFERENCES mining_workers(id),
 created INTEGER NOT NULL
);
