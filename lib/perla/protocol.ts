/** Pearl's 76-byte envelope is reused as a work-domain container, NOT a block. */
export const UPSTREAM_COMMIT = '82e6eee7076aafe10123e08db78f100d270c0582';
export const PROTOCOL = 'perla-pearl-plain-v4';
export const LEGACY_PROTOCOL = 'perla-pearl-plain-v3';
export const CERT_VERSION = 3;
export const CHAIN_ID = 46630;
// Fixed initial validation-network target. Never selected by a client.
export const SHARE_BITS = 0x1d00ffff;
export const JOB_TTL = 300;
export const MAX_PROOF_BYTES = 5 * 1024 * 1024;
export const hex = (a: Uint8Array) => Array.from(a, n => n.toString(16).padStart(2, '0')).join('');
export const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export async function digest(s: string | Uint8Array) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof s === 'string' ? new TextEncoder().encode(s) : s as Uint8Array<ArrayBuffer>)));
}
export function toBase64(a: Uint8Array) {
  let raw='';for(let i=0;i<a.length;i+=16384)raw+=String.fromCharCode(...a.subarray(i,i+16384));return btoa(raw);
}
export function fromBase64(s: string) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4) throw Error('Invalid base64');
  const raw=atob(s);const a=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)a[i]=raw.charCodeAt(i);
  if (toBase64(a) !== s) throw Error('Non-canonical base64');
  return a;
}
export async function makeJobHeader(origin: string, worker: string, address: string, epoch: number, nonce: string, timestamp: number, bits = SHARE_BITS) {
  const unhex = (s: string) => Uint8Array.from(s.match(/../g)!, x => parseInt(x, 16));
  const previous = unhex(await digest(`perla-work-v4|${CHAIN_ID}|${origin}|${epoch}`));
  const commitment = unhex(await digest(`perla-recipient-v4|${CHAIN_ID}|${worker}|${address}|${epoch}|${nonce}`));
  const a = new Uint8Array(76); const view = new DataView(a.buffer);
  view.setUint32(0, 1, true); a.set(previous.reverse(), 4); a.set(commitment.reverse(), 36);
  view.setUint32(68, timestamp, true); view.setUint32(72, bits, true);
  return toBase64(a);
}
export function compactTarget(bits: number) {
  const exponent = bits >>> 24; const mantissa = BigInt(bits & 0x7fffff);
  return exponent > 3 ? mantissa << BigInt(8 * (exponent - 3)) : mantissa >> BigInt(8 * (3 - exponent));
}
export function currentEpoch(now: number) { return Math.floor(now / 86400); }
