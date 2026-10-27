import type { Metadata } from 'next';
import { MinerOnboarding } from '@/components/perla/miner-onboarding';
export const metadata: Metadata = { title: 'Miner setup', description: 'Install a pinned GitHub worker release, validate your GPU and follow your first contribution.' };
export default function SetupPage() { return <MinerOnboarding/>; }
