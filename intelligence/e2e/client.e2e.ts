#!/usr/bin/env bun
/**
 * Browser E2E for the assistant's own client (Chromium, via Playwright).
 *
 *   bun run build && bun e2e/client.e2e.ts
 *
 * Starts `scripts/preview.ts` twice (stand-in products, scripted model; the second run with
 * PREVIEW_SCENARIO=propose), drives the real built client, and writes a screenshot of every step to
 * `docs/e2e-screenshots/`. Playwright is the repository's own (`node_modules` at the root); it is not
 * a dependency of this project. Exit code 1 when any step fails.
 */
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const shots = join(root, "docs/e2e-screenshots");
mkdirSync(shots, { recursive: true });

async function start(port: number, scenario?: string) {
  const child = Bun.spawn(["bun", "scripts/preview.ts"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), ...(scenario ? { PREVIEW_SCENARIO: scenario } : {}) },
    stdout: "ignore",
    stderr: "ignore",
  });
  for (let i = 0; i < 60; i += 1) {
    if (await fetch(`http://localhost:${port}/chat/healthz`).then((r) => r.ok, () => false)) return child;
    await Bun.sleep(500);
  }
  child.kill();
  throw new Error(`preview did not start on ${port}`);
}

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
async function step(page: Page, name: string, shot: string, body: () => Promise<void>) {
  try {
    await body();
    await page.screenshot({ path: join(shots, `${shot}.png`) });
    results.push({ name, ok: true, detail: `${shot}.png` });
  } catch (error) {
    await page.screenshot({ path: join(shots, `${shot}-FAILED.png`) }).catch(() => undefined);
    results.push({ name, ok: false, detail: (error instanceof Error ? error.message : String(error)).split("\n")[0]! });
  }
  const last = results.at(-1)!;
  console.log(`${last.ok ? "PASS" : "FAIL"}  ${name}  ${last.detail}`);
}

const ask = async (page: Page, text: string) => {
  const input = page.getByPlaceholder("Ask for a record, a page or a report…");
  await input.fill(text);
  await input.press("Enter");
};

// CHROMIUM_PATH overrides the browser Playwright would look for (a container with another build installed).
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] } : {}),
});
const servers: Array<{ kill(): void }> = [];
try {
  // ── Run 1: open a record in the frame, then sign out ───────────────────────
  const first = await start(4301);
  servers.push(first);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://localhost:4301/chat/");

  await step(page, "signed out: the sign-in form is shown", "01-sign-in", async () => {
    await page.getByRole("heading", { name: "Sign in" }).waitFor();
  });
  await step(page, "sign in: the chat opens with a greeting for the person", "02-signed-in", async () => {
    await page.getByLabel("E-mail").fill("support.agent@crm.example.com");
    await page.getByLabel("Password").fill("anything");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText("Hello Support Agent").waitFor({ timeout: 15000 });
  });
  await step(page, "ask: tool chips show, then the record opens in a framed tab", "03-record-open", async () => {
    await ask(page, "Open the Acme account");
    await page.getByText("Opened: ").first().waitFor({ timeout: 30000 });
    const frame = page.frameLocator("iframe");
    await frame.getByText("Account — Acme Corporation").waitFor({ timeout: 15000 });
  });
  await step(page, "the framed page's address is a ticket redemption, not a page address in the chat", "04-no-address", async () => {
    const html = await page.content();
    if (/\/app\/bus_account/.test(html.replace(/<iframe[^>]*>/g, ""))) throw new Error("a page address is in the chat DOM");
    const src = (await page.locator("iframe").first().getAttribute("src")) ?? "";
    if (!/\/chat\/open\/[A-Za-z0-9_-]{20,}/.test(src)) throw new Error(`iframe src is not a ticket: ${src}`);
  });
  await step(page, "closing the tab empties the workspace", "05-tab-closed", async () => {
    await page.getByRole("button", { name: /^Close / }).first().click();
    await page.locator("iframe").first().waitFor({ state: "detached", timeout: 5000 });
    // A conversation that went well never shows the "could not answer" alert.
    if ((await page.getByRole("alert").count()) !== 0) throw new Error("an error alert is shown after a successful conversation");
  });
  await step(page, "sign out returns to the sign-in form", "06-signed-out", async () => {
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("heading", { name: "Sign in" }).waitFor({ timeout: 10000 });
  });
  first.kill();

  // ── Run 2: a proposed change runs only on the person's own Confirm ─────────
  const second = await start(4302, "propose");
  servers.push(second);
  const context2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page2 = await context2.newPage();
  await page2.goto("http://localhost:4302/chat/");
  await page2.getByLabel("E-mail").fill("support.agent@crm.example.com");
  await page2.getByLabel("Password").fill("anything");
  await page2.getByRole("button", { name: "Sign in" }).click();
  await page2.getByText("Hello Support Agent").waitFor({ timeout: 15000 });
  await step(page2, "propose: a card waits, with Confirm and Decline, and nothing has changed", "07-proposal", async () => {
    await ask(page2, "Change Acme's industry to Retail");
    await page2.getByRole("group", { name: "Proposed change" }).waitFor({ timeout: 30000 });
    await page2.getByRole("button", { name: "Confirm" }).waitFor();
    await page2.getByRole("button", { name: "Decline" }).waitFor();
  });
  await step(page2, "confirm: the person's own press runs it once", "08-confirmed", async () => {
    await page2.getByRole("button", { name: "Confirm" }).click();
    await page2.getByRole("status").filter({ hasText: "Saved." }).waitFor({ timeout: 10000 });
    if ((await page2.getByRole("button", { name: "Confirm" }).count()) !== 0) throw new Error("Confirm is still offered after it ran");
  });
  second.kill();

  // ── Run 3: the model endpoint is down. The chat says so; it does not just stop. ──
  const third = await start(4303, "model-down");
  servers.push(third);
  const page3 = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })).newPage();
  await page3.goto("http://localhost:4303/chat/");
  await page3.getByLabel("E-mail").fill("support.agent@crm.example.com");
  await page3.getByLabel("Password").fill("anything");
  await page3.getByRole("button", { name: "Sign in" }).click();
  await page3.getByText("Hello Support Agent").waitFor({ timeout: 15000 });
  await step(page3, "model down: the chat says the assistant could not answer, and offers another try", "09-model-down", async () => {
    await ask(page3, "Open the Acme account");
    const alert = page3.getByRole("alert");
    await alert.waitFor({ timeout: 30000 });
    const text = (await alert.innerText()).toLowerCase();
    if (!/could(n't| not)/.test(text)) throw new Error(`the alert does not say it could not answer: ${text.slice(0, 120)}`);
    // A message of its own: no stack, no address, no model name.
    if (/500|http|127\.0\.0\.1|localhost|fake/.test(text)) throw new Error(`the alert leaks internals: ${text.slice(0, 120)}`);
  });
  await step(page3, "model down: Dismiss clears the alert", "10-dismissed", async () => {
    await page3.getByRole("button", { name: "Dismiss" }).click();
    await page3.getByRole("alert").waitFor({ state: "detached", timeout: 5000 });
  });
  third.kill();

  // Before the contexts closed: an error thrown by the client's own code is a failure.
  results.push({ name: "no uncaught page errors", ok: errors.length === 0, detail: errors.join(" | ") || "none" });
  console.log(`${errors.length === 0 ? "PASS" : "FAIL"}  no uncaught page errors  ${results.at(-1)!.detail}`);
} finally {
  await browser.close();
  for (const server of servers) server.kill();
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps passed`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
