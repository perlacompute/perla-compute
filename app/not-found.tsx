import Link from 'next/link';
import { Mark } from '@/components/auren/shared';
export default function NotFound() { return <main className="not-found"><Mark /><span className="eyebrow">A LITTLE OFF THE BEATEN PATH</span><h1>This page is still<br /><em>unexplored.</em></h1><p>Let’s bring you back to a familiar starting point.</p><Link href="/" className="button button-dark">Back to Perla</Link></main>; }
