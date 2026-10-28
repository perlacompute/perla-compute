'use client';
import { useEffect, useState } from 'react';
import { miningApi } from './mining-client';
export type CurrentReward = { configured: boolean; epoch: number; day: number | null; startEpoch: number | null; budget: string | null; networkPoints: string; walletPoints: string | null; estimatedAmount: string | null; closesAt: number; settlementOpensAt: number };
const amount = (value: string) => { const n = BigInt(value); return (n / 10n ** 18n).toLocaleString('en-US') + '.' + (n % 10n ** 18n).toString().padStart(18, '0').slice(0, 3); };
export function LiveRewardSummary({ current }: { current?: CurrentReward }) {
  const [network, setNetwork] = useState<CurrentReward | null>(null), [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    const update = () => miningApi<CurrentReward>('rewards/summary', { signal: abort.signal }).then(value => { setNetwork(value); setError(''); }).catch(() => { if (!abort.signal.aborted) setError('Current epoch data is unavailable.'); });
    void update(); const timer = setInterval(() => { if (document.visibilityState === 'visible') void update(); }, 30000);
    return () => { clearInterval(timer); abort.abort(); };
  }, []);
  const data = current || network;
  return <section className="portal-card" aria-label="Current reward epoch"><div className="portal-card-head"><div><span className="micro">CURRENT UTC EPOCH</span><h2>{data ? 'Epoch ' + data.epoch : 'Reading the reward schedule…'}</h2><p className="portal-caption">{data?.configured ? 'Emission day ' + data.day + ' · start epoch ' + data.startEpoch : 'The reward schedule has not been pinned.'}</p></div></div>
    {error && <p className="portal-error" role="status">{error}</p>}
    {data && <><div className="portal-metrics"><article><span>Scheduled daily budget</span><strong>{data.budget === null ? '—' : amount(data.budget)}</strong><small>testnet PERL · requires funding</small></article><article><span>Network accepted points</span><strong>{BigInt(data.networkPoints).toLocaleString('en-US')}</strong><small>Points determine proportional allocation</small></article>{data.walletPoints !== null && <article><span>Your accepted points</span><strong>{BigInt(data.walletPoints).toLocaleString('en-US')}</strong><small>For the signed-in recipient</small></article>}{data.estimatedAmount !== null && <article><span>Your current estimate</span><strong>{amount(data.estimatedAmount)}</strong><small>testnet PERL · changes until epoch closure</small></article>}</div><p className="portal-caption portal-inset">The day closes at 00:00 UTC. Preparation opens at 00:05 UTC after outstanding jobs expire. Budget × your points ÷ network points determines the allocation, with deterministic integer rounding. An estimate is not a token balance or a claim. Empty days have no allocation or automatic rollover.</p></>}
  </section>;
}
