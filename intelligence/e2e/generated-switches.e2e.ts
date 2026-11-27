#!/usr/bin/env bun
/**
 * The administrator's two switches, live, in a real generated CRM: CHAT_ONLY_MODE and CHAT_ENABLED.
 * They are rows of `sys_system`, changed here the way an administrator changes them (PATCH
 * /api/sys/system-config/:id), and put back at the end whatever happens.
 *
 *   CHROMIUM_PATH=… bun e2e/generated-switches.e2e.ts
 */
import type { Page } from "playwright";
import { ask, base, BAD, createRun, launch, newContext, sessionCookie, signInViaApi, signInViaChat } from "./lib";

const AGENT = { email: process.env.ROLE_EMAIL ?? "support.agent@my-app.example.com", password: process.env.ROLE_PASSWORD ?? "admin123" };
const ADMIN = { email: process.env.ADMIN_EMAIL ?? "admin@admin.com", password: process.env.ADMIN_PASSWORD ?? "admin123" };
const API = process.env.APP_API_URL ?? "http://127.0.0.1:4001";
const run = createRun("");

/** Change a switch as the administrator, then wait until the assistant's own reading shows it. */
async function setSwitch(admin: Page, key: "CHAT_ENABLED" | "CHAT_ONLY_MODE", value: boolean) {
  const rows = (await (await admin.request.get(`${base}/api/sys/system-config`)).json()) as Array<{ sys_system_id: string; config_key: string }>;
  const row = rows.find((r) => r.config_key === key);
  if (!row) throw new Error(`no ${key} row`);
  const response = await admin.request.patch(`${base}/api/sys/system-config/${row.sys_system_id}`, { data: { config_value: String(value) } });
  if (!response.ok()) throw new Error(`could not set ${key}: ${response.status()}`);
  const field = key === "CHAT_ENABLED" ? "enabled" : "chatOnly";
  for (let i = 0; i < 40; i += 1) {
    const session = (await (await admin.request.get(`${base}/chat/api/session`)).json().catch(() => ({}))) as Record<string, unknown>;
    if (session[field] === value) return;
    await admin.waitForTimeout(1000);
  }
  throw new Error(`${key} did not read back as ${value}`);
}

/** A direct call to the application's API, with only the person's session: no embed cookie, no bridge. */
async function direct(cookie: string, path: string) {
  const response = await fetch(`${API}/api${path}`, { headers: { cookie, origin: base, accept: "application/json" } });
  return { status: response.status, text: await response.text() };
}

const browser = await launch();
const adminContext = await newContext(browser);
const admin = await adminContext.newPage();
try {
  await signInViaChat(admin, ADMIN.email, ADMIN.password);

  // ── Chat-only mode ────────────────────────────────────────────────────────
  await run.step(admin, "the administrator turns chat-only mode on in the application's own settings", "s01-chat-only-on", async () => {
    await setSwitch(admin, "CHAT_ONLY_MODE", true);
  });

  const agentContext = await newContext(browser);
  const agent = await agentContext.newPage();
  await run.step(agent, "a non-administrator who opens the application directly is sent into the chat", "s02-redirected-to-chat", async () => {
    await signInViaApi(agent, AGENT.email, AGENT.password);
    await agent.goto(`${base}/bus_account`);
    await agent.waitForURL(/\/chat\//, { timeout: 60000 });
    await agent.getByPlaceholder("Ask for a record, a page or a report…").waitFor({ timeout: 30000 });
  });
  await run.step(agent, "the application's API refuses that person a direct call (403 CHAT_ONLY), while the administrator is exempt", "s03-direct-refused", async () => {
    // Without the embed cookie and the bridge header: what a script or another browser tab would send.
    const refused = await direct(await sessionCookie(agentContext), "/bus/bus_account?limit=1");
    if (refused.status !== 403 || !refused.text.includes("CHAT_ONLY")) throw new Error(`agent direct call: ${refused.status} ${refused.text.slice(0, 120)}`);
    const exempt = await direct(await sessionCookie(adminContext), "/bus/bus_account?limit=1");
    if (exempt.status !== 200) throw new Error(`administrator direct call: ${exempt.status}`);
  });
  await run.step(agent, "through the assistant the same person still works: the list opens in the frame", "s04-works-in-chat", async () => {
    await ask(agent, "Open the list of accounts.");
    await agent.getByText("Opened: ").first().waitFor({ timeout: 240000 });
    const frame = agent.frameLocator("iframe");
    await frame.getByText(/account/i).first().waitFor({ timeout: 90000 });
    const text = (await frame.locator("body").innerText()).trim();
    for (const bad of BAD) if (text.includes(bad)) throw new Error(`the frame shows "${bad}"`);
    await agent.waitForTimeout(2000);
  });
  await run.step(admin, "chat-only mode off again: a direct call from the same person works", "s05-chat-only-off", async () => {
    await setSwitch(admin, "CHAT_ONLY_MODE", false);
    const open = await direct(await sessionCookie(agentContext), "/bus/bus_account?limit=1");
    for (let i = 0; i < 12 && open.status !== 200; i += 1) {
      await admin.waitForTimeout(1500);
      if ((await direct(await sessionCookie(agentContext), "/bus/bus_account?limit=1")).status === 200) return;
    }
    if (open.status !== 200) throw new Error(`still refused: ${open.status}`);
  });

  // ── The assistant switched off ────────────────────────────────────────────
  await run.step(admin, "the administrator switches the assistant off", "s06-chat-off", async () => {
    await setSwitch(admin, "CHAT_ENABLED", false);
  });
  await run.step(agent, "a signed-in person who opens the chat is told it is switched off, and gets no tickets", "s07-switched-off", async () => {
    await agent.goto(`${base}/chat/`);
    await agent.getByRole("heading", { name: "The assistant is switched off" }).waitFor({ timeout: 30000 });
    const ticket = await agent.request.post(`${base}/chat/api/tickets`, { data: { product: "app", kind: "page", object: "bus_account", title: "x" } });
    if (ticket.status() !== 403) throw new Error(`a ticket request answered ${ticket.status()} while switched off`);
  });
  await run.step(agent, "the application itself is unaffected: it still answers the same person directly", "s08-app-unaffected", async () => {
    const open = await direct(await sessionCookie(agentContext), "/bus/bus_account?limit=1");
    if (open.status !== 200) throw new Error(`direct call: ${open.status}`);
    await agent.goto(`${base}/dashboard`);
    await agent.waitForLoadState("networkidle");
    if (/\/chat\//.test(agent.url())) throw new Error("the application sent the person to the chat while it is off");
  });
} finally {
  // Put both switches back, whatever happened above.
  for (const key of ["CHAT_ONLY_MODE", "CHAT_ENABLED"] as const) {
    await setSwitch(admin, key, key === "CHAT_ENABLED").catch((error) => console.error(`could not restore ${key}: ${error}`));
  }
  await browser.close();
}
run.finish();
