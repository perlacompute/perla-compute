'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import {ArrowUpRight} from 'lucide-react';
import {publicNetworkState} from '@/lib/perla/public-status.mjs';
type Snapshot={miningEnabled:boolean;launch?:{phase:string}|null;workers:number;acceptedShares:number;chainId:number};
export function NetworkPulse(){
 const [data,setData]=useState<Snapshot|null>(null),[failed,setFailed]=useState(false);
 useEffect(()=>{
  let stopped=false,busy=false;let request:AbortController|null=null;
  const refresh=async()=>{if(busy||document.visibilityState==='hidden')return;busy=true;request=new AbortController();const timer=setTimeout(()=>request?.abort(),12000);
   try{const r=await fetch('/api/mining/status',{signal:request.signal,cache:'no-store'});if(!r.ok)throw Error();const value=await r.json();
    if(value.chainId!==46630||typeof value.miningEnabled!=='boolean'||![value.workers,value.acceptedShares].every(n=>Number.isSafeInteger(n)&&n>=0))throw Error();
    if(!stopped){setData(value);setFailed(false);}
   }catch{if(!stopped)setFailed(true);}finally{clearTimeout(timer);busy=false;}
  };
  void refresh();const timer=setInterval(()=>void refresh(),60000);const visible=()=>void refresh();document.addEventListener('visibilitychange',visible);
  return()=>{stopped=true;request?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[]);
 const state=publicNetworkState(data,failed),available=!!data&&!failed;
 return <section className="public-network" aria-label="Live network snapshot"><div className="section-wrap public-network-inner"><div className="public-network-state"><span className={'public-indicator '+state.tone}/><div><strong>{state.label}</strong><small>Robinhood Testnet · live snapshot</small></div></div><div><strong>{available?data.workers.toLocaleString('en-US'):'—'}</strong><small>Active workers</small></div><div><strong>{available?data.acceptedShares.toLocaleString('en-US'):'—'}</strong><small>Accepted shares</small></div><Link href="/status">Service status<ArrowUpRight size={16}/></Link></div></section>;
}
