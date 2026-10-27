'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, Copy, Download, ShieldCheck } from 'lucide-react';
import { Modal, Pill } from '@/components/auren/shared';
import { miningApi } from './mining-client';

export function WorkerDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [copied, setCopied] = useState(false);
  const [created, setCreated] = useState<{ id: string; name: string; endpoint: string; token: string } | null>(null);
  const configuration = created ? `PERLA_ENDPOINT=${created.endpoint}\nPERLA_WORKER_TOKEN=${created.token}\n` : '';
  async function create() {
    setBusy(true); setError('');
    try { setCreated(await miningApi('workers', { method: 'POST', body: JSON.stringify({ name }) })); onCreated(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Worker registration failed.'); }
    finally { setBusy(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([configuration], { type: 'text/plain' }));
    const a = document.createElement('a'); a.href = url; a.download = 'worker.env'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <Modal title={created ? 'Save your worker configuration' : 'Register a GPU worker'} onClose={onClose}><div className="setup-dialog">
    {created ? <><Pill tone="coral">SAVE THIS TOKEN ONCE</Pill><p>Configuration for <strong>{created.name}</strong>. The token is scoped to this worker and cannot spend wallet funds.</p>
      <textarea className="perla-config mono" aria-label="Worker configuration" readOnly value={configuration}/>
      <div className="portal-actions"><button className="button button-dark button-small" onClick={download}><Download size={15}/>Download worker.env</button><button className="button button-outline button-small" onClick={() => void navigator.clipboard.writeText(configuration).then(() => setCopied(true)).catch(() => setError('Copy unavailable. Download the configuration instead.'))}>{copied ? <Check size={15}/> : <Copy size={15}/>} {copied ? 'Copied' : 'Copy'}</button></div>
      <p className="portal-caption">The token is shown only now. If lost, revoke this worker and register a replacement.</p>
      <Link href="/platform/setup" className="arrow-link" onClick={onClose}>Continue with installation<ArrowUpRight size={15}/></Link>
    </> : <><p>Each installation gets its own revocable credential and contribution history.</p><label htmlFor="portal-worker-name">Worker name</label><input id="portal-worker-name" maxLength={48} value={name} onChange={e => setName(e.target.value)} placeholder="My GPU worker" autoComplete="off"/>
      <div className="info-box"><ShieldCheck size={17}/><span>Registration does not reserve hardware or request a payment.</span></div>
      <button className="button button-dark" disabled={busy || !name.trim()} onClick={() => void create()}>{busy ? 'Registering…' : 'Create worker'}<ArrowUpRight size={15}/></button>
    </>}{error && <p className="form-error" role="alert">{error}</p>}
  </div></Modal>;
}
