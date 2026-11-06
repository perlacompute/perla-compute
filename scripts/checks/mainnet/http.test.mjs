/** Actual built Next server, isolated SQLite. No paid supplier, chain or GPU fixture passes for real execution. */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { privateKeyToAccount } from "viem/accounts";
const folder = await mkdtemp(resolve(tmpdir(), "perla-mainnet-http-")),
  socket = createServer().listen(0, "127.0.0.1");
await once(socket, "listening");
const port = socket.address().port;
await new Promise((r) => socket.close(r));
const origin = "http://127.0.0.1:" + port,
  who = privateKeyToAccount("0x" + "41".repeat(32));
let child,
  logs = "",
  cookie = "",
  key;
const env = {
  ...process.env,
  PORT: String(port),
  HOSTNAME: "127.0.0.1",
  PERLA_PUBLIC_ORIGIN: origin,
  PERLA_SQLITE_PATH: resolve(folder, "legacy.sqlite"),
  PERLA_COMPUTE_SQLITE_PATH: resolve(folder, "compute.sqlite"),
  PERLA_COMPUTE_CONFIG: "",
  PERLA_COMPUTE_STORAGE_KEY: "ab".repeat(32),
  PERLA_AI_PROVIDER_KEY: "",
  PERLA_MINING_ENABLED: "false",
  PERLA_VERIFIER_URL: "",
  PERLA_VERIFIER_TOKEN: "",
};
async function start() {
  child = spawn(process.execPath, ["scripts/start-vps.mjs"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const out of [child.stdout, child.stderr])
    out.on("data", (x) => (logs = (logs + x).slice(-16000)));
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null) throw Error(logs);
    try {
      if ((await fetch(origin + "/api/compute/status")).ok) return;
    } catch {}
    await delay(100);
  }
  throw Error("Server not ready: " + logs);
}
async function stop() {
  if (child && child.exitCode === null) {
    const ended = once(child, "exit");
    child.kill("SIGTERM");
    await ended;
  }
}
const call = (path, method = "GET", body, headers = {}) =>
  fetch(origin + path, {
    method,
    headers: {
      origin,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
let checks = 0;
async function check(name, fn) {
  await fn();
  checks++;
  console.log("PASS " + name);
}
try {
  await start();
  await check(
    "compute console is rendered by the production build",
    async () => {
      const r = await call("/platform/network"),
        html = await r.text();
      assert.equal(r.status, 200);
      assert(html.includes("Your mining workspace"));
      assert(html.includes("Robinhood Chain"));
    },
  );
  await check(
    "new mainnet defaults are closed and old testnet endpoint remains separate",
    async () => {
      const s = await (await call("/api/compute/status")).json();
      assert.equal(s.chainId, 4663);
      assert.equal(s.active, false);
      assert(Object.values(s.features).every((v) => v === false));
      const old = await (await call("/api/mining/status")).json();
      assert.equal(old.chainId, 46630);
      assert.equal(old.miningEnabled, false);
    },
  );
  await check(
    "unsigned callers cannot create or read account keys",
    async () => {
      assert.equal(
        (await call("/api/compute/keys", "POST", { name: "unauthorized" }))
          .status,
        401,
      );
      assert.equal((await call("/api/compute/account")).status, 401);
    },
  );
  await check(
    "actual wallet signature creates one same-origin account session",
    async () => {
      const challenge = await (
        await call("/api/compute/auth/challenge", "POST", {
          address: who.address,
        })
      ).json();
      assert(challenge.message.includes("4663"));
      const signature = await who.signMessage({ message: challenge.message });
      const r = await call("/api/compute/auth/verify", "POST", {
        id: challenge.id,
        signature,
      });
      assert.equal(r.status, 200);
      cookie = r.headers.get("set-cookie").split(";")[0];
      assert.equal(
        (
          await call("/api/compute/auth/verify", "POST", {
            id: challenge.id,
            signature,
          })
        ).status,
        401,
      );
    },
  );
  await check(
    "key creation scopes, budgets and revocation survive real HTTP routing",
    async () => {
      const r = await call("/api/compute/keys", "POST", {
        name: "HTTP key",
        models: ["perla/example"],
        scopes: ["chat"],
        dailyLimitMicros: 1000000,
        monthlyLimitMicros: 10000000,
      });
      assert.equal(r.status, 201);
      key = await r.json();
      assert(key.key.startsWith("pk_perla_"));
      const a = await (await call("/api/compute/account")).json();
      assert.equal(a.keys.length, 1);
      assert(!JSON.stringify(a).includes(key.key));
      assert.equal(
        (
          await call(
            "/api/compute/keys",
            "POST",
            { name: "wrong origin" },
            { origin: "https://other.example" },
          )
        ).status,
        403,
      );
    },
  );
  await check(
    "public SDK requests cannot dispatch a paid request while closed",
    async () => {
      assert.equal(
        (
          await call(
            "/v1/chat/completions",
            "POST",
            {
              model: "perla/example",
              messages: [{ role: "user", content: "Hello" }],
            },
            { authorization: "Bearer " + key.key },
          )
        ).status,
        503,
      );
      assert.equal((await call("/v1/models")).status, 200);
    },
  );
  await check("existing Developer Console stays separate from mining",async()=>{
    const r=await call("/platform/compute");assert.equal(r.status,200);
    const html=await r.text();assert(html.includes("data-perla-api-console"));
    const b=await call("/platform/bridge");assert(b.url.includes("/platform/network"));
    assert(cookie.startsWith("perla_mining="));
  });
  await stop();
  await start();
  await check(
    "compute session and API-key metadata persist across server restart",
    async () => {
      const a = await (await call("/api/compute/account")).json();
      assert.equal(a.address, who.address.toLowerCase());
      assert.equal(a.keys[0].id, key.id);
      assert.equal(
        (await call("/api/compute/keys/" + key.id, "DELETE")).status,
        200,
      );
      assert(
        (await (await call("/api/compute/account")).json()).keys[0].revoked,
      );
    },
  );
  console.log(
    checks +
      " mainnet production HTTP checks passed. No paid provider, public chain or physical GPU execution was inferred.",
  );
} finally {
  await stop();
  await rm(folder, { recursive: true, force: true });
}
