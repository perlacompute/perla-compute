import type {Metadata} from 'next';
import { Landing } from '@/components/auren/landing';
export const metadata:Metadata={alternates:{canonical:'/'}};
export default function Page() { return <Landing />; }
