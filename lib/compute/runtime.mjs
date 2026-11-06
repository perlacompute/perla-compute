import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { ComputeStore } from "./store.mjs";
import { readConfig } from "./config.mjs";
let connection, path;
export function context() {
  const config = readConfig(),
    next = resolve(config.databasePath);
  if (!connection) {
    connection = new ComputeStore(
      next,
      readFileSync(resolve("lib/compute/schema.sql"), "utf8"),
    );
    path = next;
  }
  if (path !== next)
    throw Error("Compute database path changed; restart the process");
  return { store: connection, config };
}
