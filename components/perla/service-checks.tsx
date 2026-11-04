'use client';
import {useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
type Report={checkedAt:number;checks:{id:string;passed:boolean;detail:string}[]};
const services=[['verifier','Native verifier'],['worker_release','GitHub installer integrity'],['treasury','Funded reward coverage'],['automatic_settlement','Automatic settlement heartbeat']] as const;
export function ServiceChecks(){
 const [data,setData]=useState<Report|null>(null),[failed,setFailed]=useState(false),[busy,setBusy]=useState(true),[version,setVersion]=useState(0);
 useEffect(()=>{const controller=new AbortController();let stopped=false;const timer=setTimeout(()=>controller.abort(),20000);setBusy(true);
  fetch('/api/mining/readiness',{signal:controller.signal,cache:'no-store'}).then(async response=>{if(!response.ok)throw Error();const report=await response.json();if(!Array.isArray(report.checks)||!Number.isFinite(report.checkedAt)||report.chainId!==46630)throw Error();if(!stopped){setData(report);setFailed(false);}}).catch(()=>{if(!stopped)setFailed(true);}).finally(()=>{clearTimeout(timer);if(!stopped)setBusy(false);});
  return()=>{stopped=true;controller.abort();clearTimeout(timer);};
 },[version]);
 return <section className="public-checks" aria-label="Live service checks"><div className="public-checks-head"><div><span className="micro">CHECKED AGAINST THE RUNNING SERVICE</span><h2>Live service checks</h2></div><button className="icon-btn" disabled={busy} aria-label="Refresh live service checks" onClick={()=>setVersion(v=>v+1)}><RefreshCw size={17} className={busy?'spin':''}/></button></div><div className="public-checks-grid">{services.map(([id,label])=>{const item=!failed&&!busy?data?.checks.find(row=>row.id===id):null;const passed=item?.passed===true;return <div key={id}><span className={'public-indicator '+(passed?'green':'neutral')}/><div><strong>{label}</strong><small>{busy?'Checking…':failed?'Check unavailable':item?passed?'Passed latest check':'Needs attention':'No result reported'}</small></div></div>;})}</div><p role="status">{failed?'The latest checks could not be read. Retry to refresh service evidence.':data?'Last checked '+new Date(data.checkedAt*1000).toISOString().replace('T',' ').replace(/\.\d+Z$/,' UTC')+'. Results describe that snapshot, not an uptime guarantee.':'Waiting for the current verifier, release, treasury and settlement checks.'}</p></section>;
}
