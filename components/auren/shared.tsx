'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useId } from 'react';
import { ArrowUpRight, ArrowRight, Check, Copy, X, ChevronDown, Menu, Wallet, LoaderCircle } from 'lucide-react';
import { brand } from '@/lib/auren/brand';
export function Mark({className=''}:{className?:string}) {
 const id=useId().replaceAll(':','');
 return <svg className={`brand-mark ${className}`} width="36" height="36" viewBox="0 0 80 80" fill="none" aria-hidden="true"><defs><mask id={`pa${id}`}><rect width="80" height="80" fill="white"/><circle cx="24" cy="39.5" r="4.7" fill="black"/><circle cx="56" cy="40.5" r="4.7" fill="black"/></mask><mask id={`pb${id}`}><rect width="80" height="80" fill="white"/><circle cx="40.5" cy="24" r="4.7" fill="black"/><circle cx="39.5" cy="56" r="4.7" fill="black"/></mask></defs><g stroke="currentColor" strokeWidth="3.5"><ellipse cx="40" cy="40" rx="12" ry="31" transform="rotate(-45 40 40)" mask={`url(#pa${id})`}/><ellipse cx="40" cy="40" rx="13" ry="27" transform="rotate(45 40 40)" mask={`url(#pb${id})`}/></g></svg>;
}
export function Logo({ compact = false }: {
    compact?: boolean;
}) { return <Link href="/" className="logo" aria-label={`${brand.fullName} home`}><Mark /><span>{brand.name.toLowerCase()}<small>{compact ? '' : brand.wordmarkSuffix}</small></span></Link>; }
export function ArrowLink({ href, children, className = '' }: {
    href: string;
    children: React.ReactNode;
    className?: string;
}) { return <Link href={href} className={`arrow-link ${className}`}>{children}<ArrowUpRight size={17}/></Link>; }
export function Pill({ children, tone = 'neutral' }: {
    children: React.ReactNode;
    tone?: string;
}) { return <span className={`pill pill-${tone}`}>{children}</span>; }
export function CopyButton({ value, label = 'Copy', className = '' }: {
    value: string;
    label?: string;
    className?: string;
}) { const [copied, setCopied] = useState(false); return <button className={`copy-btn ${className}`} aria-label={copied ? 'Copied' : label} onClick={async () => { try {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
}
catch {
    setCopied(false);
} }}>{copied ? <Check size={15}/> : <Copy size={15}/>}<span>{copied ? 'Copied' : label}</span></button>; }
export function Modal({ title, children, onClose }: {
    title: string;
    children: React.ReactNode;
    onClose: () => void;
}) { useEffect(() => { const old = document.body.style.overflow; document.body.style.overflow = 'hidden'; const key = (e: KeyboardEvent) => { if (e.key === 'Escape')
    onClose(); if (e.key === 'Tab') {
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] button,[role="dialog"] a,[role="dialog"] input,[role="dialog"] select,[role="dialog"] textarea')).filter(x => !x.hasAttribute('disabled'));
    if (items.length) {
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        }
        else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    }
} }; window.addEventListener('keydown', key); const previous = document.activeElement as HTMLElement; document.querySelector<HTMLElement>('[role="dialog"] button')?.focus(); return () => { document.body.style.overflow = old; window.removeEventListener('keydown', key); previous?.focus(); }; }, [onClose]); return <div className="modal-backdrop" onClick={onClose}><section role="dialog" aria-modal="true" aria-labelledby="modal-title" className="modal" onClick={e => e.stopPropagation()}><div className="modal-head"><h2 id="modal-title">{title}</h2><button className="icon-btn" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></div>{children}</section></div>; }
type Provider = {
    request: (args: {
        method: string;
        params?: unknown[];
    }) => Promise<unknown>;
    on?: (event: string, fn: (value: unknown) => void) => void;
    removeListener?: (event: string, fn: (value: unknown) => void) => void;
};
export function getProvider(): Provider | undefined { return (window as unknown as {
    ethereum?: Provider;
}).ethereum; }
export function WalletButton() {
    const [account, setAccount] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [open, setOpen] = useState(false);
    const [chain, setChain] = useState<number | null>(null);
    useEffect(() => { const p = getProvider(); if (!p)
        return; const refresh = (a: unknown) => setAccount(Array.isArray(a) && typeof a[0] === 'string' ? a[0] : ''); const network = (c: unknown) => setChain(typeof c === 'string' ? parseInt(c, 16) : null); p.request({ method: 'eth_accounts' }).then(refresh).catch(() => { }); p.request({ method: 'eth_chainId' }).then(network).catch(() => { }); p.on?.('accountsChanged', refresh); p.on?.('chainChanged', network); return () => { p.removeListener?.('accountsChanged', refresh); p.removeListener?.('chainChanged', network); }; }, []);
    const connect = async () => { const p = getProvider(); setError(''); if (!p) {
        setOpen(true);
        setError('Open this page in a wallet-enabled browser or install an EVM wallet to connect.');
        return;
    } setBusy(true); try {
        const a = await p.request({ method: 'eth_requestAccounts' });
        if (Array.isArray(a) && typeof a[0] === 'string')
            setAccount(a[0]);
        const c = await p.request({ method: 'eth_chainId' });
        if (typeof c === 'string')
            setChain(parseInt(c, 16));
        setOpen(true);
    }
    catch (e) {
        setError((e as {
            code?: number;
        }).code === 4001 ? 'Connection request cancelled.' : 'Wallet connection could not be completed. Please try again.');
        setOpen(true);
    }
    finally {
        setBusy(false);
    } };
    const switchChain = async () => { try {
        const p = getProvider();
        if (!p)
            return;
        await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: brand.network.chainHex }] });
        setChain(brand.network.chainId);
        setError('');
    }
    catch (e) {
        if ((e as {
            code?: number;
        }).code === 4902) {
            try {
                await getProvider()?.request({ method: 'wallet_addEthereumChain', params: [{ chainId: brand.network.chainHex, chainName: brand.network.name, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [brand.network.rpc], blockExplorerUrls: [brand.network.explorer] }] });
                setError('Network added. Select Robinhood Testnet in your wallet, then reconnect.');
            }
            catch {
                setError('Could not add the testnet. You can add it manually from your wallet.');
            }
        }
        else
            setError('Network switch cancelled or unavailable.');
    } };
    return <><button className="wallet-button" onClick={() => account ? setOpen(true) : void connect()} disabled={busy}>{busy ? <LoaderCircle size={15} className="spin"/> : <Wallet size={15}/>}<span>{account ? `${account.slice(0, 6)}…${account.slice(-4)}` : 'Connect wallet'}</span>{account && <ChevronDown size={13}/>}</button>{open && <Modal title={account ? 'Your wallet' : 'Connect your wallet'} onClose={() => setOpen(false)}><div className="wallet-dialog"><div className="wallet-avatar"><Wallet size={28}/></div>{account ? <><p className="mono wallet-address">{account}</p><Pill tone={chain === brand.network.chainId ? 'green' : 'coral'}>{chain === brand.network.chainId ? 'Robinhood Testnet' : `Network ${chain ?? 'unknown'}`}</Pill><p>Your wallet is connected. Sign in from the mining dashboard to manage workers. Claims require a funded reward epoch.</p>{chain !== brand.network.chainId && <button className="button button-dark" onClick={switchChain}>Switch to Robinhood Testnet<ArrowRight size={16}/></button>}<CopyButton value={account} label="Copy address"/></> : <><h3>Bring your EVM wallet.</h3><p>Connect an installed wallet to explore your testnet account. No payment is requested.</p><button className="button button-dark" onClick={connect}>Connect installed wallet<ArrowRight size={16}/></button></>}{error && <p className="form-error" role="alert">{error}</p>}</div></Modal>}</>;
}
export function Header() {
 const [open, setOpen] = useState(false);
 const path = usePathname();
 const id = useId();
 useEffect(() => { setOpen(false); }, [path]);
 useEffect(() => {
   const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
   window.addEventListener('keydown', close);
   return () => window.removeEventListener('keydown', close);
 }, []);
 const links = [['/platform/mining', 'Mine'], ['/explorer', 'Explorer'], ['/rewards', 'Rewards'], ['/docs', 'Docs'], ['/whitepaper', 'Whitepaper'], ['/status', 'Status']];
 return <><a className="skip-link" href="#main-content">Skip to content</a><header className="site-header"><div className="header-inner"><Logo/><nav id={id} className={open ? 'marketing-nav open' : 'marketing-nav'} aria-label="Main navigation">{links.map(([href, label]) => <Link href={href} key={href} aria-current={path === href ? 'page' : undefined} onClick={() => setOpen(false)}>{label}<ArrowUpRight className="nav-mobile-arrow" size={16}/></Link>)}<Link className="nav-mobile-dashboard" href="/platform/mining" onClick={() => setOpen(false)}>Open dashboard<ArrowUpRight size={16}/></Link></nav><div className="header-actions"><Link href="/platform/mining" className="button button-dark button-small">Open dashboard<ArrowUpRight size={15}/></Link><button className="mobile-menu icon-btn" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-controls={id} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X/> : <Menu/>}</button></div></div></header></>;
}
export function Footer(){return <footer className="site-footer"><div className="footer-top"><div><Logo/><p>GPU work. Verified contributions.<br/>Settlement on Robinhood.</p></div><div className="footer-column"><strong>Participate</strong><Link href="/platform/mining">Mining dashboard</Link><Link href="/platform/setup">Guided miner setup</Link><Link href="/participate">Participant guide</Link></div><div className="footer-column"><strong>Learn</strong><Link href="/docs">Docs</Link><Link href="/whitepaper">Whitepaper</Link><Link href="/docs#tokenomics">Supply & rewards</Link></div><div className="footer-column"><strong>Network</strong><Link href="/explorer">Proof Explorer</Link><Link href="/rewards">Reward Center</Link><Link href="/status">Status & evidence</Link></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} {brand.fullName}</span><span><i className="status-dot muted-dot"/>{brand.phase} · Robinhood Testnet</span></div></footer>}
