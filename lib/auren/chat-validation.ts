export type ChatMessage = {
    role: 'user' | 'assistant';
    content: string;
};
export function validateChatBody(body: unknown): {
    model: string;
    messages: ChatMessage[];
    temperature: number;
} | null { if (!body || typeof body !== 'object')
    return null; const b = body as Record<string, unknown>; if (typeof b.model !== 'string' || b.model.length > 200 || !Array.isArray(b.messages) || b.messages.length < 1 || b.messages.length > 30)
    return null; let length = 0; for (const m of b.messages) {
    if (!m || typeof m !== 'object' || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 12000)
        return null;
    length += m.content.length;
} if (length > 40000 || b.messages[b.messages.length - 1].role !== 'user')
    return null; const t = b.temperature ?? .7; if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > 2)
    return null; return { model: b.model, messages: b.messages as ChatMessage[], temperature: t }; }
