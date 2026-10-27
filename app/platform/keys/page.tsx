import {Keys} from '@/components/auren/keys';
import {FutureUpgrade} from '@/components/auren/future-upgrade';
import {brand} from '@/lib/auren/brand';
export default function Page(){return brand.features.developerApi?<Keys/>:<FutureUpgrade name="Developer access"/>}
