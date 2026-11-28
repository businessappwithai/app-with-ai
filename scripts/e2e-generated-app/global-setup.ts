/**
 * Sign the administrator in once and keep the browser state, so the specs
 * start signed in instead of each submitting the form (which the application
 * rate-limits). A spec about another account signs in on a fresh context.
 */

import { chromium } from "@playwright/test";
import { join } from "node:path";
import { APP_URL, signIn } from "./lib/app";

export const ADMIN_STATE = join(import.meta.dirname, ".facts", "admin-state.json");

export default async function globalSetup(): Promise<void> {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const page = await browser.newPage({ baseURL: APP_URL });
  await signIn(page);
  await page.context().storageState({ path: ADMIN_STATE });
  await browser.close();
}
