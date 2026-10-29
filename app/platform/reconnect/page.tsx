import type { Metadata } from 'next';
import { WorkerReconnect } from '@/components/perla/worker-reconnect';
export const metadata: Metadata = { title: 'Reconnect worker', description: 'Authorize a new machine while keeping your permanent Perla Worker ID and contribution history.' };
export default async function ReconnectPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { const params = await searchParams; const code = typeof params.code === 'string' && /^[A-F0-9]{12}$/.test(params.code) ? params.code : ''; return <WorkerReconnect initialCode={code}/>; }
