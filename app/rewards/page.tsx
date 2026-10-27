import type { Metadata } from 'next';
import { Header, Footer } from '@/components/auren/shared';
import { RewardCenter } from '@/components/perla/reward-center';
export const metadata: Metadata = { title: 'Reward Center', description: 'Inspect published Perla reward epochs, funding checks, allocation manifests and wallet claims on Robinhood Testnet.' };
export default function RewardsPage() { return <><Header/><main id="main-content" className="section-wrap portal-page"><RewardCenter/></main><Footer/></>; }
