/**
 * Signing in lands on the dashboard, and a failed session read does not sign anyone out.
 *
 * The sign-in page used to await `refreshSession()` and then navigate to
 * /dashboard. The router renders the new route in a transition, and the layout's
 * guard read the context from before the user was committed — it saw nobody
 * signed in and sent a person who had just signed in back to the sign-in page,
 * with every request on the way answering 200. The page now navigates once the
 * context says the person is signed in. And on a fresh
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

  it("the sign-in page goes to the dashboard only once the context says signed in", () => {
    // Navigating straight after `await refreshSession()` still lost the race: the
    // router renders the new route in a transition, and its guard read the context
    // from before the user was committed. The move now waits for isAuthenticated.
    expect(login).toContain("if (signedIn && isAuthenticated) void navigate({ to: '/dashboard' });");
    const handler = login.slice(login.indexOf("await refreshSession();"));
    expect(handler.slice(0, 80)).toContain("setSignedIn(true);");
    expect(handler.slice(0, 200)).not.toContain("navigate(");
  });

  it("tries a failed read again before deciding nobody is signed in", () => {
    expect(context).toMatch(/for \(let attempt = 1; error && data == null && !userRef\.current/);
  });
});
