'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Check, Copy, KeyRound, Layers, LockKeyhole, MessageSquare, Play, RefreshCw, Search, ShieldCheck, Wallet, X } from 'lucide-react';
import { getProvider } from '@/components/auren/shared';
import { encodeFunctionData, parseAbi } from 'viem';
import styles from './api-developer-console.module.css';

type Tab = 'playground' | 'developer' | 'models' | 'credits';
type Model = { id: string; name?: string; owned_by?: string; pricing?: {inputPerMillion?:number;outputPerMillion?:number}; available?:boolean };
type Trial = {enabled:boolean;limit:number;used:number;remaining:number;model?:string;maxOutput:number};
type ApiKey = {id:string;prefix:string;name:string;created:number;daily_limit:number;revoked:number|null;rpm:number};
type Account = {address:string;trial:Trial;keys:ApiKey[];usage:{availableMicros:number;requests?:Array<{id:string;model:string;state:string;billing_source:string;created:number}>};deposits?:Array<{hash:string;log_index:number;credits:number;created:number}>};
type Topup = {enabled:boolean;chainId?:number;token?:string;treasury?:string;decimals?:number;rateMicrosPerToken?:string;mode?:string};
const USDG_ABI = parseAbi(['function transfer(address to,uint256 amount) returns (bool)']);
type ChatMsg = {role:'user'|'assistant';content:string};
const BASE='https://perlacompute.xyz/v1';
const TRIAL_MODEL='perla/claude-sonnet-5-5';
const initialSnippet = [
  `curl ${BASE}/chat/completions \\`,
  "  -H 'Authorization: Bearer YOUR_PERLA_API_KEY' \\",
  "  -H 'Content-Type: application/json' \\",
  "  -H 'Idempotency-Key: request-001' \\",
  `  -d '{"model":"${TRIAL_MODEL}","messages":[{"role":"user","content":"Hello"}],"max_tokens":128}'`,
].join('\n');
async function call(path:string, init:RequestInit={}) {
  const response=await fetch('/v1/console/'+path,{...init, credentials:'same-origin', cache:'no-store', headers:{...(init.body?{'content-type':'application/json'}:{}),...init.headers}});
  const data=await response.json().catch(()=>({error:{message:'Invalid server response'}}));
  if(!response.ok)throw new Error(data.error?.message||data.error||'Request failed');
  return data;
}
function errorText(e:unknown) {return e instanceof Error ? e.message : 'Request failed';}
function short(s:string){return s.slice(0,6)+'…'+s.slice(-4);}
function usd(micros:number){return '$'+(Number(micros||0)/1000000).toFixed(4);}
function CopyButton({value,label='Copy'}:{value:string;label?:string}) {
  const [done,setDone]=useState(false);
  return <button type="button" className={styles.copyBtn} onClick={async()=>{try{await navigator.clipboard.writeText(value);setDone(true);setTimeout(()=>setDone(false),1500);}catch{setDone(false);}}}><span>{done?<Check size={14}/>:<Copy size={14}/>}</span>{done?'Copied':label}</button>;
}

