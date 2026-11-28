import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end validation of a generated application, in Chromium, against the
 * facts its model states (`facts.ts`). Run with `bun scripts/e2e-generated-app/run.ts`
 * (README.md beside this file); it writes the facts and starts the application
 * when one is not already running.
 *
 * One worker, files in order: every spec shares the application's database, and
 * 05 moves records that 04 may have just edited.
 */

const chromium = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  globalSetup: "./global-setup.ts",
  testDir: "./specs",
  testMatch: ["**/*.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.E2E_APP_URL ?? "http://127.0.0.1:4000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    viewport: { width: 1440, height: 1000 },
    // Signed in as the administrator by global-setup.ts.
    storageState: ".facts/admin-state.json",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
        ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
      },
    },
  ],
});
