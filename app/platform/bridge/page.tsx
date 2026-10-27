import type { Metadata } from 'next';
import { BridgePreview } from '@/components/perla/bridge-preview';
export const metadata: Metadata = { title: 'Bridge · Coming soon' };
export default function BridgePage() { return <div className="portal-workspace"><BridgePreview/></div>; }
