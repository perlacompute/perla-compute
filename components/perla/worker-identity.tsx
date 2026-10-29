'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Check, Copy, ArrowUpRight } from 'lucide-react';
import styles from './worker-identity.module.css';
export function WorkerIdentity({ id, move = false }: { id: string; move?: boolean }) {
  const [copied, setCopied] = useState(false), [error, setError] = useState('');
  async function copy() {
    try { await navigator.clipboard.writeText(id); setCopied(true); setError(''); setTimeout(() => setCopied(false), 2000); }
    catch { setError('Select and copy the full Worker ID above.'); }
  }
  return <div className={styles.identity}><span>Permanent Worker ID</span><div className={styles.row}><code>{id}</code><button type="button" aria-label={'Copy Worker ID ' + id} onClick={() => void copy()}>{copied ? <Check size={12}/> : <Copy size={12}/>}<span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span></button></div>{error && <small role="status">{error}</small>}{move && <Link className={styles.move} href={'/platform/setup?worker=' + encodeURIComponent(id)}>Use on another machine<ArrowUpRight size={12}/></Link>}</div>;
}
