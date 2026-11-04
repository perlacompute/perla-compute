import type {Metadata} from 'next';
import Link from 'next/link';
import {ArrowUpRight} from 'lucide-react';
import {Header,Footer,Pill} from '@/components/auren/shared';
import {env} from '@/lib/vps/runtime';
import {miningSummary,type MiningEnv} from '@/lib/perla/coordinator';
import {CHAIN_ID} from '@/lib/perla/protocol';
import {ServiceReadiness} from '@/components/perla/service-readiness';
import {ServiceChecks} from '@/components/perla/service-checks';
import {LaunchReadiness} from '@/components/perla/launch-readiness';
import {EarnedProof} from '@/components/perla/earned-proof';
export const metadata:Metadata={alternates:{canonical:'/status'},title:'Network status',description:'Current mining admission, verifier and installer checks, reward coverage and verified testnet payout evidence.'};
export const dynamic='force-dynamic';
export default async function Status(){
 let snapshot=null;try{snapshot={...await miningSummary(env as unknown as MiningEnv),chainId:CHAIN_ID};}catch{}
 const checkedAt=new Date().toISOString().replace('T',' ').replace(/\.\d+Z$/,' UTC');
 return <><Header/><main id="main-content" className="section-wrap pl-document"><div className="pl-document-intro public-status-intro"><span className="eyebrow">PERLA / SERVICE STATUS</span><h1>Network status.<br/><em>Evidence in view.</em></h1><p>Check current work admission, installer availability and reward settlement. Inspect the recorded GPU-to-wallet result and the scope behind it.</p><div className="public-document-links"><Link href="/platform/setup">Miner setup<ArrowUpRight size={14}/></Link><Link href="/rewards">Reward Center<ArrowUpRight size={14}/></Link><a href="https://github.com/perlacompute/perla-compute" target="_blank" rel="noopener noreferrer">Source &amp; releases<ArrowUpRight size={14}/></a></div></div>
 <ServiceReadiness data={snapshot} checkedAt={checkedAt}/><ServiceChecks/><LaunchReadiness/>
 <div className="public-status-evidence"><EarnedProof compact/></div>
 <section className="pl-status-section"><span className="eyebrow">HARDWARE / OBSERVED SCOPE</span><h2>One verified GPU path.<br/><em>Clear boundaries.</em></h2><div className="pl-milestones"><article><Pill tone="green">Observed on RTX 4090</Pill><h3>GPU work to an earned claim</h3><p>The fresh testnet recorded a passing GPU self-test, sustained accepted work, a winning reward round, funded epoch 20760 and a successful earned claim.</p><Link className="arrow-link" href="/rewards/20760">Inspect the funded epoch<ArrowUpRight size={14}/></Link></article><article><Pill>Per-host self-test</Pill><h3>RTX 30 / 40 / 50</h3><p>The installer includes sm86, sm89 and sm120 targets. Each host must pass the GPU checks; the RTX 4090 result does not independently validate every model.</p><Link className="arrow-link" href="/docs#rtx">Read the GPU guide<ArrowUpRight size={14}/></Link></article><article><Pill>Separate validation</Pill><h3>H100 / H200 integration</h3><p>The reference Hopper integration remains documented separately. Its hardware, model fit and inference-to-share behavior require their own deployment evidence.</p><Link className="arrow-link" href="/docs#hopper-validation">Read the Hopper guide<ArrowUpRight size={14}/></Link></article></div></section>
 <section className="pl-status-section"><span className="eyebrow">WHAT THE CHECKS MEAN</span><h2>A working testnet, with a stated trust model.</h2><p>Native proofs are checked offchain. Reward contracts enforce a funded allocation and prevent a claim being paid twice. Participants still trust the operator to retain accepted work and publish the complete eligible allocation.</p><p>Mainnet, migration and customer AI job services remain separate product steps. The testnet evidence is not an independent audit, a hardware attestation or a profitability benchmark.</p><Link className="arrow-link" href="/whitepaper#trust">Read the trust model<ArrowUpRight size={15}/></Link></section>
 <details className="public-detail public-status-archive"><summary>Historical software validation records</summary><div><p>These records document earlier software and compilation checks. They are preserved as release history; the running service checks and earned-reward evidence above describe the current deployment.</p><div className="public-document-links"><a href="/validation-record-0.5.0.md">Foundation 0.5.0<ArrowUpRight size={14}/></a><a href="/validation-record-v0.2.1.md">VPS baseline 0.2.1<ArrowUpRight size={14}/></a><a href="/validation-record-rtx-0.4.0-rc1.md">RTX compilation scope<ArrowUpRight size={14}/></a></div><p>Earlier CPU-generated fixtures and local EVM checks establish their stated software scope. They do not substitute for physical GPU or public-chain evidence.</p></div></details>
 </main><Footer/></>;
}
