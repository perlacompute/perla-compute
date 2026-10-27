import { PlatformShell } from '@/components/auren/platform-shell';
export default function Layout({ children }: {
    children: React.ReactNode;
}) { return <PlatformShell>{children}</PlatformShell>; }
