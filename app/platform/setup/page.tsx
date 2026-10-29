import type { Metadata } from 'next';
import { MinerOnboarding } from '@/components/perla/miner-onboarding';
export const metadata: Metadata = { title: 'Miner setup', description: 'Create a new GPU worker or move a permanent Worker ID to another machine with owner-wallet approval.' };
export default async function SetupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
 const params = await searchParams;
 const id = typeof params.worker === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(params.worker) ? params.worker : '';
 const pair = typeof params.pair === 'string' && /^[A-F0-9]{12}$/.test(params.pair) ? params.pair : '';
 return <MinerOnboarding initialWorkerId={id} reuseRequested={params.reuse === '1'} pairCode={pair}/>;
}
