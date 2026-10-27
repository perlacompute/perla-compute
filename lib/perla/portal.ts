import { createPublicClient, http, isAddress, type Address } from 'viem';
import type { MiningDatabase } from './database';
import { CHAIN_ID, JOB_TTL, PROTOCOL, UPSTREAM_COMMIT, currentEpoch, digest, fromBase64 } from './protocol';
import { createManifest, rewardsAbi } from './rewards';
import { workPolicy } from './work-policy';
import { treasurySnapshot } from './treasury';
import { chainSnapshot, assertCanonical } from './chain-read';
import recordedDeployment from '@/deployments/robinhood-testnet.json';

export type PortalEnv = { DB?: MiningDatabase; PERLA_RPC_URL?: string; PERLA_MINING_ENABLED?: string; PERLA_REWARD_TOKEN?:string; PERLA_DISTRIBUTOR_ADDRESS?:string };
export type EpochRow = { epoch: number; manifest: string; root: string; budget: string; distributor: Address; token: Address; state: string; created: number; funding_tx?: string|null; funding_block?:string|null; funding_block_hash?:string|null };
const tokenAbi = [
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const;
const claimedAbi = [{ type: 'function', name: 'isClaimed', stateMutability: 'view', inputs: [{ type: 'uint256' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] }] as const;
class PortalError extends Error { constructor(public status: number, message: string) { super(message); } }
const fail = (status: number, message: string): never => { throw new PortalError(status, message); };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const database = (env: PortalEnv) => env.DB ?? fail(503, 'Contribution storage is unavailable.');
const integer = (value: string, label: string) => /^\d{1,15}$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : fail(400, `Invalid ${label}.`);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hash = /^(?:0x)?[a-f0-9]{64}$/i;
type Manifest = ReturnType<typeof createManifest>;
const manifests = new Map<string, Manifest>();

function manifestFor(row: EpochRow): Manifest {
  const key = `${row.epoch}:${row.root}:${row.budget}:${row.distributor}:${row.token}:${row.manifest}`;
  const cached = manifests.get(key); if (cached) return cached;
  if (row.manifest.length > 8 * 1024 * 1024 || !isAddress(row.distributor) || !isAddress(row.token)) fail(503, 'Epoch record could not be validated.');
  const m = JSON.parse(row.manifest) as Manifest;
  if (m.chainId !== CHAIN_ID || m.epoch !== row.epoch || m.root !== row.root || m.budget !== row.budget || m.distributor.toLowerCase() !== row.distributor.toLowerCase() || !Array.isArray(m.allocations) || m.allocations.length > 5000) fail(503, 'Epoch record could not be validated.');
  const rebuilt = createManifest(row.epoch, BigInt(row.budget), row.distributor, m.allocations.map(a => ({ address: a.address, points: a.points })));
  if (JSON.stringify(rebuilt) !== JSON.stringify(m)) fail(503, 'Epoch allocation integrity check failed.');
  if (manifests.size >= 8) manifests.delete(manifests.keys().next().value!);
  manifests.set(key, m); return m;
}

function rpc(env: PortalEnv) {
  const endpoint = env.PERLA_RPC_URL || 'https://rpc.testnet.chain.robinhood.com';
  const u = new URL(endpoint);
  if (u.username || u.password || u.hash || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)))) throw Error('Invalid reward RPC.');
  return { endpoint, client: createPublicClient({ transport: http(endpoint, { timeout: 5000, retryCount: 0 }) }) };
}
type TokenInfo = { symbol: string; decimals: number } | null;
type ChainEpoch = { verification: 'funded' | 'unfunded' | 'mismatch' | 'unavailable'; remaining: string | null; checkedAt: number; tokenInfo: TokenInfo };
async function chainEpoch(env: PortalEnv, row: EpochRow): Promise<ChainEpoch> {
  // Funding and claim reads are refreshed; a cached soft-block result must not survive a reorg.
  const promise = (async (): Promise<ChainEpoch> => {
    const checkedAt = Math.floor(Date.now() / 1000);
    try {
      const { client } = rpc(env);
      if (await client.getChainId() !== CHAIN_ID) return { verification: 'mismatch', remaining: null, tokenInfo: null, checkedAt };
      const snapshot=await chainSnapshot(env); const blockNumber=snapshot.blockNumber;
      const [token, epoch] = await Promise.all([
        client.readContract({ address: row.distributor, abi: rewardsAbi, functionName: 'rewardToken', blockNumber }),
        client.readContract({ address: row.distributor, abi: rewardsAbi, functionName: 'epochs', args: [BigInt(row.epoch)], blockNumber }),
      ]);
      if (token.toLowerCase() !== row.token.toLowerCase()) return { verification: 'mismatch', remaining: null, tokenInfo: null, checkedAt };
      let tokenInfo: TokenInfo = null;
      try {
        const [symbol, decimals] = await Promise.all([
          client.readContract({ address: row.token, abi: tokenAbi, functionName: 'symbol', blockNumber }),
          client.readContract({ address: row.token, abi: tokenAbi, functionName: 'decimals', blockNumber }),
        ]);
        if (symbol.length > 0 && symbol.length <= 24 && /^[\x20-\x7E]+$/.test(symbol) && decimals <= 36) tokenInfo = { symbol, decimals };
      } catch { /* Raw base units remain available when metadata cannot be read. */ }
      await assertCanonical(snapshot);
      if (epoch[0] === '0x' + '0'.repeat(64) && epoch[1] === 0n) return { verification: 'unfunded', remaining: '0', tokenInfo, checkedAt };
      const matches = epoch[0].toLowerCase() === row.root.toLowerCase() && epoch[1] === BigInt(row.budget) && epoch[2] <= epoch[1];
      return { verification: matches ? 'funded' : 'mismatch', remaining: matches ? epoch[2].toString() : null, tokenInfo, checkedAt };
    } catch { return { verification: 'unavailable', remaining: null, tokenInfo: null, checkedAt }; }
  })();
  return promise;
}
async function mapLimit<T, R>(items: T[], fn: (item: T) => Promise<R>, width = 4): Promise<R[]> {
  const output: R[] = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) { const index = next++; output[index] = await fn(items[index]); }
  })); return output;
}
function epochSummary(row: EpochRow) {
  const m = manifestFor(row);
  return { epoch: row.epoch, root: row.root, budget: row.budget, distributor: row.distributor, token: row.token, state: row.state, created: row.created, totalPoints: m.totalPoints, recipients: m.allocations.length, fundingTransaction:row.funding_tx??null, fundingBlock:row.funding_block??null, chainId: CHAIN_ID,
    recordedTokenInfo: row.token.toLowerCase() === recordedDeployment.token.toLowerCase() ? { symbol: recordedDeployment.symbol, decimals: recordedDeployment.decimals } : null };
}
async function epochRows(db: MiningDatabase, before?: number, limit = 20) {
  const result = await db.prepare("SELECT * FROM mining_reward_epochs WHERE state IN ('prepared','active') AND epoch < ? ORDER BY epoch DESC LIMIT ?").bind(before ?? Number.MAX_SAFE_INTEGER, limit).all<EpochRow>();
  return result.results;
}

