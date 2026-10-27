import { createHash } from 'node:crypto';
import { workerRelease as release, type WorkerReleaseStatus } from './worker-release';
const digest = (body: Uint8Array) => createHash('sha256').update(body).digest('hex');
const api = `https://api.github.com/repos/${release.repository}/releases/tags/${release.tag}`;
class ReleaseFailure extends Error { constructor(readonly reason: WorkerReleaseStatus['reason']) { super(reason); } }
export function createWorkerReleaseResolver({ request = fetch, now = Date.now }: { request?: typeof fetch; now?: () => number } = {}) {
  let cached: WorkerReleaseStatus | undefined, expires = 0, pending: Promise<WorkerReleaseStatus> | undefined;
  async function check(): Promise<WorkerReleaseStatus> {
    const base = { repository: release.repository, tag: release.tag, version: release.version, releaseUrl: release.page, checkedAt: new Date(now()).toISOString() };
    const signal = AbortSignal.timeout(12000);
    async function bytes(url: string, limit: number, redirects = 0): Promise<Uint8Array> {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !(parsed.hostname === 'github.com' || parsed.hostname.endsWith('.githubusercontent.com'))) throw new ReleaseFailure('integrity');
      const res = await request(url, { signal, redirect: 'manual', cache: 'no-store', headers: { 'User-Agent': 'Perla-worker-release-check' } });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        await res.body?.cancel();
        if (redirects >= 5 || !res.headers.get('location')) throw new ReleaseFailure('integrity');
        return bytes(new URL(res.headers.get('location')!, url).href, limit, redirects + 1);
      }
      if (!res.ok) { await res.body?.cancel(); throw new ReleaseFailure(res.status === 404 ? 'not_public' : [403, 429].includes(res.status) ? 'rate_limited' : 'unreachable'); }
      if (Number(res.headers.get('content-length')) > limit) { await res.body?.cancel(); throw new ReleaseFailure('integrity'); }
      const reader = res.body?.getReader(); if (!reader) throw new ReleaseFailure('integrity');
      let size = 0; const chunks: Uint8Array[] = [];
      try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new ReleaseFailure('integrity'); chunks.push(value); } }
      catch (error) { await reader.cancel(); throw error; }
      const out = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; } return out;
    }
    try {
      const res = await request(api, { signal, redirect: 'error', cache: 'no-store', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Perla-worker-release-check' } });
      if (!res.ok) { await res.body?.cancel(); throw new ReleaseFailure(res.status === 404 ? 'not_public' : [403, 429].includes(res.status) ? 'rate_limited' : 'unreachable'); }
      const metadataReader = res.body?.getReader(); if (!metadataReader) throw new ReleaseFailure('integrity');
      let metadataSize = 0; const metadataChunks: Uint8Array[] = [];
      try { for (;;) { const {value, done} = await metadataReader.read(); if (done) break; metadataSize += value.length; if (metadataSize > 2 * 1024 * 1024) throw new ReleaseFailure('integrity'); metadataChunks.push(value); } }
      catch (error) { await metadataReader.cancel(); throw error; }
      const metadataText = Buffer.concat(metadataChunks).toString('utf8');
      const meta = JSON.parse(metadataText);
      if (meta.draft !== false || meta.tag_name !== release.tag || meta.html_url !== release.page || !Array.isArray(meta.assets)) throw new ReleaseFailure('integrity');
      const assets = new Map<string, { browser_download_url: string; digest?: string }>();
      for (const asset of meta.assets) {
        if (!(release.assets as readonly string[]).includes(asset.name) || assets.has(asset.name) || asset.browser_download_url !== release.base + asset.name) throw new ReleaseFailure('integrity');
        assets.set(asset.name, asset);
      }
      if (assets.size !== release.assets.length) throw new ReleaseFailure('integrity');
      const sums = await bytes(release.base + 'SHA256SUMS', 65536);
      const sumAsset = assets.get('SHA256SUMS')!;
      if (sumAsset.digest && sumAsset.digest !== 'sha256:' + digest(sums)) throw new ReleaseFailure('integrity');
      const expected = new Map<string, string>();
      for (const line of new TextDecoder().decode(sums).trim().split('\n')) {
        const m = /^([a-f0-9]{64})  ([a-zA-Z0-9.-]+)$/.exec(line);
        if (!m || m[2] === 'SHA256SUMS' || !assets.has(m[2]) || expected.has(m[2])) throw new ReleaseFailure('integrity');
        expected.set(m[2], m[1]);
      }
      if (expected.size !== assets.size - 1) throw new ReleaseFailure('integrity');
      let manifest: any;
      for (const [name, hash] of expected) {
        const body = await bytes(release.base + name, name.endsWith('.tar.gz') ? 64 * 1024 * 1024 : 2 * 1024 * 1024);
        if (digest(body) !== hash || (assets.get(name)!.digest && assets.get(name)!.digest !== 'sha256:' + hash)) throw new ReleaseFailure('integrity');
        if (name === 'worker-release.json') manifest = JSON.parse(new TextDecoder().decode(body));
      }
      if (manifest?.schema !== 1 || manifest.repository !== release.repository || manifest.tag !== release.tag || manifest.version !== release.version || manifest.chainId !== release.chainId || manifest.protocol !== release.protocol || manifest.upstreamCommit !== release.upstreamCommit || manifest.profiles?.rtx?.archive !== 'perla-rtx-worker.tar.gz' || manifest.profiles?.hopper?.archive !== 'perla-worker.tar.gz') throw new ReleaseFailure('integrity');
      return { ...base, state: 'available', integrityVerified: true };
    } catch (e) { return { ...base, state: 'unavailable', integrityVerified: false, reason: e instanceof ReleaseFailure ? e.reason : 'unreachable' }; }
  }
  return async () => {
    if (cached && now() < expires) return cached;
    if (!pending) pending = check().then(value => { cached = value; expires = now() + (value.state === 'available' ? 300000 : value.reason === 'rate_limited' ? 900000 : 60000); return value; }).finally(() => { pending = undefined; });
    return pending;
  };
}
export const resolveWorkerRelease = createWorkerReleaseResolver();
