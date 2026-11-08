import { randomUUID } from "node:crypto";
import {
  feature,
  demand,
  sha,
  seal,
  unseal,
  nowSeconds,
  tokenCost,
  decimalUnits,
  safeInt,
  markedUp,
  displayUsd,
} from "./config.mjs";
import { principal } from "./auth.mjs";
import { getModel, inputFor } from "./models.mjs";
import { reserveTrial } from "./trial.mjs";
import { reserve, dispatching, complete, fail } from "./billing.mjs";
async function jsonResult(r) {
  const reader = r.body?.getReader();
  demand(reader, 502, "provider_body", "Provider returned no body");
  let size = 0,
    text = "";
  const decoder = new TextDecoder();
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 2000000) {
      await reader.cancel();
      throw Error("response_size");
    }
    text += decoder.decode(part.value, { stream: true });
  }
  return JSON.parse(text + decoder.decode());
}
function charge(u, m) {
  const input = Number(u?.prompt_tokens ?? u?.input_tokens),
    output = Number(u?.completion_tokens ?? u?.output_tokens);
  demand(
    Number.isSafeInteger(input) &&
      input >= 0 &&
      Number.isSafeInteger(output) &&
      output > 0,
    502,
    "usage_missing",
    "Complete usage is required before settling the request",
  );
  const upstream =
    u.cost !== undefined
      ? safeInt(decimalUnits(u.cost))
      : Math.max(10, tokenCost(input, output, m));
  return { input, output, charged: markedUp(upstream, m.markupBps) };
}
const error = (code, message, id, status) =>
  Response.json(
    { error: { code, message }, request_id: id },
    { status, headers: { "cache-control": "no-store" } },
  );
