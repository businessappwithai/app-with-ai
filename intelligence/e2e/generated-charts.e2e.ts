#!/usr/bin/env bun
/**
 * A chart and a dashboard in the frame, live: asked for in plain words, opened as the real reporting
 * platform's own viewer on a session delegated for the signed-in person, with that platform's own
 * per-role table access applying to what the chart draws.
 *
 *   CHROMIUM_PATH=… bun e2e/generated-charts.e2e.ts
 */
import type { Page } from "playwright";
import { ask, base, BAD, createRun, idle, launch, newContext, saidUnavailable, signInViaChat } from "./lib";

const ADMIN = { email: process.env.ADMIN_EMAIL ?? "admin@admin.com", password: process.env.ADMIN_PASSWORD ?? "admin123" };
const AGENT = { email: process.env.ROLE_EMAIL ?? "support.agent@my-app.example.com", password: process.env.ROLE_PASSWORD ?? "admin123" };
const CHART_ALL = "Open pipeline value by stage"; // reads bus_opportunity: the administrator may, the Support Agent may not
const CHART_AGENT = "Accounts at risk"; // reads bus_account: both may
const DASHBOARD = "my-app — overview";
const run = createRun("");

/** The platform's own search, with whatever reporting session this browser holds. */
async function definitionId(page: Page, title: string, kind: "chart" | "dashboard"): Promise<string> {
  const response = await page.request.get(`${base}/report/api/search?q=${encodeURIComponent(title)}&limit=20`);
  if (!response.ok()) throw new Error(`search answered ${response.status()}`);
  const items = ((await response.json()) as { items?: Array<{ id: string; kind?: string; type?: string; title?: string; name?: string }> }).items ?? [];
  const hit = items.find((i) => (i.title ?? i.name) === title && String(i.kind ?? i.type ?? "").includes(kind));
  if (!hit) throw new Error(`no ${kind} titled "${title}" in ${JSON.stringify(items).slice(0, 220)}`);
  return hit.id;
}
const chartData = (page: Page, id: string) => page.request.get(`${base}/report/api/charts/${id}/data`);

/** Ask in plain words and wait for the framed viewer: a ticket link, real content, no error page. */
async function openedInFrame(page: Page, prompt: string, expect: RegExp | string) {
  const before = await page.locator("iframe").count();
  await ask(page, prompt);
  await page.getByText("Opened: ").nth(before).waitFor({ timeout: 240000 });
  const frame = page.frameLocator("section.frame:not([hidden]) iframe");
  await frame.getByText(expect).first().waitFor({ timeout: 120000 });
  const text = (await frame.locator("body").innerText()).trim();
  for (const bad of [...BAD, "Sign in", "Access denied"]) if (text.includes(bad)) throw new Error(`the frame shows "${bad}"`);
  return frame;
}
/** The chart itself drawn: an SVG or canvas with real size, not just the page around it. */
async function chartDrawn(frame: ReturnType<Page["frameLocator"]>) {
  const surface = frame.locator("svg.recharts-surface, .recharts-wrapper svg, canvas").first();
  await surface.waitFor({ timeout: 60000 });
  const box = await surface.boundingBox();
  if (!box || box.width < 120 || box.height < 80) throw new Error(`the chart surface is ${JSON.stringify(box)}`);
}

const browser = await launch();
try {
  const adminContext = await newContext(browser);
  const admin = await adminContext.newPage();
  await signInViaChat(admin, ADMIN.email, ADMIN.password);

  await run.step(admin, "administrator: \"open the chart called …\" draws the real chart in the frame", "c01-admin-chart", async () => {
    const frame = await openedInFrame(admin, `Open the chart (not the report) called "${CHART_ALL}".`, CHART_ALL);
    await chartDrawn(frame);
    await admin.waitForTimeout(2500);
  });
  await run.step(admin, "administrator: \"open the dashboard called …\" opens the dashboard with its widgets", "c02-admin-dashboard", async () => {
    const frame = await openedInFrame(admin, `Open the dashboard called "${DASHBOARD}".`, DASHBOARD);
    await frame.locator("svg.recharts-surface, .recharts-wrapper svg, canvas").first().waitFor({ timeout: 90000 });
    await admin.waitForTimeout(3500);
  });
  let restrictedId = "";
  await run.step(admin, "administrator: the platform returns data for the Opportunity chart (the reference for the role below)", "c03-admin-data", async () => {
    restrictedId = await definitionId(admin, CHART_ALL, "chart");
    const response = await chartData(admin, restrictedId);
    if (response.status() !== 200) throw new Error(`administrator chart data answered ${response.status()}`);
  });

  const agentContext = await newContext(browser);
  const agent = await agentContext.newPage();
  await signInViaChat(agent, AGENT.email, AGENT.password);
  await run.step(agent, "support agent: a chart on a table their role reads is drawn in the frame", "c04-agent-chart", async () => {
    const frame = await openedInFrame(agent, `Open the chart (not the report) called "${CHART_AGENT}".`, CHART_AGENT);
    await chartDrawn(frame);
    await agent.waitForTimeout(2500);
  });
  await run.step(agent, "support agent: asking for the Opportunity chart opens nothing, and the assistant says it is not available (the platform refuses its data)", "c05-agent-refused", async () => {
    const id = await definitionId(agent, CHART_ALL, "chart");
    if (id !== restrictedId) throw new Error("the two sessions see different charts");
    const direct = await chartData(agent, id);
    if (direct.status() === 200) throw new Error("the platform returned data for tables this role may not read");
    const tabsBefore = await agent.locator("section.frame").count();
    await ask(agent, `Open the chart (not the report) called "${CHART_ALL}".`);
    await idle(agent);
    if ((await agent.locator("section.frame").count()) !== tabsBefore) throw new Error("a tab opened for a chart this person may not see");
    const chat = await agent.locator("body").innerText();
    if (!saidUnavailable(chat)) throw new Error("the assistant did not say it was unavailable");
    if (/Opened: Open pipeline value by stage/.test(chat)) throw new Error("the assistant says it opened the refused chart");
  });
} finally {
  await browser.close();
}
run.finish();
