import type { Metadata } from 'next';
import { Header, Footer } from '@/components/auren/shared';
import { BridgePreview } from '@/components/perla/bridge-preview';
export const metadata: Metadata = { title: 'Bridge · Coming soon', description: 'Planned Perla testnet reward migration: 100:7 conversion, a 70M mainnet PERL maximum and a global 1M daily output cap. Bridge remains closed.' };
export default function BridgePage() { return <><Header/><main id="main-content" className="section-wrap portal-page"><BridgePreview/></main><Footer/></>; }
