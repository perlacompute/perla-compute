CREATE TABLE `mining_auth_sessions` (
	`hash` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mining_auth_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`message` text NOT NULL,
	`expires` integer NOT NULL,
	`used` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mining_reward_epochs` (
	`epoch` integer PRIMARY KEY NOT NULL,
	`snapshot` text NOT NULL,
	`manifest` text NOT NULL,
	`root` text NOT NULL,
	`budget` text NOT NULL,
	`distributor` text NOT NULL,
	`token` text NOT NULL,
	`state` text NOT NULL,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mining_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`worker_id` text NOT NULL,
	`epoch` integer NOT NULL,
	`header` text NOT NULL,
	`created` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mining_jobs_worker` ON `mining_jobs` (`worker_id`);--> statement-breakpoint
CREATE TABLE `mining_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mining_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`worker_id` text NOT NULL,
	`address` text NOT NULL,
	`epoch` integer NOT NULL,
	`proof_hash` text NOT NULL,
	`accepted` integer NOT NULL,
	`points` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mining_one_share_per_job` ON `mining_shares` (`job_id`);--> statement-breakpoint
CREATE INDEX `mining_shares_account` ON `mining_shares` (`address`);--> statement-breakpoint
CREATE INDEX `mining_shares_epoch` ON `mining_shares` (`epoch`);--> statement-breakpoint
CREATE TABLE `mining_workers` (
	`id` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created` integer NOT NULL,
	`last_seen` integer,
	`revoked` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mining_worker_token` ON `mining_workers` (`token_hash`);--> statement-breakpoint
CREATE INDEX `mining_workers_owner` ON `mining_workers` (`address`);