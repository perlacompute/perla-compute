import {Models} from '@/components/auren/models';
import {FutureUpgrade} from '@/components/auren/future-upgrade';
import {brand} from '@/lib/auren/brand';
export default function Page(){return brand.features.modelCatalog?<Models/>:<FutureUpgrade name="Model explorer"/>}
