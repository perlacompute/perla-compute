import type { Metadata } from 'next';
import { Header, Footer } from '@/components/auren/shared';
import { RewardEpoch } from '@/components/perla/reward-epoch';
export const metadata: Metadata = { title: 'Reward epoch' };
export default async function EpochPage({ params }: { params: Promise<{ epoch: string }> }) { const { epoch } = await params; return <><Header/><main id="main-content" className="section-wrap portal-page"><RewardEpoch epoch={epoch}/></main><Footer/></>; }
