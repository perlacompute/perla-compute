import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, parseAbiItem, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { auditManifest } from './reward-manifest.mjs';
import { dailyBudget } from '../lib/perla/emission.mjs';
import reviewedDeployment from '../deployments/robinhood-testnet.json' with { type: 'json' };

const tokenAbi = parseAbi(['function owner() view returns(address)', 'function symbol() view returns(string)', 'function decimals() view returns(uint8)', 'function totalSupply() view returns(uint256)', 'function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)', 'function approve(address,uint256) returns(bool)']);
const distributorAbi = parseAbi(['function owner() view returns(address)', 'function rewardToken() view returns(address)', 'function epochs(uint256) view returns(bytes32,uint256,uint256)', 'function fundEpoch(uint256,bytes32,uint256)']);
const fundedEvent = parseAbiItem('event EpochFunded(uint256 indexed epoch, bytes32 root, uint256 budget)');
const chain = defineChain({ id: 46630, name: 'Robinhood Testnet', nativeCurrency: { name: 'Test ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } } });
const zero = '0x' + '0'.repeat(64);
const equal = (a, b) => a.toLowerCase() === b.toLowerCase();
export async function settleRewards({ action = 'review', key, expectedPlan, env = process.env, transport, deployment = reviewedDeployment, operator: providedOperator, log = value => console.log(JSON.stringify(value)) } = {}) {
  if (!['review', 'prepare', 'settle'].includes(action)) throw Error('Use review, prepare or settle.');
  const secret = env.PERLA_OPERATOR_TOKEN;
  async function operator(path, payload) {
    if (providedOperator) return providedOperator(path, payload);
    if (!secret || secret.length < 32) throw Error('Operator authentication is not configured.');
    const response = await fetch('http://127.0.0.1:3000/api/mining/' + path, { method: payload === undefined ? 'GET' : 'POST', headers: { authorization: 'Bearer ' + secret, 'content-type': 'application/json' }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), signal: AbortSignal.timeout(120000), redirect: 'error' });
    const value = await response.json(); if (!response.ok) throw Error(value.error || 'Reward operator request failed.'); return value;
  }
  const queue = await operator('operator/rewards');
  if (!queue.summary.configured || queue.summary.token !== deployment.token.toLowerCase() || queue.summary.distributor !== deployment.distributor.toLowerCase()) throw Error('Pin the reviewed PERL reward schedule first.');
  const plan = [];
  for (const item of queue.items) {
    const manifest = await operator('operator/epochs', { epoch: item.epoch });
    if (manifest.skipped) continue;
    auditManifest(manifest);
    if (manifest.epoch < queue.summary.startEpoch || manifest.budget !== dailyBudget(manifest.epoch - queue.summary.startEpoch + 1).toString() || !equal(manifest.distributor, deployment.distributor)) throw Error('Prepared manifest differs from the pinned local budget rules.');
    plan.push(manifest);
  }
  const budget = plan.reduce((sum, row) => sum + BigInt(row.budget), 0n);
  const planHash = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  const report = { planHash, chainId: 46630, action, epochs: plan.map(m => ({ epoch: m.epoch, budgetPERL: formatUnits(BigInt(m.budget), 18), recipients: m.allocations.length, points: m.totalPoints, root: m.root })), totalScheduledPERL: formatUnits(budget, 18), currentEpoch: queue.summary.epoch, settlementOpensAt: queue.summary.settlementOpensAt, more: queue.more, mainnetTransactions: false, transactionsSent: false };
  if (action === 'review' && plan.length) {
    try {
      const endpoint = new URL(env.PERLA_RPC_URL || chain.rpcUrls.default.http[0]);
      if (!transport && (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash)) throw Error('RPC endpoint invalid');
      const read = createPublicClient({chain,transport:transport || http(endpoint.href,{timeout:15000,retryCount:0})});
      const id = await read.getChainId();
      const actual = await read.readContract({address:deployment.distributor,abi:distributorAbi,functionName:'rewardToken'});
      report.rpcReady = id === 46630 && equal(actual,deployment.token);
    } catch { report.rpcReady = false; }
  }
  log(report);
  if (action !== 'settle' || !plan.length) return report;
  if (expectedPlan !== planHash) throw Error('The prepared plan changed after review. Run the settlement command again; no transaction was sent.');
  if (!/^0x[0-9a-fA-F]{64}$/.test(key || '')) throw Error('A dedicated testnet owner key is required locally; it is never stored.');
  const rpc = new URL(env.PERLA_RPC_URL || chain.rpcUrls.default.http[0]);
  if (!transport && (rpc.protocol !== 'https:' || rpc.username || rpc.password || rpc.hash)) throw Error('Use the reviewed HTTPS testnet RPC.');
  const connection = transport || http(rpc.href, { timeout: 30000, retryCount: 0 });
  const client = createPublicClient({ chain, transport: connection });
  if (await client.getChainId() !== 46630) throw Error('Wrong chain. No transaction was sent.');
  const account = privateKeyToAccount(key), wallet = createWalletClient({ chain, account, transport: connection });
  const [owner, token, symbol, decimals, supply, balance, gas] = await Promise.all([
    client.readContract({ address: deployment.distributor, abi: distributorAbi, functionName: 'owner' }),
    client.readContract({ address: deployment.distributor, abi: distributorAbi, functionName: 'rewardToken' }),
    client.readContract({ address: deployment.token, abi: tokenAbi, functionName: 'symbol' }),
    client.readContract({ address: deployment.token, abi: tokenAbi, functionName: 'decimals' }),
    client.readContract({ address: deployment.token, abi: tokenAbi, functionName: 'totalSupply' }),
    client.readContract({ address: deployment.token, abi: tokenAbi, functionName: 'balanceOf', args: [account.address] }),
    client.getBalance({ address: account.address }),
  ]);
  if (!equal(account.address, owner) || !equal(owner, deployment.owner) || !equal(token, deployment.token) || symbol !== 'PERL' || decimals !== 18 || supply !== 1000000000n * 10n ** 18n) throw Error('Owner, token or fixed testnet supply differs from the reviewed deployment.');
  const states = [];
  for (const m of plan) {
    const state = await client.readContract({ address: deployment.distributor, abi: distributorAbi, functionName: 'epochs', args: [BigInt(m.epoch)] });
    if (state[0] !== zero && (!equal(state[0], m.root) || state[1] !== BigInt(m.budget))) throw Error('An immutable onchain epoch conflicts with the manifest.');
    states.push(state);
  }
  const required = plan.reduce((sum, m, i) => sum + (states[i][0] === zero ? BigInt(m.budget) : 0n), 0n);
  if (balance < required || gas === 0n) throw Error('The testnet owner needs sufficient PERL and test ETH. No funding transaction was sent.');
  const directory = resolve(env.PERLA_SETTLEMENT_DIR || '/app/data/reward-settlement'); await mkdir(directory, { recursive: true, mode: 0o700 });
  async function send(address, abi, functionName, args) {
    const { request } = await client.simulateContract({ account, address, abi, functionName, args });
    const hash = await wallet.writeContract(request); const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120000 });
    if (receipt.status !== 'success') throw Error('The testnet transaction reverted; existing funding records were preserved.'); return hash;
  }
  async function findFunding(m) {
    const saved = await operator('operator/epochs/' + m.epoch);
    if (saved.funding_tx) return saved.funding_tx;
    const file = resolve(directory, 'epoch-' + m.epoch + '.json');
    try { const row = JSON.parse(await readFile(file, 'utf8')); if (row.root === m.root && /^0x[a-f0-9]{64}$/i.test(row.transaction)) return row.transaction; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const first = await client.getTransactionReceipt({ hash: deployment.distributorTransaction });
    const latest = await client.getBlockNumber();
    for (let from = first.blockNumber; from <= latest; from += 5000n) {
      const logs = await client.getLogs({ address: deployment.distributor, event: fundedEvent, args: { epoch: BigInt(m.epoch) }, fromBlock: from, toBlock: from + 4999n > latest ? latest : from + 4999n });
      const found = logs.find(row => row.args.root === m.root && row.args.budget === BigInt(m.budget)); if (found) return found.transactionHash;
    }
    throw Error('A funded epoch has no matching canonical funding event. Preserve the manifest and inspect the chain.');
  }
  const completed = [];
  for (const m of plan) {
    let state = await client.readContract({ address: deployment.distributor, abi: distributorAbi, functionName: 'epochs', args: [BigInt(m.epoch)] });
    let hash;
    if (state[0] === zero) {
      const file = resolve(directory, 'epoch-' + m.epoch + '.json');
      let pending;
      try { pending = JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (pending) {
        if (pending.root !== m.root || !/^0x[a-f0-9]{64}$/i.test(pending.transaction)) throw Error('A prior transaction journal conflicts with this epoch.');
        const receipt = await client.waitForTransactionReceipt({ hash: pending.transaction, timeout: 120000 });
        if (receipt.status !== 'success') throw Error('The recorded funding attempt reverted. Preserve its journal for review.');
        hash = pending.transaction;
      } else {
        const allowance = await client.readContract({ address: deployment.token, abi: tokenAbi, functionName: 'allowance', args: [account.address, deployment.distributor] });
        if (allowance < BigInt(m.budget)) await send(deployment.token, tokenAbi, 'approve', [deployment.distributor, BigInt(m.budget)]);
        const { request } = await client.simulateContract({ account, address: deployment.distributor, abi: distributorAbi, functionName: 'fundEpoch', args: [BigInt(m.epoch), m.root, BigInt(m.budget)] });
        hash = await wallet.writeContract(request);
        const temporary = file + '.tmp'; await writeFile(temporary, JSON.stringify({ epoch: m.epoch, root: m.root, transaction: hash }) + '\n', { mode: 0o600 }); await rename(temporary, file);
        const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120000 }); if (receipt.status !== 'success') throw Error('Funding reverted; the transaction journal was retained.');
      }
    } else hash = await findFunding(m);
    await operator('operator/epochs/' + m.epoch + '/funding', { transaction: hash });
    await operator('operator/epochs/' + m.epoch + '/activate', {});
    const result = { epoch: m.epoch, state: 'active', transaction: hash, budgetPERL: formatUnits(BigInt(m.budget), 18), claimableAllocationsRequireFreshChainCheck: true, finality: 'Included and checked against the canonical chain; not a finalization guarantee.' }; completed.push(result); log(result);
  }
  return { ...report, completed, transactionsSent: required > 0n };
}

export async function cli() {
  let input = '';
  try {
    for await (const part of process.stdin) { input += part; if (input.length > 1000) throw Error('Invalid local reward request.'); }
    const request = JSON.parse(input || '{}');
    await settleRewards({action: request.action, key: request.key, expectedPlan: request.expectedPlan});
  } catch (error) {
    // Do not serialize wallet errors: RPC details may contain signed transactions or environment values.
    const message = error?.name === 'Error' && error.message?.length < 300 ? error.message : 'Reward operation stopped. Existing funding and journals were preserved; rerun to reconcile.';
    console.error(message.replace(/0x[a-fA-F0-9]{64}/g, '[redacted]')); process.exitCode = 1;
  }
}
