'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getProvider } from '@/components/auren/shared';
import { brand } from '@/lib/auren/brand';

export type Worker = { id: string; name: string; created: number; last_seen: number | null; revoked: number | null; miner_version?:string|null; architecture?:string|null; last_error?:string|null };
export type Share = { id: string; job_id: string; worker_id: string; epoch: number; proof_hash: string; accepted: number; points: number };
export type MiningAccount = { address: string; workers: Worker[]; history: Share[]; totals: { shares: number; points: number }; miningEnabled: boolean; diagnostics?:{worker_id:string;kind:string;count:number}[] };
export class MiningApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = 'MiningApiError'; }
}
export async function miningApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api/mining/' + path, { ...options, cache: 'no-store', headers: { 'Content-Type': 'application/json', ...options.headers } });
  let data;
  try { data = await response.json(); }
  catch { throw new MiningApiError('The server response could not be read. Please retry.', response.ok ? 502 : response.status); }
  if (!response.ok) throw new MiningApiError(data.error || 'This request could not be completed.', response.status);
  return data as T;
}
export const short = (value: string, length = 8) => value.length > length * 2 ? `${value.slice(0, length)}…${value.slice(-length)}` : value;
export const utcDate = (seconds: number) => new Date(seconds * 1000).toLocaleString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' UTC';
export function tokenAmount(raw: string, info: { symbol: string; decimals: number } | null) {
  if (!info) return { value: BigInt(raw).toLocaleString('en-US'), unit: 'base units' };
  const scale = 10n ** BigInt(info.decimals), n = BigInt(raw);
  const fraction = (n % scale).toString().padStart(info.decimals, '0').slice(0, 4).replace(/0+$/, '');
  return { value: (n / scale).toLocaleString('en-US') + (fraction ? '.' + fraction : n > 0n && n < scale ? '.0000…' : ''), unit: info.symbol };
}
export async function ensureTestnet() {
  const provider = getProvider(); if (!provider) throw Error('Open Perla in an EVM wallet browser to continue.');
  if (Number(await provider.request({ method: 'eth_chainId' })) !== brand.network.chainId) {
    try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: brand.network.chainHex }] }); }
    catch (error) {
      if ((error as { code?: number }).code !== 4902) throw error;
      await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: brand.network.chainHex, chainName: brand.network.name, nativeCurrency: { name: 'Test ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: [brand.network.rpc], blockExplorerUrls: [brand.network.explorer] }] });
    }
  }
  if (Number(await provider.request({ method: 'eth_chainId' })) !== brand.network.chainId) throw Error('Select Robinhood Testnet in your wallet before continuing.');
  return provider;
}
export function useMiningAccount() {
  const [account, setAccount] = useState<MiningAccount | null>(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const address = useRef<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const response = await fetch('/api/mining/account', { cache: 'no-store' });
      if (response.status === 401) { setAccount(null); address.current = null; setError(''); return; }
      const data = await response.json(); if (!response.ok) throw Error(data.error || 'Account unavailable.');
      setAccount(data); address.current = data.address; setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Account unavailable.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void reload(); const timer = setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, 15_000);
    const provider = getProvider();
    const changed = (accounts: unknown) => {
      const next = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0].toLowerCase() : null;
      if (address.current && next !== address.current.toLowerCase()) {
        setAccount(null); address.current = null;
        void miningApi('auth/logout', { method: 'POST' }).catch(() => {});
      }
    };
    provider?.on?.('accountsChanged', changed);
    return () => { clearInterval(timer); provider?.removeListener?.('accountsChanged', changed); };
  }, [reload]);
  const signIn = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const provider = getProvider(); if (!provider) throw Error('Open Perla in an EVM wallet browser or install an EVM wallet.');
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') throw Error('No wallet account was selected.');
      const selected = accounts[0];
      const challenge = await miningApi<{ id: string; message: string }>('auth/challenge', { method: 'POST', body: JSON.stringify({ address: selected }) });
      const signature = await provider.request({ method: 'personal_sign', params: [challenge.message, selected] });
      const current = await provider.request({ method: 'eth_accounts' });
      if (!Array.isArray(current) || String(current[0]).toLowerCase() !== selected.toLowerCase()) throw Error('The selected wallet changed. Please sign in again.');
      await miningApi('auth/verify', { method: 'POST', body: JSON.stringify({ id: challenge.id, signature }) });
      await reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Wallet authorization was not completed.'); }
    finally { setBusy(false); }
  }, [reload]);
  return { account, loading, busy, error, setError, reload, signIn };
}
