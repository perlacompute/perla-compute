import type { Metadata } from 'next';
import { Header, Footer } from '@/components/auren/shared';
import { ProofExplorer } from '@/components/perla/proof-explorer';
import { Suspense } from 'react';
export const metadata: Metadata = { title: 'Proof Explorer', description: 'Follow accepted native-proof contributions, recipient wallets and reward epochs in the Perla ledger.' };
export default function ExplorerPage() { return <><Header/><main id="main-content" className="section-wrap portal-page"><Suspense fallback={<p role="status">Loading Proof Explorer…</p>}><ProofExplorer/></Suspense></main><Footer/></>; }
