/**
 * 06 — Rollup and calculated fields are drawn right, live, and never stored.
 *
 * For every entity with a computed field (`%%field … rollup: | calculated:`):
 *
 * - on the record with the most child rows, each value the form draws equals the
 *   value the model's definition gives for that record and its rows, read
 *   through the API. The definition is evaluated with common/language/field-compute.ts,
 *   which field-compute.test.ts holds to hand-written results: what this spec
 *   checks is everything the application adds around it — the metadata, the
 *   rollup's child and link, loading every row, the order formulas run in, and
 *   how the value is drawn;
 * - the record's API answer carries no computed column (nothing stores one);
 * - typing a value a formula reads changes the formula's value before any save;
 * - saving a child moves its parent's rollup, with no reload.
 */

import { expect, type Page, test } from "@playwright/test";
import { type ComputeField, computeValues, isComputed, parseRollup } from "../../../common/language/field-compute";
import { apiAs, entityByName, facts, numberShown, routeOf, rowsOf, shownValue, watchErrors, type Api } from "../lib/app";

let api: Api;
test.beforeAll(async () => {
  api = await apiAs();
});

/** A metadata column: the computed-field keys, plus whatever else the API serves. */
type Meta = { columns: Array<ComputeField & Record<string, any>> };
const metaCache = new Map<string, Meta>();
async function meta(segment: string): Promise<Meta> {
  if (!metaCache.has(segment)) metaCache.set(segment, (await api.get(`/bus/${segment}/meta`)).data);
  return metaCache.get(segment)!;
}

/** Every child row of a parent, with the child's own formulas computed on each. */
async function childRows(childTable: string, link: string, parentId: string) {
  const segment = childTable.replace(/^bus_/, "");
  const rows: Array<Record<string, any>> = [];
  for (let page = 1; page < 50; page++) {
    const answer = (await api.get(`/bus/${segment}?limit=100&page=${page}&${link}=${parentId}`)).data;
    rows.push(...rowsOf(answer));
    if (rows.length >= (answer?.meta?.total ?? 0) || !rowsOf(answer).length) break;
  }
  const own = (await meta(segment)).columns.filter(isComputed);
  return own.length ? rows.map((row) => ({ ...row, ...computeValues(own, row) })) : rows;
}

async function expectedFor(segment: string, record: Record<string, any>) {
  const columns = (await meta(segment)).columns;
  const rowsByField: Record<string, Array<Record<string, any>>> = {};
  for (const column of columns.filter((c) => c.computed_kind === "rollup")) {
    expect(column.rollup, `${segment}.${column.column_name} resolves its child`).toBeTruthy();
    rowsByField[column.column_name] = await childRows(column.rollup.child_table, column.rollup.link_column, record.id);
  }
  return { columns, values: computeValues(columns, record, rowsByField) };
}

async function compareDrawn(page: Page, label: string, values: Record<string, unknown>) {
  for (const [column, expected] of Object.entries(values)) {
    const shown = await shownValue(page, column);
    if (typeof expected === "number") {
      const n = numberShown(shown);
      expect(n, `${label}.${column} shown "${shown}", expected ${expected}`).not.toBeNull();
      expect(Math.abs(n! - expected), `${label}.${column} shown "${shown}", expected ${expected}`).toBeLessThan(0.006);
    } else if (expected === null) {
      expect(shown, `${label}.${column} is empty`).toBe("—");
    } else {
      expect(shown, `${label}.${column}`).not.toBe("—");
    }
  }
}

const withComputed = facts.entities.filter((e) => e.columns.some((c) => c.computedKind));

