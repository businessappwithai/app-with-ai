// Regression: QA-F3 — found by /qa on 2026-11-27
// Report: intelligence/docs/qa-report-2026-11-27.md
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClientServer } from "../static";

const dir = mkdtempSync(join(tmpdir(), "client-"));
mkdirSync(join(dir, "assets"));
writeFileSync(join(dir, "index.html"), "<!doctype html><title>chat</title>");
writeFileSync(join(dir, "assets", "app-abc.js"), "export {}");
const serve = createClientServer(dir);
const get = (path: string) => serve(new Request(`http://localhost/chat${path}`), path);

describe("QA-F3: a missing asset is a 404, never the page", () => {
  test("a built asset is served immutable", async () => {
    const response = await get("/assets/app-abc.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("immutable");
  });
  test("a missing asset, a traversal and an asset directory are 404", async () => {
    for (const path of ["/assets/nope.js", "/assets/..%2f..%2findex.html", "/assets/../index.html", "/assets/", "/assets"]) {
      expect((await get(path)).status).toBe(404);
    }
  });
  test("every other path is the page, with the page's headers and never cached", async () => {
    const response = await get("/some/route");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });
  test("an unbuilt client is a 503, not a crash", async () => {
    const empty = createClientServer(mkdtempSync(join(tmpdir(), "empty-")));
    expect((await empty(new Request("http://localhost/chat/"), "/")).status).toBe(503);
  });
});
