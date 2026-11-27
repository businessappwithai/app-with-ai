#!/usr/bin/env bun
/**
 * Natural-language reports, live. Two ways of asking in plain words:
 *
 *  1. of the assistant itself: it finds a report, runs it as the signed-in person and answers from the rows;
 *  2. of the reporting platform's own "Natural Language Query" page, opened in the frame through the chat:
 *     its AI writes and runs the SQL (its model is pointed at the same Claude Code shim, AI_NL2SQL_BASE_URL).
 *
 *   CHROMIUM_PATH=… bun e2e/generated-nl.e2e.ts
 */
import { ask, BAD, createRun, idle, launch, newContext, signInViaChat } from "./lib";

const ADMIN = { email: process.env.ADMIN_EMAIL ?? "admin@admin.com", password: process.env.ADMIN_PASSWORD ?? "admin123" };
const run = createRun("");

const browser = await launch();
try {
  const page = await (await newContext(browser)).newPage();
  await signInViaChat(page, ADMIN.email, ADMIN.password);

  await run.step(page, "ask the assistant a question in plain words: it runs a report as this person and answers from the rows", "n01-answer-from-report", async () => {
    await ask(page, "Which accounts are at risk right now? Use the reports to find out, and tell me their names.");
    await idle(page);
    const chat = await page.locator("body").innerText();
    if (!/Running the report/i.test(chat)) throw new Error("no report was run");
    if (!/Account 2/.test(chat)) throw new Error("the answer does not name the account the report returns (Account 2)");
  });

  await run.step(page, "ask for the platform's natural-language query page: its real screen opens in the frame", "n02-nl-page", async () => {
    await ask(page, "Open the page where I can ask a question about the data in plain English.");
    await page.getByText("Opened: ").first().waitFor({ timeout: 240000 });
    const frame = page.frameLocator("section.frame:not([hidden]) iframe");
    await frame.getByText("Natural Language Query").first().waitFor({ timeout: 120000 });
    await frame.getByPlaceholder("Ask about your data...").waitFor({ timeout: 60000 });
    const text = (await frame.locator("body").innerText()).trim();
    for (const bad of [...BAD, "Sign in"]) if (text.includes(bad)) throw new Error(`the frame shows "${bad}"`);
    await page.waitForTimeout(2000);
  });

  await run.step(page, "ask that page a question in plain English: its AI writes the SQL, runs it, and the answer appears", "n03-nl-answer", async () => {
    const frame = page.frameLocator("section.frame:not([hidden]) iframe");
    const box = frame.getByPlaceholder("Ask about your data...");
    await box.fill("How many accounts are there in each tier?");
    await frame.getByRole("button", { name: "Send" }).click();
    // The page leaves "No results yet" when a query has run.
    await frame.getByText("No results yet").waitFor({ state: "detached", timeout: 280000 });
    const text = (await frame.locator("body").innerText()).toLowerCase();
    if (!/select/.test(text) && !/tier/.test(text)) throw new Error(`nothing that looks like an answer: ${text.slice(0, 200)}`);
    await page.waitForTimeout(3000);
  });
} finally {
  await browser.close();
}
run.finish();
