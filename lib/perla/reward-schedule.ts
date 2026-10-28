import type { MiningDatabase } from './database';
import { CHAIN_ID, JOB_TTL, currentEpoch } from './protocol';
import { dailyBudget, EMISSION_POLICY } from './emission.mjs';
import { createManifest } from './rewards';
import deployment from '@/deployments/robinhood-testnet.json';
import type { Address } from 'viem';

type Env = { DB?: MiningDatabase; PERLA_REWARD_TOKEN?: string; PERLA_DISTRIBUTOR_ADDRESS?: string };
type Policy = { policy: string; start_epoch: number; token: Address; distributor: Address; created: number };
export class RewardScheduleError extends Error { constructor(public status: number, message: string) { super(message); } }
const fail = (message: string): never => { throw new RewardScheduleError(409, message); };
const dbFor = (env: Env) => env.DB ?? fail('Reward storage is unavailable.');
function configured(env: Env, policy: Policy) {
  if (policy.policy !== EMISSION_POLICY || env.PERLA_REWARD_TOKEN?.toLowerCase() !== policy.token || env.PERLA_DISTRIBUTOR_ADDRESS?.toLowerCase() !== policy.distributor) fail('The pinned reward policy does not match this deployment.');
  return policy;
}
export async function pinnedRewardPolicy(env: Env) {
  const row = await dbFor(env).prepare('SELECT * FROM mining_reward_policy WHERE id=1').first<Policy>();
  return row ? configured(env, row) : null;
}
export async function configureRewardPolicy(env: Env, now: number) {
  const db = dbFor(env); const saved = await pinnedRewardPolicy(env); if (saved) return saved;
  const start = await db.prepare('SELECT start_epoch FROM mining_policy_state WHERE id=1').first<{ start_epoch: number }>();
  if (!start || !Number.isSafeInteger(start.start_epoch) || start.start_epoch < 0) fail('Activate the validated mining policy before pinning rewards.');
  const token = env.PERLA_REWARD_TOKEN?.toLowerCase(), distributor = env.PERLA_DISTRIBUTOR_ADDRESS?.toLowerCase();
  if (token !== deployment.token.toLowerCase() || distributor !== deployment.distributor.toLowerCase()) fail('Use the reviewed PERL testnet token and matching distributor.');
  const old = await db.prepare('SELECT epoch,budget,token,distributor FROM mining_reward_epochs').all<{ epoch: number; budget: string; token: string; distributor: string }>();
  for (const row of old.results) {
    if (row.epoch < start!.start_epoch || row.token.toLowerCase() !== token || row.distributor.toLowerCase() !== distributor || BigInt(row.budget) !== dailyBudget(row.epoch - start!.start_epoch + 1)) fail('An existing epoch uses a different reward schedule. Preserve it for reconciliation.');
  }
  await db.prepare('INSERT OR IGNORE INTO mining_reward_policy(id,policy,start_epoch,token,distributor,created) VALUES(1,?,?,?,?,?)').bind(EMISSION_POLICY, start!.start_epoch, token, distributor, now).run();
  return (await pinnedRewardPolicy(env))!;
}
export async function rewardSummary(env: Env, now: number, address?: string) {
  const db = dbFor(env), policy = await pinnedRewardPolicy(env), epoch = currentEpoch(now);
  const totals = await db.prepare('SELECT COUNT(*) AS shares,COALESCE(SUM(points),0) AS points FROM mining_shares WHERE epoch=?').bind(epoch).first<{ shares: number; points: number }>();
  const own = address ? await db.prepare('SELECT COALESCE(SUM(points),0) AS points FROM mining_shares WHERE epoch=? AND address=?').bind(epoch, address.toLowerCase()).first<{ points: number }>() : null;
  const day = policy && epoch >= policy.start_epoch ? epoch - policy.start_epoch + 1 : null;
  const budget = day ? dailyBudget(day) : null;
  return { chainId: CHAIN_ID, policy: policy?.policy ?? null, configured: !!policy, startEpoch: policy?.start_epoch ?? null,
    token: policy?.token ?? null, distributor: policy?.distributor ?? null, epoch, day,
    budget: budget?.toString() ?? null, networkPoints: String(totals?.points ?? 0), acceptedShares: totals?.shares ?? 0,
    walletPoints: own ? String(own.points) : null,
    estimatedAmount: own && budget !== null ? (totals!.points > 0 ? budget * BigInt(own.points) / BigInt(totals!.points) : 0n).toString() : null,
    closesAt: (epoch + 1) * 86400, settlementOpensAt: (epoch + 1) * 86400 + JOB_TTL,
    latestClosedEpoch: Math.floor((now - JOB_TTL) / 86400) - 1,
    status: day ? 'scheduled' : 'not_configured', checkedAt: now,
    funding: 'A scheduled budget is not funded. Claims require a matching funded and activated allocation.',
    emptyEpochs: 'No accepted work means no allocation, no funding and no rollover.' };
}
export async function prepareRewardEpoch(env: Env, epoch: number, now: number, requestedBudget?: unknown) {
  const db = dbFor(env), policy = await pinnedRewardPolicy(env);
  if (!policy) fail('Pin the reward schedule before preparing an epoch.');
  if (!Number.isSafeInteger(epoch) || epoch < policy!.start_epoch || now < (epoch + 1) * 86400 + JOB_TTL) fail('Only fully closed epochs within the pinned schedule can be prepared.');
  const budget = dailyBudget(epoch - policy!.start_epoch + 1).toString();
  if (requestedBudget !== undefined && requestedBudget !== budget) fail('The epoch budget must equal the pinned daily schedule. Manual overrides are disabled.');
  const saved = await db.prepare('SELECT * FROM mining_reward_epochs WHERE epoch=?').bind(epoch).first<{ manifest: string; budget: string; token: string; distributor: string; state: string; snapshot: string }>();
  if (saved) {
    if (saved.budget !== budget || saved.token.toLowerCase() !== policy!.token || saved.distributor.toLowerCase() !== policy!.distributor) fail('The existing immutable epoch conflicts with this schedule.');
    return { ...JSON.parse(saved.manifest), snapshot: saved.snapshot, state: saved.state };
  }
  const rows = await db.prepare('SELECT address,SUM(points) AS points FROM mining_shares WHERE epoch=? GROUP BY address ORDER BY address LIMIT 5001').bind(epoch).all<{ address: Address; points: number }>();
  if (!rows.results.length) return { epoch, skipped: true, reason: 'No accepted work; no allocation or rollover.', budget: '0' };
  if (rows.results.length > 5000) fail('This epoch exceeds the 5,000-recipient allocation limit.');
  const manifest = createManifest(epoch, BigInt(budget), policy!.distributor, rows.results);
  const bytes = new TextEncoder().encode(JSON.stringify(rows.results));
  const snapshot = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  await db.prepare("INSERT OR IGNORE INTO mining_reward_epochs(epoch,snapshot,manifest,root,budget,distributor,token,state,created) VALUES(?,?,?,?,?,?,?,'prepared',?)").bind(epoch, snapshot, JSON.stringify(manifest), manifest.root, budget, policy!.distributor, policy!.token, now).run();
  const final = await db.prepare('SELECT manifest,snapshot,state FROM mining_reward_epochs WHERE epoch=?').bind(epoch).first<{ manifest: string; snapshot: string; state: string }>();
  if (final?.manifest !== JSON.stringify(manifest)) fail('A concurrent epoch preparation differs. Preserve both records for review.');
  return { ...manifest, snapshot: final!.snapshot, state: final!.state };
}
export async function settlementQueue(env: Env, now: number) {
  const summary = await rewardSummary(env, now), db = dbFor(env);
  if (!summary.configured) return { summary, items: [], more: false };
  const rows = await db.prepare("SELECT DISTINCT s.epoch FROM mining_shares s LEFT JOIN mining_reward_epochs e ON e.epoch=s.epoch WHERE s.epoch>=? AND s.epoch<=? AND (e.epoch IS NULL OR e.state<>'active') ORDER BY s.epoch LIMIT 33").bind(summary.startEpoch, summary.latestClosedEpoch).all<{ epoch: number }>();
  return { summary, items: rows.results.slice(0, 32).map(row => ({ epoch: row.epoch, day: row.epoch - summary.startEpoch! + 1, budget: dailyBudget(row.epoch - summary.startEpoch! + 1).toString() })), more: rows.results.length > 32 };
}
