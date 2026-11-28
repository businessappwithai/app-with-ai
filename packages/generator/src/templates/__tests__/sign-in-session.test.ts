/**
 * Signing in lands on the dashboard, and a failed session read does not sign anyone out.
 *
 * The sign-in page awaits `refreshSession()` and then navigates to /dashboard.
 * The user used to be applied inside `startTransition`, so the dashboard's guard
 * ran first, saw nobody signed in, and sent a person who had just signed in back
 * to the sign-in page — every request on the way answered 200. And on a fresh
 * page load a rate-limited session read (429) was taken as "no session" and did
 * the same. Found driving a generated application in Chromium
 * (scripts/e2e-generated-app); nothing on the API side could show either.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FRONTEND = join(import.meta.dirname, "../../../templates/tanstack-start-nestjs/frontend/src");
const context = readFileSync(join(FRONTEND, "contexts/auth-context.tsx"), "utf8");
const login = readFileSync(join(FRONTEND, "routes/auth/login.tsx"), "utf8");

describe("the session after signing in", () => {
  it("applies the user urgently unless asked not to", () => {
    expect(context).toContain("const refreshSession = async (urgent = true) => {");
    expect(context).toContain("if (urgent) setUser(next);");
  });

  it("keeps only the first read, made while hydrating, non-urgent", () => {
    expect(context).toContain("await refreshSession(false);");
  });

  it("the sign-in page puts the user in place before it navigates", () => {
    const refresh = login.indexOf("await refreshSession();");
    const go = login.indexOf("navigate({ to: '/dashboard' })");
    expect(refresh).toBeGreaterThan(0);
    expect(go).toBeGreaterThan(refresh);
  });

  it("tries a failed read again before deciding nobody is signed in", () => {
    expect(context).toMatch(/for \(let attempt = 1; error && data == null && !userRef\.current/);
  });
});