for (const entity of withComputed) {
  test(`computed: ${entity.name}`, async ({ page }) => {
    const rollups = entity.columns.filter((c) => c.computedKind === "rollup");
    let record: Record<string, any> | undefined;
    if (rollups.length) {
      // The record with the most rows under its first rollup's child.
      const parsed = parseRollup(rollups[0]!.computedExpression);
      const column = (await meta(entity.apiSegment)).columns.find((c) => c.column_name === rollups[0]!.name)!;
      const child = entityByName.get(parsed.ok ? parsed.rollup.child : "")!;
      const rows = rowsOf((await api.get(`/bus/${child.apiSegment}?limit=100`)).data);
      const counts = new Map<string, number>();
      for (const r of rows) if (r[column.rollup.link_column]) counts.set(r[column.rollup.link_column], (counts.get(r[column.rollup.link_column]) ?? 0) + 1);
      const busiest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (busiest) record = (await api.get(`/bus/${entity.apiSegment}/${busiest}`)).data;
    }
    record ??= rowsOf((await api.get(`/bus/${entity.apiSegment}?limit=1`)).data)[0];
    test.skip(!record, `${entity.name} has no record`);

    // Nothing stores a computed value.
    for (const column of entity.columns.filter((c) => c.computedKind)) {
      expect(record![column.name], `${entity.name}.${column.name} is not in the API's record`).toBeUndefined();
    }

    const errors = watchErrors(page);
    await page.goto(`${routeOf(entity)}/${record!.id}`);
    const first = entity.columns.find((c) => c.computedKind)!.name;
    await expect(page.getByTestId(`computed-field-${first}`)).toBeVisible();
    const { values } = await expectedFor(entity.apiSegment, record!);
    // Rollups arrive with their rows; wait until they are drawn.
    const firstRollup = rollups[0]?.name;
    if (firstRollup && values[firstRollup] !== null) {
      await expect.poll(async () => shownValue(page, firstRollup), { timeout: 30_000 }).not.toBe("—");
    }
    await compareDrawn(page, entity.name, values);
    expect(errors()).toEqual([]);
  });
}

// ---- Live: a formula follows the input it reads, and a parent's rollup its child.

const liveChild = facts.entities.find((e) =>
  e.parent && e.columns.some((c) => c.computedKind === "calculated") &&
  entityByName.get(e.parent)!.columns.some((c) => c.computedKind === "rollup")
);

test("live: a formula recomputes while typing, and the parent's rollup follows the save", async ({ page }) => {
  test.skip(!liveChild, "the model has no line item with a formula under a parent with a rollup");
  const child = liveChild!;
  const parent = entityByName.get(child.parent!)!;
  const formula = child.columns.find((c) => c.computedKind === "calculated")!;
  const reads = [...(formula.computedExpression ?? "").matchAll(/@(\w+)@/g)].map((m) => m[1]!);
  const input = child.columns.find((c) => reads.includes(c.name) && (c.type === "decimal" || c.type === "integer") && !c.computedKind)!;
  expect(input, `${formula.name} reads a number a person types`).toBeTruthy();

  const line = rowsOf((await api.get(`/bus/${child.apiSegment}?limit=1`)).data)[0]!;
  const parentId = line[child.parentLink!];
  const parentBefore = (await api.get(`/bus/${parent.apiSegment}/${parentId}`)).data;
  const before = await expectedFor(parent.apiSegment, parentBefore);

  const errors = watchErrors(page);
  await page.goto(`${routeOf(child)}/${line.id}`);
  await page.getByRole("button", { name: /^Edit$/ }).first().click();
  const box = page.locator(`[name="${input.name}"]`).first();
  await expect(box).toBeEditable();
  const typed = Number(line[input.name] ?? 0) + 3;
  await box.fill(String(typed));
  const childColumns = (await meta(child.apiSegment)).columns;
  const expectedLive = computeValues(childColumns, { ...line, [input.name]: typed })[formula.name];
  await expect.poll(async () => numberShown(await shownValue(page, formula.name)), { timeout: 10_000 })
    .toBeCloseTo(Number(expectedLive), 2);

  await page.getByRole("button", { name: /^Save( Changes)?$/ }).first().click();
  await expect.poll(async () => Number((await api.get(`/bus/${child.apiSegment}/${line.id}`)).data[input.name]), { timeout: 20_000 })
    .toBe(typed);

  // Back on the parent: its rollups match the rows as they now are.
  const parentNow = (await api.get(`/bus/${parent.apiSegment}/${parentId}`)).data;
  const after = await expectedFor(parent.apiSegment, parentNow);
  const moved = Object.keys(after.values).find((k) => after.values[k] !== before.values[k]);
  await page.goto(`${routeOf(parent)}/${parentId}`);
  if (moved) {
    await expect.poll(async () => numberShown(await shownValue(page, moved)), { timeout: 30_000 })
      .toBeCloseTo(Number(after.values[moved]), 2);
  }
  await compareDrawn(page, parent.name, after.values);
  expect(errors()).toEqual([]);
});
