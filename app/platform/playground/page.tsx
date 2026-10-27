import {Suspense} from 'react';
import {Playground} from '@/components/auren/playground';
import {FutureUpgrade} from '@/components/auren/future-upgrade';
import {brand} from '@/lib/auren/brand';
export default function Page(){return brand.features.inference?<Suspense fallback={<p>Loading Playground…</p>}><Playground/></Suspense>:<FutureUpgrade name="Playground"/>}
