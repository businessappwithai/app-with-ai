/**
 * 01 — The application opens, offers every screen the model declares, and each
 * of those screens lists its records.
 *
 * - The administrator's navigation names every top-level entity, under the
 *   label the dictionary gives its table. A line item has no screen of its own:
 *   it is a tab in its parent's window, so it is not in the navigation.
 * - Every list opens with no error in the page and no 5xx from the API, and
 *   shows its records (or says there are none).
 * - A rollup — and a formula that reads one — is not a column of any list:
 *   a list loads no child rows, so the value could only ever be empty.
 */

import { expect, test } from "@playwright/test";
import { apiAs, rowsOf, routeOf, signIn, topLevel, watchErrors } from "../lib/app";

let labels = new Map<string, string>();

test.beforeAll(async () => {
  const api = await apiAs();
  const tables = rowsOf((await api.get("/sys/tables?limit=1000")).data);
  labels = new Map(tables.map((t) => [t.table_name as string, t.name as string]));
});

test.describe("signing in", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("the form signs the administrator in and lands on the dashboard", async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page);
    await expect(page).toHaveURL(/dashboard/);
    expect(errors()).toEqual([]);
  });
});

test("the navigation offers every top-level entity", async ({ page }) => {
  await page.goto("/dashboard");
  const nav = page.locator("nav").first();
  await expect(nav.locator("button[aria-label]").first()).toBeVisible();
  const offered = new Set(await nav.locator("button[aria-label]").evaluateAll((nodes) =>
    nodes.map((n) => n.getAttribute("aria-label") ?? "")
  ));
  const missing = topLevel
    .map((entity) => labels.get(entity.table) ?? entity.table)
    .filter((label) => !offered.has(label));
  expect(missing, "entities the navigation does not offer").toEqual([]);
});

for (const entity of topLevel) {
  test(`list: ${entity.name}`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(routeOf(entity));
    // Either the grid or its empty state, never a blank screen or an error page.
    const grid = page.locator("table thead th").first();
    const empty = page.getByText(/no (records|entries|data)|nothing here|no results/i).first();
    await expect(grid.or(empty)).toBeVisible();
    await expect(page.getByText(/something went wrong|failed to load/i)).toHaveCount(0);

    // A rollup, or a formula that needs one, is not a list column.
    const formOnly = entity.columns.filter(
      (c) => c.computedKind === "rollup" ||
        (c.computedKind === "calculated" && readsRollup(entity, c.name))
    );
    if (formOnly.length && (await grid.count())) {
      const heads = (await page.locator("table thead th").allTextContents()).map((h) => h.trim().toLowerCase());
      for (const column of formOnly) {
        const label = column.name.replace(/_/g, " ").toLowerCase();
        expect(heads.some((h) => h.startsWith(label)), `${column.name} is not a list column`).toBe(false);
      }
    }
    expect(errors()).toEqual([]);
  });
}

function readsRollup(entity: (typeof topLevel)[number], column: string, seen = new Set<string>()): boolean {
  if (seen.has(column)) return false;
  seen.add(column);
  const field = entity.columns.find((c) => c.name === column);
  if (!field?.computedKind) return false;
  if (field.computedKind === "rollup") return true;
  const reads = [...(field.computedExpression ?? "").matchAll(/@(\w+)@/g)].map((m) => m[1]!);
  return reads.some((name) => readsRollup(entity, name, seen));
}
