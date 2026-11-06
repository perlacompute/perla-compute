import { randomUUID } from "node:crypto";
import {
  demand,
  sha,
  nowSeconds,
  publicConfig,
  activationHash,
} from "./config.mjs";
import {
  sameOrigin,
  challenge,
  verifyLogin,
  cookie,
  session,
  principal,
  createKey,
  listKeys,
  operator,
  throttle,
} from "./auth.mjs";
import { trialStatus } from "./trial.mjs";
import { usage, reconcile } from "./billing.mjs";
import { publicModels, syncModels } from "./models.mjs";
import { gateway } from "./gateway.mjs";
import { quote, confirmDeposit, claimState } from "./chain.mjs";
import {
  connectWorker,
  worker,
  report,
  reconnectStart,
  reconnectApprove,
  reconnectExchange,
  work,
  share,
  analytics,
} from "./mining.mjs";
import {
  gpuCatalog,
  configureGpuModel,
  approveGpuWorker,
  enqueue,
  getJob,
  lease,
  submitResult,
} from "./gpu-jobs.mjs";
const json = (data, status = 200, headers = {}) =>
  Response.json(data, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
async function bodyOf(r, max = 1024 * 1024) {
  demand(
    r.headers.get("content-type")?.includes("application/json"),
    415,
    "json",
    "JSON content type required",
  );
  const reader = r.body?.getReader();
  demand(reader, 400, "body", "JSON body required");
  let n = 0,
    text = "";
  const decoder = new TextDecoder();
  while (true) {
    const v = await reader.read();
    if (v.done) break;
    n += v.value.length;
    if (n > max) {
      await reader.cancel();
      demand(false, 413, "body_size", "Request body exceeds its limit");
    }
    text += decoder.decode(v.value, { stream: true });
  }
  let b;
  try {
    b = JSON.parse(text + decoder.decode());
  } catch {
    demand(false, 400, "json", "Invalid JSON");
  }
  demand(
    b && typeof b === "object" && !Array.isArray(b),
    400,
    "body",
    "JSON object required",
  );
  return b;
}
export async function handle(r, s, c, options = {}) {
  try {
    const url = new URL(r.url),
      isV1 = url.pathname.startsWith("/v1/"),
      path = isV1
        ? url.pathname.slice(4)
        : url.pathname.replace(/^\/api\/compute\/?/, ""),
      method = r.method,
      token = r.headers.get("authorization")?.replace(/^Bearer /, "") || "";
    if (path === "status" && method === "GET")
      return json({
        ...publicConfig(c),
        active:
          s.get("SELECT value FROM compute_meta WHERE key='activation'")
            ?.value === activationHash(c),
        models: publicModels(s, c).length,
        workerRelease: s.get(
          "SELECT value FROM compute_meta WHERE key='worker_release'",
        )
          ? JSON.parse(
              s.get("SELECT value FROM compute_meta WHERE key='worker_release'")
                .value,
            )
          : null,
        health: s.get("SELECT value FROM compute_meta WHERE key='chain_health'")
          ? JSON.parse(
              s.get("SELECT value FROM compute_meta WHERE key='chain_health'")
                .value,
            )
          : null,
      });
    if (path === "models" && method === "GET")
      return json({
        object: "list",
        data: [...publicModels(s, c), ...gpuCatalog(s)],
      });
    if (path === "public/explorer" && method === "GET")
      return json(analytics(s, c));
    if (path.startsWith("public/receipt/") && method === "GET") {
      const id = path.split("/").at(-1),
        receipt = s.get(
          "SELECT sh.id,sh.job_id,sh.address,sh.epoch,sh.round_id,sh.proof_hash,sh.accepted,sh.round_won,j.header FROM compute_shares sh JOIN compute_jobs j ON j.id=sh.job_id WHERE sh.id=?",
          id,
        );
      demand(receipt, 404, "receipt", "Receipt not found");
      return json(receipt);
    }
    if (path.startsWith("public/proof/") && method === "GET") {
      const proof = s.get(
        "SELECT sh.proof,j.header FROM compute_shares sh JOIN compute_jobs j ON j.id=sh.job_id WHERE sh.id=?",
        path.split("/").at(-1),
      );
      demand(
        proof?.proof,
        404,
        "proof",
        "Proof payload is outside its retention window",
      );
      return json({
        protocol: "perla-mainnet-plain-v1",
        cert_version: 3,
        header: proof.header,
        plain_proof: proof.proof,
      });
    }
    if (path === "auth/challenge" && method === "POST") {
      sameOrigin(r, c);
      return json(challenge(s, c, (await bodyOf(r, 4000)).address));
    }
    if (path === "auth/verify" && method === "POST") {
      sameOrigin(r, c);
      const b = await bodyOf(r, 8000),
        login = await verifyLogin(s, b.id, b.signature);
      return json({ address: login.address }, 200, {
        "set-cookie": cookie(login.token, c),
      });
    }
    if (path === "auth/logout" && method === "POST") {
      sameOrigin(r, c);
      const value = r.headers
        .get("cookie")
        ?.match(/perla_compute=([a-f0-9]{64})/)?.[1];
      if (value) s.run("DELETE FROM compute_sessions WHERE hash=?", sha(value));
      return json({ loggedOut: true }, 200, { "set-cookie": cookie("", c, 0) });
    }
    if (path === "chat/completions" || path === "messages" || path === "chat") {
      demand(method === "POST", 405, "method", "POST required");
      return await gateway(r, s, c, {
        kind: path === "messages" ? "anthropic" : "openai",
        workspace: !isV1,
        body: await bodyOf(r),
        ...options,
      });
    }
    if (path === "jobs" && method === "POST") {
      const p = principal(r, s, c, !isV1),
        b = await bodyOf(r);
      return json(
        enqueue(s, c, p, b, r.headers.get("idempotency-key") || randomUUID()),
        202,
      );
    }
    if (path.startsWith("jobs/") && method === "GET") {
      const p = isV1
          ? principal(r, s, c)
          : { address: session(r, s), models: ["*"], scopes: ["jobs"] },
        j = getJob(s, c, p.address, path.split("/").at(-1));
      demand(
        p.scopes.includes("jobs") &&
          p.models.some((m) => m === "*" || m === j.model),
        403,
        "scope",
        "This key cannot read the job",
      );
      return json(j);
    }
    if (path.startsWith("operator/")) {
      demand(method === "POST", 405, "method", "POST required");
      operator(r, c);
      const b = method === "POST" ? await bodyOf(r) : {};
      if (path === "operator/sync-models")
        return json(await syncModels(s, c, options.fetcher));
      if (path === "operator/reconcile") return json(reconcile(s, b.id, b));
      if (path === "operator/gpu/model") return json(configureGpuModel(s, b));
      if (path === "operator/gpu/approve")
        return json(approveGpuWorker(s, b.workerId, b.models));
      return json({ error: "Operator route not found" }, 404);
    }
    if (path.startsWith("mining/")) {
      const p = path.slice(7);
      if (p === "connect" && method === "POST")
        return json(connectWorker(s, await bodyOf(r, 10000), token));
      if (p === "reconnect/start" && method === "POST")
        return json(reconnectStart(s, await bodyOf(r, 10000), token));
      if (p === "reconnect/exchange" && method === "POST")
        return json(reconnectExchange(s, (await bodyOf(r, 10000)).id, token));
      const w = worker(s, token);
      if (p === "status") {
        s.run(
          "UPDATE compute_workers SET last_seen=? WHERE id=?",
          nowSeconds(),
          w.id,
        );
        return json({
          id: w.id,
          address: w.address,
          name: w.name,
          kind: w.kind,
          validated: !!w.gpu_report,
        });
      }
      if (p === "validation" && method === "POST")
        return json(report(s, w, (await bodyOf(r, 100000)).report));
      if (p === "work" && method === "GET")
        return json(await work(s, c, w, { request: r, ...options }));
      if (p === "shares" && method === "POST")
        return json(
          await share(s, c, w, await bodyOf(r, 8 * 1024 * 1024), options),
          201,
        );
      if (p === "gpu/lease" && method === "POST")
        return json(lease(s, c, w, (await bodyOf(r, 10000)).models));
      if (p === "gpu/result" && method === "POST")
        return json(submitResult(s, c, w, await bodyOf(r, 100000)));
      return json({ error: "Worker route not found" }, 404);
    }
    const address = session(r, s);
    if (method !== "GET") sameOrigin(r, c);
    if (path === "account" && method === "GET")
      return json({
        address,
        usage: usage(s, address),
        trial: trialStatus(s, c, address),
        keys: listKeys(s, address),
        mining: analytics(s, c, address),
      });
    if (path === "keys" && method === "POST") {
      demand(
        s.get(
          "SELECT COUNT(*) n FROM compute_keys WHERE address=? AND revoked IS NULL",
          address,
        ).n < 100,
        429,
        "keys",
        "Active key limit reached",
      );
      return json(createKey(s, address, await bodyOf(r, 20000)), 201);
    }
    if (path.startsWith("keys/") && method === "DELETE") {
      s.run(
        "UPDATE compute_keys SET revoked=? WHERE id=? AND address=?",
        nowSeconds(),
        path.split("/").at(-1),
        address,
      );
      return json({ revoked: true });
    }
    if (path === "quote" && method === "GET")
      return json(await quote(c, options.client));
    if (path === "deposits/confirm" && method === "POST") {
      const b = await bodyOf(r, 10000);
      return json(
        await confirmDeposit(
          s,
          c,
          address,
          b.hash,
          b.logIndex == null ? null : Number(b.logIndex),
          options.client,
        ),
      );
    }
    if (path === "reconnect/approve" && method === "POST")
      return json(reconnectApprove(s, address, await bodyOf(r, 10000)));
    if (path.startsWith("workers/") && method === "DELETE") {
      s.run(
        "UPDATE compute_workers SET revoked=? WHERE id=? AND address=?",
        nowSeconds(),
        path.split("/").at(-1),
        address,
      );
      return json({ revoked: true });
    }
    if (path === "rewards" && method === "GET") {
      const allocations = [];
      for (const row of s.all(
        "SELECT manifest,state,tx_hash FROM compute_epochs ORDER BY epoch DESC LIMIT 100",
      )) {
        const m = JSON.parse(row.manifest),
          a = m.allocations.find((a) => a.address === address);
        if (!a) continue;
        let state;
        try {
          state = await claimState(c, m, a, options.client);
        } catch {
          state = { funded: false, unavailable: true };
        }
        allocations.push({
          ...a,
          epoch: m.epoch,
          vault: m.vault,
          ...state,
          transaction: row.tx_hash,
        });
      }
      return json({ allocations });
    }
    if (path === "migration" && method === "GET") {
      const row = s.get("SELECT manifest FROM compute_migration WHERE id=1");
      if (!row)
        return json({
          available: false,
          cutoff: c.migrationCutoff ?? null,
          reason: "No funded testnet migration snapshot is published yet",
          ratio: [100, 7],
          dailyLimit: "1000000",
        });
      const m = JSON.parse(row.manifest),
        a = m.allocations.find((a) => a.address === address);
      if (!a)
        return json({
          available: false,
          reason: "No eligible earned allocation in this snapshot",
        });
      const state = await claimState(c, m, a, options.client);
      return json({
        ...a,
        available: !!c.features.migration,
        epoch: m.epoch,
        vault: m.vault,
        snapshotHash: m.snapshotHash,
        cutoff: m.cutoff,
        sourceChainId: 46630,
        ...state,
      });
    }
    return json({ error: "Compute route not found" }, 404);
  } catch (e) {
    return json(
      {
        error: {
          code: e.code || "service_unavailable",
          message: e.status
            ? e.message
            : "Service could not complete this operation; no successful result has been inferred.",
        },
      },
      e.status || 503,
    );
  }
}
