#!/usr/bin/env bun
/**
 * A person with a narrower role, through the assistant, against a real generated CRM: whatever the
 * application refuses that person, the assistant refuses too, and what it allows opens in the frame.
 *
 *   CHROMIUM_PATH=… bun e2e/generated-roles.e2e.ts
 *
 * The Support Agent reads 5 of the CRM's 17 entities (`%%rbac`); Opportunity is not one of them.
 */
import { ask, base, BAD, createRun, idle, launch, newContext, saidUnavailable, signInViaChat } from "./lib";

const EMAIL = process.env.ROLE_EMAIL ?? "support.agent@my-app.example.com";
const PASSWORD = process.env.ROLE_PASSWORD ?? "admin123";
const run = createRun("");
const browser = await launch();
try {
  const page = await (await newContext(browser)).newPage();
  await signInViaChat(page, EMAIL, PASSWORD);

  await run.step(page, "the application itself refuses this person Opportunity and allows Account (the standard to hold the assistant to)", "r01-app-answers", async () => {
    const denied = await page.request.get(`${base}/api/bus/bus_opportunity?limit=1`);
    const allowed = await page.request.get(`${base}/api/bus/bus_account?limit=1`);
    if (denied.status() === 200) throw new Error("the application lets this role read Opportunity");
    if (allowed.status() !== 200) throw new Error(`the application refuses Account: ${allowed.status()}`);
  });
  await run.step(page, "the assistant issues no ticket for Opportunity, the same neutral answer as for a record that does not exist, and one for Account", "r02-tickets", async () => {
    const post = (object: string) => page.request.post(`${base}/chat/api/tickets`, { data: { product: "app", kind: "page", object, title: object } });
    const denied = await post("bus_opportunity");
    const missing = await post("bus_no_such_thing");
    const allowed = await post("bus_account");
    if (denied.status() !== 404) throw new Error(`Opportunity ticket answered ${denied.status()}`);
    if ((await denied.text()) !== (await missing.text())) throw new Error("a refusal and a missing record are told apart");
    if (allowed.status() !== 200) throw new Error(`Account ticket answered ${allowed.status()}`);
  });
  await run.step(page, "ask for opportunities: nothing opens, and the assistant says it is not available to this person", "r03-refused", async () => {
    await ask(page, "Open the list of opportunities.");
    await idle(page);
    if ((await page.locator("iframe").count()) !== 0) throw new Error("a page opened for a role that may not read it");
    const chat = await page.locator("body").innerText();
    if (!saidUnavailable(chat)) throw new Error("the assistant did not say it was unavailable");
  });
  await run.step(page, "ask for accounts: the real list opens in the frame for the same person", "r04-allowed", async () => {
    await ask(page, "Open the list of accounts.");
    await page.getByText("Opened: ").first().waitFor({ timeout: 240000 });
    const frame = page.frameLocator("iframe");
    await frame.getByText(/account/i).first().waitFor({ timeout: 90000 });
    const text = (await frame.locator("body").innerText()).trim();
    for (const bad of BAD) if (text.includes(bad)) throw new Error(`the frame shows "${bad}"`);
    await page.waitForTimeout(2000);
  });
} finally {
  await browser.close();
}
run.finish();
