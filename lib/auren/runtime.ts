import { env } from '@/lib/vps/runtime';
export interface RuntimeConfig {
    inferenceConfigured: boolean;
    activeModel: string | null;
    workerConfigured: boolean;
    claimsEnabled: false;
    phase: 'preproduction';
}
export function providerConfig() { const e = env as unknown as Record<string, string | undefined>; const raw = e.INFERENCE_BASE_URL?.trim(); const apiKey = e.INFERENCE_API_KEY?.trim(); const model = e.INFERENCE_MODEL_ID?.trim(); const accessToken = e.PREPRODUCTION_ACCESS_TOKEN?.trim(); if (!raw || !apiKey || !model || !accessToken || accessToken.length < 32)
    return null; try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash)
        return null;
    return { baseUrl: u.toString().replace(/\/$/, ''), apiKey, model, accessToken };
}
catch {
    return null;
} }
export function runtimeStatus(): RuntimeConfig { const p = providerConfig();const e=env as unknown as Record<string,unknown>;return { phase: 'preproduction', inferenceConfigured: !!p, activeModel: p?.model ?? null, workerConfigured: !!(e.DB&&e.PERLA_MINING_ENABLED==='true'&&e.PERLA_VERIFIER_URL&&typeof e.PERLA_VERIFIER_TOKEN==='string'&&e.PERLA_VERIFIER_TOKEN.length>=32), claimsEnabled: false }; }
