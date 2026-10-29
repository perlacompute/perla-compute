'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';
import { miningApi, useMiningAccount, utcDate } from './mining-client';
import { monitorReconnect } from '@/lib/perla/reconnect-monitor';
import { WorkerIdentity } from './worker-identity';
import styles from './worker-identity.module.css';
type Info = { workerId: string; name: string; address: string; expires: number; approved: boolean; completed: boolean };
export function WorkerReconnect({ initialCode = '' }: { initialCode?: string }) {
  const { account, loading, busy, error, signIn } = useMiningAccount();
  const [code, setCode] = useState(initialCode), [info, setInfo] = useState<Info | null>(null), [message, setMessage] = useState(''), [checked, setChecked] = useState(false), [sending, setSending] = useState(false), [retrying, setRetrying] = useState(false);
  const generation = useRef(0);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const monitor = useRef<ReturnType<typeof monitorReconnect<Info>> | null>(null);
  const approval = useRef<AbortController | null>(null);
  useEffect(() => { setCode(initialCode); }, [initialCode]);
  useEffect(() => {
    setInfo(null); setChecked(false); setMessage(''); setSending(false); setRetrying(false); setNeedsSignIn(false); const request = ++generation.current;
    if (!account || !/^[A-F0-9]{12}$/.test(code)) return;
    const watcher = monitorReconnect<Info>({
      load: signal => miningApi<Info>('worker/reconnect/info', { method: 'POST', body: JSON.stringify({ code }), signal }),
      value: value => { if (request === generation.current) { setInfo(value); setNeedsSignIn(false); } },
      error: (text, willRetry, status) => { if (request !== generation.current) return; setMessage(text); setRetrying(willRetry); if (text && !willRetry) setInfo(null); if (status === 401) setNeedsSignIn(true); },
    });
    monitor.current = watcher;
    return () => { watcher.stop(); monitor.current = null; approval.current?.abort(); generation.current++; };
  }, [account?.address, code]);
  async function approve() {
    if (!checked || !info || info.approved || info.completed) return;
    const request = generation.current; setSending(true); setMessage('');
    const abort = new AbortController(); approval.current = abort;
    try {
      const value = await miningApi<Info>('worker/reconnect/approve', { method: 'POST', body: JSON.stringify({ code }), signal: abort.signal });
      if (request !== generation.current) return; setInfo(value);
      void monitor.current?.refresh();
    } catch (e) { if (request === generation.current && !abort.signal.aborted) { setMessage(e instanceof TypeError ? 'Connection interrupted. Checking whether approval was saved…' : e instanceof Error ? e.message : 'Approval confirmation unavailable.'); void monitor.current?.refresh(); } }
    finally { if (request === generation.current) setSending(false); }
  }
  return <div className={'portal-workspace ' + styles.approval}><div className="portal-intro"><div><span className="eyebrow">PERLA / USE EXISTING WORKER</span><h1>A new machine.<br/><em>The same worker.</em></h1><p>Keep your Worker ID, name, reward wallet and contribution history.</p></div></div><section className="portal-card portal-inset"><ShieldCheck size={25}/><h2>Authorize your new GPU machine.</h2><p className={styles.help}>Start the reconnect command on your new machine, then compare its confirmation code here. Approval replaces the old machine credential. Your wallet key stays in your wallet and no blockchain transaction is required.</p><label htmlFor="reconnect-code">Confirmation code from your GPU terminal<input id="reconnect-code" type="text" value={code} maxLength={12} autoComplete="off" spellCheck={false} onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-F0-9]/g, ''))}/></label>
    {(message || (!account && error)) && <p className="portal-error" role="alert">{message || error}</p>}
    {!account || needsSignIn ? <button className="button button-dark" disabled={loading || busy} onClick={() => void signIn().then(() => monitor.current?.refresh())}>{busy ? 'Waiting for wallet…' : 'Connect owner wallet'}<ArrowUpRight size={15}/></button> : info ? <><dl><div><dt>Worker name</dt><dd>{info.name}</dd></div><div><dt>Worker identity</dt><dd><WorkerIdentity id={info.workerId}/></dd></div><div><dt>Reward wallet · retained</dt><dd>{info.address}</dd></div><div><dt>Request expires</dt><dd>{utcDate(info.expires)}</dd></div></dl>{info.completed ? <div className={styles.notice} role="status">Worker reconnected. The previous machine credential is disabled. Return to your GPU terminal to follow its hardware checks and mining result.</div> : info.approved ? <div className={styles.notice} role="status">{retrying ? 'Approval was confirmed. Reconnecting to check whether the transfer completed…' : 'Approved. Keep the GPU terminal running to finish the transfer. Old access is replaced when that machine completes the exchange.'}</div> : <><label className={styles.confirm}><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)}/><span>I started this request and code <strong className={styles.code}>{code}</strong> matches my new GPU terminal.</span></label><button className="button button-dark" disabled={!checked || sending} onClick={() => void approve()}>{sending ? 'Authorizing…' : 'Authorize this machine'}<ArrowUpRight size={15}/></button></>}</> : <p className={styles.help}>{/^[A-F0-9]{12}$/.test(code) ? 'Checking that this worker belongs to your wallet…' : 'Enter the complete 12-character code to inspect the worker.'}</p>}
    <p className={styles.help}>This action creates no contribution points or token rewards. The new machine must pass its own GPU checks. Previously accepted work remains recorded.</p><Link href="/platform/mining" className="arrow-link">Your workers<ArrowUpRight size={14}/></Link></section></div>;
}
