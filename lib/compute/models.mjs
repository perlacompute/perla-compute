import {
  demand,
  nowSeconds,
  decimalUnits,
  safeInt,
  markedUp,
} from "./config.mjs";
export function definitions(data, markupBps) {
  demand(
    Array.isArray(data?.data),
    502,
    "catalog",
    "Model catalog is unavailable",
  );
  const groups = new Map();
  for (const r of data.data) {
    if (
      typeof r.id !== "string" ||
      !r.id.includes("/") ||
      !String(r.modality || "text").includes("text") ||
      !Number.isFinite(r.pricing?.min_ask_in) ||
      !Number.isFinite(r.pricing?.min_ask_out) ||
      r.pricing.min_ask_in <= 0 ||
      r.pricing.min_ask_out <= 0
    )
      continue;
    const name = String(r.upstream_label || r.id.split("/").at(-1)).slice(
        0,
        100,
      ),
      slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    if (!slug || /(image|video|embedding|whisper|speech|tts)/i.test(name))
      continue;
    const m = groups.get(slug) || {
      id: "perla/" + slug,
      name,
      family: /claude/i.test(name)
        ? "Anthropic"
        : /gpt|codex/i.test(name)
          ? "OpenAI"
          : /gemini|gemma/i.test(name)
            ? "Google"
            : /deepseek/i.test(name)
              ? "DeepSeek"
              : /qwen/i.test(name)
                ? "Qwen"
                : "Open models",
      routes: [],
    };
    m.routes.push({
      model: r.id,
      inputMicro: safeInt(decimalUnits(r.pricing.min_ask_in)),
      outputMicro: safeInt(decimalUnits(r.pricing.min_ask_out)),
      inputLimit: Math.min(Number(r.input_token_limit) || 32768, 131072),
      outputLimit: Math.min(Number(r.max_output_tokens) || 4096, 8192),
      reasoningLevels: r.reasoning_levels || [],
    });
    groups.set(slug, m);
  }
  return [...groups.values()]
    .map((m) => {
      m.routes.sort(
        (a, b) => a.inputMicro + a.outputMicro - b.inputMicro - b.outputMicro,
      );
      m.routes = m.routes.slice(0, 3);
      return {
        ...m,
        inputMicro: Math.max(...m.routes.map((r) => r.inputMicro)),
        outputMicro: Math.max(...m.routes.map((r) => r.outputMicro)),
        inputLimit: Math.min(...m.routes.map((r) => r.inputLimit)),
        outputLimit: Math.min(...m.routes.map((r) => r.outputLimit)),
        markupBps,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 300);
}
export async function syncModels(s, c, fetcher = fetch, now = nowSeconds()) {
  const r = await fetcher(c.providerBase.replace(/\/$/, "") + "/models", {
    headers: c.providerKey ? { authorization: "Bearer " + c.providerKey } : {},
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  demand(r.ok, 502, "catalog", "Catalog refresh failed");
  const text = await r.text();
  demand(
    text.length < 10000000,
    502,
    "catalog",
    "Catalog exceeds the size limit",
  );
  const rows = definitions(JSON.parse(text), c.markupBps);
  demand(rows.length, 502, "catalog", "No priced chat models were found");
  s.tx(() => {
    s.run("DELETE FROM compute_models");
    for (const m of rows)
      s.run(
        "INSERT INTO compute_models VALUES(?,?,?)",
        m.id,
        JSON.stringify(m),
        now,
      );
  });
  return { models: rows.length, updated: now };
}
export function publicModels(s, c) {
  return s.all("SELECT * FROM compute_models ORDER BY id").map((r) => {
    const m = JSON.parse(r.definition);
    return {
      id: m.id,
      name: m.name,
      object: "model",
      owned_by: m.family,
      kind: "chat",
      inputLimit: m.inputLimit,
      outputLimit: m.outputLimit,
      reasoningLevels: m.routes[0].reasoningLevels,
      pricing: {
        inputPerMillion: markedUp(m.inputMicro, m.markupBps) / 1000000,
        outputPerMillion: markedUp(m.outputMicro, m.markupBps) / 1000000,
        currency: "USD",
      },
      available: !!c.features.api && !!c.providerKey,
      updated: r.updated,
    };
  });
}
export function getModel(s, id, now = nowSeconds()) {
  const row = s.get("SELECT * FROM compute_models WHERE id=?", id);
  demand(row, 404, "model", "Choose a model from the catalog");
  demand(
    now - row.updated < 3600,
    503,
    "pricing_stale",
    "Model pricing requires refresh",
  );
  return JSON.parse(row.definition);
}
export function inputFor(body, kind, m) {
  demand(
    body &&
      Array.isArray(body.messages) &&
      body.messages.length > 0 &&
      body.messages.length <= 100,
    400,
    "messages",
    "Provide 1–100 messages",
  );
  const roles =
    kind === "anthropic"
      ? ["user", "assistant"]
      : ["system", "developer", "user", "assistant", "tool"];
  for (const v of body.messages)
    demand(
      v &&
        roles.includes(v.role) &&
        (typeof v.content === "string" ||
          (v.content === null && Array.isArray(v.tool_calls)) ||
          (Array.isArray(v.content) &&
            v.content.every(
              (x) => x && ["text", "tool_use", "tool_result"].includes(x.type),
            ))),
      400,
      "content",
      "Only text and tool messages are supported",
    );
  const output = Number(body.max_tokens ?? body.max_completion_tokens ?? 1024);
  demand(
    Number.isInteger(output) && output >= 1 && output <= m.outputLimit,
    400,
    "max_tokens",
    "Output allowance exceeds the selected model",
  );
  if (body.temperature !== undefined)
    demand(
      Number.isFinite(body.temperature) &&
        body.temperature >= 0 &&
        body.temperature <= 2,
      400,
      "temperature",
      "Choose a temperature between 0 and 2",
    );
  if (body.tools)
    demand(
      Array.isArray(body.tools) && body.tools.length <= 32,
      400,
      "tools",
      "At most 32 tools are supported",
    );
  const fields =
    kind === "anthropic"
      ? [
          "messages",
          "system",
          "tools",
          "tool_choice",
          "temperature",
          "top_p",
          "top_k",
          "stop_sequences",
          "thinking",
          "output_config",
          "reasoning_effort",
        ]
      : [
          "messages",
          "tools",
          "tool_choice",
          "temperature",
          "top_p",
          "stop",
          "seed",
          "response_format",
          "reasoning_effort",
          "parallel_tool_calls",
        ];
  const input = Object.fromEntries(
    fields.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]),
  );
  const bound =
    Buffer.byteLength(JSON.stringify(input)) +
    256 * body.messages.length +
    1024;
  demand(
    bound <= m.inputLimit,
    400,
    "input_limit",
    "Prompt exceeds this model’s conservative input allowance",
  );
  return {
    payload: { ...input, max_tokens: output, stream: body.stream === true },
    bound,
    output,
  };
}