export function ApiDeveloperConsole({initialTab}:{initialTab:Tab}){
  const [tab,setTab]=useState<Tab>(initialTab);
  const [models,setModels]=useState<Model[]>([]);
  const [loading,setLoading]=useState(true);
  const [account,setAccount]=useState<Account|null>(null);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [search,setSearch]=useState('');
  const [prompt,setPrompt]=useState('');
  const [messages,setMessages]=useState<ChatMsg[]>([]);
  const [newKey,setNewKey]=useState('');
  const [keyName,setKeyName]=useState('My application');
  const [daily,setDaily]=useState('1');
  const [monthly,setMonthly]=useState('10');
  const [modelScope,setModelScope]=useState(TRIAL_MODEL);
  const [freeModel,setFreeModel]=useState(TRIAL_MODEL);
  const [trialOpen,setTrialOpen]=useState(false);
  const [topup,setTopup]=useState<Topup>({enabled:false});
  const [topupAmount,setTopupAmount]=useState('5');
  const [paymentHash,setPaymentHash]=useState('');

  const refresh=useCallback(async()=>{
    const [catalog,config]=await Promise.all([
      fetch('/v1/models',{cache:'no-store'}).then(async(r)=>{if(!r.ok)throw Error('Catalog unavailable');return r.json();}),
      call('status'),
    ]);
    setModels(Array.isArray(catalog.data)?catalog.data:[]);
    if(typeof config?.model==='string')setFreeModel(config.model);
    setTrialOpen(config?.freeChats===true);
    setTopup(config?.usdgTopup||{enabled:false});
    try {setAccount(await call('account'));}catch{setAccount(null);}
  },[]);
  useEffect(()=>{let cancelled=false;setLoading(true);refresh().catch(e=>{if(!cancelled)setError(errorText(e));}).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true};},[refresh]);
  useEffect(()=>{
    const provider=getProvider();
    const change=()=>{setAccount(null);setNewKey('');setMessages([]);void call('auth/logout',{method:'POST',body:'{}'}).catch(()=>{});};
    provider?.on?.('accountsChanged',change);
    return()=>provider?.removeListener?.('accountsChanged',change);
  },[]);
  const go=(t:Tab)=>{setTab(t);setError('');setNotice('');const u=new URL(window.location.href);u.searchParams.set('tab',t);window.history.replaceState(null,'',u.pathname+u.search+u.hash);};
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(errorText(e));}finally{setBusy(false);}};
  const signin=()=>run(async()=>{
    const p=getProvider();if(!p)throw Error('Install or open an EVM wallet such as MetaMask or Rabby.');
    const addresses=await p.request({method:'eth_requestAccounts'}) as string[];
    if(!addresses?.[0])throw Error('Choose a wallet to sign in');
    const ch=await call('auth/challenge',{method:'POST',body:JSON.stringify({address:addresses[0]})});
    const hex='0x'+Array.from(new TextEncoder().encode(ch.message),(b)=>b.toString(16).padStart(2,'0')).join('');
    const signature=await p.request({method:'personal_sign',params:[hex,addresses[0]]});
    await call('auth/verify',{method:'POST',body:JSON.stringify({id:ch.id,signature})});
    setAccount(await call('account'));
    setNotice('Wallet connected. Signing did not send a transaction.');
  });
  const signout=()=>run(async()=>{await call('auth/logout',{method:'POST',body:'{}'});setAccount(null);setNewKey('');setMessages([]);});
  const send=()=>run(async()=>{
    if(!account)throw Error('Connect your wallet first');
    if(!trialOpen || !account.trial.enabled || account.trial.remaining<=0)throw Error('All three free chats have been used');
    if(!prompt.trim())throw Error('Write a message first');
    const next=[...messages,{role:'user',content:prompt.trim()} as ChatMsg];
    // Preserve short context, bounded by the server's strict per-chat input budget.
    const context=next.slice(-5);
    if(new TextEncoder().encode(JSON.stringify(context)).length>3000)throw Error('Conversation is too long for a free chat. Choose New conversation to continue.');
    const reply=await call('chat',{method:'POST',headers:{'idempotency-key':crypto.randomUUID()},body:JSON.stringify({model:freeModel,messages:context,billing_mode:'trial',stream:false,max_tokens:256})});
    const answer=reply.choices?.[0]?.message?.content;
    if(typeof answer!=='string' || !answer.trim())throw Error('The provider did not return a text reply. Check Usage before retrying.');
    setMessages([...next,{role:'assistant',content:answer}]);setPrompt('');
    setAccount(await call('account'));
  });
  const generate=()=>run(async()=>{
    if(!account)throw Error('Connect your wallet first');
    const d=Number(daily),m=Number(monthly);
    if(!Number.isFinite(d)||!Number.isFinite(m)||d<0.001||m<d)throw Error('Choose valid daily/monthly spending caps');
    const created=await call('keys',{method:'POST',body:JSON.stringify({name:keyName,scopes:['chat'],models:[modelScope],dailyLimitMicros:Math.round(d*1000000),monthlyLimitMicros:Math.round(m*1000000),rpm:10,concurrency:2})});
    setNewKey(created.key);setAccount(await call('account'));
    setNotice('Private API key created. Save it now: the full value is shown only once.');
  });
  const revoke=(id:string)=>run(async()=>{await call('keys/'+id,{method:'DELETE'});setNewKey('');setAccount(await call('account'));setNotice('API key revoked.');});
  const restorePayment=(addr:string)=>{
    try {const hash=localStorage.getItem('perla-usdg-pending:'+addr.toLowerCase());if(hash&&/^0x[0-9a-fA-F]{64}$/.test(hash))setPaymentHash(hash);else setPaymentHash('');}catch{setPaymentHash('');}
  };
  useEffect(()=>{if(account?.address)restorePayment(account.address);else setPaymentHash('');},[account?.address]);
  const confirmPayment=()=>run(async()=>{
    if(!account)throw Error('Connect wallet first');
    const hash=paymentHash.trim();
    if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw Error('Enter the payment transaction hash');
    const result=await call('deposits/confirm',{method:'POST',body:JSON.stringify({hash})});
    setAccount(await call('account'));
    if(result?.credited||result?.alreadyCredited){
      try{localStorage.removeItem('perla-usdg-pending:'+account.address.toLowerCase())}catch{}
      setPaymentHash('');
      setNotice(result.credited?'Finalized USDG payment credited to your wallet account.':'Payment was already credited; no duplicate credit was added.');
    }
  });
  const purchaseUSDG=()=>run(async()=>{
    if(!account)throw Error('Connect wallet first');
    if(!topup.enabled||!topup.treasury||!topup.token||topup.chainId!==4663)throw Error('USDG top-up is not open');
    if(account.address.toLowerCase()===topup.treasury.toLowerCase())throw Error('Treasury wallet cannot fund its own credit account');
    if(paymentHash.trim())throw Error('Check the previous payment before making another deposit');
    if(!/^(0|[1-9]\d{0,5})(?:\.\d{1,6})?$/.test(topupAmount))throw Error('Enter a USDG amount with up to 6 decimal places');
    const [whole,fraction='']=topupAmount.split('.');
    const value=BigInt(whole)*1000000n+BigInt((fraction+'000000').slice(0,6));
    if(value<1000000n||value>1000000000n)throw Error('Choose an amount between 1 and 1000 USDG');
    const wallet=getProvider();if(!wallet)throw Error('Open a supported browser wallet');
    const addresses=await wallet.request({method:'eth_accounts'}) as string[];
    if(!addresses?.[0]||addresses[0].toLowerCase()!==account.address.toLowerCase())throw Error('Connected wallet differs from your signed-in Perla account');
    let chain=await wallet.request({method:'eth_chainId'}) as string;
    if(Number(BigInt(chain))!==4663){
      try{await wallet.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});}
      catch(e){
        const code=(e as {code?:number;data?:{originalError?:{code?:number}}})?.code;
        if(code!==4902)throw Error('Please switch your wallet to Robinhood Chain (4663)');
        await wallet.request({method:'wallet_addEthereumChain',params:[{chainId:'0x1237',chainName:'Robinhood Chain',rpcUrls:['https://rpc.mainnet.chain.robinhood.com'],nativeCurrency:{name:'ETH',symbol:'ETH',decimals:18},blockExplorerUrls:['https://robinhoodchain.blockscout.com']}]});
        await wallet.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x1237'}]});
      }
    }
    chain=await wallet.request({method:'eth_chainId'}) as string;
    if(Number(BigInt(chain))!==4663)throw Error('Payment chain differs; transaction cancelled');
    const current=await wallet.request({method:'eth_accounts'}) as string[];
    if(!current?.[0]||current[0].toLowerCase()!==account.address.toLowerCase())throw Error('Wallet changed; transaction cancelled');
    const data=encodeFunctionData({abi:USDG_ABI,functionName:'transfer',args:[topup.treasury as `0x${string}`,value]});
    // No approvals, allowance or private keys. User signs only ERC20 transfer to the pinned treasury.
    const hash=await wallet.request({method:'eth_sendTransaction',params:[{from:account.address,to:topup.token,data}]}) as string;
    if(!/^0x[0-9a-fA-F]{64}$/.test(hash))throw Error('Wallet did not return a transaction hash. Check your wallet history before retrying');
    setPaymentHash(hash);
    try{localStorage.setItem('perla-usdg-pending:'+account.address.toLowerCase(),hash)}catch{}
    setNotice('USDG transfer submitted. Wait for finalized receipt, then press Check finalized payment. Do not send again while pending.');
  });
  const filtered=useMemo(()=>models.filter(m=>(m.id+' '+(m.name||'')).toLowerCase().includes(search.toLowerCase())).slice(0,130),[models,search]);

  return <div className={styles.root} data-perla-api-console="1">
    <div className={styles.topline}><span className={styles.overline}>PERLA COMPUTE / AI WORKSPACE</span><span className={styles.pill}><span className={styles.liveDot}/> API-only · token-independent</span></div>
    <div className={styles.hero}><div><span className={styles.eyebrow}>PROVIDER-POWERED INFERENCE</span><h1>Explore. Build. <em>Compute.</em></h1><p>Try three free AI chats with your wallet, create private API keys for your applications, and explore the live Perla model catalog.</p></div><div className={styles.heroGraphic} aria-hidden="true"><div className={styles.glyph}>P<span>.</span></div><div className={styles.glyphCaption}>PLAYGROUND / API / MODELS</div></div></div>
    <div className={styles.nav} role="tablist" aria-label="AI workspace">
      <button type="button" role="tab" aria-selected={tab==='playground'} className={tab==='playground'?styles.active:''} onClick={()=>go('playground')}><MessageSquare size={16}/> Playground <span className={styles.count}>3 FREE</span></button>
      <button type="button" role="tab" aria-selected={tab==='credits'} className={tab==='credits'?styles.active:''} onClick={()=>go('credits')}><Wallet size={16}/> Add credits</button>
      <button type="button" role="tab" aria-selected={tab==='developer'} className={tab==='developer'?styles.active:''} onClick={()=>go('developer')}><KeyRound size={16}/> API keys</button>
      <button type="button" role="tab" aria-selected={tab==='models'} className={tab==='models'?styles.active:''} onClick={()=>go('models')}><Layers size={16}/> Models <span className={styles.count}>{loading?'…':models.length}</span></button>
    </div>
    <div className={styles.accountBar}><div><Wallet size={16}/>{account?<><strong>{short(account.address)}</strong><span className={styles.hint}>Wallet authenticated · {account.trial.remaining} free chats remaining</span></>:<span>Connect your EVM wallet to use Playground and manage keys.</span>}</div><div>{account?<button type="button" className={styles.copyBtn} disabled={busy} onClick={signout}>Sign out</button>:<button type="button" className={styles.primaryBtn} disabled={busy} onClick={signin}>{busy?'Connecting…':'Connect wallet'}</button>}</div></div>
    {notice&&<div className={styles.notice} role="status">{notice}</div>}{error&&<div className={styles.error} role="alert">{error}</div>}
    {tab==='playground'&&<section className={styles.content} role="tabpanel">
      <div className={styles.stats}>
        <div className={styles.stat}><span>FREE ALLOWANCE</span><strong>{account?`${account.trial.remaining} / 3 remaining`:'3 chats per wallet'}</strong><small>Lifetime allowance, not reset by new conversations</small></div>
        <div className={styles.stat}><span>FREE MODEL</span><strong>{freeModel.replace(/^perla\//,'')}</strong><small>Short text prompts · up to 256 output tokens</small></div>
        <div className={styles.stat}><span>STATUS</span><strong>{trialOpen?'Open for wallet users':'Temporarily unavailable'}</strong><small>Sponsored capacity is limited by a daily server budget</small></div>
      </div>
      <div className={styles.chatShell}><div className={styles.chatHead}><div><span className={styles.eyebrow}>AI PLAYGROUND</span><h2>Ask Perla.</h2></div><button type="button" className={styles.copyBtn} onClick={()=>{setMessages([]);setPrompt('');setError('');}}>New conversation</button></div>
        <div className={styles.chatMessages} aria-live="polite">{messages.length?messages.map((m,i)=><div className={`${styles.chatBubble} ${m.role==='user'?styles.chatUser:styles.chatAssistant}`} key={i}><span>{m.role==='user'?'YOU':'PERLA AI'}</span><p>{m.content}</p></div>):<div className={styles.chatEmpty}><MessageSquare size={27}/><strong>Three free replies. One workspace.</strong><p>Connect a wallet, enter a short prompt, and see a real model response. A completed reply uses one free slot; uncertain requests may temporarily reserve a slot pending review.</p></div>}</div>
        <div className={styles.chatInput}><label htmlFor="perla-chat-prompt">Your prompt</label><textarea id="perla-chat-prompt" value={prompt} maxLength={1000} onChange={e=>setPrompt(e.target.value)} placeholder="Ask a question, generate an idea, or test the model…" rows={3} disabled={busy||!account||!trialOpen||account.trial.remaining===0}/><div><small>{prompt.length}/1000 characters · Free trial is Playground-only</small><button type="button" className={styles.primaryBtn} disabled={busy||!account||!prompt.trim()||!trialOpen||account.trial.remaining===0} onClick={send}><Play size={15}/>{busy?'Sending…':'Send free chat'}</button></div></div>
      </div>
      <div className={styles.infoLine}><ShieldCheck size={15}/> Quota is stored per wallet in the server ledger. Disconnecting or starting a new conversation does not restore it. Multiple wallets may still be subject to global anti-abuse limits.</div>
    </section>}
    {tab==='developer'&&<section className={styles.content} role="tabpanel">
      <div className={styles.stats}><div className={styles.stat}><span>API BASE URL</span><strong>perlacompute.xyz/v1</strong><CopyButton value={BASE}/></div><div className={styles.stat}><span>ACTIVE PRIVATE KEYS</span><strong>{account?account.keys.filter(k=>!k.revoked).length:'Connect wallet'}</strong><small>Manage access independently for each application</small></div><div className={styles.stat}><span>AVAILABLE PAID CREDITS</span><strong>{account?usd(account.usage.availableMicros):'—'}</strong><small>{topup.enabled?'Fund with USDG on Robinhood Chain':'Funding is not configured'}</small><button type="button" className={styles.copyBtn} onClick={()=>go('credits')}>Add USDG credits</button></div></div>
      <div className={styles.twoCol}><div className={styles.panel}><div className={styles.panelLabel}><LockKeyhole size={17}/> PRIVATE API KEYS</div><h2>Issue your own key.</h2><p>Sign in with an EVM wallet. Your secret API key appears only once. Every key has its own spending limits and can be revoked at any time.</p>
        {newKey&&<div className={styles.secretBlock}><strong>Save this key now — it will not be shown again.</strong><code>{newKey}</code><div><CopyButton value={newKey} label="Copy private key"/><button type="button" className={styles.copyBtn} onClick={()=>setNewKey('')}>I saved it <X size={12}/></button></div></div>}
        <div className={styles.formGrid}><label>Key name<input value={keyName} maxLength={64} onChange={e=>setKeyName(e.target.value)} /></label><label>Allowed model<select value={modelScope} onChange={e=>setModelScope(e.target.value)}><option value={TRIAL_MODEL}>{TRIAL_MODEL}</option><option value="*">All registered chat models</option></select></label><label>Daily limit (USD)<input type="number" min="0.001" step="0.1" value={daily} onChange={e=>setDaily(e.target.value)}/></label><label>Monthly limit (USD)<input type="number" min="0.001" step="1" value={monthly} onChange={e=>setMonthly(e.target.value)}/></label></div>
        <button type="button" className={styles.primaryBtn} disabled={!account||busy} onClick={generate}><KeyRound size={14}/> Create private API key</button><div className={styles.rows}>{account?.keys.filter(k=>!k.revoked).map(k=><div key={k.id}><KeyRound size={18}/><div><strong>{k.name}</strong><small>{k.prefix}… · {usd(k.daily_limit)}/day · {k.rpm} rpm</small></div><button type="button" className={styles.copyBtn} disabled={busy} onClick={()=>revoke(k.id)}>Revoke</button></div>)}</div>
      </div><div className={`${styles.panel} ${styles.darkPanel}`}><div className={styles.panelLabel}><ShieldCheck size={17}/> LIVE API</div><h2>One endpoint.<br/><em>Your credentials.</em></h2><p>API keys generated here authenticate against the running API-only gateway. Keep them on your backend, never in browser JavaScript.</p><div className={styles.scope}><span>OpenAI-compatible endpoint</span><strong>ACTIVE</strong></div><div className={styles.scope}><span>Individual API keys</span><strong>MANAGED HERE</strong></div><div className={styles.scope}><span>Free API requests</span><strong className={styles.coming}>PLAYGROUND ONLY</strong></div><div className={styles.scope}><span>USDG credit top-up</span><strong>{topup.enabled?'OPEN':'NOT CONFIGURED'}</strong></div><p className={styles.darkNote}>Use Add credits to fund your wallet's API usage with USDG when enabled. Free Playground chat allowance cannot be spent using an API key.</p></div></div>
      <div className={styles.codePanel}><div className={styles.codeHeader}><div><span className={styles.eyebrow}>QUICK START</span><h2>Chat Completions</h2></div><CopyButton value={initialSnippet} label="Copy cURL"/></div><pre className={styles.pre}><code>{initialSnippet}</code></pre><p className={styles.codeNote}>Use a unique Idempotency-Key for each new request. The private key shown in the dashboard is not your wallet private key. Never share seed phrases or wallet secrets.</p></div>
    </section>}
    {tab==='credits'&&<section className={styles.content} role="tabpanel">
      <div className={styles.stats}>
        <div className={styles.stat}><span>YOUR PAID CREDIT BALANCE</span><strong>{account?usd(account.usage.availableMicros):'Connect wallet'}</strong><small>Shares a wallet ledger with your API keys</small></div>
        <div className={styles.stat}><span>USDG RATE</span><strong>1 USDG = $1 credit</strong><small>Canonical Robinhood Chain USDG, 6 decimals</small></div>
        <div className={styles.stat}><span>PAYMENT NETWORK</span><strong>Robinhood Chain · 4663</strong><small>ETH is needed for network gas</small></div>
      </div>
      <div className={styles.twoCol}>
        <div className={styles.panel}>
          <div className={styles.panelLabel}><Wallet size={17}/> USDG CREDIT TOP-UP</div>
          <h2>Add credits to Perla.</h2>
          <p>Send canonical USDG from your signed-in wallet to the configured Perla treasury. Your balance updates only after the server verifies the finalized onchain receipt. Payments are irreversible.</p>
          {!topup.enabled?<p className={styles.error}>Top-ups have not been configured by the operator yet. No payment will be requested.</p>:<>
            <div className={styles.formGrid}>
              <label>USDG amount<input type="text" inputMode="decimal" autoComplete="off" value={topupAmount} onChange={e=>setTopupAmount(e.target.value)} placeholder="5.00" /></label>
              <label>Credit estimate<input type="text" readOnly value={/^(0|[1-9]\d{0,5})(?:\.\d{1,6})?$/.test(topupAmount)?'$'+topupAmount:'—'} /></label>
            </div>
            <div className={styles.infoLine}>Treasury: <code className={styles.address}>{topup.treasury}</code> <CopyButton value={topup.treasury||''}/></div>
            <div className={styles.infoLine}>Token: <code className={styles.address}>{topup.token}</code> <CopyButton value={topup.token||''}/></div>
            <button type="button" className={styles.primaryBtn} disabled={!account||busy||!!paymentHash} onClick={purchaseUSDG}><Wallet size={15}/>{busy?'Processing…':'Pay USDG from wallet'}</button>
          </>}
        </div>
        <div className={`${styles.panel} ${styles.darkPanel}`}>
          <div className={styles.panelLabel}><ShieldCheck size={17}/> FINALIZED RECEIPT</div>
          <h2>Check your<br/><em>payment.</em></h2>
          <p>After transferring USDG, check the transaction. Pending or non-final transactions never add credits; the same event cannot be credited twice.</p>
          <label className={styles.paymentLabel}>USDG transfer transaction hash<input value={paymentHash} onChange={e=>setPaymentHash(e.target.value)} placeholder="0x…" spellCheck={false}/></label>
          <button type="button" className={styles.copyBtn} disabled={!account||busy||!/^0x[0-9a-fA-F]{64}$/.test(paymentHash)} onClick={confirmPayment}>Check finalized payment</button>
          {/^0x[0-9a-fA-F]{64}$/.test(paymentHash)&&<p className={styles.darkNote}><a href={'https://robinhoodchain.blockscout.com/tx/'+paymentHash} target="_blank" rel="noopener noreferrer">View pending transaction on Blockscout</a></p>}
          <p className={styles.darkNote}>Always verify the network, token address and treasury address in your wallet before approving. Do not send funds on another chain.</p>
        </div>
      </div>
      {account?.deposits?.length? <div className={styles.depositHistory}><h2>Recent USDG credits</h2>{account.deposits.map((d,i)=><div key={d.hash+':'+d.log_index+i}><span>{new Date(d.created*1000).toLocaleString()}</span><a href={'https://robinhoodchain.blockscout.com/tx/'+d.hash} target="_blank" rel="noopener noreferrer">{short(d.hash)}</a><strong>{usd(d.credits)}</strong></div>)}</div>:null}
    </section>}
    {tab==='models'&&<section className={styles.content} role="tabpanel"><div className={styles.catalogHeading}><div><span className={styles.eyebrow}>LIVE MODEL DIRECTORY</span><h2>Browse Perla models.</h2><p>Catalog entries are from the active gateway. Listed models are not guaranteed to have current provider capacity. The free Playground currently uses one verified model.</p></div><button type="button" className={styles.copyBtn} disabled={loading} onClick={()=>{setLoading(true);void refresh().catch(e=>setError(errorText(e))).finally(()=>setLoading(false));}}><RefreshCw size={16}/> Refresh</button></div><div className={styles.searchWrap}><Search size={18}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by model ID or name" aria-label="Search models"/></div><div className={styles.modelList}>{filtered.map(m=><div className={styles.modelRow} key={m.id}><div><strong>{m.name||m.id}</strong><code>{m.id}</code>{m.pricing&&<small>{`$${m.pricing.inputPerMillion ?? '?'} input / $${m.pricing.outputPerMillion ?? '?'} output per 1M tokens`}</small>}</div><CopyButton value={m.id} label="Copy ID"/></div>)}</div>{!filtered.length&&<div className={styles.empty}>{loading?'Loading live models…':'No matching models'}</div>}</section>}
    <div className={styles.footerNote}><span>PERLA / AI PLAYGROUND & DEVELOPER</span><span>Mining, bridge and mainnet settlement remain separate</span></div>
  </div>;
}
