/** Fix the canonical site origin when a TLS proxy fronts Next's HTTP listener.
 * Use operator configuration rather than trusting arbitrary forwarded headers. */
export function canonicalMiningRequest(request: Request): Request {
  const incoming = new URL(request.url);
  const value = process.env.PERLA_PUBLIC_ORIGIN?.trim();
  // Next normalizes loopback URLs to localhost. Keep the actual HTTP Host for
  // local testing; external TLS deployments use the explicit public origin.
  const origin = new URL(value || `${incoming.protocol}//${request.headers.get('host') || incoming.host}`);
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
    (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname)))) {
    throw Error('PERLA_PUBLIC_ORIGIN must be the HTTPS website origin without a path.');
  }
  return new Request(new URL(incoming.pathname + incoming.search, origin), request);
}
