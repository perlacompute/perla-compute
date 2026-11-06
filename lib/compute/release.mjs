import expected from "../../services/compute-worker/release-manifest.json" with { type: "json" };
import { demand, sha, nowSeconds, PLAN_HASH } from "./config.mjs";
const root = "https://github.com/perlacompute/perla-compute/releases/download/";
export async function verifyWorkerRelease(s, fetcher = fetch) {
  demand(
    expected.tag === "mainnet-worker-v1.2.0" &&
      expected.policyHash === PLAN_HASH,
    503,
    "release_policy",
    "Worker release policy differs",
  );
  const base = root + expected.tag + "/";
  for (const [name, digest] of Object.entries(expected.assets)) {
    const r = await fetcher(base + name, {
      redirect: "follow",
      signal: AbortSignal.timeout(45000),
      headers: { "user-agent": "Perla-Compute-Release-Check" },
    });
    demand(
      r.ok && (!r.url || new URL(r.url).protocol === "https:"),
      503,
      "release_unavailable",
      "The public mainnet worker release is not available",
    );
    const reader = r.body?.getReader();
    demand(reader, 503, "release_body", "Release file has no body");
    let size = 0,
      parts = [];
    while (true) {
      const p = await reader.read();
      if (p.done) break;
      size += p.value.length;
      demand(
        size <= 64000000,
        503,
        "release_size",
        "Release file exceeds the reviewed size",
      );
      parts.push(Buffer.from(p.value));
    }
    demand(
      sha(Buffer.concat(parts)) === digest,
      503,
      "release_integrity",
      "Public mainnet worker assets differ from this prepared source",
    );
  }
  const report = {
    verified: true,
    tag: expected.tag,
    policyHash: PLAN_HASH,
    installerUrl: base + "install.sh",
    installerSha256: expected.assets["install.sh"],
    checkedAt: nowSeconds(),
  };
  s.run(
    "INSERT INTO compute_meta VALUES('worker_release',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    JSON.stringify(report),
  );
  return report;
}
