'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, RefreshCw, PackageCheck } from 'lucide-react';
import { workerCommands, workerRelease, type WorkerProfile, type WorkerReleaseStatus } from '@/lib/perla/worker-release';
import { CommandBlock } from './portal-ui';
import styles from './worker-install.module.css';
export function WorkerInstall({ profile, device = 0, onConfigurationNeeded }: { profile: WorkerProfile; device?: number; onConfigurationNeeded?: () => void }) {
  const [status, setStatus] = useState<WorkerReleaseStatus | null>(null), [retry, setRetry] = useState(0), [checking, setChecking] = useState(true);
  useEffect(() => {
    const abort = new AbortController(); setChecking(true); setStatus(null);
    fetch('/api/worker-release', { signal: abort.signal, cache: 'no-store' }).then(async res => {
      if (!res.ok) throw new Error(); const value = await res.json();
      if (value.repository !== workerRelease.repository || value.tag !== workerRelease.tag || !['available', 'unavailable'].includes(value.state)) throw new Error();
      if (!abort.signal.aborted) setStatus(value);
    }).catch(() => { if (!abort.signal.aborted) setStatus(null); }).finally(() => { if (!abort.signal.aborted) setChecking(false); });
    return () => abort.abort();
  }, [retry]);
  const commands = workerCommands(profile, device), ready = status?.state === 'available' && status.integrityVerified === true;
  return <div className={styles.root} data-worker-install={profile}><div className={styles.release}><PackageCheck size={19}/><div><strong>Perla Worker {workerRelease.version}</strong><span>{profile==='rtx'?'RTX 30 / 40 / 50 · Docker or native CUDA':'H100 / H200 · Docker model-serving adapter'}</span></div><a href={workerRelease.page} target="_blank" rel="noreferrer">Release notes<ArrowUpRight size={13}/></a></div>{ready?<><p className={styles.caption}>Public release and file checksums verified. Run on the GPU host.</p><CommandBlock label="1 / Install" value={commands.install}/><CommandBlock label="2 / Connect wallet" value={'"$HOME/.local/bin/perla" login'}/><p className={styles.caption}>Open the printed URL, approve its matching code with your wallet, and return to the terminal. Credentials are saved automatically.</p>{profile==='hopper'&&<CommandBlock label="Build the Hopper adapter" value={commands.build}/>}<CommandBlock label={profile==='rtx'?'3 / Start and validate':'Start after Hopper model validation'} value={commands.start}/><p className={styles.caption}>{profile==='rtx'?'Start prepares the runtime, runs the real GPU self-test and uploads its report.':'Hopper requires the separate model validation guide and a suitable Docker GPU host.'} Operator admission is managed by the project.</p></>:<div className={styles.availability} role="status"><p>{checking?'Checking public release…':'Installer availability not confirmed. Commands appear when the new GitHub files pass verification.'}</p>{!checking&&<button onClick={()=>setRetry(n=>n+1)}>Retry check</button>}</div>}</div>;
}
