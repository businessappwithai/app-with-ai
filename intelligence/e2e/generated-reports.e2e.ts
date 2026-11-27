#!/usr/bin/env bun
/**
 * A report in the frame, live: the real Enterprise Reporting platform (built for /report, seeded from
 * the generated project's reporting pack) opens beside the chat through the same ticket flow, on a
 * session delegated for the signed-in person, and that platform's own per-role table access applies.
 *
 *   CHROMIUM_PATH=… bun e2e/generated-reports.e2e.ts
 *
 * The Support Agent reads 5 tables; "Accounts at risk" reads only `bus_account`, "Deals with no activity
 * in 14 days" reads `bus_opportunity` and `bus_user`.
 */
import type { Page } from "playwright";
import { ask, base, BAD, createRun, idle, launch, newContext, saidUnavailable, signInViaChat } from "./lib";

const ADMIN = { email: process.env.ADMIN_EMAIL ?? "admin@admin.com", password: process.env.ADMIN_PASSWORD ?? "admin123" };
const AGENT = { email: process.env.ROLE_EMAIL ?? "support.agent@my-app.example.com", password: process.env.ROLE_PASSWORD ?? "admin123" };
const RUNNABLE = "Accounts at risk";
const REFUSED = "Deals with no activity in 14 days";
const run = createRun("");

/** The report platform's own answer, with whatever reporting session this browser holds. */
async function reportId(page: Page, title: string): Promise<string> {
  const response = await page.request.get(`${base}/report/api/search?q=${encodeURIComponent(title)}&limit=10`);
  if (!response.ok()) throw new Error(`report search answered ${response.status()}`);
  const items = ((await response.json()) as { items?: Array<{ id: string; kind?: string; type?: string; title?: string; name?: string }> }).items ?? [];
  const hit = items.find((i) => (i.title ?? i.name) === title && (i.kind ?? i.type ?? "report").toString().includes("report"));
  if (!hit) throw new Error(`no report titled "${title}" in ${JSON.stringify(items).slice(0, 200)}`);
  return hit.id;
}
const rows = (page: Page, id: string) => page.request.get(`${base}/report/api/reports/${id}/data?page=0&pageSize=5`);

async function openedReport(page: Page, title: string) {
  await ask(page, `Open the report called "${title}".`);
  await page.getByText("Opened: ").first().waitFor({ timeout: 240000 });
  const src = (await page.locator("iframe").first().getAttribute("src")) ?? "";
  if (!/\/chat\/open\/[A-Za-z0-9_-]{20,}/.test(src)) throw new Error(`iframe src is not a ticket: ${src}`);
  const frame = page.frameLocator("iframe");
  await frame.getByText(title).first().waitFor({ timeout: 120000 });
  const text = (await frame.locator("body").innerText()).trim();
  for (const bad of [...BAD, "Sign in", "Access denied"]) if (text.includes(bad)) throw new Error(`the frame shows "${bad}"`);
  await page.waitForTimeout(3000);
}

const browser = await launch();
try {
  const adminContext = await newContext(browser);
  const admin = await adminContext.newPage();
  await signInViaChat(admin, ADMIN.email, ADMIN.password);
  await run.step(admin, "administrator: asking for a report opens the real reporting platform in the frame, on a session delegated for them", "p01-admin-report", async () => {
    await openedReport(admin, RUNNABLE);
  });
  let refusedId = "";
  await run.step(admin, "administrator: the platform runs the restricted-table report and returns rows (the reference the role below is held to)", "p02-admin-rows", async () => {
    refusedId = await reportId(admin, REFUSED);
    const response = await rows(admin, refusedId);
    if (response.status() !== 200) throw new Error(`administrator run answered ${response.status()}`);
  });

  const agentContext = await newContext(browser);
  const agent = await agentContext.newPage();
  await signInViaChat(agent, AGENT.email, AGENT.password);
  await run.step(agent, "support agent: a report on tables their role reads opens in the frame", "p03-agent-allowed", async () => {
    await openedReport(agent, RUNNABLE);
  });
  await run.step(agent, "support agent: the platform itself refuses the report that reads Opportunity (403), and the assistant gives them no rows", "p04-agent-refused", async () => {
    const id = await reportId(agent, REFUSED);
    if (id !== refusedId) throw new Error("the two sessions see different reports");
    const direct = await rows(agent, id);
    if (direct.status() === 200) throw new Error("the platform ran a report on tables this role may not read");
    await ask(agent, `Run the report called "${REFUSED}" and tell me its first row.`);
    await idle(agent);
    const chat = await agent.locator("body").innerText();
    if (!saidUnavailable(chat)) throw new Error("the assistant did not say it could not run it");
  });
} finally {
  await browser.close();
}
run.finish();
