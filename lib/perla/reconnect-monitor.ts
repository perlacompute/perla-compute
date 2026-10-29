/** One cancellable polling loop; transient failures never erase a confirmed identity. */
export function monitorReconnect<T extends { completed: boolean }>(options: {
  load: (signal: AbortSignal) => Promise<T>;
  value: (value: T) => void;
  error: (message: string, retrying: boolean, status?: number) => void;
  schedule?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  const schedule = options.schedule || setTimeout, cancel = options.cancel || clearTimeout;
  let active = true, revision = 0, failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  function clear() {
    if (timer !== undefined) cancel(timer);
    if (timeout !== undefined) cancel(timeout);
    timer = timeout = undefined;
    controller?.abort();
  }
  async function refresh() {
    if (!active) return;
    const request = ++revision;
    clear();
    const abort = new AbortController(); controller = abort;
    timeout = schedule(() => abort.abort(), 20_000);
    try {
      const result = await options.load(abort.signal);
      if (!active || request !== revision) return;
      failures = 0; options.error('', false); options.value(result);
      if (!result.completed) timer = schedule(() => void refresh(), 4_000);
    } catch (error) {
      if (!active || request !== revision) return;
      const status = typeof (error as { status?: unknown })?.status === 'number'
        ? (error as { status: number }).status : 0;
      const retrying = status === 0 || status === 408 || status === 429 || status >= 500;
      options.error(retrying ? 'Connection interrupted. Retrying the transfer status…'
        : status === 401 ? 'Your owner-wallet session expired. Connect your wallet again.'
        : error instanceof Error ? error.message : 'This reconnect request is unavailable.', retrying, status);
      if (retrying) timer = schedule(() => void refresh(), status === 429 ? 30_000
        : Math.min(30_000, 4_000 * 2 ** ++failures));
    } finally {
      if (request === revision && timeout !== undefined) { cancel(timeout); timeout = undefined; }
    }
  }
  void refresh();
  return { refresh, stop: () => { active = false; revision++; clear(); } };
}
