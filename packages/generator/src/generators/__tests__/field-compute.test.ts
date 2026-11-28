/**
 * Computed fields — a Rollup and a Calculated field, drawn on the screen and
 * never stored.
 *
 * `%%field <E>.<c> rollup: | calculated: <expression>` passes through the same
 * readers field logic does, and these tests hold them to one meaning: the
 * expressions themselves (common/language/field-compute.ts), the checker, the
 * parser, the dictionary both stacks seed from, the storage the generator does
 * *not* write, and the browser stack's JavaScript twin.
 *
 * Two properties matter most. A computed column has no storage — no table
 * column, no seed value, no report or rule built on it — and every copy of the
 * evaluator computes the same number from the same rows, so the form and the
 * browser application cannot show two different totals for one order.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import Handlebars from "handlebars";
import { describe, expect, it } from "vitest";
import { checkSource } from "../../../../../common/language/checker";
import * as canonical from "../../../../../common/language/field-compute";
import * as twin from "../../../templates/wasm/server/lib/field-compute.js";
import { DictionaryGenerator } from "../dictionary.generator";
import { buildModelBundle } from "../wasm/model-bundle";
import { parseModel } from "../../pipeline/parse-model";
import { TemplateLoader } from "../../templates/loader";
import { buildRuleModel } from "../../rules/rule-model";

const ROOT = join(import.meta.dirname, "../../../../..");
const FIXTURE = readFileSync(join(ROOT, "tests/test-data/computed-fields.eml.mmd"), "utf8");

const LINES = [
  { amount: "12.50", status: "captured", captured_at: "2026-01-02T10:00:00Z" },
  { amount: 0.1, status: "pending", captured_at: null },
  { amount: 0.2, status: "captured", captured_at: "2026-03-01T10:00:00Z" },
  { amount: null, status: "captured", captured_at: null },
];

/** [rollup, rows, expected] — results carry 10 decimals at most (no float noise). */
const ROLLUPS: Array<[string, Array<Record<string, unknown>>, unknown]> = [
  ["sum(Line.amount)", LINES, 12.8],
  // 0.1 + 0.2 is 0.3 here, not 0.30000000000000004.
  ["sum(Line.amount) where @status@=pending", LINES, 0.1],
  ["sum(Line.amount)", [], 0],
  ["count(Line)", LINES, 4],
  ["count(Line.amount)", LINES, 3],
  ["count(Line) where @status@=captured", LINES, 3],
  ["avg(Line.amount)", LINES, 4.2666666667],
  ["avg(Line.amount)", [], null],
  ["min(Line.amount)", LINES, 0.1],
  ["max(Line.amount)", LINES, 12.5],
  ["max(Line.captured_at)", LINES, "2026-03-01T10:00:00Z"],
  ["min(Line.captured_at)", LINES, "2026-01-02T10:00:00Z"],
];

/** [formula, record, expected] */
const FORMULAS: Array<[string, Record<string, unknown>, unknown]> = [
  ["@q@ * @p@", { q: "3", p: "19.99" }, 59.97],
  ["round(@q@ * @p@ * (1 - coalesce(@d@, 0) / 100), 2)", { q: 3, p: 19.99, d: null }, 59.97],
  ["round(@q@ * @p@ * (1 - coalesce(@d@, 0) / 100), 2)", { q: 3, p: 19.99, d: 10 }, 53.97],
  ["1 + 2 * 3", {}, 7],
  ["(1 + 2) * 3", {}, 9],
  ["-@a@ + 1", { a: 4 }, -3],
  ["@a@ / @b@", { a: 1, b: 0 }, null],
  ["@a@ + @b@", { a: 1 }, null],
  ["coalesce(@a@, @b@, 5)", { b: 2 }, 2],
  ["max(@a@ - @b@, 0)", { a: 1, b: 9 }, 0],
  ["min(@a@, @b@)", { a: 1, b: null }, 1],
  ["abs(@a@)", { a: -2.5 }, 2.5],
  ["round(@a@)", { a: 2.5 }, 3],
  ["concat(@first@, ' ', @last@)", { first: "Ada", last: "Lovelace" }, "Ada Lovelace"],
  ["concat('#', @n@)", { n: null }, "#"],
  ["days(@due@, @start@)", { due: "2026-03-01", start: "2026-02-01" }, 28],
  ["if(@status@=won, @amount@, 0)", { status: "won", amount: "40" }, 40],
  ["if(@status@=won & @amount@>10, 'big', 'small')", { status: "won", amount: 5 }, "small"],
  ["0.1 + 0.2", {}, 0.3],
];

