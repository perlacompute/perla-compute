ALTER TABLE mining_jobs ADD COLUMN protocol TEXT NOT NULL DEFAULT 'perla-pearl-plain-v3';
--> statement-breakpoint
ALTER TABLE mining_jobs ADD COLUMN share_bits INTEGER NOT NULL DEFAULT 545259519;
--> statement-breakpoint
ALTER TABLE mining_jobs ADD COLUMN work_points INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE mining_jobs ADD COLUMN policy_hash TEXT;
--> statement-breakpoint
ALTER TABLE mining_jobs ADD COLUMN profile_id TEXT NOT NULL DEFAULT 'legacy-v3';
--> statement-breakpoint
ALTER TABLE mining_workers ADD COLUMN miner_version TEXT;
--> statement-breakpoint
ALTER TABLE mining_workers ADD COLUMN architecture TEXT;
--> statement-breakpoint
ALTER TABLE mining_workers ADD COLUMN last_error TEXT;
--> statement-breakpoint
CREATE TABLE mining_policy_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  profile_id TEXT NOT NULL,
  start_epoch INTEGER NOT NULL,
  activated_at INTEGER NOT NULL,
  validation_hash TEXT NOT NULL,
  validation_family TEXT NOT NULL,
  validation_version TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE mining_operation_counts (
  bucket INTEGER NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  max_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(bucket,kind)
);
--> statement-breakpoint
CREATE TABLE mining_worker_counts (
  worker_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(worker_id,epoch,kind)
);
--> statement-breakpoint
ALTER TABLE mining_reward_epochs ADD COLUMN funding_tx TEXT;
--> statement-breakpoint
ALTER TABLE mining_reward_epochs ADD COLUMN funding_block TEXT;
--> statement-breakpoint
ALTER TABLE mining_reward_epochs ADD COLUMN funding_block_hash TEXT;
