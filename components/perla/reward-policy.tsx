import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { LiveRewardSummary } from './live-reward-summary';
import { RewardAllocationPlan } from './reward-allocation-plan';

export function RewardPolicy() {
  return <div className="pl-policy">
    <details className="public-detail"><summary>Testnet supply and the planned mainnet allocation</summary><div><RewardAllocationPlan/></div></details>
    <div className="pl-policy-top"><span className="eyebrow">TESTNET ROUND REWARDS</span><span className="pill">PPLNS settlement</span></div>
    <div className="pl-policy-description"><h3>Valid work. A harder round target. Earned PERL.</h3><p>Accepted shares measure difficulty-weighted work. A share must also meet the harder round target to unlock one reward round. The round reward is split across the recent share window in proportion to its work weight, including the winning share. A partially included oldest share receives only its included weight.</p><p>The initial round target is 256 times the reference share difficulty. The window holds twice the round work target. Difficulty can adjust one step after every 16 completed rounds, within 256–2,048 times the reference. The 194-second target is a controller setting; it is not a measured GPU benchmark or a payout promise.</p><p>The declining UTC budget is a maximum, not an automatic daily payout. Each qualifying round unlocks 1/446 of that day’s cap, rounded down in token base units. At most 446 reward rounds can complete in a UTC day. Unused capacity stays in treasury and does not roll over. Shares without a qualifying round unlock zero PERL.</p><p>Completed rounds keep an immutable allocation snapshot. After UTC close and the settlement delay, the earned total can be published to the existing testnet distributor. The owner-authorized settlement service funds and activates earned epochs automatically. Public miners claim their allocation in Reward Center after its onchain funding check passes.</p></div>
    <LiveRewardSummary/>
    <p className="pl-policy-footnote">Testnet has a fixed 1B PERL supply. The planned mainnet mining allocation is 200M PERL: at most 70M for eligible testnet migration and 130M for future mining. Migration remains closed. Transfers and arbitrary token balances do not create migration eligibility.</p>
    <Link className="arrow-link" href="/whitepaper#emission">Read the targets, allocation rules and funding limits<ArrowUpRight size={15}/></Link>
  </div>;
}
