'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { Activity, ArrowDown, ArrowUpRight, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';
import { Pill, getProvider } from '@/components/auren/shared';
import { rewardsAbi } from '@/lib/perla/rewards';
import { ensureTestnet, miningApi, short, tokenAmount, useMiningAccount } from './mining-client';
import { TreasuryPanel } from './treasury-panel';
import { DateValue, EpochClock, EvidenceNote, StatePill } from './portal-ui';

type TokenInfo = { symbol: string; decimals: number } | null;
export type EpochSummary = { epoch: number; root: string; budget: string; distributor: Address; token: Address; state: string; created: number; totalPoints: string; recipients: number; chainId: number; recordedTokenInfo: TokenInfo };
type Allocation = EpochSummary & { index: number; address: Address; amount: string; points: number; proof: Hex[]; status: string; tokenInfo: TokenInfo; verification: string; checkedAt: number };
type RewardAccount = { address: string; items: Allocation[]; epochWindow: number; next: number | null; checkedAt: number };
type Transaction = { hash: string; state: 'pending' | 'included' | 'finalized' | 'failed' };
const allocationKey = (item: Allocation) => `${item.distributor.toLowerCase()}:${item.epoch}:${item.index}`;
const transactionUrl = (hash: string) => 'https://explorer.testnet.chain.robinhood.com/tx/' + hash;

