'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Activity, ArrowDown, ArrowRight, ArrowUpRight, Check, Cpu, Search, ShieldCheck, Users, X } from 'lucide-react';
import { Pill } from '@/components/auren/shared';
import { miningApi, short, type Share } from './mining-client';
import { DateValue, EvidenceNote } from './portal-ui';

type PublicShare = Share & { address: string };
type Records = { items: PublicShare[]; next: string | null; query: string };
type Overview = { shares: number; points: number; contributors: number; activeWorkers: number; miningEnabled: boolean; epoch: number; checkedAt: number; daily: { epoch: number; shares: number; points: number }[] };
export function ProofExplorer() {
  const router = useRouter(); const searchParams = useSearchParams();
  const [query, setQuery] = useState(''); const [records, setRecords] = useState<Records | null>(null); const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [epochFilter, setEpochFilter] = useState('');
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async (search: string, epoch: string, before?: string, append = false) => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setLoading(true); setError(''); if (!append) setRecords(null);
    const params = new URLSearchParams(); if (search.trim()) params.set('q', search.trim()); if (epoch) params.set('epoch', epoch); if (before) params.set('before', before);
    try {
      const data = await miningApi<Records>('explorer?' + params, { signal: abort.signal });
      setRecords(previous => append && previous ? { ...data, items: [...previous.items, ...data.items.filter(item => !previous.items.some(p => p.id === item.id))] } : data);
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : 'Records unavailable.'); }
    finally { if (!abort.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    const q = searchParams.get('q') || '', epoch = searchParams.get('epoch') || ''; setQuery(q); setEpochFilter(epoch); void load(q, epoch);
  }, [searchParams, load]);
  useEffect(() => {
    let mounted = true;
    const refresh = () => miningApi<Overview>('overview').then(value => { if (mounted) setOverview(value); }).catch(() => { if (mounted) setOverview(null); });
    void refresh(); const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30_000);
    return () => { mounted = false; controller.current?.abort(); clearInterval(timer); };
  }, [load]);
  function search(value = query, epoch = epochFilter) {
    const params = new URLSearchParams(); if (value.trim()) params.set('q', value.trim()); if (epoch) params.set('epoch', epoch);
    const next = '/explorer' + (params.size ? '?' + params : '');
    if (next === location.pathname + location.search) void load(value, epoch);
    else router.push(next, { scroll: false });
  }
  const max = Math.max(1, ...(overview?.daily.map(d => d.shares) || []));
  return <>
    <div className="portal-intro"><div><span className="eyebrow">PERLA / PROOF EXPLORER</span><h1>Every contribution.<br/><em>A record you can follow.</em></h1><p>Explore accepted native proofs and the wallets they contribute to.</p></div><div className="portal-intro-side"><Pill tone={overview?.miningEnabled ? 'green' : 'neutral'}>{overview ? overview.miningEnabled ? 'Work admission enabled' : 'Work admission paused' : 'Reading service status'}</Pill><span>Robinhood Testnet · 46630</span></div></div>
    <div className="portal-metrics"><article><ShieldCheck size={18}/><span>Accepted shares</span><strong>{overview?.shares.toLocaleString() ?? '—'}</strong></article><article><Activity size={18}/><span>Contribution points</span><strong>{overview?.points.toLocaleString() ?? '—'}</strong></article><article><Cpu size={18}/><span>Online workers</span><strong>{overview?.activeWorkers.toLocaleString() ?? '—'}</strong></article><article><Users size={18}/><span>Contributing wallets</span><strong>{overview?.contributors.toLocaleString() ?? '—'}</strong></article></div>
    <section className="portal-activity"><div><span className="micro">ACCEPTED SHARES / LAST 14 UTC EPOCHS</span><h2>Work, over time.</h2><p>{overview ? `${overview.daily.reduce((sum, d) => sum + d.shares, 0).toLocaleString()} accepted shares in this window.` : 'Activity data is currently unavailable.'}</p></div><div className="portal-bars" role="img" aria-label={overview ? overview.daily.map(d => `${new Date(d.epoch * 86400000).toISOString().slice(0, 10)}: ${d.shares} accepted shares`).join('; ') : 'Activity unavailable'}>{overview?.daily.map(d => <div key={d.epoch} title={`${new Date(d.epoch * 86400000).toISOString().slice(0, 10)} · ${d.shares} shares`}><i style={{ height: d.shares ? `${Math.max(4, d.shares / max * 100)}%` : '2px' }} className={d.shares ? '' : 'empty'}/></div>)}</div></section>
    <section className="portal-card"><div className="portal-card-head"><div><span className="micro">PUBLIC CONTRIBUTION LEDGER</span><h2>Find accepted work.</h2></div><Link className="arrow-link" href="/docs#verification">What is verified<ArrowUpRight size={14}/></Link></div>
      <form className="portal-search" onSubmit={e => { e.preventDefault(); search(); }}><label className="sr-only" htmlFor="proof-search">Wallet address, worker/job/receipt ID, or proof hash</label><Search size={19}/><input id="proof-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Wallet address, worker/job ID, or proof hash" maxLength={80} autoComplete="off"/><button type="submit" className="button button-dark button-small" disabled={loading}>Search<ArrowRight size={14}/></button></form>
      {epochFilter && <div className="portal-filter"><Pill>Epoch {epochFilter}</Pill><button onClick={() => search(query, '')}><X size={13}/>Remove epoch filter</button></div>}
      {error && <div className="portal-error" role="alert">{error}<button onClick={() => search('', '')}>Show latest records</button></div>}
      {loading && !records ? <div className="portal-empty" role="status"><Activity size={28}/><h3>Reading contribution records…</h3></div> : records?.items.length ? <><div className="portal-table-wrap"><table className="portal-table"><thead><tr><th>Receipt</th><th>Recipient</th><th>Epoch</th><th>Points</th><th>Accepted</th><th><span className="sr-only">Open receipt</span></th></tr></thead><tbody>{records.items.map(item => <tr key={item.id}><td><Link className="mono portal-link" href={'/explorer/' + item.id}>{short(item.id, 6)}</Link><small><Check size={11}/>Native proof accepted</small></td><td><Link className="mono portal-link" href={'/explorer?q=' + item.address}>{short(item.address, 6)}</Link></td><td><Link className="portal-link" href={'/explorer?epoch=' + item.epoch}>{item.epoch}</Link></td><td>{item.points}</td><td><DateValue seconds={item.accepted}/></td><td><Link href={'/explorer/' + item.id} aria-label={'Open receipt ' + item.id}><ArrowUpRight size={16}/></Link></td></tr>)}</tbody></table></div>{records.next && <button className="button button-outline portal-load-more" disabled={loading} onClick={() => void load(records.query, epochFilter, records.next!, true)}>{loading ? 'Loading…' : 'Load earlier records'}<ArrowDown size={15}/></button>}</> : !error && <div className="portal-empty"><ShieldCheck size={31}/><h3>{query || epochFilter ? 'No matching accepted work.' : 'The ledger is ready for its first contribution.'}</h3><p>{query || epochFilter ? 'Use a full identifier, or return to the latest records.' : 'Contributions appear after a worker submits a valid native proof. Registration alone does not create a record.'}</p><Link href={query || epochFilter ? '/explorer' : '/platform/setup'} className="arrow-link">{query || epochFilter ? 'View latest records' : 'Set up a worker'}<ArrowUpRight size={15}/></Link></div>}
    </section><EvidenceNote/>
  </>;
}
