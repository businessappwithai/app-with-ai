/**
 * 02 — Every entity's record opens and shows what the model declares.
 *
 * For each entity with a record (line items included, opened on their own
 * route), the record screen draws with no page error and no 5xx, shows a value
 * slot for the model's columns, and — for a parent — a tab for each of its line
 * items. Columns the form legitimately leaves out (the key, the managed audit
 * columns, the state field shown in the header) are not required.
 */

import { expect, test } from "@playwright/test";
import { apiAs, facts, rowsOf, routeOf, watchErrors, entityByName, type Api } from "../lib/app";

const MANAGED = new Set(["id", "version", "created_at", "updated_at", "deleted_at", "created_by", "updated_by", "is_active", "doc_status"]);
let api: Api;
let labels = new Map<string, string>();

test.beforeAll(async () => {
  api = await apiAs();
  const tables = rowsOf((await api.get("/sys/tables?limit=1000")).data);
  labels = new Map(tables.map((t) => [t.table_name as string, t.name as string]));
});

for (const entity of facts.entities) {
  test(`record: ${entity.name}`, async ({ page }) => {
    const listed = await api.get(`/bus/${entity.apiSegment}?limit=1`);
    expect(listed.status, `the API lists ${entity.name}`).toBe(200);
    const row = rowsOf(listed.data)[0];
    test.skip(!row, `${entity.name} has no records to open`);

    const errors = watchErrors(page);
    await page.goto(`${routeOf(entity)}/${row!.id}`);
    await expect(page.locator('[data-testid^="field-value-"]').first()).toBeVisible();

    const machine = facts.machines.find((m) => m.entity === entity.name);
    const expected = entity.columns
      // A field with display logic is drawn only while it holds for the record.
      .filter((c) => !c.displayLogic)
      .map((c) => c.name)
      .filter((name) => !MANAGED.has(name) && name !== entity.primaryKey && name !== machine?.stateField)
      // A line item's link to its parent is the context it is opened in.
      .filter((name) => name !== entity.parentLink);
    const drawn = new Set(
      await page.locator('[data-testid^="field-value-"]').evaluateAll((nodes) =>
        nodes.map((n) => (n.getAttribute("data-testid") ?? "").replace("field-value-", ""))
      )
    );
    const missing = expected.filter((name) => !drawn.has(name));
    expect(missing, `${entity.name} fields the record screen does not show`).toEqual([]);

    // A parent shows a tab for each line item the model gives it.
    for (const childName of entity.children) {
      const child = entityByName.get(childName)!;
      const label = labels.get(child.table) ?? child.table;
      await expect(page.getByRole("tab", { name: new RegExp(escape(label), "i") }).first(),
        `${entity.name} has a ${childName} tab`).toBeVisible();
    }
    expect(errors()).toEqual([]);
  });
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
