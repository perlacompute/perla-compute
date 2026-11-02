CREATE TABLE mining_round_policy (
 id INTEGER PRIMARY KEY CHECK(id=1), policy_hash TEXT NOT NULL,
 started INTEGER NOT NULL, cutover_epoch INTEGER NOT NULL,
 suspended INTEGER NOT NULL DEFAULT 0 CHECK(suspended IN (0,1))
);
CREATE TABLE mining_reward_rounds (
 id TEXT PRIMARY KEY, epoch INTEGER NOT NULL, policy_hash TEXT NOT NULL,
 difficulty_weight INTEGER NOT NULL CHECK(difficulty_weight IN (256,512,1024,2048)),
 target_bits INTEGER NOT NULL, reward TEXT NOT NULL,
 opened INTEGER NOT NULL, closed INTEGER,
 state TEXT NOT NULL CHECK(state IN ('open','won','expired')),
 winner_share TEXT UNIQUE, snapshot TEXT
);
CREATE UNIQUE INDEX mining_one_open_round ON mining_reward_rounds(epoch) WHERE state='open';
CREATE INDEX mining_round_epoch ON mining_reward_rounds(epoch,state);
CREATE TABLE mining_round_jobs (
 job_id TEXT PRIMARY KEY REFERENCES mining_jobs(id),
 round_id TEXT NOT NULL REFERENCES mining_reward_rounds(id)
);
CREATE TABLE mining_round_shares (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT,
 share_id TEXT NOT NULL UNIQUE REFERENCES mining_shares(id),
 round_id TEXT NOT NULL REFERENCES mining_reward_rounds(id),
 epoch INTEGER NOT NULL, address TEXT NOT NULL,
 work_units INTEGER NOT NULL CHECK(work_units IN (1,2,4,8,16))
);
CREATE INDEX mining_round_share_epoch ON mining_round_shares(epoch,address);
CREATE TABLE mining_allocation_cancellations (
 epoch INTEGER PRIMARY KEY REFERENCES mining_reward_epochs(epoch),
 root TEXT NOT NULL, budget TEXT NOT NULL, recipient TEXT NOT NULL,
 reason TEXT NOT NULL, cancelled INTEGER NOT NULL,
 block_number TEXT NOT NULL, block_hash TEXT NOT NULL
);

CREATE TABLE mining_round_epoch_state(epoch INTEGER PRIMARY KEY, started INTEGER NOT NULL);
CREATE TABLE mining_round_epoch_recipients(epoch INTEGER NOT NULL,address TEXT NOT NULL,PRIMARY KEY(epoch,address));
