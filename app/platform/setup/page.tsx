import type { Metadata } from 'next';
import { MinerOnboarding } from '@/components/perla/miner-onboarding';
export const metadata: Metadata = { title: 'Miner setup', description: 'Authorize a wallet, register a worker, install the supported miner and follow the first accepted contribution.' };
export default function SetupPage() { return <MinerOnboarding/>; }
