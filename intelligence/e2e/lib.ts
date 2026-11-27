/**
 * What the live E2E scripts share: a browser, steps that screenshot, the chat's own controls, and
 * the sign-ins. Everything here drives the real thing through the gateway at CHAT_URL.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export const base = process.env.CHAT_URL ?? "http://localhost:4080";
/** Messages that mean a page is an error page, not the application. */
export const BAD = ["not answering", "not available", "Not found", "Internal Server Error"];

export const launch = (): Promise<Browser> =>
  chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] } : {}) });

export const newContext = (browser: Browser): Promise<BrowserContext> =>
  browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

/** A run: its screenshots land in docs/e2e-screenshots/live/<prefix>*.png, its steps in `results`. */
export function createRun(prefix: string) {
  const shots = join(resolve(import.meta.dir, ".."), "docs/e2e-screenshots/live");
  mkdirSync(shots, { recursive: true });
  const results: Array<{ ok: boolean; name: string; detail: string }> = [];
  async function step(page: Page, name: string, shot: string, body: () => Promise<void>) {
    try {
      await body();
      await page.screenshot({ path: join(shots, `${prefix}${shot}.png`) });
      results.push({ ok: true, name, detail: `${prefix}${shot}.png` });
    } catch (error) {
      await page.screenshot({ path: join(shots, `${prefix}${shot}-FAILED.png`) }).catch(() => undefined);
      results.push({ ok: false, name, detail: (error instanceof Error ? error.message : String(error)).split("\n")[0]! });
    }
    const last = results.at(-1)!;
    console.log(`${last.ok ? "PASS" : "FAIL"}  ${last.name}  ${last.detail}`);
  }
  const finish = (): never => {
    console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps passed`);
    process.exit(results.every((r) => r.ok) ? 0 : 1);
  };
  return { step, results, finish };
}

export const askBox = (page: Page) => page.getByPlaceholder("Ask for a record, a page or a report…");
/** The send button reads "Stop" while a turn runs and "Send message" when the chat is idle. */
export const idle = (page: Page) => page.locator('[data-testid="copilot-send-button"][aria-label="Send message"]').waitFor({ timeout: 240000 });
export async function ask(page: Page, text: string) {
  await idle(page);
  await askBox(page).fill(text);
  await askBox(page).press("Enter");
}

/** Sign in on the assistant's own form (which posts to the application's Better Auth). */
export async function signInViaChat(page: Page, email: string, password: string) {
  await page.goto(`${base}/chat/`);
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await askBox(page).waitFor({ timeout: 30000 });
}

/** Sign in on the generated application's own page, as somebody who never opened the chat. */
export async function signInViaApp(page: Page, email: string, password: string) {
  await page.goto(`${base}/auth/login`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.locator('button[type="submit"]').click();
}

/** The application's session cookie, as a `Cookie` header value, and nothing else (no embed cookie). */
export async function sessionCookie(context: BrowserContext): Promise<string> {
  const cookies = await context.cookies(base);
  const session = cookies.filter((c) => c.name.includes("session_token"));
  if (session.length === 0) throw new Error("no application session cookie");
  return session.map((c) => `${c.name}=${c.value}`).join("; ");
}

/** Whether the chat's text says something is unavailable to the person, in any of the ways a model puts it. */
export const saidUnavailable = (text: string): boolean =>
  /(aren't|isn't|is not|are not|not|never|no longer)\s+(\w+\s+){0,3}(available|accessible|permitted|allowed)|can't|cannot|can not|don't have|do not have|no access|unable|not able|couldn't|could not|denied|not permitted|may not/i.test(text);
