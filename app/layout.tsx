import type { Metadata } from 'next';
import { brand } from '@/lib/auren/brand';
import './globals.css';
import './refinement.css';
import './portal.css';
import './public-ready.css';
import { Preferences } from '@/components/auren/preferences';
export const metadata: Metadata = {
    metadataBase: new URL('https://perlacompute.xyz'),
    applicationName: brand.fullName,
    openGraph: {type: 'website',siteName:brand.fullName,title:brand.fullName+' — GPU work. Verified contributions.',description:brand.description,locale:'en_US'},
    twitter: {card:'summary_large_image',site:'@perlacompute',title:brand.fullName,description:brand.description},
    title: { default: `${brand.fullName} — ${brand.tagline}`, template: `%s | ${brand.fullName}` },
    description: brand.description,
    icons: { icon: '/favicon.svg', shortcut: '/favicon.svg' },
};
export default function RootLayout({ children }: Readonly<{
    children: React.ReactNode;
}>) {
    return <html lang="en"><body><Preferences />{children}</body></html>;
}
