/** Only public profile links belong in the public header. */
export function normalizeProjectX(value: unknown): string | null {
 if (typeof value !== 'string' || value.length > 200) return null;
 try {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname)) return null;
  const match = /^\/([a-zA-Z0-9_]{1,15})\/?$/.exec(url.pathname);
  if (!match || ['home', 'explore', 'search', 'intent', 'settings', 'messages', 'notifications', 'i'].includes(match[1].toLowerCase()) || url.search || url.hash) return null;
  return 'https://x.com/' + match[1];
 } catch { return null; }
}