function cleanUsage(u) {
  if (!u) return u;
  const copy = { ...u };
  delete copy.cost;
  return copy;
}
function clean(v, kind, model) {
  if (kind === "anthropic") {
    const copy = { ...v };
    if (copy.model) copy.model = model;
    if (copy.usage) copy.usage = cleanUsage(copy.usage);
    if (copy.message)
      copy.message = {
        ...copy.message,
        model,
        usage: cleanUsage(copy.message.usage),
      };
    delete copy.provider;
    return copy;
  }
  return {
    id: v.id,
    object: v.object,
    created: v.created,
    model,
    choices: v.choices || [],
    ...(v.usage ? { usage: cleanUsage(v.usage) } : {}),
  };
}
export async function gateway(
  r,
  s,
  c,
  { kind = "openai", workspace = false, body, fetcher = fetch } = {},
) {
  feature(s, c, "api");
  demand(
    c.providerKey && /^[a-f0-9]{64}$/.test(c.storageKey),
    503,
    "configuration",
    "Configure provider access and encrypted storage",
  );
  const p = principal(r, s, c, workspace);
  body ??= await r.json();
  const free = body.billing_mode === "trial";
  demand(
    body.billing_mode === undefined ||
      ["trial", "credits"].includes(body.billing_mode),
    400,
    "billing_mode",
    "Choose trial or credits",
  );
  demand(
    !free || workspace,
    403,
    "trial_workspace",
    "Free chats are available only in Playground",
  );
  const m = getModel(s, body.model),
    input = inputFor(body, kind, m),
    amount = markedUp(
      Math.max(10, tokenCost(input.bound, input.output, m)),
      m.markupBps,
    ),
    idem =
      r.headers.get("idempotency-key") ||
      r.headers.get("x-client-request-id") ||
      randomUUID(),
    reservation = {
      idem,
      fingerprint: sha({ kind, body }),
      model: m.id,
      amount,
    },
    row = free
      ? reserveTrial(s, c, p, reservation, body)
      : reserve(s, p, reservation),
    domain = row.id + "|" + p.address;
  if (row.reused) {
    if (row.state === "completed") {
      const cached = s.get(
        "SELECT * FROM compute_responses WHERE request_id=? AND expires>?",
        row.id,
        nowSeconds(),
      );
      demand(
        cached,
        409,
        "cache_expired",
        "Request completed; the encrypted result cache expired. No new charge was made",
      );
      return new Response(unseal(c, cached.encrypted, domain), {
        headers: {
          "content-type": cached.content_type,
          "cache-control": "no-store",
          "x-perla-request-id": row.id,
          "x-perla-billing-source": free ? "trial" : "credits",
          "x-perla-idempotency-replayed": "true",
        },
      });
    }
    return error(
      "request_" + row.state,
      "This request already exists; inspect its usage record before retrying.",
      row.id,
      409,
    );
  }
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), body.stream ? 180000 : 90000),
    abort = () => controller.abort(),
    cleanup = () => {
      clearTimeout(timer);
      r.signal.removeEventListener("abort", abort);
    };
  r.signal.addEventListener("abort", abort, { once: true });
  const started = performance.now();
  let upstream;
  try {
    dispatching(s, row.id);
    for (const route of m.routes) {
      const h = s.get(
        "SELECT * FROM compute_route_health WHERE route=?",
        route.model,
      );
      if (
        h?.state === "cooldown" &&
        nowSeconds() - h.checked < 30 &&
        m.routes.length > 1
      )
        continue;
      const headers = {
        "content-type": "application/json",
        authorization: "Bearer " + c.providerKey,
        "x-max-input-price": displayUsd(route.inputMicro),
        "x-max-output-price": displayUsd(route.outputMicro),
        "x-session-id": sha({
          address: p.address,
          key: p.keyId,
          session: r.headers.get("x-session-id") || row.id,
        }),
      };
      if (kind === "anthropic") {
        headers["x-api-key"] = c.providerKey;
        headers["anthropic-version"] = "2023-06-01";
      }
      const payload = { ...input.payload, model: route.model };
      if (kind === "openai" && payload.stream)
        payload.stream_options = { include_usage: true };
      upstream = await fetcher(
        c.providerBase.replace(/\/$/, "") +
          (kind === "anthropic" ? "/messages" : "/chat/completions"),
        {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
          redirect: "error",
        },
      );
      if (upstream.ok) break;
      const detail = await jsonResult(upstream).catch(() => ({})),
        code = detail?.error?.code || detail?.error?.type;
      if (
        [429, 503, 402].includes(upstream.status) &&
        [
          "capacity_saturated",
          "no_capacity",
          "no_provider_under_bid",
          "rate_limit_error",
        ].includes(code)
      ) {
        s.run(
          "INSERT INTO compute_route_health VALUES(?,'cooldown',?) ON CONFLICT(route) DO UPDATE SET state='cooldown',checked=excluded.checked",
          route.model,
          nowSeconds(),
        );
        upstream = null;
        continue;
      }
      const known = [400, 401, 403, 404, 413, 422].includes(upstream.status);
      fail(s, row.id, "provider_rejected", !known);
      cleanup();
      return error(
        known ? "provider_rejected" : "billing_review",
        known
          ? "The model rejected this request. No credits were charged."
          : "The upstream result is uncertain; credits remain reserved for reconciliation.",
        row.id,
        502,
      );
    }
    if (!upstream) {
      fail(s, row.id, "capacity_unavailable");
      cleanup();
      return error(
        "capacity_unavailable",
        "No capacity within the quoted price. No charge was made.",
        row.id,
        503,
      );
    }
    if (!body.stream) {
      const result = await jsonResult(upstream);
      demand(
        !result.error,
        502,
        "provider_result",
        "Provider result is incomplete",
      );
      const bill = charge(result.usage, m),
        value = clean(result, kind, m.id);
      value.usage = {
        ...value.usage,
        cost: displayUsd(free ? 0 : bill.charged),
      };
      const text = JSON.stringify(value);
      complete(s, row.id, {
        ...bill,
        providerId: result.id || null,
        latency: Math.round(performance.now() - started),
        cache: { encrypted: seal(c, text, domain), type: "application/json" },
      });
      cleanup();
      return new Response(text, {
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
          "x-perla-request-id": row.id,
          "x-perla-billing-source": free ? "trial" : "credits",
        },
      });
    }
    const reader = upstream.body?.getReader();
    demand(reader, 502, "stream", "Provider returned no stream");
    const encoder = new TextEncoder(),
      decoder = new TextDecoder();
    let pending = "",
      transcript = "",
      usage = {},
      providerId = null,
      size = 0,
      terminal = false;
    const stream = new ReadableStream({
      async start(out) {
        const emit = (text) => {
          transcript += text;
          out.enqueue(encoder.encode(text));
        };
        function settle() {
          if (terminal) return;
          const bill = charge(usage, m),
            end =
              kind === "anthropic"
                ? 'event: message_stop\ndata: {"type":"message_stop"}\n\n'
                : "data: [DONE]\n\n";
          complete(s, row.id, {
            ...bill,
            providerId,
            latency: Math.round(performance.now() - started),
            cache: {
              encrypted: seal(c, transcript + end, domain),
              type: "text/event-stream",
            },
          });
          terminal = true;
          emit(end);
        }
        function event(block) {
          const lines = block.split("\n"),
            data = lines
              .filter((x) => x.startsWith("data:"))
              .map((x) => x.slice(5).trimStart())
              .join("\n");
          if (!data || terminal) return;
          if (data === "[DONE]") {
            settle();
            return;
          }
          const v = JSON.parse(data);
          demand(
            !v.error && v.type !== "error",
            502,
            "stream_error",
            "Provider stream failed",
          );
          providerId = v.id || v.message?.id || providerId;
          usage = { ...usage, ...v.message?.usage, ...v.usage };
          if (v.type === "message_stop") {
            settle();
            return;
          }
          const safe = clean(v, kind, m.id);
          if (
            v.usage &&
            (usage.prompt_tokens !== undefined ||
              usage.input_tokens !== undefined) &&
            (usage.completion_tokens > 0 || usage.output_tokens > 0)
          )
            safe.usage = {
              ...safe.usage,
              cost: displayUsd(free ? 0 : charge(usage, m).charged),
            };
          emit(
            (kind === "anthropic"
              ? (lines.find((x) => x.startsWith("event:")) ||
                  "event: " + v.type) + "\n"
              : "") +
              "data: " +
              JSON.stringify(safe) +
              "\n\n",
          );
        }
        try {
          while (!terminal) {
            const item = await reader.read();
            if (item.done) break;
            size += item.value.length;
            demand(
              size <= 2000000,
              502,
              "stream_size",
              "Stream exceeds its size limit",
            );
            pending += decoder
              .decode(item.value, { stream: true })
              .replace(/\r\n/g, "\n");
            let index;
            while ((index = pending.indexOf("\n\n")) >= 0) {
              event(pending.slice(0, index));
              pending = pending.slice(index + 2);
            }
          }
          if (!terminal && pending.trim()) event(pending);
          demand(
            terminal,
            502,
            "incomplete_stream",
            "Stream ended before final usage",
          );
          await reader.cancel().catch(() => {});
          cleanup();
          out.close();
        } catch {
          controller.abort();
          fail(s, row.id, "stream_uncertain", true);
          cleanup();
          try {
            out.enqueue(
              encoder.encode(
                kind === "anthropic"
                  ? 'event: error\ndata: {"type":"error","error":{"type":"api_error","message":"Stream interrupted; inspect billing status before retrying."}}\n\n'
                  : 'data: {"error":{"code":"stream_interrupted","message":"Inspect billing status before retrying."}}\n\n',
              ),
            );
            out.close();
          } catch {}
        }
      },
      async cancel() {
        controller.abort();
        await reader.cancel().catch(() => {});
        fail(s, row.id, "client_disconnected", true);
        cleanup();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        "x-accel-buffering": "no",
        "x-perla-request-id": row.id,
        "x-perla-billing-source": free ? "trial" : "credits",
      },
    });
  } catch (e) {
    controller.abort();
    fail(s, row.id, e.code || "provider_uncertain", true);
    cleanup();
    return error(
      "billing_review",
      "The request needs reconciliation. Reserved credits are not charged twice.",
      row.id,
      502,
    );
  }
}
