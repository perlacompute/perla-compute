import type { Metadata } from 'next';
import { Header, Footer } from '@/components/auren/shared';
import { ProofReceipt } from '@/components/perla/proof-receipt';
export const metadata: Metadata = { title: 'Contribution receipt', robots: { index: false, follow: true } };
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <><Header/><main id="main-content" className="section-wrap portal-page"><ProofReceipt id={id}/></main><Footer/></>; }