describe("common/language/field-compute.ts", () => {
  it.each(ROLLUPS)("%s over its rows", (source, rows, expected) => {
    const parsed = canonical.parseRollup(source);
    expect(parsed.ok).toBe(true);
    expect(canonical.aggregate(parsed.rollup!, rows)).toEqual(expected);
  });

  it.each(FORMULAS)("%s against %j is %j", (formula, record, expected) => {
    expect(canonical.evaluateFormula(formula, record)).toEqual(expected);
  });

  it("reads a rollup's parts, `via` and `where` included", () => {
    expect(canonical.parseRollup("sum(Opportunity.amount via account_id) where @stage@=won"))
      .toEqual({
        ok: true,
        rollup: {
          fn: "sum",
          child: "Opportunity",
          column: "amount",
          via: "account_id",
          where: "@stage@=won",
        },
      });
  });

  it.each([
    ["", "empty"],
    ["sumx(Line.a)", "not a rollup"],
    ["sum(Line)", "needs a column"],
    ["sum(Line.a) where @x@", "where condition"],
    ["total of lines", "A rollup is"],
  ])("refuses the rollup %j (%s)", (source, reason) => {
    const parsed = canonical.parseRollup(source);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain(reason);
  });

  it.each([
    ["", "empty"],
    ["1 +", "ends where a value was expected"],
    ["foo(1)", "is not a function"],
    ["round(1, 2, 3)", "takes 1 or 2 values"],
    ["quantity * 2", "is not a value"],
    ["@a@ @b@", "after the formula"],
    ["if(@a@, 1, 2)", "if() condition"],
  ])("refuses the formula %j (%s)", (source, reason) => {
    const parsed = canonical.parseFormula(source);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain(reason);
  });

  it("lists the columns a formula reads, its if() condition included", () => {
    expect(canonical.formulaVariables("if(@s@=won, @a@ * @b@, @a@)")).toEqual(["s", "a", "b"]);
  });

  it("orders formulas after what they read, and finds a circle", () => {
    const fields = [
      { column_name: "grand", computed_kind: "calculated", computed_expression: "@total@ + 1" },
      { column_name: "total", computed_kind: "rollup", computed_expression: "sum(L.a)" },
      { column_name: "net", computed_kind: "calculated", computed_expression: "@grand@ - 1" },
    ];
    expect(canonical.computeOrder(fields)).toEqual({ order: ["total", "grand", "net"], cycle: null });
    expect(
      canonical.computeOrder([
        { column_name: "a", computed_kind: "calculated", computed_expression: "@b@" },
        { column_name: "b", computed_kind: "calculated", computed_expression: "@a@" },
      ]).cycle
    ).toEqual(["a", "b", "a"]);
  });

  it("computes a record: a formula reads a rollup, a rollup with no rows is unknown", () => {
    const fields = [
      { column_name: "subtotal", computed_kind: "rollup", computed_expression: "sum(L.amount)" },
      {
        column_name: "total",
        computed_kind: "calculated",
        computed_expression: "@subtotal@ + coalesce(@shipping@, 0)",
      },
      { column_name: "shipping", computed_kind: null },
    ];
    expect(canonical.computeValues(fields, { shipping: "5" }, { subtotal: LINES })).toEqual({
      subtotal: 12.8,
      total: 17.8,
    });
    // Not loaded, or refused: null — never a zero the screen did not compute.
    expect(canonical.computeValues(fields, { shipping: 5 }, {})).toEqual({
      subtotal: null,
      total: null,
    });
  });

  it("knows which formulas need child rows, however indirectly — those stay off a list", () => {
    const fields = [
      { column_name: "subtotal", computed_kind: "rollup", computed_expression: "sum(L.a)" },
      { column_name: "total", computed_kind: "calculated", computed_expression: "@subtotal@ + 1" },
      { column_name: "due", computed_kind: "calculated", computed_expression: "@total@ - @paid@" },
      { column_name: "line", computed_kind: "calculated", computed_expression: "@q@ * @p@" },
    ];
    expect(canonical.readsRollup(fields, "subtotal")).toBe(true);
    expect(canonical.readsRollup(fields, "total")).toBe(true);
    expect(canonical.readsRollup(fields, "due")).toBe(true);
    expect(canonical.readsRollup(fields, "line")).toBe(false);
    expect(twin.readsRollup(fields, "due")).toBe(true);
    expect(twin.readsRollup(fields, "line")).toBe(false);
  });

  it("strips computed values from a write and keeps everything else", () => {
    const fields = [
      { column_name: "subtotal", computed_kind: "rollup" },
      { column_name: "total", computed_kind: "calculated" },
      { column_name: "shipping" },
    ];
    expect(canonical.stripComputed(fields, { subtotal: 1, total: 2, shipping: 3 })).toEqual({
      shipping: 3,
    });
  });
});