/** Only public accepted contribution records are searchable; credentials and unaccepted jobs never leave storage. */
export async function explorerRecords(env: PortalEnv, url: URL) {
  const db = database(env); const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const clauses: string[] = []; const values: unknown[] = [];
  if (q) {
    if (isAddress(q)) { clauses.push('s.address = ?'); values.push(q); }
    else if (uuid.test(q)) { clauses.push('(s.id = ? OR s.job_id = ? OR s.worker_id = ?)'); values.push(q, q, q); }
    else if (hash.test(q)) { clauses.push('s.proof_hash = ?'); values.push(q.replace(/^0x/, '')); }
    else fail(400, 'Enter a full wallet address, worker/job/receipt ID, or proof hash.');
  }
  if (url.searchParams.has('epoch')) { clauses.push('s.epoch = ?'); values.push(integer(url.searchParams.get('epoch')!, 'epoch')); }
  const cursor = url.searchParams.get('before');
  if (cursor) {
    const match = cursor.match(/^(\d{1,15}):([a-f0-9-]{36})$/i);
    if (!match || !uuid.test(match[2])) fail(400, 'Invalid page cursor.');
    const accepted = integer(match![1], 'page cursor');
    clauses.push('(s.accepted < ? OR (s.accepted = ? AND s.id < ?))'); values.push(accepted, accepted, match![2]);
  }
  const result = await db.prepare(`SELECT s.id,s.job_id,s.worker_id,s.address,s.epoch,s.proof_hash,s.accepted,s.points FROM mining_shares s ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''} ORDER BY s.accepted DESC,s.id DESC LIMIT 21`).bind(...values).all<{ id: string; accepted: number }>();
  const items = result.results.slice(0, 20); const last = items.at(-1);
  return { items, query: q, next: result.results.length > 20 && last ? `${last.accepted}:${last.id}` : null, protocol: PROTOCOL, chainId: CHAIN_ID };
}
export async function explorerReceipt(env: PortalEnv, id: string) {
  if (!uuid.test(id)) fail(400, 'Invalid receipt or job ID.');
  const row = await database(env).prepare('SELECT s.id,s.job_id,s.worker_id,s.address,s.epoch,s.proof_hash,s.accepted,s.points,j.header,j.protocol,j.share_bits,j.work_points,j.profile_id,j.policy_hash,j.created AS job_created FROM mining_shares s LEFT JOIN mining_jobs j ON j.id=s.job_id WHERE s.id=? OR s.job_id=? LIMIT 1').bind(id, id).first<{ header: string | null; epoch: number; [key: string]: unknown }>();
  if (!row) fail(404, 'No accepted contribution was found for this receipt.');
  const { header, ...publicFields } = row!;
  const epoch = await database(env).prepare("SELECT * FROM mining_reward_epochs WHERE epoch=? AND state IN ('prepared','active')").bind(row!.epoch).first<EpochRow>();
  return { ...publicFields, headerHash: header ? await digest(fromBase64(header)) : null, protocol: row!.protocol || 'perla-pearl-plain-v3', upstreamCommit: UPSTREAM_COMMIT, chainId: CHAIN_ID, rewardEpoch: epoch ? epochSummary(epoch) : null, evidence: 'Operator-recorded native verification receipt. Full proof bytes and an EVM verification certificate are not published by this endpoint.' };
}
export async function portalOverview(env: PortalEnv) {
  const db = database(env); const now = Math.floor(Date.now() / 1000); const today = currentEpoch(now);
  const totals = await db.prepare('SELECT COUNT(*) AS shares,COALESCE(SUM(points),0) AS points,COUNT(DISTINCT address) AS contributors FROM mining_shares').first();
  const workers = await db.prepare('SELECT COUNT(*) AS n FROM mining_workers WHERE revoked IS NULL AND last_seen>?').bind(now - 90).first<{ n: number }>();
  const daily = await db.prepare('SELECT epoch,COUNT(*) AS shares,COALESCE(SUM(points),0) AS points FROM mining_shares WHERE epoch>=? AND epoch<=? GROUP BY epoch').bind(today - 13, today).all<{ epoch: number; shares: number; points: number }>();
  const epochs = await db.prepare("SELECT COUNT(*) AS published,SUM(CASE WHEN state='active' THEN 1 ELSE 0 END) AS active FROM mining_reward_epochs WHERE state IN ('prepared','active')").first();
  return { ...totals, activeWorkers: workers?.n ?? 0, epochs, miningEnabled: (await workPolicy(env)).miningEnabled, epoch: today, closesAt: (today + 1) * 86400, earliestPreparationAt: (today + 1) * 86400 + JOB_TTL, checkedAt: now, chainId: CHAIN_ID, daily: Array.from({ length: 14 }, (_, i) => { const epoch = today - 13 + i; return daily.results.find(d => d.epoch === epoch) || { epoch, shares: 0, points: 0 }; }) };
}

