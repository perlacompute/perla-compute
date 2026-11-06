import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { workerCommand } from "../../../lib/compute/commands.mjs";
const release = {
    verified: true,
    installerUrl:
      "https://github.com/perlacompute/perla-compute/releases/download/mainnet-worker-v1.2.0/install.sh",
    installerSha256: "ab".repeat(32),
  },
  address = "0x" + "11".repeat(20);
test("copied install command contains four real shell lines and a pinned installer check", () => {
  const command = workerCommand(release, address, "home-4090", "0");
  assert.equal(command.split("\n").length, 4);
  assert(command.includes("sha256sum -c -"));
  assert(!command.includes("\\nbash"));
  assert.equal(spawnSync("bash", ["-n"], { input: command }).status, 0);
  const line = command.split("\n")[1].split(" | ")[0],
    out = spawnSync("bash", ["-c", line], { encoding: "utf8" });
  assert.equal(out.status, 0);
  assert.equal(
    out.stdout,
    release.installerSha256 + "  install-perla-mainnet.sh\n",
  );
});
test("unverified releases and shell input are never turned into executable commands", () => {
  assert.equal(
    workerCommand({ ...release, verified: false }, address, "rig01", 0),
    "",
  );
  assert.equal(
    workerCommand(
      { ...release, installerUrl: "https://other.example/install" },
      address,
      "rig01",
      0,
    ),
    "",
  );
  assert.equal(workerCommand(release, address, "rig; echo unsafe", 0), "");
  assert.equal(workerCommand(release, address, "rig01", "$(id)"), "");
});
