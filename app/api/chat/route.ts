export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { providerConfig } from '@/lib/auren/runtime';
import { validateChatBody } from '@/lib/auren/chat-validation';
export async function POST(request: Request) {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin)
        return Response.json({ error: 'Request origin is not allowed.' }, { status: 403 });
    const p = providerConfig();
    if (!p)
        return Response.json({ error: 'Live inference is not configured. Use the labelled interface preview to explore the Playground.', code: 'inference_unavailable' }, { status: 503 });
    if (request.headers.get('authorization') !== `Bearer ${p.accessToken}`)
        return Response.json({ error: 'A valid pre-production access token is required.', code: 'access_required' }, { status: 401 });
    if (!request.headers.get('content-type')?.includes('application/json'))
        return Response.json({ error: 'JSON content type required.' }, { status: 415 });
    const reader = request.body?.getReader();
    if (!reader)
        return Response.json({ error: 'Request body is required.' }, { status: 400 });
    let bytes = 0;
    const chunks: Uint8Array[] = [];
    try {
        while (true) {
            const item = await reader.read();
            if (item.done)
                break;
            bytes += item.value.byteLength;
            if (bytes > 65536) {
                await reader.cancel();
                return Response.json({ error: 'Request body is too large.' }, { status: 413 });
            }
            chunks.push(item.value);
        }
    }
    catch {
        return Response.json({ error: 'Could not read request.' }, { status: 400 });
    }
    const merged = new Uint8Array(bytes);
    let offset = 0;
    for (const c of chunks) {
        merged.set(c, offset);
        offset += c.length;
    }
    let body: unknown;
    try {
        body = JSON.parse(new TextDecoder().decode(merged));
    }
    catch {
        return Response.json({ error: 'Invalid JSON.' }, { status: 400 });
    }
    const input = validateChatBody(body);
    if (!input)
        return Response.json({ error: 'Provide 1–30 valid messages, a model, and temperature between 0 and 2.' }, { status: 400 });
    if (input.model !== p.model)
        return Response.json({ error: 'This model is not enabled on the configured inference service.' }, { status: 400 });
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 60000);
    try {
        const upstream = await fetch(`${p.baseUrl}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${p.apiKey}` }, body: JSON.stringify({ ...input, max_tokens: 1024, stream: true }), signal: controller.signal });
        if (!upstream.ok || !upstream.body) {
            clearTimeout(timeout);
            request.signal.removeEventListener('abort', abort);
            return Response.json({ error: 'The inference provider could not complete this request. Check the configured model and provider account.' }, { status: 502 });
        }
        const streamReader = upstream.body.getReader();
        const stream = new ReadableStream({ async pull(c) { try {
                const item = await streamReader.read();
                if (item.done) {
                    clearTimeout(timeout);
                    request.signal.removeEventListener('abort', abort);
                    c.close();
                }
                else
                    c.enqueue(item.value);
            }
            catch (e) {
                clearTimeout(timeout);
                request.signal.removeEventListener('abort', abort);
                c.error(e);
            } }, async cancel() { clearTimeout(timeout); request.signal.removeEventListener('abort', abort); controller.abort(); await streamReader.cancel(); } });
        return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
    }
    catch {
        clearTimeout(timeout);
        request.signal.removeEventListener('abort', abort);
        return Response.json({ error: 'The inference provider is unreachable or timed out.' }, { status: 502 });
    }
}
