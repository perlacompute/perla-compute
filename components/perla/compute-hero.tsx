'use client';
import Link from 'next/link';
import { ArrowUpRight, Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ComputeField } from './compute-field';
import './compute-hero.css';

export function ComputeHero() {
 const canvas = useRef<HTMLCanvasElement>(null), field = useRef<ComputeField | null>(null);
 const [ready, setReady] = useState(false), [paused, setPaused] = useState(false), [generation, setGeneration] = useState(0);
 useEffect(() => {
  let cancelled = false;
  const surface = canvas.current; if (!surface) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)'); setPaused(reduced.matches);
  const motion = () => { setPaused(reduced.matches); field.current?.setPaused(reduced.matches); };
  const restored = () => setGeneration(n => n + 1);
  reduced.addEventListener('change', motion); surface.addEventListener('webglcontextrestored', restored);
  import('./compute-field').then(({ createComputeField }) => {
   if (cancelled) return;
   field.current = createComputeField(surface, { onReady: value => { if (!cancelled) setReady(value); } });
   field.current?.setPaused(reduced.matches);
  }).catch(() => { if (!cancelled) setReady(false); });
  return () => { cancelled = true; field.current?.dispose(); field.current = null; reduced.removeEventListener('change', motion); surface.removeEventListener('webglcontextrestored', restored); };
 }, [generation]);
 const toggle = () => { setPaused(value => { field.current?.setPaused(!value); return !value; }); };
 return <section className="compute-hero" data-perla-hero="matrix-v2" data-ready={ready} aria-labelledby="compute-hero-title">
  <div className="compute-hero-backdrop" aria-hidden="true"/>
  <canvas ref={canvas} className="compute-field" tabIndex={ready ? 0 : -1} role="img" aria-label="Interactive compute sculpture. Drag or use the arrow keys to move the view. Press Home to reset." aria-describedby="compute-scene-description"/>
  <div className="compute-hero-wash" aria-hidden="true"/>
  <div className="compute-hero-copy">
   <p className="compute-hero-eyebrow">GPU mining <span aria-hidden="true">/</span> Verifiable compute</p>
   <h1 id="compute-hero-title">Your GPU.<br/><em>A greater purpose.</em></h1>
   <p className="compute-hero-description">GPU mining for AI compute.<br className="compute-mobile-break"/> Built on Robinhood.</p>
   <div className="compute-hero-actions"><Link className="button compute-primary" href="/platform/setup">Explore mining<ArrowUpRight size={17}/></Link><Link className="button compute-secondary" href="/docs">Read the docs<ArrowUpRight size={17}/></Link></div>
  </div>
  <div className="compute-scene-controls" hidden={!ready}><button type="button" onClick={toggle} aria-label={paused ? 'Play ambient motion' : 'Pause ambient motion'} aria-pressed={paused}>{paused ? <Play size={14}/> : <Pause size={14}/>}</button><button type="button" onClick={() => field.current?.reset()} aria-label="Reset 3D view"><RotateCcw size={14}/></button></div>
  <p id="compute-scene-description" className="compute-sr-only">Decorative, interactive compute blocks. The sculpture is an illustration, not a display of live network activity.</p>
 </section>;
}
