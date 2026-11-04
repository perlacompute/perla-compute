import type {Metadata} from 'next';
export const metadata:Metadata={robots:{index:false,follow:true}};
import { PlatformShell } from '@/components/auren/platform-shell';
export default function Layout({ children }: {
    children: React.ReactNode;
}) { return <PlatformShell>{children}</PlatformShell>; }
