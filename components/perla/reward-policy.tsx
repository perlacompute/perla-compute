'use client';
import { useId, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { dailyBudget, cumulativeBudget } from '@/lib/perla/emission.mjs';
import { mainnetEquivalent, REWARD_PLAN as plan } from '@/lib/perla/reward-plan.mjs';
import { RewardAllocationPlan } from './reward-allocation-plan';

function display(value: bigint) {
  const scale = 10n ** 18n;
  return (value / scale).toLocaleString('en-US') + '.' + (value % scale).toString().padStart(18, '0').slice(0, 3);
}

export function RewardPolicy() {
  const id = useId();
  const [dayInput, setDay] = useState('1');
  const [shareInput, setShare] = useState('1');
  const day = Number(dayInput), percentage = Number(shareInput);
  const valid = dayInput !== '' && shareInput !== '' && Number.isInteger(day) && day >= 1 && day <= 1000000 && Number.isFinite(percentage) && percentage >= 0 && percentage <= 100 && Math.abs(percentage * 100 - Math.round(percentage * 100)) < 0.000001;
  const budget = valid ? dailyBudget(day) : 0n;
  const allocation = valid ? budget * BigInt(Math.round(percentage * 100)) / 10000n : 0n;
  return <div className="pl-policy">
    <RewardAllocationPlan/>
    <div className="pl-policy-top"><span className="eyebrow">TESTNET REFERENCE POLICY</span><span className="pill">Not activated</span></div>
    <div className="pl-supply-grid"><div><span>Testnet supply</span><strong>1B <small>PERL</small></strong><p>Fixed supply on Robinhood Testnet. Epoch rewards still require explicit funding.</p></div><div><span>Planned mainnet supply</span><strong>1B <small>PERL</small></strong><p>200M planned for mining: 70M migration and 130M future mainnet mining. Mainnet reserves are not funded by this release.</p></div></div>
    <div className="pl-policy-description"><h3>A declining budget. A proportional allocation.</h3><p>The reference schedule calculates a declining budget over UTC days: <code>C(d) = S × d / (d + 1460)</code>. Each daily budget is the difference between two rounded cumulative amounts. At day 1,460, the cumulative scheduled budget is 50% of the testnet pool.</p><p>This calculates a budget; the current distributor does not enforce the schedule. The operator still publishes and funds each epoch. Days with no accepted work create no allocation and have no automatic rollover.</p></div>
    <div className="pl-policy-calculator"><div className="pl-policy-inputs"><label htmlFor={id + '-day'}>Emission day<input id={id + '-day'} type="number" min="1" max="1000000" step="1" value={dayInput} onChange={event => setDay(event.target.value)}/></label><label htmlFor={id + '-share'}>Your share of accepted points (%)<input id={id + '-share'} type="number" min="0" max="100" step="0.01" value={shareInput} onChange={event => setShare(event.target.value)}/></label></div><div className="pl-policy-output" aria-live="polite">{valid ? <><span>Illustration for day {day.toLocaleString('en-US')}</span><strong>{display(allocation)} <small>PERL</small></strong><p>{percentage}% of a {display(budget)} PERL daily budget. Cumulative scheduled budget: {display(cumulativeBudget(day))} PERL.</p></> : <p>Enter a whole day from 1 to 1,000,000 and a contribution percentage from 0 to 100 with up to two decimal places.</p>}</div></div>
    {valid && <p className="pl-policy-footnote">Planned mainnet equivalent of this illustration: <strong>{display(mainnetEquivalent(allocation))} PERL</strong> at {plan.testnetRatioUnits}:{plan.mainnetRatioUnits}. This does not establish migration eligibility or reserve capacity.</p>}
    <p className="pl-policy-footnote">Illustration only, displayed to three decimal places. Actual testnet claims use integer base units and deterministic rounding. Only verified mining reward records may enter the future migration snapshot. Arbitrary balances and transfers do not create eligibility. Bridge remains closed.</p>
    <Link className="arrow-link" href="/whitepaper#emission">Read the emission model and funding limits<ArrowUpRight size={15}/></Link>
  </div>;
}