export function RewardCenter({ initialTab = 'epochs', compact = false }: { initialTab?: 'epochs' | 'mine'; compact?: boolean }) {
  const { account, loading, busy, error, signIn } = useMiningAccount();
  const [tab, setTab] = useState(initialTab); const [epochs, setEpochs] = useState<EpochSummary[] | null>(null); const [next, setNext] = useState<number | null>(null);
  const [networkError, setNetworkError] = useState(''); const [loadingEpochs, setLoadingEpochs] = useState(false);
  const [rewards, setRewards] = useState<RewardAccount | null>(null); const [rewardError, setRewardError] = useState(''); const [checkingRewards, setCheckingRewards] = useState(false);
  const [rewardCursor, setRewardCursor] = useState<number | undefined>();
  const rewardRequest = useRef(0);
  const [transactions, setTransactions] = useState<Record<string, Transaction>>({}); const [claiming, setClaiming] = useState(''); const [notice, setNotice] = useState('');
  const loadEpochs = useCallback(async (before?: number) => {
    setLoadingEpochs(true); setNetworkError('');
    try { const data = await miningApi<{ items: EpochSummary[]; next: number | null }>('epochs' + (before === undefined ? '' : '?before=' + before)); setEpochs(previous => before !== undefined && previous ? [...previous, ...data.items.filter(item => !previous.some(p => p.epoch === item.epoch))] : data.items); setNext(data.next); }
    catch (e) { setNetworkError(e instanceof Error ? e.message : 'Epoch records unavailable.'); }
    finally { setLoadingEpochs(false); }
  }, []);
  useEffect(() => { void loadEpochs(); }, [loadEpochs]);
  const address = account?.address;
  const reloadRewards = useCallback(async () => {
    if (!address) return;
    const request = ++rewardRequest.current;
    setCheckingRewards(true); setRewardError('');
    try { const data = await miningApi<RewardAccount>('rewards/account' + (rewardCursor === undefined ? '' : '?before=' + rewardCursor)); if (request === rewardRequest.current) setRewards(data); }
    catch (e) { if (request === rewardRequest.current) setRewardError(e instanceof Error ? e.message : 'Reward checks are unavailable.'); }
    finally { if (request === rewardRequest.current) setCheckingRewards(false); }
  }, [address, rewardCursor]);
  useEffect(() => {
    setRewards(null); setTransactions({}); setNotice(''); setRewardCursor(undefined);
    if (!address) return;
    try {
      const raw = localStorage.getItem('perla:claims:46630:' + address); const saved = raw && raw.length < 20_000 ? JSON.parse(raw) : {};
      const safe: Record<string, Transaction> = {};
      for (const [key, value] of Object.entries(saved).slice(-30)) {
        const tx = value as Transaction;
        if (/^0x[a-f0-9]{40}:\d+:\d+$/.test(key) && /^0x[a-f0-9]{64}$/i.test(tx.hash) && ['pending', 'included', 'finalized', 'failed'].includes(tx.state)) safe[key] = tx;
      }
      setTransactions(safe);
    } catch { /* A malformed local transaction cache is ignored. */ }
  }, [address]);
  useEffect(() => {
    setRewards(null);
    if (!address) return;
    void reloadRewards();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void reloadRewards(); }, 20_000);
    return () => { clearInterval(timer); rewardRequest.current++; };
  }, [address, reloadRewards]);
  const remember = useCallback((key: string, transaction: Transaction) => {
    setTransactions(previous => {
      const value = { ...previous, [key]: transaction };
      if (address) try { localStorage.setItem('perla:claims:46630:' + address, JSON.stringify(value)); } catch {}
      return value;
    });
  }, [address]);
  function dismissTransaction(key: string) {
    setTransactions(previous => {
      const value = { ...previous }; delete value[key];
      if (address) try { localStorage.setItem('perla:claims:46630:' + address, JSON.stringify(value)); } catch {}
      return value;
    });
    setNotice('Transaction tracking dismissed. Check for any pending transaction in your wallet before submitting another claim.');
    void reloadRewards();
  }
  useEffect(() => {
    if (!address || !Object.values(transactions).some(tx => ['pending','included'].includes(tx.state))) return;
    let stopped = false; let running = false;
    const poll = async () => {
      if (running || document.visibilityState !== 'visible') return; running = true;
      try {
        const provider = getProvider(); if (!provider || Number(await provider.request({ method: 'eth_chainId' })) !== 46630) return;
        for (const [key, tx] of Object.entries(transactions)) {
          if (!['pending','included'].includes(tx.state)) continue;
          const value = await provider.request({ method: 'eth_getTransactionReceipt', params: [tx.hash] }) as { to?: string; status?: string; blockNumber?:string; blockHash?:string } | null;
          if(stopped)continue;
          if(!value){if(tx.state==='included')remember(key,{hash:tx.hash,state:'pending'});continue;}
          if(!value.blockNumber||!value.blockHash)continue;
          const canonical=await provider.request({method:'eth_getBlockByNumber',params:[value.blockNumber,false]}) as {hash?:string}|null;
          if(canonical?.hash!==value.blockHash){remember(key,{hash:tx.hash,state:'pending'});continue;}
          if (value.to?.toLowerCase() !== key.split(':')[0]) continue;
          if (value.status === '0x1' || value.status === '0x0') {
            let finalized=false;try{const block=await provider.request({method:'eth_getBlockByNumber',params:['finalized',false]}) as {number?:string}|null;finalized=!!block?.number&&BigInt(block.number)>=BigInt(value.blockNumber);}catch{}
            remember(key, { hash: tx.hash, state: value.status === '0x0' ? 'failed' : finalized ? 'finalized' : 'included' });
            setNotice(value.status === '0x1' ? finalized ? 'Claim finalized. Refreshing the contract state.' : 'Claim included in a block. Finalization is still pending.' : 'The claim transaction reverted. Inspect the transaction before trying again.');
            void reloadRewards();
          }
        }
      } catch { /* Keep the pending record; never infer confirmation from a timeout. */ }
      finally { running = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 5000);
    return () => { stopped = true; clearInterval(timer); };
  }, [address, transactions, remember, reloadRewards]);
  async function claim(item: Allocation) {
    const key = allocationKey(item); setClaiming(key); setNotice(''); setRewardError('');
    try {
      const provider = await ensureTestnet();
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (!Array.isArray(accounts) || String(accounts[0]).toLowerCase() !== address?.toLowerCase()) throw Error('Select the signed-in recipient wallet before claiming.');
      const fresh = await miningApi<RewardAccount>('rewards/account' + (rewardCursor === undefined ? '' : '?before=' + rewardCursor)); setRewards(fresh);
      const allocation = fresh.items.find(a => allocationKey(a) === key);
      if (!allocation || allocation.status !== 'claimable') throw Error('This allocation is not currently claimable. Its status has been refreshed.');
      const hash = await provider.request({ method: 'eth_sendTransaction', params: [{ from: accounts[0], to: allocation.distributor, data: encodeFunctionData({ abi: rewardsAbi, functionName: 'claim', args: [BigInt(allocation.epoch), BigInt(allocation.index), allocation.address, BigInt(allocation.amount), allocation.proof] }) }] });
      if (typeof hash !== 'string' || !/^0x[a-f0-9]{64}$/i.test(hash)) throw Error('The wallet did not return a valid transaction hash. Check its activity before retrying.');
      remember(key, { hash, state: 'pending' }); setNotice('Claim transaction submitted. Waiting for its receipt and contract confirmation.');
    } catch (e) { setRewardError((e instanceof Error ? e.message : 'Claim was not completed.').slice(0, 350)); }
    finally { setClaiming(''); }
  }
  const currentRewards = rewards?.address.toLowerCase() === address?.toLowerCase() ? rewards : null;
  return <div className={compact ? 'reward-center portal-compact' : 'reward-center'}>
    {!compact && <div className="portal-intro"><div><span className="eyebrow">PERLA / REWARD CENTER</span><h1>From accepted work.<br/><em>To a funded allocation.</em></h1><p>Follow published epoch budgets, inspect distributions, and claim eligible testnet rewards.</p></div><EpochClock/></div>}
    {!compact && <TreasuryPanel/>}
    <div className="portal-tabs" role="group" aria-label="Reward views"><button aria-pressed={tab === 'epochs'} className={tab === 'epochs' ? 'active' : ''} onClick={() => setTab('epochs')}>Network epochs</button><button aria-pressed={tab === 'mine'} className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>My rewards</button><span>Robinhood Testnet</span></div>
    {tab === 'epochs' ? <section className="portal-card"><div className="portal-card-head"><div><span className="micro">PUBLISHED DISTRIBUTIONS</span><h2>Every epoch, explained.</h2></div><button className="icon-btn" aria-label="Refresh published epochs" disabled={loadingEpochs} onClick={() => void loadEpochs()}><RefreshCw size={17}/></button></div>
      {networkError && <p className="portal-error" role="alert">{networkError}</p>}
      {!epochs && loadingEpochs ? <div className="portal-empty" role="status">Loading published epochs…</div> : epochs?.length ? <><div className="portal-table-wrap"><table className="portal-table"><thead><tr><th>Epoch</th><th>Published budget</th><th>Recipients</th><th>Points</th><th>Publication</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{epochs.map(item => { const amount = tokenAmount(item.budget, item.recordedTokenInfo); return <tr key={item.epoch}><td><Link className="portal-link" href={'/rewards/' + item.epoch}>{item.epoch}</Link><small><DateValue seconds={item.epoch * 86400}/></small></td><td title={item.budget + ' base units'}>{amount.value}<small>{amount.unit}</small></td><td>{item.recipients}</td><td>{BigInt(item.totalPoints).toLocaleString()}</td><td><StatePill state={item.state}/></td><td><Link className="portal-link" href={'/rewards/' + item.epoch}>Details<ArrowUpRight size={13}/></Link></td></tr>; })}</tbody></table></div>{next !== null && <button className="button button-outline portal-load-more" disabled={loadingEpochs} onClick={() => void loadEpochs(next)}>Earlier epochs<ArrowDown size={15}/></button>}<p className="portal-caption portal-inset">Publication status comes from the ledger. Open an epoch for its current contract funding check.</p></> : !networkError && <div className="portal-empty"><ShieldCheck size={31}/><h3>The first distribution starts with accepted work.</h3><p>No reward allocation has been published. After a UTC epoch closes and its jobs expire, the operator can prepare and fund its distribution.</p><Link href="/explorer" className="arrow-link">Explore accepted work<ArrowUpRight size={15}/></Link></div>}
    </section> : <>
      {(error || rewardError) && <p className="portal-error" role="alert">{rewardError || error}</p>}{notice && <p className="portal-notice" role="status">{notice}</p>}
      {!account ? <section className="portal-card portal-empty"><Wallet size={32}/><h2>Your wallet. Your allocation.</h2><p>Sign a one-time message to view your reward status. Signing in does not send a transaction.</p><button className="button button-dark" disabled={busy || loading} onClick={() => void signIn()}>{busy ? 'Waiting for wallet…' : loading ? 'Checking session…' : 'Sign in with wallet'}<ArrowUpRight size={15}/></button></section> : <>
        <div className="portal-metrics reward-metrics"><article><Wallet size={18}/><span>Recipient</span><strong className="portal-address-stat">{short(account.address, 5)}</strong></article><article><ShieldCheck size={18}/><span>Claimable in this view</span><strong>{currentRewards ? currentRewards.items.filter(a => a.status === 'claimable').length : '—'}</strong></article><article><Activity size={18}/><span>Claimed in this view</span><strong>{currentRewards ? currentRewards.items.filter(a => a.status === 'claimed').length : '—'}</strong></article><article><RefreshCw size={18}/><span>Awaiting funding / activation</span><strong>{currentRewards ? currentRewards.items.filter(a => ['pending', 'funded'].includes(a.status)).length : '—'}</strong></article></div>
        <section className="portal-card"><div className="portal-card-head"><div><h2>Your epoch allocations</h2><p className="portal-caption">20 published epochs per page. Status is checked against chain 46630.</p></div><button className="icon-btn" aria-label="Refresh reward contract status" disabled={checkingRewards} onClick={() => void reloadRewards()}><RefreshCw size={17}/></button></div>
          {!currentRewards && checkingRewards ? <div className="portal-empty" role="status">Checking allocation and contract state…</div> : currentRewards?.items.length ? <div className="portal-allocation-list">{currentRewards.items.map(item => { const key = allocationKey(item), tx = transactions[key], amount = tokenAmount(item.amount, item.tokenInfo || item.recordedTokenInfo); const pending = tx?.state === 'pending' || tx?.state === 'included' && item.status !== 'claimed'; return <article key={key}><div><Link className="portal-link" href={'/rewards/' + item.epoch}>Epoch {item.epoch}<ArrowUpRight size={13}/></Link><StatePill state={item.status}/><p>{item.points} of {BigInt(item.totalPoints).toLocaleString()} epoch points</p></div><div className="portal-allocation-amount"><strong title={item.amount + ' base units'}>{amount.value}<small>{amount.unit}</small></strong><span>Recipient: {short(item.address, 5)}</span></div><div className="portal-allocation-action"><button className="button button-dark button-small" disabled={!!claiming || item.status !== 'claimable' || pending} onClick={() => void claim(item)}>{claiming === key ? 'Waiting for wallet…' : item.status === 'claimed' ? 'Claimed' : pending ? 'Confirming…' : 'Claim reward'}<ArrowUpRight size={13}/></button>{tx && <a className="portal-link" href={transactionUrl(tx.hash)} target="_blank" rel="noopener noreferrer">{tx.state === 'pending' ? 'Pending transaction' : tx.state === 'failed' ? 'Reverted transaction' : tx.state === 'finalized' ? 'Finalized transaction' : 'Included · awaiting finality'}<ArrowUpRight size={12}/></a>}{tx && item.status !== 'claimed' && <button className="text-button" onClick={() => dismissTransaction(key)}>Dismiss transaction tracking</button>}</div></article>; })}</div> : !rewardError && <div className="portal-empty"><Wallet size={30}/><h3>No allocation in this epoch window.</h3><p>Your accepted contributions appear in the mining dashboard. Token allocations follow publication and funding of an epoch.</p><Link href="/platform/mining" className="arrow-link">View your contributions<ArrowUpRight size={15}/></Link></div>}
          {(currentRewards?.next !== null && currentRewards?.next !== undefined || rewardCursor !== undefined) && <div className="portal-actions portal-inset">{rewardCursor !== undefined && <button className="button button-outline button-small" disabled={checkingRewards} onClick={() => setRewardCursor(undefined)}>Latest epochs</button>}{currentRewards?.next !== null && currentRewards?.next !== undefined && <button className="button button-outline button-small" disabled={checkingRewards} onClick={() => setRewardCursor(currentRewards.next!)}>Earlier epochs<ArrowDown size={14}/></button>}</div>}
        </section>
      </>}
    </>}
    <EvidenceNote/>
  </div>;
}
