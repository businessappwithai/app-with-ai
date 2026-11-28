/**
 * 05 — Every role sees what the model's `%%rbac … .read` lines give it, and is
 * refused what they do not.
 *
 * Each seeded account (one per role) signs in through the form. Its navigation
 * offers exactly the top-level entities its role may read — no fewer, which
 * would hide work it is meant to do, and no more, which would offer screens that
 * answer 403. Then it opens an entity it may not read, and the API refuses the
 * list with 403 rather than handing over the rows.
 */

import { expect, test } from "@playwright/test";
import { apiAs, facts, routeOf, rowsOf, signIn, topLevel, watchErrors } from "../lib/app";

let labels = new Map<string, string>();
test.beforeAll(async () => {
  const api = await apiAs();
  const tables = rowsOf((await api.get("/sys/tables?limit=1000")).data);
  labels = new Map(tables.map((t) => [t.table_name as string, t.name as string]));
});

test.use({ storageState: { cookies: [], origins: [] } });

for (const role of facts.roles.filter((r) => !r.isAdmin)) {
  test(`role: ${role.role} (${role.visible.length} of ${topLevel.length})`, async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page, role.email);
    const labelOf = (name: string) => {
      const entity = topLevel.find((e) => e.name === name)!;
      return labels.get(entity.table) ?? entity.table;
    };
    const expected = new Set(role.visible.map(labelOf));
    const entityLabels = new Set(topLevel.map((e) => labels.get(e.table) ?? e.table));

    const nav = page.locator("nav").first();
    if (expected.size) await expect(nav.locator("button[aria-label]").first()).toBeVisible();
    else await page.waitForTimeout(2_000);
    const offered = (await nav.locator("button[aria-label]").evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute("aria-label") ?? "")
    )).filter((label) => entityLabels.has(label));

    expect([...expected].filter((l) => !offered.includes(l)), "entities the role may read but is not offered").toEqual([]);
    expect(offered.filter((l) => !expected.has(l)), "entities offered that the role may not read").toEqual([]);

    // An entity this role may not read: the list is refused by the API.
    const forbidden = topLevel.find((e) => !role.visible.includes(e.name));
    if (forbidden) {
      const answer = page.waitForResponse(
        (r) => new URL(r.url()).pathname.endsWith(`/bus/${forbidden.apiSegment}`) && r.request().method() === "GET",
        { timeout: 30_000 }
      ).catch(() => null);
      await page.goto(routeOf(forbidden));
      const response = await answer;
      if (response) expect(response.status(), `${role.role} reading ${forbidden.name}`).toBe(403);
      else {
        // The screen did not even ask: the route itself refused to open it.
        await expect(page.locator("table tbody tr")).toHaveCount(0);
      }
    }
    expect(errors()).toEqual([]);
  });
}
