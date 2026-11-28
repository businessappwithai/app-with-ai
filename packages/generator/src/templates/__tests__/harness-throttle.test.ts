/**
 * A rate-limited test run says so, instead of looking like a hung database.
 *
 * The generated API throttles to THROTTLE_LIMIT requests a minute, with one
 * bucket per route handler — so every entity's writes share `/bus/:entity`'s.
 * Against a backend started without the limit raised, a large model's bulk
 * writes are refused, and the harness rightly waits out each 60-second window.
 * Done silently, that was read as a write hang on the 88-entity hospital model
 * (suite 18 timed out at 528s; with the limit raised it passes in 196s). The
 * runner raises it when it starts the backend, and CI and compose set it; the
 * harness now says so the first time it waits, whatever the verbosity.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TESTS = join(import.meta.dirname, "../../../templates/tanstack-start-nestjs/tests");
const http = readFileSync(join(TESTS, "harness/http.ts.hbs"), "utf8");
const server = readFileSync(join(TESTS, "harness/server.ts.hbs"), "utf8");

describe("a rate-limited run", () => {
  it("names the cause the first time it waits, even when not verbose", () => {
    expect(http).toContain("} else if (!throttleNoticeShown) {");
    expect(http).toContain("The backend is rate limiting this run");
    expect(http).toContain("THROTTLE_LIMIT=1000000");
  });

  it("is avoided when the runner starts the backend itself", () => {
    expect(server).toContain('THROTTLE_LIMIT: process.env.THROTTLE_LIMIT ?? "1000000"');
  });
});
