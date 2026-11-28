/**
 * 04 — Every state machine the model draws is the one the application runs.
 *
 * For each `kind: state` workflow, on a record in a state with a way out:
 *
 * - the moves the API offers from that state are exactly the edges the model
 *   draws out of it (the administrator holds every grant);
 * - the record screen offers them as action buttons, and pressing one moves the
 *   record along the drawn edge — the state changes and `<state>_at` is stamped
 *   where the model declares one — or the page says why the move was refused
 *   (a rule or a workflow bound to the state);
 * - a move the model does not draw is refused with 409 INVALID_TRANSITION.
 */

import { expect, test } from "@playwright/test";
import { apiAs, entityByName, facts, routeOf, rowsOf, watchErrors, type Api } from "../lib/app";

let api: Api;
test.beforeAll(async () => {
  api = await apiAs();
});

for (const machine of facts.machines) {
  const entity = entityByName.get(machine.entity)!;
  const movable = [...new Set(machine.edges.map((e) => e.from))].filter((s) => !machine.terminal.includes(s));

  test(`lifecycle: ${machine.entity}`, async ({ page }) => {
    // A record in a state the model draws a way out of.
    let row: Record<string, any> | undefined;
    for (const state of movable) {
      const found = rowsOf((await api.get(`/bus/${entity.apiSegment}?limit=5&${machine.stateField}=${encodeURIComponent(state)}`)).data);
      if (found.length) { row = found[0]; break; }
    }
    test.skip(!row, `no ${machine.entity} record is in a state with a way out`);
    const from = String(row![machine.stateField]);
    const drawn = machine.edges.filter((e) => e.from === from);

    // The API offers exactly the drawn moves.
    const actions = (await api.get(`/bus/${entity.apiSegment}/${row!.id}/actions`)).data as Array<{ to: string; event: string; kind: string }>;
    const offered = actions.filter((a) => a.kind === "move").map((a) => a.to).sort();
    expect(offered, `moves offered from ${from}`).toEqual([...new Set(drawn.map((e) => e.to))].sort());

    // A move the model does not draw is refused.
    const undrawn = machine.edges.map((e) => e.to).find((to) => to !== from && !drawn.some((e) => e.to === to));
    if (undrawn) {
      const refused = await api.post(`/bus/${entity.apiSegment}/${row!.id}/transition`, { to: undrawn }, { "If-Match": `"${row!.version}"` });
      expect(refused.status, `${from} → ${undrawn} is not drawn`).toBe(409);
      expect(refused.data?.details?.code).toBe("INVALID_TRANSITION");
    }

    // The screen offers the move as a button, and pressing it moves the record.
    const errors = watchErrors(page);
    await page.goto(`${routeOf(entity)}/${row!.id}`);
    await expect(page.getByTestId("record-actions")).toBeVisible();
    const move = actions.find((a) => a.kind === "move")!;
    const key = move.event || move.to;
    const menu = page.getByTestId("record-actions-menu");
    if (await menu.count()) await menu.click();
    await page.getByTestId(`record-action-${key}`).first().click();
    await expect(page.getByTestId("press-moved").or(page.getByTestId("press-refused"))).toBeVisible();

    const after = (await api.get(`/bus/${entity.apiSegment}/${row!.id}`)).data;
    if (await page.getByTestId("press-moved").count()) {
      expect(after[machine.stateField], `${machine.entity} moved ${from} → ${move.to}`).toBe(move.to);
      const stamp = `${move.to.toLowerCase()}_at`;
      if (entity.columns.some((c) => c.name === stamp)) expect(after[stamp], `${stamp} is stamped`).toBeTruthy();
    } else {
      expect(after[machine.stateField], "a refused move leaves the state where it was").toBe(from);
      test.info().annotations.push({ type: "refused", description: `${machine.entity} ${from} → ${move.to}: ${await page.getByTestId("press-refused").textContent()}` });
    }
    expect(errors()).toEqual([]);
  });
}