/** Read-only account reward state. A missing RPC result never becomes a claimable allocation. */
export async function accountRewards(env: PortalEnv, address: string, before?: number) {
  const page = await epochRows(database(env), before, 21);
  const rows = page.slice(0, 20);
  const allocations = rows.flatMap(row => { const allocation = manifestFor(row).allocations.find(a => a.address.toLowerCase() === address.toLowerCase()); return allocation ? [{ row, allocation }] : []; });
  const items = await mapLimit(allocations, async ({ row, allocation }) => {
    const chain = await chainEpoch(env, row);
    let status: 'pending' | 'funded' | 'claimable' | 'claimed' | 'unavailable' = 'pending';
    if (chain.verification === 'unavailable' || chain.verification === 'mismatch') status = 'unavailable';
    else if (chain.verification === 'funded') {
      if (row.state !== 'active') status = 'funded';
      else {
        try {
          const { client } = rpc(env);
          // Claim bits are refreshed for every account request, even while epoch metadata is cached.
          if (await client.getChainId() !== CHAIN_ID) throw Error('Wrong network');
          const claimed = await client.readContract({ address: row.distributor, abi: claimedAbi, functionName: 'isClaimed', args: [BigInt(row.epoch), BigInt(allocation.index)] });
          status = claimed ? 'claimed' : BigInt(allocation.amount) > 0n && BigInt(allocation.amount) <= BigInt(chain.remaining || '0') ? 'claimable' : 'unavailable';
        } catch { status = 'unavailable'; }
      }
    }
    return { ...allocation, ...epochSummary(row), status, verification: chain.verification, tokenInfo: chain.tokenInfo, checkedAt: Math.floor(Date.now() / 1000) };
  });
  return { address, items, chainId: CHAIN_ID, epochWindow: 20, next: page.length > 20 ? rows[19].epoch : null, checkedAt: Math.floor(Date.now() / 1000) };
}

