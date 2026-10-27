import definitions from './work-profiles.json';
import type { MiningDatabase } from './database';
import { compactTarget, digest, currentEpoch } from './protocol';

export type WorkProfile = { id: string; bits: number; points: number };
export type PolicyEnv = { DB?: MiningDatabase; PERLA_MINING_ENABLED?: string };
export type PolicyRow = { profile_id: string; start_epoch: number; activated_at: number; validation_hash: string; validation_family: string; validation_version: string };
export const workProfiles: readonly WorkProfile[] = definitions.profiles;
export function profileFor(id: string): WorkProfile {
  const profile = workProfiles.find(p => p.id === id);
  if (!profile) throw Error('Unknown server work profile.');
  const target = compactTarget(profile.bits);
  if (target <= 0n || target * BigInt(definitions.maximumWorkFactor) >= 2n ** 256n || compactTarget(definitions.referenceBits) !== target * BigInt(profile.points)) throw Error('Invalid non-saturating work profile.');
  return profile;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
let fingerprint: Promise<string> | undefined;
export const policyHash = () => fingerprint ??= digest(canonical(definitions));
export async function workPolicy(env: PolicyEnv, now = Math.floor(Date.now() / 1000)) {
  const row = env.DB ? await env.DB.prepare('SELECT * FROM mining_policy_state WHERE id=1').first<PolicyRow>() : null;
  const profile = row ? profileFor(row.profile_id) : profileFor('p1');
  const scheduled = !!row && row.start_epoch > currentEpoch(now);
  const status = !row ? 'not_activated' : scheduled ? 'scheduled' : env.PERLA_MINING_ENABLED !== 'true' ? 'paused' : 'enabled';
  return { protocol: definitions.protocol, chainId: definitions.chainId, certificateVersion: definitions.certificateVersion,
    hash: await policyHash(), definitions, profile, referenceTarget: compactTarget(definitions.referenceBits).toString(),
    target: compactTarget(profile.bits).toString(), configured: !!row, status, miningEnabled: status === 'enabled',
    startEpoch: row?.start_epoch ?? null, activatedAt: row?.activated_at ?? null,
    operatorValidation: row ? { hash: row.validation_hash, family: row.validation_family, minerVersion: row.validation_version } : null,
    pointRule: 'Server-assigned points equal the exact reference-target ratio. One job is credited at most once.',
    scope: 'Robinhood Testnet only. Native proof validity is not physical GPU attestation or one-person-one-worker enforcement.' };
}
