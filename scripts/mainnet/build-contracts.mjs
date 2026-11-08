import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import solc from "solc";
const root = new URL("../../", import.meta.url);
export function compileContracts(extra = {}) {
  const sources = {
    ...Object.fromEntries(
      ["PerlaMainnetRewards.sol", "PerlaCreditVault.sol"].map((name) => [
        name,
        { content: readFileSync(new URL("contracts/" + name, root), "utf8") },
      ]),
    ),
    ...extra,
  };
  const input = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "paris",
      metadata: { bytecodeHash: "none" },
      outputSelection: {
        "*": {
          "*": [
            "abi",
            "evm.bytecode.object",
            "evm.deployedBytecode.object",
            "evm.deployedBytecode.immutableReferences",
          ],
        },
      },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = out.errors?.filter((e) => e.severity === "error") || [];
  if (errors.length)
    throw Error(errors.map((e) => e.formattedMessage).join("\n"));
  const contracts = {};
  for (const cs of Object.values(out.contracts))
    for (const [name, c] of Object.entries(cs))
      if (c.evm.bytecode.object)
        contracts[name] = {
          abi: c.abi,
          bytecode: "0x" + c.evm.bytecode.object,
          runtime: "0x" + c.evm.deployedBytecode.object,
          immutableReferences: c.evm.deployedBytecode.immutableReferences,
        };
  return {
    version: 1,
    compiler: solc.version(),
    sourceHash: createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex"),
    contracts,
  };
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  writeFileSync(
    new URL("lib/compute/contract-artifacts.json", root),
    JSON.stringify(compileContracts(), null, 2) + "\n",
  );
  console.log("Mainnet vaults compiled; no transaction sent.");
}
