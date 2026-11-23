/**
 * The browser-stack `pg` driver keeps Kysely's transaction semantics on one session.
 *
 * Every "connection" the driver hands out is the same PGlite session. Two
 * things a server never does then happened: two requests' BEGIN/COMMIT
 * interleaved (two saves from one version both won), and a transaction opened
 * from inside another (a workflow step saving a record through the
 * application's own service) ended the outer one, so a press whose workflow
 * failed still left the record moved. The driver now lets a transaction own the
 * session: an unrelated BEGIN waits, a nested one is a savepoint.
 *
 * Runs in a child process: PGlite will not load under this suite's jsdom
 * environment.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DRIVER = join(
  import.meta.dirname,
  "../../../../templates/wasm-overlay/backend/pg-wasm/index.js"
);
const FIXTURE = join(import.meta.dirname, "fixtures/exercise-pg-transactions.cjs");

describe("pg-wasm transactions", () => {
  const out = JSON.parse(
    execFileSync("node", [FIXTURE, DRIVER], { encoding: "utf8", timeout: 60_000 })
      .trim()
      .split("\n")
      .pop()!
  );

  it("rolls a failed transaction back", () => {
    expect(out.rollback).toBe("a");
  });

  it("does not let a nested transaction end the outer one", () => {
    expect(out.nestedOuterRollback).toEqual(["a", "a"]);
    expect(out.nestedInnerRollback).toEqual(["outer", "a"]);
  });

  it("lets exactly one of two parallel saves from the same version win", () => {
    expect(out.parallel).toEqual(["200", "409"]);
  });

  it("keeps a write made outside a transaction when another one rolls back", () => {
    expect(out.outsideWrite).toEqual([7, true]);
  });
});
