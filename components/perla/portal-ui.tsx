'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Clock3, ShieldCheck } from 'lucide-react';
import { Pill, CopyButton } from '@/components/auren/shared';
import { utcDate } from './mining-client';

export function EpochClock() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const left = now === null ? null : 86400 - Math.floor(now / 1000) % 86400;
  const value = left === null ? '— : — : —' : [Math.floor(left / 3600), Math.floor(left / 60) % 60, left % 60].map(n => String(n).padStart(2, '0')).join(' : ');
  return <div className="epoch-clock"><span className="micro"><Clock3 size={14}/>CURRENT UTC EPOCH CLOSES IN</span><strong>{value}</strong><p>Allocation preparation opens after a five-minute job grace period. Closing an epoch does not fund a reward.</p></div>;
}
export function CommandBlock({ value, label }: { value: string; label: string }) {
  return <div className="portal-command"><div><span>{label}</span><CopyButton value={value} label="Copy command"/></div><pre><code>{value}</code></pre></div>;
}
export function RecordField({ label, value, href }: { label: string; value: string; href?: string }) {
  return <div className="record-field"><dt>{label}</dt><dd>{href ? <Link className="mono portal-value" href={href}>{value}<ArrowUpRight size={13}/></Link> : <span className="mono portal-value">{value}</span>}<CopyButton value={value} label="Copy"/></dd></div>;
}
export function StatePill({ state }: { state: string }) {
  const labels: Record<string, string> = { prepared: 'Prepared', active: 'Activated', pending: 'Awaiting funding', funded: 'Awaiting activation', claimable: 'Claimable', claimed: 'Claimed', unavailable: 'Check unavailable', mismatch: 'Contract mismatch', unfunded: 'Not funded' };
  return <Pill tone={['claimable', 'claimed', 'active'].includes(state) ? 'green' : ['unavailable', 'mismatch'].includes(state) ? 'coral' : 'neutral'}>{labels[state] || state}</Pill>;
}
export function EvidenceNote() { return <p className="portal-evidence"><ShieldCheck size={16}/><span>Records are published by the Perla operator. Native verification runs offchain; reward contracts enforce the funded allocation.</span></p>; }
export function DateValue({ seconds }: { seconds: number }) { return <time dateTime={new Date(seconds * 1000).toISOString()}>{utcDate(seconds)}</time>; }
