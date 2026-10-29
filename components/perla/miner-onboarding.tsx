'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, Cpu, ShieldCheck, Terminal, Wallet } from 'lucide-react';
import { miningApi, useMiningAccount, type MiningAccount } from './mining-client';
import { CommandBlock } from './portal-ui';
import { namedWorkerCommand, existingWorkerCommand, workerCommands, workerRelease } from '@/lib/perla/worker-release';
import styles from './miner-setup.module.css';
import { WorkerIdentity } from './worker-identity';

export function SetupProgress({ account, compact = false }: { account: MiningAccount | null; compact?: boolean }) {
 const steps = [{ label: 'Dashboard wallet', done: !!account }, { label: 'Worker connected', done: !!account?.workers.some(w => !w.revoked) }, { label: 'Worker contact', done: !!account?.workers.some(w => w.last_seen) }, { label: 'Accepted share', done: !!account?.totals.shares }];
 return <div className={'setup-progress ' + (compact ? 'compact' : '')}><div><span className="micro">YOUR MINING SETUP</span><span>{steps.filter(s => s.done).length} / 4 account milestones</span></div><ol>{steps.map((s, i) => <li key={s.label} className={s.done ? 'done' : ''}><span>{s.done ? <Check size={13}/> : i + 1}</span><strong>{s.label}</strong></li>)}</ol>{compact && <Link className="arrow-link" href="/platform/setup">Open miner setup<ArrowUpRight size={14}/></Link>}</div>;
}
export function MinerOnboarding({ initialWorkerId = '', reuseRequested = false, pairCode = '' }: { initialWorkerId?: string; reuseRequested?: boolean; pairCode?: string }) {
 const { account, loading, busy, error, signIn } = useMiningAccount();
 const [mode, setMode] = useState<'new' | 'reuse'>(initialWorkerId || reuseRequested ? 'reuse' : 'new'), [workerId, setWorkerId] = useState(initialWorkerId);
 const [wallet, setWallet] = useState(''), [name, setName] = useState('rig01'), [device, setDevice] = useState(0);
 const [releaseReady, setReleaseReady] = useState(false), [releaseRead, setReleaseRead] = useState(false), [retry, setRetry] = useState(0);
 const [status, setStatus] = useState<{ miningEnabled: boolean } | null>(null), [legacyCode, setLegacyCode] = useState('');
 useEffect(() => { setLegacyCode(pairCode); if (initialWorkerId || reuseRequested) { setWorkerId(initialWorkerId); setMode('reuse'); } }, [initialWorkerId, reuseRequested, pairCode]);
 useEffect(() => {
  const abort = new AbortController(); setReleaseRead(false); setReleaseReady(false);
  fetch('/api/worker-release', { signal: abort.signal, cache: 'no-store' }).then(r => r.json()).then(v => { if (!abort.signal.aborted) setReleaseReady(v.state === 'available' && v.integrityVerified === true && v.tag === workerRelease.tag); }).catch(() => {}).finally(() => { if (!abort.signal.aborted) setReleaseRead(true); });
  miningApi<{ miningEnabled: boolean }>('status').then(setStatus).catch(() => {});
  return () => abort.abort();
 }, [retry]);
 let start = ''; try { start = mode === 'reuse' ? existingWorkerCommand(workerId, device) : namedWorkerCommand(wallet, name, device); } catch {}
 const command = start ? workerCommands('rtx', device).install + ' && \\\n' + start : '';
 return <div className={'portal-workspace ' + styles.root} data-miner-setup="permanent-worker-v3">
  <header className={styles.intro}><div><span className="eyebrow">PERLA / MINER SETUP</span><h1>Create once.<br/><em>Keep your worker.</em></h1><p>Create a new worker or move an existing Worker ID to another GPU machine.</p></div><div className={styles.release}>WORKER {workerRelease.version}</div></header>
  <div className={styles.status}><ShieldCheck size={18}/><div><strong>{status ? status.miningEnabled ? 'Work admission is open' : 'Work admission is paused' : 'Checking work admission…'}</strong><span>{status?.miningEnabled ? 'The worker validates your GPU before requesting jobs.' : 'You can connect a worker and validate your GPU now. Accepted work starts when the project admits mining.'}</span></div><Link href="/status">Service status<ArrowUpRight size={14}/></Link></div>
  {legacyCode && <LegacyPairApproval code={legacyCode} account={account} signIn={signIn}/>}
  <section className={styles.minerFlow} aria-label="Generate your mining command">
   <div className={styles.minerIdentity}><span className="micro">01 / WORKER IDENTITY</span><h2>{mode === 'new' ? 'Create a new worker.' : 'Use an existing worker.'}</h2>
    <div className={styles.modeSwitch} role="group" aria-label="Worker setup mode"><button type="button" aria-pressed={mode === 'new'} onClick={() => setMode('new')}>Create new worker</button><button type="button" aria-pressed={mode === 'reuse'} onClick={() => setMode('reuse')}>Use existing worker</button></div>
    {mode === 'new' ? <><p>Choose a name and public reward address. The first successful connection creates a permanent Worker ID and prints it in your terminal.</p>
    <label htmlFor="reward-wallet">Reward wallet</label><input id="reward-wallet" spellCheck={false} autoComplete="off" placeholder="0x…" value={wallet} maxLength={42} onChange={e => setWallet(e.target.value.trim())} aria-describedby="wallet-help"/>
    <small id="wallet-help">Public EVM address on Robinhood. Keep the private key in your wallet.</small>
    {account && <button className="button button-small" onClick={() => setWallet(account.address)}>Use connected wallet</button>}
    <label htmlFor="worker-name">Worker name</label><input id="worker-name" spellCheck={false} autoComplete="off" value={name} maxLength={48} onChange={e => setName(e.target.value)} aria-describedby="worker-help"/>
    <small id="worker-help">A display label, for example home-4090. The same name on another fresh installation creates a different ID. To keep the old identity, choose Use existing worker.</small></> : <><p>Moving to a new VPS or GPU rental? Keep the same ID, name, wallet and contribution history.</p>
    {account?.workers.length ? <><label htmlFor="saved-worker">Choose from your wallet</label><select id="saved-worker" value={account.workers.some(w => w.id === workerId) ? workerId : ''} onChange={e => setWorkerId(e.target.value)}><option value="">Choose an existing worker…</option>{account.workers.map(w => <option key={w.id} value={w.id}>{w.name} · {w.id}{w.revoked ? ' · access revoked' : ''}</option>)}</select></> : null}
    <label htmlFor="existing-worker-id">Permanent Worker ID</label><input id="existing-worker-id" spellCheck={false} autoComplete="off" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" value={workerId} maxLength={36} onChange={e => setWorkerId(e.target.value.trim().toLowerCase())} aria-describedby="worker-id-help"/>
    <small id="worker-id-help">Copy the full ID from Compute &amp; mining. Your wallet and name are retained. This is different from the local GPU device index.</small>
    <p className={styles.reuseNote}>Start on the new machine, then open its approval link and sign in with the owner wallet. Compare the terminal code and authorize the move. The old machine loses access when the exchange completes; no configuration files need to be copied.</p><Link className="arrow-link" href="/platform/mining">Find your Worker ID<ArrowUpRight size={14}/></Link></>}
    <details className={styles.gpuOptions} data-gpu-selector="advanced-default-0"><summary>Advanced options <span>GPU {device}</span></summary><label htmlFor="gpu-device">GPU to use <span>(optional)</span></label><input id="gpu-device" className={styles.deviceIndex} type="number" min="0" max="63" step="1" value={device} aria-describedby="gpu-device-help" onChange={e => setDevice(Math.max(0, Math.min(63, Math.trunc(Number(e.target.value) || 0))))}/><small id="gpu-device-help">GPU numbering starts at 0: 0 selects the first GPU, 1 selects the second. If your machine has one GPU, keep the default 0. Change this only to choose another available GPU.</small></details>
    <p className={styles.hardwareNote}><Cpu size={16}/> NVIDIA RTX 30 / 40 / 50 · Linux</p><Link className="arrow-link" href="/docs#hopper-validation">H100 / H200 guide<ArrowUpRight size={14}/></Link>
   </div>
   <div className={styles.minerCommand}><span className="micro">02 / GPU TERMINAL</span><h2>Install and start.</h2><p>Copy the generated command to your GPU machine. {mode === 'reuse' ? 'It installs the pinned release, requests owner approval for the existing ID, then prepares and checks this GPU.' : 'It installs the pinned release, creates the connection, prepares the runtime and checks the GPU automatically.'}</p>
    {!start ? <div className={styles.commandEmpty}><Terminal size={25}/><strong>Your command will appear here.</strong><span>{mode === 'reuse' ? 'Enter the full permanent Worker ID.' : 'Enter a valid reward address and worker name.'}</span></div> : !releaseReady ? <div className={styles.commandEmpty} role="status"><strong>{releaseRead ? 'Installer availability not confirmed' : 'Checking the GitHub release…'}</strong><span>Commands appear when the pinned public release and its checksums pass verification.</span>{releaseRead && <button className="button button-small" onClick={() => setRetry(n => n + 1)}>Retry check</button>}</div> : <CommandBlock label="Run on your Linux GPU host" value={command}/>}
    {mode === 'reuse' && <p className={styles.reuseNote}>Worker 0.8.1 supports this command. The owner wallet is used on the approval website; the GPU terminal never asks for its private key. A running process uses its saved credential until you stop it or move the ID again.</p>}
    <p className={styles.validationNote}>This validation release stops after one accepted share. While admission is paused it uploads the GPU check and exits without requesting work.</p>
    <a className="arrow-link" href={workerRelease.page} target="_blank" rel="noreferrer">Verified release & source<ArrowUpRight size={14}/></a>
   </div>
  </section>
  <section className={styles.followWorker} aria-label="Follow your worker"><Wallet size={20}/><div><h2>Follow your worker.</h2><p>Open the dashboard with the same reward wallet to see connected workers, contribution receipts and rewards. Wallet authorization is used for account management and claims.</p>{error && <p role="alert">{error}</p>}</div>{account ? <Link className="button button-dark button-small" href="/platform/mining">Open dashboard<ArrowUpRight size={14}/></Link> : <button className="button button-dark button-small" disabled={loading || busy} onClick={() => void signIn()}>{busy ? 'Waiting for wallet…' : 'Connect dashboard wallet'}</button>}</section>
  {account && <><SetupProgress account={account}/>{account.workers.length > 0 && <section className={styles.savedWorkers} aria-label="Your permanent worker identities"><h2>Your Worker IDs</h2><p>Copy an ID to move that worker. A Worker ID stays with its wallet; GPU device numbering belongs to each machine.</p>{account.workers.slice(0, 5).map(w => <article key={w.id}><strong>{w.name}</strong><WorkerIdentity id={w.id} move/></article>)}<Link className="arrow-link" href="/platform/mining">View all workers<ArrowUpRight size={14}/></Link></section>}</>}
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
