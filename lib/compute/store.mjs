import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { sha, demand, nowSeconds, activationHash } from "./config.mjs";
export class ComputeStore {
  constructor(filename = ":memory:", schema) {
    if (filename !== ":memory:")
      mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(filename);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    const sql =
      schema || readFileSync(resolve("lib/compute/schema.sql"), "utf8");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS compute_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
    );
    const old = this.get("SELECT value FROM compute_meta WHERE key='schema'");
    if (
      old &&
      old.value !== sha(sql) &&
      old.value ===
        "bf8b1cc6e6ce92317e32520248aed6d1787283622412179e4e96710c6f94902a"
    ) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(
          "ALTER TABLE compute_requests ADD COLUMN billing_source TEXT NOT NULL DEFAULT 'credits' CHECK(billing_source IN('credits','trial')); ALTER TABLE compute_deposits ADD COLUMN payment_token TEXT NOT NULL DEFAULT 'PERL';",
        );
        this.db.exec(sql);
        this.run(
          "UPDATE compute_meta SET value=? WHERE key='schema'",
          sha(sql),
        );
        this.db.exec("COMMIT");
      } catch (e) {
        this.db.exec("ROLLBACK");
        throw e;
      }
    }
    demand(
      !old ||
        old.value === sha(sql) ||
        old.value ===
          "bf8b1cc6e6ce92317e32520248aed6d1787283622412179e4e96710c6f94902a",
      503,
      "schema_migration",
      "A reviewed compute database migration is required",
    );
    this.db.exec(sql);
    this.run("INSERT OR IGNORE INTO compute_meta VALUES('schema',?)", sha(sql));
  }
  get(sql, ...v) {
    return this.db.prepare(sql).get(...v);
  }
  all(sql, ...v) {
    return this.db.prepare(sql).all(...v);
  }
  run(sql, ...v) {
    return this.db.prepare(sql).run(...v);
  }
  tx(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const v = fn();
      if (v && typeof v.then === "function")
        throw Error("Transactions must not yield");
      this.db.exec("COMMIT");
      return v;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  account(address, now = nowSeconds()) {
    this.run(
      "INSERT OR IGNORE INTO compute_accounts(address,created) VALUES(?,?)",
      address,
      now,
    );
    return this.get("SELECT * FROM compute_accounts WHERE address=?", address);
  }
  audit(kind, reference, details, now = nowSeconds()) {
    this.run(
      "INSERT INTO compute_audit(kind,reference,details,created) VALUES(?,?,?,?)",
      kind,
      reference,
      JSON.stringify(details),
      now,
    );
  }
  credit(address, n, kind, reference, now = nowSeconds()) {
    return this.tx(() => {
      demand(
        Number.isSafeInteger(n) && n > 0,
        400,
        "credit",
        "Invalid credit amount",
      );
      const old = this.get(
        "SELECT * FROM compute_ledger WHERE reference=?",
        reference,
      );
      if (old) {
        demand(
          old.address === address && old.delta === n && old.kind === kind,
          409,
          "credit_conflict",
          "Credit reference already exists",
        );
        return false;
      }
      const a = this.account(address, now);
      demand(
        Number.isSafeInteger(a.balance + n),
        400,
        "balance_limit",
        "Balance exceeds the supported range",
      );
      this.run(
        "UPDATE compute_accounts SET balance=balance+? WHERE address=?",
        n,
        address,
      );
      this.run(
        "INSERT INTO compute_ledger VALUES(?,?,?,?,?,?)",
        randomUUID(),
        address,
        n,
        kind,
        reference,
        now,
      );
      return true;
    });
  }
  pin(c) {
    const pin = activationHash(c),
      old = this.get("SELECT value FROM compute_meta WHERE key='deployment'");
    demand(
      !old || old.value === pin,
      503,
      "deployment_changed",
      "Mainnet deployment differs from the pinned configuration",
    );
    if (!old) this.run("INSERT INTO compute_meta VALUES('deployment',?)", pin);
  }
  close() {
    this.db.close();
  }
}
