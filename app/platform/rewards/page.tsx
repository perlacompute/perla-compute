import type { Metadata } from 'next';
import { RewardCenter } from '@/components/perla/reward-center';
export const metadata: Metadata = { title: 'Your rewards' };
export default function AccountRewardsPage() { return <div className="portal-workspace"><RewardCenter initialTab="mine"/></div>; }
