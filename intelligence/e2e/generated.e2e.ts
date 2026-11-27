#!/usr/bin/env bun
/**
 * Browser E2E against a REAL generated application with the chat assistant, run locally:
 * the application on :4000/:4001 (PostgreSQL), the assistant and gateway from `assistant/scripts/run-chat.ts`
 * on :4080, and a model on AI_BASE_URL (Claude Code through `scripts/claude-model.ts` when testing).
 *
 *   CHAT_URL=http://localhost:4080 CHAT_EMAIL=admin@admin.com CHAT_PASSWORD=admin123 bun e2e/generated.e2e.ts
 *
 * Screenshots go to `docs/e2e-screenshots/generated/`. Exit code 1 when a step fails.
 */
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const base = process.env.CHAT_URL ?? "http://localhost:4080";
const shots = join(resolve(import.meta.dir, ".."), "docs/e2e-screenshots/generated");
mkdirSync(shots, { recursive: true });
const results: Array<{ ok: boolean; name: string; detail: string }> = [];

async function step(page: Page, name: string, shot: string, body: () => Promise<void>) {
  try {
    await body();
    await page.screenshot({ path: join(shots, `${shot}.png`) });
    results.push({ ok: true, name, detail: `${shot}.png` });
  } catch (error) {
    await page.screenshot({ path: join(shots, `${shot}-FAILED.png`) }).catch(() => undefined);
    results.push({ ok: false, name, detail: (error instanceof Error ? error.message : String(error)).split("\n")[0]! });
  }
  const last = results.at(-1)!;
  console.log(`${last.ok ? "PASS" : "FAIL"}  ${last.name}  ${last.detail}`);
}

const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] } : {}) });
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })).newPage();
  await page.goto(`${base}/chat/`);
  await step(page, "the assistant asks the application's own sign-in", "g01-sign-in", async () => {
    await page.getByRole("heading", { name: "Sign in" }).waitFor({ timeout: 20000 });
  });
  await step(page, "the application's administrator signs in through the assistant", "g02-signed-in", async () => {
    await page.getByLabel("E-mail").fill(process.env.CHAT_EMAIL ?? "admin@admin.com");
    await page.getByLabel("Password").fill(process.env.CHAT_PASSWORD ?? "admin123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByPlaceholder("Ask for a record, a page or a report…").waitFor({ timeout: 30000 });
  });
  await step(page, "ask for a list: the real application page opens beside the chat, without its own chrome", "g03-list-open", async () => {
    const input = page.getByPlaceholder("Ask for a record, a page or a report…");
    await input.fill("Open the list of accounts.");
    await input.press("Enter");
    await page.getByText("Opened: ").first().waitFor({ timeout: 180000 });
    const src = (await page.locator("iframe").first().getAttribute("src")) ?? "";
    if (!/\/chat\/open\/[A-Za-z0-9_-]{20,}/.test(src)) throw new Error(`iframe src is not a ticket: ${src}`);
    // The real application's list, not an error page: wait for its own content, and refuse every
    // message the gateway or the ticket redemption could answer with instead.
    const frame = page.frameLocator("iframe");
    await frame.getByText(/account/i).first().waitFor({ timeout: 90000 });
    const text = (await frame.locator("body").innerText()).trim();
    for (const bad of ["not answering", "not available", "Not found", "Sign in", "Internal Server Error"]) {
      if (text.includes(bad)) throw new Error(`the frame shows "${bad}"`);
    }
    await page.waitForTimeout(2000);
  });
} finally {
  await browser.close();
}
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps passed`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
