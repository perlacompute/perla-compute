'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowUpRight, ChevronDown, Menu, X } from 'lucide-react';
import { normalizeProjectX } from '@/lib/perla/project-links';
import './site-header.css';
const github = 'https://github.com/perlacompute/perla-compute';
const exploreLinks = [
 ['/platform/setup', 'Miner setup', 'Install and validate your worker'],
 ['/explorer', 'Proof Explorer', 'Inspect accepted contributions'],
 ['/rewards', 'Reward Center', 'Follow funded reward epochs'],
 ['/status', 'Network status', 'Read service and release evidence'],
] as const;
export function SiteHeader({ logo }: { logo: ReactNode }) {
 const [open, setOpen] = useState(false), [explore, setExplore] = useState(false), [xUrl, setXUrl] = useState<string | null>(null);
 const path = usePathname(), id = useId(), root = useRef<HTMLElement>(null), toggle = useRef<HTMLButtonElement>(null), exploreToggle = useRef<HTMLButtonElement>(null);
 useEffect(() => { setOpen(false); setExplore(false); }, [path]);
 useEffect(() => {
  const abort = new AbortController();
  fetch('/api/project-links', { signal: abort.signal }).then(r => r.ok ? r.json() : null).then(value => { if (!abort.signal.aborted) setXUrl(normalizeProjectX(value?.x)); }).catch(() => {});
  return () => abort.abort();
 }, []);
 useEffect(() => {
  const key = (event: KeyboardEvent) => { if (event.key !== 'Escape') return; if (explore) { setExplore(false); exploreToggle.current?.focus(); } else if (open) { setOpen(false); toggle.current?.focus(); } };
  const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) { setExplore(false); setOpen(false); } };
  document.addEventListener('keydown', key); document.addEventListener('pointerdown', outside);
  return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside); };
 }, [open, explore]);
 const close = () => { setOpen(false); setExplore(false); };
 return <><a className="skip-link" href="#main-content">Skip to content</a><header className="site-header perla-header" ref={root} data-perla-header="reference-v2"><div className="header-inner">
  {logo}
  <nav id={id} className={'perla-main-nav' + (open ? ' is-open' : '')} aria-label="Main navigation">
   <div className="perla-explore"><button ref={exploreToggle} type="button" className="perla-explore-toggle" aria-expanded={explore} aria-controls={id + '-explore'} onClick={() => setExplore(v => !v)}>Explore<ChevronDown size={13}/></button>
    <div className="perla-explore-menu" id={id + '-explore'} hidden={!explore}>{exploreLinks.map(([href, label, caption]) => <Link key={href} href={href} onClick={close} aria-current={path === href ? 'page' : undefined}><span><strong>{label}</strong><small>{caption}</small></span><ArrowUpRight size={15}/></Link>)}</div>
   </div>
   {[['/docs', 'Docs'], ['/whitepaper', 'Whitepaper']].map(([href, label]) => <Link key={href} href={href} onClick={close} aria-current={path === href ? 'page' : undefined}>{label}</Link>)}
   <a href={github} target="_blank" rel="noopener noreferrer" onClick={close}>GitHub<span className="perla-external-arrow"><ArrowUpRight size={13}/></span></a>
   {xUrl && <a className="perla-x-link" href={xUrl} target="_blank" rel="noopener noreferrer" aria-label="Perla on X" onClick={close}><svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l7.9-9L1.8 2h6.4l4.5 6.8L18.9 2Zm-1.1 18h1.8L7.1 3.9H5.2L17.8 20Z"/></svg><span>X</span></a>}
   <Link className="perla-mobile-dashboard" href="/platform/mining" onClick={close}>Open dashboard<ArrowUpRight size={15}/></Link>
  </nav>
  <div className="perla-header-actions"><Link className="button button-dark button-small" href="/platform/mining">Open dashboard<ArrowUpRight size={15}/></Link><button ref={toggle} className="perla-mobile-menu icon-btn" type="button" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-controls={id} aria-expanded={open} onClick={() => { setOpen(v => !v); setExplore(false); }}>{open ? <X size={21}/> : <Menu size={21}/>}</button></div>
 </div></header></>;
}
