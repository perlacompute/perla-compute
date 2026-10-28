'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, ChevronRight, Cpu, Download, RefreshCw, ShieldCheck, Terminal, Wallet } from 'lucide-react';
import { miningApi, short, useMiningAccount, type MiningAccount } from './mining-client';
import { CommandBlock } from './portal-ui';
import { WorkerDialog } from './worker-dialog';
import styles from './miner-setup.module.css';
import { WorkerInstall } from './worker-install';
import { workerCommands, workerRelease } from '@/lib/perla/worker-release';

export function SetupProgress({ account, compact = false }: { account: MiningAccount | null; compact?: boolean }) {
  const steps = [{ label: 'Authorize wallet', done: !!account }, { label: 'Register worker', done: !!account?.workers.some(w => !w.revoked) }, { label: 'Worker contact', done: !!account?.workers.some(w => w.last_seen) }, { label: 'Accepted share', done: !!account?.totals.shares }];
  return <div className={'setup-progress ' + (compact ? 'compact' : '')}><div><span className="micro">YOUR MINING SETUP</span><span>{steps.filter(s => s.done).length} / 4 account milestones</span></div><ol>{steps.map((s, i) => <li key={s.label} className={s.done ? 'done' : ''}><span>{s.done ? <Check size={13}/> : i + 1}</span><strong>{s.label}</strong></li>)}</ol>{compact && <Link className="arrow-link" href="/platform/setup">Continue setup<ArrowUpRight size={14}/></Link>}</div>;
}
type PairInfo={name:string;expires:number;approved:boolean;consumed:boolean};
export function MinerOnboarding(){
 const {account,loading,busy,error,signIn,reload}=useMiningAccount();
 const [code,setCode]=useState(''),[pair,setPair]=useState<PairInfo|null>(null),[message,setMessage]=useState(''),[working,setWorking]=useState(false);
 const [releaseReady,setReleaseReady]=useState(false),[releaseRead,setReleaseRead]=useState(false),[device,setDevice]=useState(0);
 const [status,setStatus]=useState<{miningEnabled:boolean;registeredWorkers?:number;activeWorkers?:number}|null>(null);
 const cli='"$HOME/.local/bin/perla"';
 useEffect(()=>{setCode((new URLSearchParams(window.location.search).get('pair')||'').toUpperCase());fetch('/api/worker-release',{cache:'no-store'}).then(r=>r.json()).then(v=>setReleaseReady(v.state==='available'&&v.integrityVerified&&v.tag===workerRelease.tag)).catch(()=>setReleaseReady(false)).finally(()=>setReleaseRead(true));miningApi<typeof status>('status').then(setStatus).catch(()=>{});},[]);
 useEffect(()=>{if(!account||!/^[A-F0-9]{12}$/.test(code))return;let current=true;miningApi<PairInfo>('pairing/info',{method:'POST',body:JSON.stringify({code})}).then(v=>{if(current){setPair(v);setMessage('');}}).catch(e=>{if(current){setPair(null);setMessage(e.message);}});return()=>{current=false;};},[code,account?.address]);
 const approve=async()=>{setWorking(true);setMessage('');try{await miningApi('pairing/approve',{method:'POST',body:JSON.stringify({code})});setPair(v=>v?{...v,approved:true}:v);setMessage('Approved. Return to the GPU terminal; it saves the connection automatically.');await reload();}catch(e){setMessage(e instanceof Error?e.message:'Pairing failed.');}finally{setWorking(false);}};
 const install=workerCommands('rtx',device).install;
 return <div className={'portal-workspace '+styles.root} data-miner-setup="paired-v1">
  <header className={styles.intro}><div><span className="eyebrow">PERLA / MINER SETUP</span><h1>Connect your GPU.<br/><em>Let the worker handle the rest.</em></h1><p>Install the CLI, approve your worker with your wallet, then start.</p></div><div className={styles.release}>WORKER {workerRelease.version}</div></header>
  <div className={styles.status}><ShieldCheck size={18}/><div><strong>{status?.miningEnabled?'Public work admission is open':'Public work admission is paused'}</strong><span>Setup and GPU validation are available. Controlled trials require project operator admission.</span></div><Link href="/status">Service status<ArrowUpRight size={14}/></Link></div>
  <section className={styles.pairing} aria-label="Connect this worker">
   <div><span className="micro">WALLET PAIRING</span><h2>Approve your GPU host.</h2><p>Run <code>perla login</code> on the GPU host and open the URL it prints. Compare its code here before approving.</p>{account?<p>Reward wallet: <strong>{short(account.address)}</strong></p>:<button className="button button-dark button-small" disabled={loading||busy} onClick={()=>void signIn()}>{busy?'Waiting for wallet…':'Connect wallet'}</button>}</div>
   <div><label htmlFor="pair-code">Code shown by your CLI</label><input id="pair-code" autoComplete="off" maxLength={12} value={code} placeholder="12-character code" onChange={e=>{setCode(e.target.value.replace(/[^a-f0-9]/gi,'').toUpperCase());setPair(null);}}/>{pair&&<p><strong>{pair.name}</strong> · {pair.approved?'Approved':'Awaiting your approval'}</p>}<button className="button button-dark" disabled={!account||!pair||pair.approved||working} onClick={()=>void approve()}>{pair?.approved?'Worker approved':working?'Approving…':'Approve this worker'}</button><p role="status">{message||error}</p><small>Approval creates a revocable worker credential on the GPU host. Your wallet authorizes this pairing with a message; no token transfer is requested.</small></div>
  </section>
  <div className={styles.quickSteps}>
   <section><span className="micro">01 / INSTALL</span><h2>One CLI.</h2><p>Linux NVIDIA RTX 30 / 40 / 50. The CLI selects a working Docker host or the native CUDA path inside a GPU container.</p>{releaseReady?<CommandBlock label="Install the verified GitHub release" value={install}/>:<p role="status">{releaseRead?'The new CLI release is not verified as public yet. Commands appear after publication succeeds.':'Checking public installer checksums…'}</p>}<Link className="arrow-link" href={workerRelease.page}>GitHub release<ArrowUpRight size={14}/></Link><p>H100/H200 use the separate <Link href="/docs#hopper-validation">Hopper guide</Link>.</p></section>
   <section><span className="micro">02 / CONNECT</span><h2>Your wallet. Your worker.</h2><p>Open the printed URL in your wallet browser and approve the matching code above. The CLI saves its private credential automatically.</p>{releaseReady&&<CommandBlock label="Pair the GPU host" value={cli+' login'}/>}<p>You can revoke the worker from <Link href="/platform/mining">Compute & mining</Link>.</p></section>
   <section><span className="micro">03 / START</span><h2>Build. Validate. Contribute.</h2><p>Start builds the runtime when needed, runs the actual GPU self-test and uploads its report. It requests work only when admission permits it.</p><label htmlFor="gpu-device">GPU device index</label><input id="gpu-device" type="number" min="0" max="63" value={device} onChange={e=>setDevice(Math.max(0,Math.min(63,Number(e.target.value)||0)))}/>{releaseReady&&<CommandBlock label="First contribution · one accepted share" value={cli+' start --device '+device+' --shares 1'}/>}<p>The terminal prints a receipt when work is accepted. Contribution points become claimable only through a funded reward epoch.</p></section>
  </div>
  {account&&<SetupProgress account={account}/>}
  <footer className={styles.bottom}><span>Robinhood Testnet · chain 46630</span><p>GPU reports upload directly to Perla. Operator review, trial admission and reward funding are managed by the project.</p><Link href="/docs#rtx">Full guide<ArrowUpRight size={13}/></Link></footer>
 </div>;
}
