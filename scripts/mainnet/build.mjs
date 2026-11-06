import { build } from "esbuild";
import { compileContracts } from "./build-contracts.mjs";
import { writeFileSync } from "node:fs";
import { PLAN, PLAN_HASH } from "../../lib/compute/config.mjs";
writeFileSync(
  "lib/compute/contract-artifacts.json",
  JSON.stringify(compileContracts(), null, 2) + "\n",
);
writeFileSync(
  "services/compute-worker/launch-plan.json",
  JSON.stringify({ plan: PLAN, hash: PLAN_HASH }, null, 2) + "\n",
);
await build({
  entryPoints: ["scripts/mainnet/operator.mjs"],
  outfile: "scripts/mainnet/operator.bundle.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  minify: true,
});
