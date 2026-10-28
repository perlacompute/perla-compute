export const workerRelease = {
  repository: 'perlacompute/perla-compute', version: '0.6.0', tag: 'worker-v0.6.0',
  protocol: 'perla-pearl-plain-v4', chainId: 46630,
  page: 'https://github.com/perlacompute/perla-compute/releases/tag/worker-v0.6.0',
  base: 'https://github.com/perlacompute/perla-compute/releases/download/worker-v0.6.0/',
  upstreamCommit: '82e6eee7076aafe10123e08db78f100d270c0582',
  assets: ['install.sh', 'install.py', 'worker-release.json', 'perla-rtx-worker.tar.gz', 'perla-worker.tar.gz', 'SHA256SUMS'],
} as const;
export type WorkerProfile = 'rtx' | 'hopper';
export type WorkerReleaseStatus = {
  state: 'available' | 'unavailable'; repository: string; tag: string; version: string;
  releaseUrl: string; checkedAt: string; integrityVerified: boolean;
  reason?: 'not_public' | 'rate_limited' | 'unreachable' | 'integrity';
};
const cli = '"$HOME/.local/bin/perla"';
export function workerCommands(profile: WorkerProfile, device = 0) {
  if (!['rtx', 'hopper'].includes(profile) || !Number.isInteger(device) || device < 0 || device > 255) throw new Error('Invalid worker profile or GPU index');
  return {
    install: `curl --fail --show-error --location --proto '=https' --proto-redir '=https' \\\n  '${workerRelease.base}install.sh' -o install-perla.sh\nbash install-perla.sh --profile ${profile}`,
    doctor: `${cli} doctor --device ${device}`,
    build: `${cli} build --device ${device}`,
    configure: `${cli} configure --file ./worker.env`,
    selftest: `${cli} selftest --device ${device} > gpu-validation.json\ncat gpu-validation.json`,
    start: profile === 'rtx' ? `${cli} start --device ${device} --shares 1` : `${cli} start --model pearl-ai/Llama-3.3-70B-Instruct-pearl \\\n  --tensor-parallel-size 2`,
    monitor: `${cli} status\n${cli} logs --tail 100`, stop: `${cli} stop`, version: `${cli} version`, updateHelp: `${cli} update --help`,
  };
}
