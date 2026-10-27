import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const challenges = sqliteTable('mining_auth_challenges', {
  id: text('id').primaryKey(), address: text('address').notNull(), message: text('message').notNull(),
  expires: integer('expires').notNull(), used: integer('used').notNull().default(0),
});
export const accounts = sqliteTable('mining_auth_sessions', {
  hash: text('hash').primaryKey(), address: text('address').notNull(), expires: integer('expires').notNull(),
});
export const workers = sqliteTable('mining_workers', {
  id: text('id').primaryKey(), address: text('address').notNull(), name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(), created: integer('created').notNull(),
  lastSeen: integer('last_seen'), revoked: integer('revoked'),
}, t => [uniqueIndex('mining_worker_token').on(t.tokenHash), index('mining_workers_owner').on(t.address)]);
export const jobs = sqliteTable('mining_jobs', {
  id: text('id').primaryKey(), workerId: text('worker_id').notNull(), epoch: integer('epoch').notNull(),
  header: text('header').notNull(), created: integer('created').notNull(), expires: integer('expires').notNull(),
}, t => [index('mining_jobs_worker').on(t.workerId)]);
export const shares = sqliteTable('mining_shares', {
  id: text('id').primaryKey(), jobId: text('job_id').notNull(), workerId: text('worker_id').notNull(),
  address: text('address').notNull(), epoch: integer('epoch').notNull(), proofHash: text('proof_hash').notNull(),
  accepted: integer('accepted').notNull(), points: integer('points').notNull(),
}, t => [uniqueIndex('mining_one_share_per_job').on(t.jobId), index('mining_shares_account').on(t.address), index('mining_shares_epoch').on(t.epoch)]);
export const epochs = sqliteTable('mining_reward_epochs', {
  epoch: integer('epoch').primaryKey(), snapshot: text('snapshot').notNull(), manifest: text('manifest').notNull(),
  root: text('root').notNull(), budget: text('budget').notNull(), distributor: text('distributor').notNull(),
  token: text('token').notNull(), state: text('state').notNull(), created: integer('created').notNull(),
});
export const limits = sqliteTable('mining_rate_limits', {
  key: text('key').primaryKey(), count: integer('count').notNull(), expires: integer('expires').notNull(),
});
