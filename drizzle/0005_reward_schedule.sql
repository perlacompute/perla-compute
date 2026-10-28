CREATE TABLE IF NOT EXISTS mining_reward_policy (
 id INTEGER PRIMARY KEY CHECK (id=1),
 policy TEXT NOT NULL,
 start_epoch INTEGER NOT NULL CHECK (start_epoch>=0),
 token TEXT NOT NULL,
 distributor TEXT NOT NULL,
 created INTEGER NOT NULL
);
