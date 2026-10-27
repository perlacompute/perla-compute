'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, Check, ShieldCheck } from 'lucide-react';
import { CopyButton, Pill } from '@/components/auren/shared';
import { miningApi, utcDate } from './mining-client';
import { EvidenceNote, RecordField, StatePill } from './portal-ui';

type Receipt = { id: string; job_id: string; worker_id: string; address: string; epoch: number; proof_hash: string; headerHash: string | null; accepted: number; points: number; protocol: string; upstreamCommit: string; evidence: string; rewardEpoch: { epoch: number; state: string } | null };
export function ProofReceipt({ id }: { id: string }) {
  const [receipt, setReceipt] = useState<Receipt | null>(null); const [error, setError] = useState('');
  useEffect(() => { const abort = new AbortController(); miningApi<Receipt>('explorer/' + encodeURIComponent(id), { signal: abort.signal }).then(setReceipt).catch(e => { if (!abort.signal.aborted) setError(e.message); }); return () => abort.abort(); }, [id]);
  return <><Link href="/explorer" className="portal-back"><ArrowLeft size={15}/>Back to explorer</Link><div className="portal-intro"><div><span className="eyebrow">PERLA / CONTRIBUTION RECEIPT</span><h1>Accepted work.<br/><em>A traceable record.</em></h1></div>{receipt && <Pill tone="green"><Check size={13}/>Native proof accepted</Pill>}</div>
    {error ? <div className="portal-empty portal-card" role="alert"><ShieldCheck size={30}/><h3>Receipt unavailable.</h3><p>{error}</p><Link href="/explorer" className="arrow-link">Search accepted work<ArrowUpRight size={15}/></Link></div> : !receipt ? <div className="portal-empty portal-card" role="status">Loading receipt…</div> : <>
      <div className="portal-receipt-top"><div><span className="micro">CONTRIBUTION CREDIT</span><strong>{receipt.points}<small>point{receipt.points === 1 ? '' : 's'}</small></strong><p>{utcDate(receipt.accepted)}</p></div><div><span className="micro">REWARD EPOCH</span><h2>{receipt.epoch}</h2>{receipt.rewardEpoch ? <><StatePill state={receipt.rewardEpoch.state}/><Link className="arrow-link" href={'/rewards/' + receipt.epoch}>View allocation<ArrowUpRight size={15}/></Link></> : <p>No allocation has been published for this epoch.</p>}</div><div><span className="micro">SHARE THIS RECORD</span><p>A public receipt for this accepted contribution.</p><CopyButton value={typeof window === 'undefined' ? '' : window.location.origin + '/explorer/' + receipt.id} label="Copy receipt link"/></div></div>
      <section className="portal-card portal-record"><div className="portal-card-head"><h2>Receipt details</h2><Pill>Robinhood Testnet</Pill></div><dl>
        <RecordField label="Receipt ID" value={receipt.id}/><RecordField label="Recipient wallet" value={receipt.address} href={'/explorer?q=' + receipt.address}/><RecordField label="Worker ID" value={receipt.worker_id} href={'/explorer?q=' + receipt.worker_id}/><RecordField label="Job ID" value={receipt.job_id}/><RecordField label="Proof SHA-256" value={receipt.proof_hash}/>{receipt.headerHash && <RecordField label="Challenge SHA-256" value={receipt.headerHash}/>}<RecordField label="Protocol" value={receipt.protocol}/><RecordField label="Pinned upstream revision" value={receipt.upstreamCommit} href={'https://github.com/pearl-research-labs/pearl/tree/' + receipt.upstreamCommit}/>
      </dl></section><p className="portal-caption">{receipt.evidence}</p><EvidenceNote/>
    </>}
  </>;
}
