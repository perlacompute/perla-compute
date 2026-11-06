import { ApiDeveloperConsole } from '@/components/compute/api-developer-console';
type Params = { tab?: string };
export default async function ComputePage({ searchParams }: { searchParams?: Promise<Params> }) {
  const params = await searchParams;
  const tab = params?.tab;
  return <ApiDeveloperConsole initialTab={tab === 'playground' || tab === 'models' || tab === 'credits' ? tab : 'developer'} />;
}
