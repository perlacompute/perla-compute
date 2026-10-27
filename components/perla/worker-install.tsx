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
  return <div className={styles.root} data-worker-install={profile}>
    <div className={styles.release}><PackageCheck size={19}/><div><strong>Perla Worker {workerRelease.version}</strong><span>{profile === 'rtx' ? 'RTX 30 / 40 / 50' : 'H100 / H200'} · {workerRelease.tag}</span></div><a href={workerRelease.page} target="_blank" rel="noopener noreferrer">Release notes<ArrowUpRight size={13}/></a></div>
    <p className={styles.caption}>The guide stays here. GitHub distributes the pinned installer and worker packages. Installation does not start mining.</p>
    <div className={styles.availability} role="status"><strong>{checking ? 'Checking installer availability…' : ready ? 'Public release and file checksums verified' : 'Installer availability not confirmed'}</strong><span>{checking ? 'Checking the published release and its required files.' : ready ? 'Run these commands on your Linux GPU host.' : status?.reason === 'rate_limited' ? 'GitHub temporarily limited the check. Retry later or inspect the release page.' : 'The release may be private, unpublished or temporarily unreachable. Installation commands appear after its files pass verification.'}</span>{!checking && !ready && <button type="button" onClick={() => setRetry(n => n + 1)}><RefreshCw size={13}/>Retry check</button>}</div>
    {ready && <><CommandBlock label={`1 / Install the ${profile === 'rtx' ? 'RTX' : 'Hopper'} CLI`} value={commands.install}/><CommandBlock label="2 / Diagnose the selected GPU" value={commands.doctor}/><p className={styles.caption}>Review the report, then build the image. A missing image or configuration is expected before the first build and import.</p><CommandBlock label="3 / Build the worker image" value={commands.build}/><p className={styles.caption}>Copy the private <code>worker.env</code> downloaded from your account to this folder on the GPU host.</p>{onConfigurationNeeded ? <button type="button" className="arrow-link" onClick={onConfigurationNeeded}>Need worker.env? Create a worker<ArrowUpRight size={13}/></button> : <Link className="arrow-link" href="/platform/setup?step=1">Need worker.env? Create a worker<ArrowUpRight size={13}/></Link>}<CommandBlock label="4 / Import your worker configuration" value={commands.configure}/><p className={styles.caption}>Default CLI location: <code>$HOME/.local/bin/perla</code>. The installer checks the release files; it never requests your wallet private key.</p></>}
  </div>;
}
