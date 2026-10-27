import type { Metadata } from 'next';
import { brand } from '@/lib/auren/brand';
import './globals.css';
import './refinement.css';
import './portal.css';
import { Preferences } from '@/components/auren/preferences';
export const metadata: Metadata = {
    title: { default: `${brand.fullName} — ${brand.tagline}`, template: `%s | ${brand.fullName}` },
    description: brand.description,
    icons: { icon: '/favicon.svg', shortcut: '/favicon.svg' },
};
export default function RootLayout({ children }: Readonly<{
    children: React.ReactNode;
}>) {
    return <html lang="en"><body><Preferences />{children}</body></html>;
}
