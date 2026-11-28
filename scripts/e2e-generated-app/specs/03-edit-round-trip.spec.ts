/**
 * 03 — A person can change a record through its form, and the change is saved.
 *
 * For every top-level entity with a plain text column a person types into, the
 * spec opens a record that is not Final, presses Edit, types a new value, saves,
 * and reads the record back through the API: the value is the one typed and the
 * version moved on. The one other acceptable outcome is the model refusing the
 * save — a rule, a mandatory field — shown on the page as the reason. A crash,
 * a 5xx, or a save that silently changed nothing fails.
 */

import { expect, test } from "@playwright/test";
import { apiAs, facts, rowsOf, routeOf, topLevel, watchErrors, type Api } from "../lib/app";

let api: Api;
test.beforeAll(async () => {
  api = await apiAs();
});

const UNIQUE_HINT = /(_number|_code|^code$|email|_no$|^name$)/;

for (const entity of topLevel) {
  const machine = facts.machines.find((m) => m.entity === entity.name);
  const column = entity.columns.find(
    (c) =>
      (c.type === "string" || c.type === "text") &&
      !c.foreignKey && !c.enumValues && !c.computedKind && !c.displayLogic &&
      c.name !== machine?.stateField && c.name !== entity.primaryKey &&
      !UNIQUE_HINT.test(c.name) && !c.name.endsWith("_id")
  );
  if (!column) continue;

  test(`edit: ${entity.name}.${column.name}`, async ({ page }) => {
    const rows = rowsOf((await api.get(`/bus/${entity.apiSegment}?limit=50`)).data);
    const row = rows.find((r) => !machine || !machine.terminal.includes(String(r[machine.stateField])));
    test.skip(!row, `${entity.name} has no record that is not Final`);

    const errors = watchErrors(page);
    await page.goto(`${routeOf(entity)}/${row!.id}`);
    const edit = page.getByRole("button", { name: /^Edit$/ }).first();
    await expect(edit).toBeVisible();
    await edit.click();

    const input = page.locator(`input[name="${column.name}"], textarea[name="${column.name}"], select[name="${column.name}"]`).first();
    await expect(input, `${column.name} is an input in edit mode`).toBeEditable();
    const typed = `E2E ${column.name} ${Date.now().toString(36)}`;
    await input.fill(typed);
    await page.getByRole("button", { name: /^Save( Changes)?$/ }).first().click();

    // Saved, or refused with a reason the page shows.
    const stored = async () => (await api.get(`/bus/${entity.apiSegment}/${row!.id}`)).data;
    await expect
      .poll(async () => {
        const now = await stored();
        if (now?.[column.name] === typed) return "saved";
        const refused = await page.locator('[role="alert"], [data-testid="press-refused"], .text-destructive').count();
        return refused ? "refused" : "pending";
      }, { timeout: 20_000 })
      .not.toBe("pending");

    const now = await stored();
    if (now?.[column.name] === typed) {
      expect(Number(now.version), "the version moved on").toBeGreaterThan(Number(row!.version));
    } else {
      test.info().annotations.push({ type: "refused", description: `${entity.name}: the model refused the save` });
    }
    expect(errors()).toEqual([]);
  });
}