describe("the copies the generated applications carry", () => {
  it("NestJS: templates/common/field-compute.ts is common/language/field-compute.ts, byte for byte", () => {
    expect(readFileSync(join(ROOT, "packages/generator/templates/common/field-compute.ts"), "utf8"))
      .toBe(readFileSync(join(ROOT, "common/language/field-compute.ts"), "utf8"));
  });

  it("browser: the JavaScript twin exports the same functions", () => {
    expect(Object.keys(twin).sort()).toEqual(Object.keys(canonical).sort());
  });

  it.each(ROLLUPS)("browser twin: %s over its rows", (source, rows, expected) => {
    expect(twin.aggregate(twin.parseRollup(source).rollup, rows)).toEqual(expected);
  });

  it.each(FORMULAS)("browser twin: %s against %j is %j", (formula, record, expected) => {
    expect(twin.evaluateFormula(formula, record)).toEqual(expected);
  });
});

const codes = (source: string) => checkSource(source).issues.map((issue) => issue.code);

describe("the checker", () => {
  it("accepts the fixture: every rollup function, where, via, a rolled-up formula", () => {
    expect(codes(FIXTURE).filter((code) => /^EML1[89]\d$/.test(code))).toEqual([]);
  });

  const withLine = (line: string) =>
    FIXTURE.replace("    %%entity OrderItem parent: Order\n", `    %%entity OrderItem parent: Order\n${line}\n`);

  it.each([
    ["EML180", "    %%field Order.discount_amount rollup: sumx(OrderItem.quantity)"],
    ["EML181", "    %%field Order.discount_amount rollup: sum(Nowhere.quantity)"],
    ["EML181", "    %%field Order.discount_amount rollup: sum(Category.name)"],
    ["EML182", "    %%field Order.discount_amount rollup: sum(OrderItem.nope)"],
    ["EML182", "    %%field Order.discount_amount rollup: sum(Payment.method)"],
    ["EML183", "    %%field Order.discount_amount rollup: sum(OrderItem.quantity via quantity)"],
    ["EML184", "    %%field Order.discount_amount rollup: sum(OrderItem.quantity) where @nope@=1"],
    ["EML185", "    %%field Customer.phone rollup: sum(Order.subtotal)"],
    ["EML186", "    %%field Customer.phone rollup: count(Order)"],
    ["EML190", "    %%field Product.sku calculated: 1 +"],
    ["EML191", "    %%field Product.sku calculated: @nope@ * 2"],
    ["EML192", "    %%field Product.stock_qty calculated: @stock_qty@ + 1"],
    ["EML193", "    %%field Product.name calculated: @unit_price@ * 2"],
    ["EML195", "    %%field Product.unit_price calculated: @stock_qty@ * 2"],
    ["EML196", "    %%field Order.subtotal calculated: 1"],
  ])("reports %s for %s", (code, line) => {
    expect(codes(withLine(line))).toContain(code);
  });

  it("reports EML197 when a report reads a computed column", () => {
    const report = `%%report order_balance title: Order balance entity: Order sql: SELECT balance_due FROM bus_order`;
    expect(codes(`${FIXTURE}\n${report}\n`)).toContain("EML197");
  });
});

const parsed = parseModel(FIXTURE);
const order = parsed.entities.find((entity) => entity.name === "Order")!;
const item = parsed.entities.find((entity) => entity.name === "OrderItem")!;