export async function publicPortalResponse(request: Request, env: PortalEnv): Promise<Response | null> {
  const url = new URL(request.url); const path = url.pathname.replace(/^\/api\/mining\/?/, '');
  if (request.method !== 'GET' || !(/^(treasury|overview|explorer(?:\/[^/]+)?|epochs(?:\/\d+(?:\/manifest)?)?)$/.test(path))) return null;
  try {
    if (path === 'treasury') return json(await treasurySnapshot(env));
    if (path === 'overview') return json(await portalOverview(env));
    if (path === 'explorer') return json(await explorerRecords(env, url));
    if (path.startsWith('explorer/')) return json(await explorerReceipt(env, path.slice(9)));
    if (path === 'epochs') {
      const before = url.searchParams.has('before') ? integer(url.searchParams.get('before')!, 'epoch cursor') : undefined;
      const rows = await epochRows(database(env), before, 21);
      return json({ items: rows.slice(0, 20).map(epochSummary), next: rows.length > 20 ? rows[19].epoch : null, chainId: CHAIN_ID });
    }
    const epoch = integer(path.split('/')[1], 'epoch');
    const row = await database(env).prepare("SELECT * FROM mining_reward_epochs WHERE epoch=? AND state IN ('prepared','active')").bind(epoch).first<EpochRow>();
    if (!row) fail(404, 'This epoch has no published allocation.');
    const m = manifestFor(row!);
    if (path.endsWith('/manifest')) return new Response(JSON.stringify(m, null, 2) + '\n', { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="perla-epoch-${epoch}.json"`, 'Cache-Control': 'no-store' } });
    const chain = await chainEpoch(env, row!);
    return json({ ...epochSummary(row!), ...chain });
  } catch (error) { return error instanceof PortalError ? json({ error: error.message }, error.status) : json({ error: 'The public record could not be read or validated.' }, 503); }
}
