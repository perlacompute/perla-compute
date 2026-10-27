import Link from 'next/link';
import { ArrowUpRight, ArrowRight, Cpu, ShieldCheck, Wallet } from 'lucide-react';
import { Header, Footer, Mark, Pill } from './shared';
import { KnowledgeHeading, ProtocolSection, WorkloadsSection, VerificationSection, ParticipationSection, ContributionSection, SecuritySection, FaqList } from '@/components/perla/knowledge';
export function Landing() {
  return <><Header/><main id="main-content" className="compute-home">
    <section className="hero section-wrap mining-first-hero">
      <div className="hero-copy">
        <Link href="/status" className="hero-announcement"><span className="tiny-dot"/>PERLA / VALIDATION RELEASE<span className="announcement-line"/><span>View release status</span><ArrowUpRight size={13}/></Link>
        <h1>GPU mining.<br/><em>For AI compute.</em></h1>
        <p className="hero-description">Choose standalone RTX matrix mining or the separate Hopper AI-inference path. Perla checks native proofs, records accepted shares for your wallet, and prepares funded settlement on Robinhood.</p>
        <div className="hero-buttons"><Link href="/platform/setup" className="button button-dark">Set up a worker<ArrowUpRight size={17}/></Link><Link href="#how-it-works" className="button button-outline">Understand the system<ArrowRight size={17}/></Link></div>
        <div className="hero-note"><span className="network-symbol">↗</span>Robinhood settlement<span className="note-divider"/>GPU validation pending</div>
      </div>
      <div className="hero-art mining-hero-art">
        <div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/>
        <img className="sculpture" src="/brand/compute-sculpture.svg" alt="Abstract coral compute sculpture" width="720" height="700" fetchPriority="high"/>
        <div className="art-label art-label-top"><span className="micro">PERLA / COMPUTE</span><span>Compute. Contribute. Verify.</span></div>
        <div className="hero-session-card"><div><span className="session-card-icon"><Cpu size={17}/></span><span>GPU mining worker<small>INITIAL VALIDATION PROFILE</small></span><Pill tone="coral">RTX / Hopper</Pill></div><div className="hero-session-row"><span>Proof checking</span><span>Native · offchain</span></div><div className="hero-session-row"><span>Reward settlement</span><span>Robinhood Testnet</span></div><Link href="/status">Read the current validation scope<ArrowUpRight size={14}/></Link></div>
      </div>
    </section>
    <section className="compute-principles"><div className="section-wrap principles-inner"><span><Cpu size={17}/>AI-oriented GPU work</span><span><ShieldCheck size={17}/>Native share verification</span><span><Wallet size={17}/>Wallet-bound contributions</span><span><span className="network-symbol">↗</span>Robinhood settlement</span></div></section>
    <ProtocolSection/><WorkloadsSection/><VerificationSection/><ParticipationSection/><ContributionSection/><SecuritySection/>
    <section className="section-wrap pl-section" id="roadmap"><KnowledgeHeading number="07" label="RELEASE PATH" title="Validate the foundation." emphasis="Then open participation.">Milestones follow working evidence rather than a launch-date promise. The status page separates software checks from deployment and contract activation.</KnowledgeHeading><div className="roadmap"><article className="current"><span className="roadmap-dot"/><span className="micro">IMPLEMENTED FOUNDATION</span><h3>Native mining integration</h3><p>Wallet accounts, worker tokens, native proof checks, a durable ledger and funded reward tooling.</p><Pill tone="coral">GPU validation pending</Pill></article><article><span className="roadmap-dot"/><span className="micro">DEPLOYMENT GATES</span><h3>A complete testnet flow</h3><p>Validate RTX or Hopper GPU work, accept a native share, validate the service and demonstrate a funded test-token claim.</p><Pill>Operator validation</Pill></article><article><span className="roadmap-dot"/><span className="micro">SEPARATE FUTURE DECISIONS</span><h3>A broader AI platform</h3><p>Expand hardware and workload support, then assess managed capacity, AI services and a Pons token launch.</p><Pill>Later phase</Pill></article></div><Link className="arrow-link" href="/status">Read the evidence and remaining gates<ArrowUpRight size={15}/></Link></section>
    <section className="section-wrap pl-section pl-faq-layout" id="faq"><div><span className="eyebrow">08 / COMMON QUESTIONS</span><h2>Understand your work.<br/><em>Understand the rules.</em></h2><p>Hardware, costs, point accounting, claims and operator trust—explained before you install.</p><Link className="arrow-link" href="/docs">Open complete documentation<ArrowUpRight size={15}/></Link></div><FaqList/></section>
    <section className="section-wrap closing-section"><div className="closing-mark"><Mark/></div><span className="eyebrow">PERLA / A CLEAR PATH TO PARTICIPATION</span><h2>Know the system.<br/><em>Bring your compute.</em></h2><div className="hero-buttons"><Link href="/platform/mining" className="button button-dark">Open mining dashboard<ArrowUpRight size={17}/></Link><Link href="/whitepaper" className="button button-outline">Read whitepaper<ArrowRight size={17}/></Link></div></section>
  </main><Footer/></>;
}