describe("the parser", () => {
  it("marks computed columns and frees them of storage constraints", () => {
    const subtotal = order.attributes.find((a) => a.name === "subtotal")!;
    expect(subtotal).toMatchObject({
      computedKind: "rollup",
      computedExpression: "sum(OrderItem.line_total)",
      required: false,
      unique: false,
      rollup: {
        fn: "sum",
        childEntity: "OrderItem",
        childColumn: "line_total",
        linkColumn: "order_id",
      },
    });
    expect(item.attributes.find((a) => a.name === "line_total")).toMatchObject({
      computedKind: "calculated",
      computedExpression: "round(@quantity@ * @unit_price@, 2)",
    });
  });

  it("resolves a non-line-item child by its one key, and keeps `where`", () => {
    expect(order.attributes.find((a) => a.name === "paid_amount")?.rollup).toEqual({
      fn: "sum",
      childEntity: "Payment",
      childColumn: "amount",
      linkColumn: "order_id",
      where: "@status@=captured",
    });
  });

  it("leaves a column the checker refuses as a stored one", () => {
    const broken = parseModel(
      FIXTURE.replace(
        "%%field Order.item_count rollup: count(OrderItem)",
        "%%field Order.item_count rollup: count(Nowhere)"
      )
    );
    const column = broken.entities
      .find((entity) => entity.name === "Order")!
      .attributes.find((a) => a.name === "item_count");
    expect(column?.computedKind).toBeUndefined();
  });
});

describe("storage: a computed column is never written anywhere", () => {
  new TemplateLoader(join(import.meta.dirname, "../../../templates"));
  const render = (relative: string, context: Record<string, unknown>) =>
    Handlebars.compile(
      readFileSync(join(import.meta.dirname, "../../../templates", relative), "utf8"),
      { noEscape: true }
    )(context);

  it("has no column in the NestJS table", () => {
    const ddl = render("common/migrations/bus-tables.migration.ts.hbs", {
      now: "x",
      entities: [{ ...order, displayName: "Order", tableName: "bus_order" }],
    });
    expect(ddl).toContain("discount_amount");
    for (const column of ["subtotal", "total_amount", "item_count", "balance_due", "paid_amount"]) {
      expect(ddl).not.toMatch(new RegExp(`\\b${column}\\b`));
    }
  });

  it("has no column in the browser stack's schema, and model.json marks it", () => {
    const { model, schema } = buildModelBundle(parsed, { name: "Store", description: "x" } as never);
    const orderTable = schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS bus_order ("));
    const block = orderTable.slice(0, orderTable.indexOf(");"));
    expect(block).toContain("discount_amount");
    expect(block).not.toContain("subtotal");
    expect(block).not.toContain("balance_due");
    expect(
      model.dictionary.columns.find((c) => c.columnName === "subtotal" && c.tableName === "bus_order")
    ).toMatchObject({ computedKind: "rollup", computedExpression: "sum(OrderItem.line_total)" });
  });

  it("is not offered to the rule and workflow editors, which run in the API", () => {
    const rules = buildRuleModel({ entities: parsed.entities, workflows: [], sagas: [] } as never);
    const fields = rules.find((entity) => entity.name === "Order")!.fields.map((f) => f.name);
    expect(fields).toContain("discount_amount");
    expect(fields).not.toContain("subtotal");
    expect(fields).not.toContain("balance_due");
  });
});

describe("the dictionary", () => {
  const dictionary = new DictionaryGenerator({ randomizeFieldOrder: false }).generateDictionaryContext(parsed.entities);
  const column = (name: string) => dictionary.sysColumns.find((c) => c.column_name === name)!;
  const field = (name: string) =>
    dictionary.sysFields.find((f) => f._columnRef === column(name)._tempId)!;

  it("records the kind and the expression on sys_column, never updateable", () => {
    expect(column("subtotal")).toMatchObject({
      computed_kind: "rollup",
      computed_expression: "sum(OrderItem.line_total)",
      is_updateable: false,
    });
    expect(column("discount_amount").computed_kind).toBeUndefined();
  });

  it("draws the field read-only, and a rollup on the form only", () => {
    expect(field("subtotal")).toMatchObject({ is_read_only: true, is_displayed_grid: false });
    expect(field("total_amount")).toMatchObject({ is_read_only: true });
    expect(field("total_amount").is_displayed_grid).not.toBe(false);
  });
});
