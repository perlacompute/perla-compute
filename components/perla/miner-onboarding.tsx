'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, Cpu, ShieldCheck, Terminal, Wallet } from 'lucide-react';
import { miningApi, useMiningAccount, type MiningAccount } from './mining-client';
import { CommandBlock } from './portal-ui';
import { namedWorkerCommand, workerCommands, workerRelease } from '@/lib/perla/worker-release';
import styles from './miner-setup.module.css';

export function SetupProgress({ account, compact = false }: { account: MiningAccount | null; compact?: boolean }) {
 const steps = [{ label: 'Dashboard wallet', done: !!account }, { label: 'Worker connected', done: !!account?.workers.some(w => !w.revoked) }, { label: 'Worker contact', done: !!account?.workers.some(w => w.last_seen) }, { label: 'Accepted share', done: !!account?.totals.shares }];
 return <div className={'setup-progress ' + (compact ? 'compact' : '')}><div><span className="micro">YOUR MINING SETUP</span><span>{steps.filter(s => s.done).length} / 4 account milestones</span></div><ol>{steps.map((s, i) => <li key={s.label} className={s.done ? 'done' : ''}><span>{s.done ? <Check size={13}/> : i + 1}</span><strong>{s.label}</strong></li>)}</ol>{compact && <Link className="arrow-link" href="/platform/setup">Open miner setup<ArrowUpRight size={14}/></Link>}</div>;
}
export function MinerOnboarding() {
 const { account, loading, busy, error, signIn } = useMiningAccount();
 const [wallet, setWallet] = useState(''), [name, setName] = useState('rig01'), [device, setDevice] = useState(0);
 const [releaseReady, setReleaseReady] = useState(false), [releaseRead, setReleaseRead] = useState(false), [retry, setRetry] = useState(0);
 const [status, setStatus] = useState<{ miningEnabled: boolean } | null>(null), [legacyCode, setLegacyCode] = useState('');
 useEffect(() => { const code = new URLSearchParams(window.location.search).get('pair') || ''; if (/^[A-F0-9]{12}$/.test(code)) setLegacyCode(code); }, []);
 useEffect(() => {
  const abort = new AbortController(); setReleaseRead(false); setReleaseReady(false);
  fetch('/api/worker-release', { signal: abort.signal, cache: 'no-store' }).then(r => r.json()).then(v => { if (!abort.signal.aborted) setReleaseReady(v.state === 'available' && v.integrityVerified === true && v.tag === workerRelease.tag); }).catch(() => {}).finally(() => { if (!abort.signal.aborted) setReleaseRead(true); });
  miningApi<{ miningEnabled: boolean }>('status').then(setStatus).catch(() => {});
  return () => abort.abort();
 }, [retry]);
 let start = ''; try { start = namedWorkerCommand(wallet, name, device); } catch {}
 const command = start ? workerCommands('rtx', device).install + ' && \\\n' + start : '';
 return <div className={'portal-workspace ' + styles.root} data-miner-setup="wallet-worker-v2">
  <header className={styles.intro}><div><span className="eyebrow">PERLA / MINER SETUP</span><h1>Your wallet. Your worker.<br/><em>One command to get ready.</em></h1><p>Choose a rig name. Run on your GPU host. Follow your accepted work here.</p></div><div className={styles.release}>WORKER {workerRelease.version}</div></header>
  <div className={styles.status}><ShieldCheck size={18}/><div><strong>{status ? status.miningEnabled ? 'Work admission is open' : 'Work admission is paused' : 'Checking work admission…'}</strong><span>{status?.miningEnabled ? 'The worker validates your GPU before requesting jobs.' : 'You can connect a worker and validate your GPU now. Accepted work starts when the project admits mining.'}</span></div><Link href="/status">Service status<ArrowUpRight size={14}/></Link></div>
  {legacyCode && <LegacyPairApproval code={legacyCode} account={account} signIn={signIn}/>}
  <section className={styles.minerFlow} aria-label="Generate your mining command">
   <div className={styles.minerIdentity}><span className="micro">01 / YOUR RIG</span><h2>Name your worker.</h2><p>Use your public reward address. Give each machine a name you recognize.</p>
    <label htmlFor="reward-wallet">Reward wallet</label><input id="reward-wallet" spellCheck={false} autoComplete="off" placeholder="0x…" value={wallet} maxLength={42} onChange={e => setWallet(e.target.value.trim())} aria-describedby="wallet-help"/>
    <small id="wallet-help">Public EVM address on Robinhood. Keep the private key in your wallet.</small>
    {account && <button className="button button-small" onClick={() => setWallet(account.address)}>Use connected wallet</button>}
    <label htmlFor="worker-name">Worker name</label><input id="worker-name" spellCheck={false} autoComplete="off" value={name} maxLength={48} onChange={e => setName(e.target.value)} aria-describedby="worker-help"/>
    <small id="worker-help">Examples: rig01, home-4090, server02. Letters, numbers, dots, underscores and hyphens.</small>
    <details className={styles.gpuOptions} data-gpu-selector="advanced-default-0"><summary>Advanced options <span>GPU {device}</span></summary><label htmlFor="gpu-device">GPU to use <span>(optional)</span></label><input id="gpu-device" className={styles.deviceIndex} type="number" min="0" max="63" step="1" value={device} aria-describedby="gpu-device-help" onChange={e => setDevice(Math.max(0, Math.min(63, Math.trunc(Number(e.target.value) || 0))))}/><small id="gpu-device-help">GPU numbering starts at 0: 0 selects the first GPU, 1 selects the second. If your machine has one GPU, keep the default 0. Change this only to choose another available GPU.</small></details>
    <p className={styles.hardwareNote}><Cpu size={16}/> NVIDIA RTX 30 / 40 / 50 · Linux</p><Link className="arrow-link" href="/docs#hopper-validation">H100 / H200 guide<ArrowUpRight size={14}/></Link>
   </div>
   <div className={styles.minerCommand}><span className="micro">02 / GPU TERMINAL</span><h2>Install and start.</h2><p>Copy the generated command to your GPU machine. It installs the pinned release, saves the connection, prepares the runtime and checks the GPU automatically.</p>
    {!start ? <div className={styles.commandEmpty}><Terminal size={25}/><strong>Your command will appear here.</strong><span>Enter a valid reward address and worker name.</span></div> : !releaseReady ? <div className={styles.commandEmpty} role="status"><strong>{releaseRead ? 'Installer availability not confirmed' : 'Checking the GitHub release…'}</strong><span>Commands appear when the pinned public release and its checksums pass verification.</span>{releaseRead && <button className="button button-small" onClick={() => setRetry(n => n + 1)}>Retry check</button>}</div> : <CommandBlock label="Run on your Linux GPU host" value={command}/>}
    <p className={styles.validationNote}>This validation release stops after one accepted share. While admission is paused it uploads the GPU check and exits without requesting work.</p>
    <a className="arrow-link" href={workerRelease.page} target="_blank" rel="noreferrer">Verified release & source<ArrowUpRight size={14}/></a>
   </div>
  </section>
  <section className={styles.followWorker} aria-label="Follow your worker"><Wallet size={20}/><div><h2>Follow your worker.</h2><p>Open the dashboard with the same reward wallet to see connected workers, contribution receipts and rewards. Wallet authorization is used for account management and claims.</p>{error && <p role="alert">{error}</p>}</div>{account ? <Link className="button button-dark button-small" href="/platform/mining">Open dashboard<ArrowUpRight size={14}/></Link> : <button className="button button-dark button-small" disabled={loading || busy} onClick={() => void signIn()}>{busy ? 'Waiting for wallet…' : 'Connect dashboard wallet'}</button>}</section>
  {account && <SetupProgress account={account}/>}
  <footer className={styles.bottom}><span>Robinhood Testnet · chain 46630</span><p>The worker uploads GPU checks directly. Contribution points require accepted proofs; token claims require a funded reward epoch.</p><Link href="/docs#rtx">Full guide<ArrowUpRight size={13}/></Link></footer>
 </div>;
}
// Existing CLI pairing URLs remain supported; new miners use wallet + rig name above.
function LegacyPairApproval({ code, account, signIn }: { code: string; account: MiningAccount | null; signIn: () => Promise<void> }) {
 const [pair, setPair] = useState<{ name: string; approved: boolean } | null>(null), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
 useEffect(() => { if (!account) return; let current = true; miningApi<{ name: string; approved: boolean }>('pairing/info', { method: 'POST', body: JSON.stringify({ code }) }).then(v => { if (current) setPair(v); }).catch(e => { if (current) setMessage(e.message); }); return () => { current = false; }; }, [code, account?.address]);
 const approve = async () => { setBusy(true); try { await miningApi('pairing/approve', { method: 'POST', body: JSON.stringify({ code }) }); setPair(p => p ? { ...p, approved: true } : p); setMessage('Approved. Return to the GPU terminal.'); } catch (e) { setMessage(e instanceof Error ? e.message : 'Approval failed.'); } finally { setBusy(false); } };
 return <section className={styles.followWorker}><div><h2>Existing CLI connection</h2><p>Compare code <strong>{code}</strong> with your terminal. {pair && <>Worker: <strong>{pair.name}</strong>.</>} Approve only a request you started.</p><p role="status">{message}</p></div>{!account ? <button className="button button-small" onClick={() => void signIn()}>Connect wallet</button> : <button className="button button-small" disabled={!pair || pair.approved || busy} onClick={() => void approve()}>{pair?.approved ? 'Approved' : 'Approve this connection'}</button>}</section>;
}
