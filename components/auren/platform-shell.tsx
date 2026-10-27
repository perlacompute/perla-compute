'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { ArrowUpRight, ArrowLeftRight, LayoutDashboard, MessageSquare, Cpu, Layers3, KeyRound, FileText, BookOpen, Settings2, ShieldCheck, PanelLeftClose, Menu, X, ChevronRight, ExternalLink, Command, Wallet, Search, Terminal } from 'lucide-react';
import { Logo, WalletButton, Pill } from './shared';
import { brand } from '@/lib/auren/brand';
export type Status = {
    inferenceConfigured: boolean;
    activeModel: string | null;
    workerConfigured: boolean;
    claimsEnabled: boolean;
    phase: string;
    workers: number;
    acceptedWork: number;
};
const defaultStatus: Status = { inferenceConfigured: false, activeModel: null, workerConfigured: false, claimsEnabled: false, phase: 'preproduction', workers: 0, acceptedWork: 0 };
const RuntimeContext = createContext({ status: defaultStatus, statusError: false });
export const useRuntime = () => useContext(RuntimeContext);
const nav = [
 { href: '/platform/mining', label: 'Compute & mining', icon: Cpu },
 { href: '/platform/setup', label: 'Miner setup', icon: Terminal },
 { href: '/platform/rewards', label: 'Reward Center', icon: Wallet },
 { href: '/platform/bridge', label: 'Bridge', icon: ArrowLeftRight },
 { href: '/explorer', label: 'Proof Explorer', icon: Search },
 ...(brand.features.inference ? [{href:'/platform/playground',label:'Playground',icon:MessageSquare}] : []),
 ...(brand.features.modelCatalog ? [{href:'/platform/models',label:'Model explorer',icon:Layers3}] : []),
 ...(brand.features.developerApi ? [{href:'/platform/keys',label:'API access',icon:KeyRound}] : []),
];
export function PlatformShell({ children }: {
    children: React.ReactNode;
}) {
    const path = usePathname();
    const [mobile, setMobile] = useState(false);
    const [status, setStatus] = useState(defaultStatus);
    const [statusError, setStatusError] = useState(false);
    useEffect(() => { setMobile(false); }, [path]);
    useEffect(() => {
      if (!mobile) return;
      const previous = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobile(false); };
      window.addEventListener('keydown', close);
      return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', close); };
    }, [mobile]);
    useEffect(() => { const c = new AbortController(); fetch('/api/status', { signal: c.signal }).then(r => { if (!r.ok)
        throw Error(); return r.json(); }).then(data => { if (!data || typeof data !== 'object' || !('inferenceConfigured' in data))
        throw Error('Invalid status'); setStatus(data as Status); }).catch(e => { if (e.name !== 'AbortError')
        setStatusError(true); }); return () => c.abort(); }, []);
    const current = nav.find(n => path === n.href)?.label || (path === '/platform/settings' ? 'Settings' : 'Workspace');
    return <RuntimeContext.Provider value={{ status, statusError }}><div className="platform"><aside className={`sidebar ${mobile ? 'sidebar-open' : ''}`}><div className="sidebar-brand"><Logo /><button className="icon-btn mobile-menu" aria-label="Close navigation" onClick={() => setMobile(false)}><X size={20}/></button></div><div className="workspace-picker"><span className="workspace-icon">P</span><div><strong>Personal workspace</strong><span>Mining workspace</span></div><Pill>01</Pill></div><span className="sidebar-label micro">WORKSPACE</span><nav aria-label="Platform navigation">{nav.map(n => <Link key={n.href} href={n.href} className={path === n.href ? 'active' : ''}><n.icon size={18}/><span>{n.label}</span>{n.label === 'Bridge' && <span className="nav-beta">SOON</span>}{n.label === 'Compute & mining' && <span className="nav-beta">BETA</span>}</Link>)}</nav><span className="sidebar-label micro">RESOURCES</span><nav><Link href="/docs"><BookOpen size={18}/><span>Docs</span><ArrowUpRight size={14}/></Link><Link href="/whitepaper"><FileText size={18}/><span>Whitepaper</span><ArrowUpRight size={14}/></Link><Link href="/status"><ShieldCheck size={18}/><span>Network status</span><ArrowUpRight size={14}/></Link><Link href="/platform/settings" className={path === '/platform/settings' ? 'active' : ''}><Settings2 size={18}/><span>Settings</span></Link></nav><div className="sidebar-bottom"><Link href="/" className="back-to-site">Back to website<ArrowUpRight size={14}/></Link><div className="sidebar-network"><span className="network-symbol">↗</span><span>Robinhood Testnet</span><span className="status-dot muted-dot"/></div></div></aside>{mobile && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobile(false)}/>}
    <div className="platform-main"><header className="platform-header"><div className="breadcrumbs"><button className="icon-btn mobile-menu" aria-label="Open navigation" aria-expanded={mobile} onClick={() => setMobile(true)}><Menu size={20}/></button><span className="desktop-breadcrumb">Workspace</span><ChevronRight size={13}/><span>{current}</span></div><div className="platform-header-right"><Pill tone="coral">Validation release</Pill><WalletButton /></div></header><main id="main-content" className="platform-content">{children}</main><footer className="platform-footer"><span>{brand.fullName} <span>·</span> A foundation in progress</span><Link href="/docs#release"><span className={`status-dot ${statusError ? 'coral-dot' : 'muted-dot'}`}/>{statusError ? 'Status unavailable' : status.workerConfigured ? 'Work admission enabled' : 'Work admission paused'}<ArrowUpRight size={12}/></Link></footer></div></div></RuntimeContext.Provider>;
}
