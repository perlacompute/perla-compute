import Link from 'next/link';
import { ArrowUpRight, ArrowLeftRight } from 'lucide-react';
import { REWARD_PLAN as plan } from '@/lib/perla/reward-plan.mjs';
import styles from './rewards-plan.module.css';
const number = (value: string) => Number(value).toLocaleString('en-US');
export function RewardAllocationPlan() {
  return <section className={styles.allocation} aria-labelledby="allocation-plan-title" data-reward-plan={plan.version}>
    <div className={styles.heading}><div><span className="micro">MAINNET ALLOCATION PLAN</span><h2 id="allocation-plan-title">{Number(plan.totalMiningAllocation)/1e6}M PERL for mining.</h2><p>Planned fixed mainnet supply: {number(plan.mainnetSupply)} PERL. Allocation targets are separate from funded testnet rewards.</p></div><span className={styles.badge}>Mainnet on hold</span></div>
    <div className={styles.allocations}>{[
      [Number(plan.migrationAllocation)/1e6+'M', 'Testnet reward migration', Number(plan.migrationAllocation)/Number(plan.mainnetSupply)*100+'% of mainnet supply · maximum migration allocation'],
      [Number(plan.mainnetMiningAllocation)/1e6+'M', 'Mining after mainnet', Number(plan.mainnetMiningAllocation)/Number(plan.mainnetSupply)*100+'% of mainnet supply · separate mining allocation'],
      [Number(plan.unallocated)/1e6+'M', 'Other allocations', Number(plan.unallocated)/Number(plan.mainnetSupply)*100+'% of mainnet supply · not assigned in this plan'],
    ].map(([value,title,caption]) => <article key={title}><strong>{value}<small> PERL</small></strong><h3>{title}</h3><p>{caption}</p></article>)}</div>
    <div className={styles.planLink}><ArrowLeftRight size={20}/><div><strong>{plan.testnetRatioUnits} testnet PERL → {plan.mainnetRatioUnits} mainnet PERL</strong><p>Planned global output limit: {number(plan.dailyMainnetLimit)} mainnet PERL per UTC day. Eligibility follows verified mining history.</p></div><Link className="arrow-link" href="/platform/bridge">View Bridge<ArrowUpRight size={14}/></Link></div>
    <p className={styles.footnote}>These mainnet reserves are not funded by this release. Bridge opening requires the mainnet launch, a verified eligibility snapshot and funded distribution contracts.</p>
  </section>;
}
