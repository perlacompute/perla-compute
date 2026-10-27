'use client';
import { useId, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUpRight, LockKeyhole, ShieldCheck } from 'lucide-react';
import { REWARD_PLAN as plan, parseTestnetAmount, mainnetEquivalent, formatPlanAmount } from '@/lib/perla/reward-plan.mjs';
import styles from './rewards-plan.module.css';
export function BridgePreview() {
  const id = useId(), [amount,setAmount] = useState('1000');
  let quote: bigint | null = null, error = '';
  try { if (amount !== '') quote = mainnetEquivalent(parseTestnetAmount(amount)); } catch (e) { error = e instanceof Error ? e.message : 'Check the amount.'; }
  return <div className={styles.bridge} data-perla-bridge="coming-soon">
    <header className={styles.bridgeIntro}><div><span className="eyebrow">PERLA / BRIDGE</span><h1>Your contribution.<br/><em>The next network.</em></h1><p>Preview the planned migration of verified testnet mining rewards to Robinhood Mainnet.</p></div><span className={styles.badge}><LockKeyhole size={13}/>Coming soon</span></header>
    <div className={styles.bridgeColumns}><section className={styles.converter} aria-labelledby="bridge-preview-title">
      <div className={styles.heading}><div><span className="micro">CONVERSION PREVIEW</span><h2 id="bridge-preview-title">Testnet → Mainnet</h2></div><span className={styles.smallRate}>{plan.testnetRatioUnits} : {plan.mainnetRatioUnits}</span></div>
      <label htmlFor={id}>Testnet PERL amount</label><div className={styles.inputRow}><input id={id} inputMode="decimal" autoComplete="off" value={amount} aria-invalid={!!error} aria-describedby={id+'-help'} onChange={event=>setAmount(event.target.value)} placeholder="0.00"/><span>Testnet PERL</span></div>
      <div className={styles.direction}><ArrowDown size={17}/></div><div className={styles.quote} aria-live="polite"><span>Planned mainnet equivalent</span><strong>{quote === null ? '—' : formatPlanAmount(quote,8)}<small> PERL</small></strong><p>{plan.testnetRatioUnits} testnet PERL = {plan.mainnetRatioUnits} mainnet PERL</p></div>
      <p id={id+'-help'} className={error ? styles.error : styles.footnote}>{error || 'Illustration only. This input is not your wallet balance, an eligibility check or a reserved allocation. Display rounds down to eight decimal places; settlement arithmetic uses integer base units.'}</p>
      <button type="button" className={styles.closedButton} disabled><LockKeyhole size={16}/>Bridge opens with mainnet</button><p className={styles.closedNote}>Coming soon — planned to open when mainnet goes live.</p>
    </section><aside className={styles.bridgeDetails} aria-label="Planned migration rules"><span className="micro">PLANNED LIMITS</span><div><span>Maximum migration allocation</span><strong>{Number(plan.migrationAllocation).toLocaleString('en-US')} <small>mainnet PERL</small></strong></div><div><span>Global daily output limit</span><strong>{Number(plan.dailyMainnetLimit).toLocaleString('en-US')} <small>mainnet PERL</small></strong><p>Shared across all participants, resetting at 00:00 UTC. The cap is a maximum, not a daily distribution target.</p></div><div><span>Equivalent testnet input at this rate</span><strong>≈{Math.floor(Number(plan.dailyMainnetLimit)*plan.testnetRatioUnits/plan.mainnetRatioUnits).toLocaleString('en-US')} <small>PERL / day</small></strong><p>The daily limit is denominated in mainnet output. Using multiple wallets does not increase the global limit.</p></div><div className={styles.requirements}><ShieldCheck size={19}/><p>Eligibility comes from verified mining reward records. Owner holdings and arbitrary testnet transfers do not automatically create migration rights. Each eligible allocation can be settled only once.</p></div><p className={styles.footnote}>Mainnet contracts and migration reserves are not deployed or funded by this update. At full utilization, distributing the entire migration cap requires at least {Math.ceil(Number(plan.migrationAllocation)/Number(plan.dailyMainnetLimit))} daily epochs. No approval, deposit or migration transaction is available here.</p></aside></div>
    <div className={styles.bridgeFooter}><Link className="arrow-link" href="/platform/rewards">View testnet rewards<ArrowUpRight size={14}/></Link><Link className="arrow-link" href="/docs#migration">Read migration policy<ArrowUpRight size={14}/></Link></div>
  </div>;
}
