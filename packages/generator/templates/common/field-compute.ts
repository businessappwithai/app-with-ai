/**
 * Computed fields — a Rollup and a Calculated field, both drawn on the screen
 * and never stored.
 *
 *   %%field Order.total_amount   rollup: sum(OrderLine.line_amount)
 *   %%field Order.line_count     rollup: count(OrderLine)
 *   %%field Order.open_total     rollup: sum(OrderLine.line_amount) where @status@!cancelled
 *   %%field Account.won_value    rollup: sum(Opportunity.amount via account_id)
 *   %%field OrderLine.line_amount calculated: round(@quantity@ * @unit_price@, 2)
 *
 * A rollup aggregates a column of the child records of the record on screen:
 * `<fn>(<Child>[.<column>] [via <link_column>]) [where <field logic>]`, where
 * `fn` is `sum`, `avg`, `min`, `max` or `count`, and `where` is field logic
 * (`./field-logic`) read against each child row.
 *
 * A calculated field is a formula over the record's own fields:
 *
 * - operands: `@column@`, a number, a quoted text `'x'`;
 * - operators: `+ - * /`, unary minus, parentheses (usual precedence);
 * - functions: `round(x[, n])`, `abs(x)`, `min(…)`, `max(…)`, `coalesce(…)`,
 *   `concat(…)`, `days(a, b)` (whole days from b to a), and
 *   `if(<field logic>, then, else)`.
 *
 * An empty value is null; arithmetic with a null is null, and so is a division
 * by zero. `min`, `max` and the aggregates skip nulls; `concat` reads one as
 * the empty text.
 *
 * Neither is a column of the table. The server serves the definition and never
 * a value: the browser computes both from what it already holds — the record
 * being edited, and for a rollup the child rows its tab lists. This file is the
 * one reading of both: the checker validates with it, the generated backend
 * parses an administrator's edit and strips the values from a write with a
 * byte-identical copy (`packages/generator/templates/common/field-compute.ts`),
 * and the generated front end computes with that same copy. Its only import is
 * the field-logic module that sits beside it in every copy.
 */

import { contextValue, evaluateLogic, parseLogic } from "./field-logic";

export type ComputedKind = "rollup" | "calculated";
export type RollupFunction = "sum" | "avg" | "min" | "max" | "count";

export const ROLLUP_FUNCTIONS: RollupFunction[] = ["sum", "avg", "min", "max", "count"];
export const FORMULA_FUNCTIONS = [
  "round",
  "abs",
  "min",
  "max",
  "coalesce",
  "concat",
  "days",
  "if",
];

/* ------------------------------------------------------------------ rollup */

export interface RollupSpec {
  fn: RollupFunction;
  /** The child entity, as the model names it. */
  child: string;
  /** The child column aggregated; absent only for `count(Child)`. */
  column?: string;
  /** The child's link column, when the author named it with `via`. */
  via?: string;
  /** Field logic every counted child row must satisfy. */
  where?: string;
}

/*
 * Both members name both keys, so `result.error` reads without narrowing on
 * `ok` — the generated backend compiles without `strictNullChecks`.
 */
export type RollupParseResult =
  | { ok: true; rollup: RollupSpec; error?: undefined }
  | { ok: false; rollup?: undefined; error: string };

const ROLLUP_PATTERN =
  /^([A-Za-z]+)\s*\(\s*([A-Za-z_]\w*)(?:\s*\.\s*([A-Za-z_]\w*))?(?:\s+via\s+([A-Za-z_]\w*))?\s*\)\s*(?:where\s+([\s\S]+))?$/i;

export function parseRollup(source: string | null | undefined): RollupParseResult {
  const text = (source ?? "").trim();
  if (!text) return { ok: false, error: "The rollup is empty." };
  const match = ROLLUP_PATTERN.exec(text);
  if (!match) {
    return {
      ok: false,
      error:
        "A rollup is <fn>(<Child>.<column>) — sum, avg, min, max or count — optionally " +
        "followed by `via <link_column>` inside the brackets and `where <logic>` after them.",
    };
  }
  const fn = (match[1] as string).toLowerCase() as RollupFunction;
  if (!ROLLUP_FUNCTIONS.includes(fn)) {
    return { ok: false, error: `"${match[1]}" is not a rollup: use ${ROLLUP_FUNCTIONS.join(", ")}.` };
  }
  const column = match[3];
  if (!column && fn !== "count") {
    return { ok: false, error: `${fn}() needs a column: write ${fn}(${match[2]}.<column>).` };
  }
  const rollup: RollupSpec = { fn, child: match[2] as string };
  if (column) rollup.column = column;
  if (match[4]) rollup.via = match[4];
  const where = match[5] ? match[5].trim() : "";
  if (where) {
    const parsed = parseLogic(where);
    if (!parsed.ok) return { ok: false, error: `The where condition: ${parsed.error}` };
    rollup.where = where;
  }
  return { ok: true, rollup };
}

/** A value as a number, or null when it is empty or not a number. */
export function numericValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return null;
  const text = String(value).trim();
  if (text === "") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

/** Floating-point noise off a result: `0.1 + 0.2` is `0.3`. */
function clean(value: number): number {
  return Number(value.toFixed(10));
}

function dateTime(value: unknown): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/**
 * Aggregate child rows. Nulls are skipped. `sum` and `count` of no rows are 0;
 * `avg`, `min` and `max` of none are null. `min` and `max` also order dates,
 * and answer the date itself.
 */
export function aggregate(
  rollup: RollupSpec,
  rows: Array<Record<string, unknown>> | null | undefined
): number | string | null {
  const counted = (rows ?? []).filter(
    (row) => !rollup.where || evaluateLogic(rollup.where, row)
  );
  if (!rollup.column) return rollup.fn === "count" ? counted.length : null;
  const column = rollup.column;
  const present = counted
    .map((row) => row[column])
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== "");
  if (rollup.fn === "count") return present.length;
  const numbers = present.map(numericValue).filter((n): n is number => n !== null);
  if (rollup.fn === "sum") return clean(numbers.reduce((total, n) => total + n, 0));
  if (rollup.fn === "avg") {
    return numbers.length ? clean(numbers.reduce((total, n) => total + n, 0) / numbers.length) : null;
  }
  if (numbers.length && numbers.length === present.length) {
    return rollup.fn === "min" ? Math.min(...numbers) : Math.max(...numbers);
  }
  let best: unknown = null;
  let bestTime: number | null = null;
  for (const value of present) {
    const time = dateTime(value);
    if (time === null) continue;
    if (bestTime === null || (rollup.fn === "min" ? time < bestTime : time > bestTime)) {
      bestTime = time;
      best = value;
    }
  }
  if (best === null) return null;
  return best instanceof Date ? best.toISOString() : String(best);
}

/* ------------------------------------------------------------- calculated */

export type FormulaNode =
  | { kind: "number"; value: number }
  | { kind: "text"; value: string }
  | { kind: "variable"; name: string }
  | { kind: "negate"; operand: FormulaNode }
  | { kind: "binary"; op: "+" | "-" | "*" | "/"; left: FormulaNode; right: FormulaNode }
  | { kind: "call"; fn: string; args: FormulaNode[] }
  | { kind: "if"; condition: string; then: FormulaNode; otherwise: FormulaNode };

export interface ParsedFormula {
  root: FormulaNode;
  /** Every `@name@` the formula reads, its `if` conditions included. */
  variables: string[];
}

export type FormulaParseResult =
  | { ok: true; formula: ParsedFormula; error?: undefined }
  | { ok: false; formula?: undefined; error: string };

const ARITY: Record<string, [number, number]> = {
  round: [1, 2],
  abs: [1, 1],
  min: [1, Infinity],
  max: [1, Infinity],
  coalesce: [1, Infinity],
  concat: [1, Infinity],
  days: [2, 2],
};

class FormulaReader {
  pos = 0;
  variables: string[] = [];

  text: string;

  constructor(text: string) {
    this.text = text;
  }

  fail(message: string): never {
    throw new Error(message);
  }

  skip(): void {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos] as string)) this.pos++;
  }

  peek(): string {
    this.skip();
    return this.text[this.pos] ?? "";
  }

  expect(ch: string): void {
    if (this.peek() !== ch) {
      this.fail(this.pos >= this.text.length ? `Expected "${ch}" at the end.` : `Expected "${ch}" at "${this.text.slice(this.pos, this.pos + 12)}".`);
    }
    this.pos++;
  }

  note(name: string): void {
    if (!this.variables.includes(name)) this.variables.push(name);
  }

  expression(): FormulaNode {
    let left = this.term();
    for (;;) {
      const ch = this.peek();
      if (ch !== "+" && ch !== "-") return left;
      this.pos++;
      left = { kind: "binary", op: ch, left, right: this.term() };
    }
  }

  term(): FormulaNode {
    let left = this.unary();
    for (;;) {
      const ch = this.peek();
      if (ch !== "*" && ch !== "/") return left;
      this.pos++;
      left = { kind: "binary", op: ch, left, right: this.unary() };
    }
  }

  unary(): FormulaNode {
    if (this.peek() === "-") {
      this.pos++;
      return { kind: "negate", operand: this.unary() };
    }
    if (this.peek() === "+") {
      this.pos++;
      return this.unary();
    }
    return this.primary();
  }

  primary(): FormulaNode {
    const ch = this.peek();
    if (ch === "") this.fail("The formula ends where a value was expected.");
    if (ch === "(") {
      this.pos++;
      const inner = this.expression();
      this.expect(")");
      return inner;
    }
    if (ch === "@") {
      const end = this.text.indexOf("@", this.pos + 1);
      if (end < 0) this.fail("A variable is not closed: write it as @column@.");
      const name = this.text.slice(this.pos + 1, end).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) this.fail(`"@${name}@" is not a column name.`);
      this.pos = end + 1;
      this.note(name);
      return { kind: "variable", name };
    }
    if (ch === "'" || ch === '"') {
      const end = this.text.indexOf(ch, this.pos + 1);
      if (end < 0) this.fail("A quoted text is not closed.");
      const value = this.text.slice(this.pos + 1, end);
      this.pos = end + 1;
      return { kind: "text", value };
    }
    const number = /^(\d+(?:\.\d+)?|\.\d+)/.exec(this.text.slice(this.pos));
    if (number) {
      this.pos += (number[1] as string).length;
      return { kind: "number", value: Number(number[1]) };
    }
    const word = /^[A-Za-z_]\w*/.exec(this.text.slice(this.pos));
    if (word) {
      const fn = word[0].toLowerCase();
      this.pos += word[0].length;
      if (this.peek() !== "(") {
        this.fail(`"${word[0]}" is not a value: write a column as @${word[0]}@, a text as '${word[0]}'.`);
      }
      this.pos++;
      if (fn === "if") return this.conditional();
      const arity = ARITY[fn];
      if (!arity) this.fail(`"${word[0]}" is not a function: use ${FORMULA_FUNCTIONS.join(", ")}.`);
      const args: FormulaNode[] = [];
      if (this.peek() !== ")") {
        args.push(this.expression());
        while (this.peek() === ",") {
          this.pos++;
          args.push(this.expression());
        }
      }
      this.expect(")");
      if (args.length < arity[0] || args.length > arity[1]) {
        const wanted = arity[0] === arity[1] ? `${arity[0]}` : arity[1] === Infinity ? `at least ${arity[0]}` : `${arity[0]} or ${arity[1]}`;
        this.fail(`${fn}() takes ${wanted} value${wanted === "1" ? "" : "s"}, not ${args.length}.`);
      }
      return { kind: "call", fn, args };
    }
    return this.fail(`Unexpected "${ch}" at "${this.text.slice(this.pos, this.pos + 12)}".`);
  }

  /** `if(<field logic>, then, else)`: the condition is read up to its comma. */
  conditional(): FormulaNode {
    this.skip();
    const start = this.pos;
    let quote: string | null = null;
    let inVariable = false;
    let end = -1;
    for (let i = start; i < this.text.length; i++) {
      const c = this.text[i] as string;
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"') quote = c;
      else if (c === "@") inVariable = !inVariable;
      else if (!inVariable && c === ",") {
        end = i;
        break;
      }
    }
    if (end < 0) this.fail("if() takes a condition, a value and another value.");
    const condition = this.text.slice(start, end).trim();
    const parsed = parseLogic(condition);
    if (!parsed.ok) this.fail(`The if() condition: ${parsed.error}`);
    for (const name of parsed.logic.variables) this.note(name);
    this.pos = end + 1;
    const then = this.expression();
    this.expect(",");
    const otherwise = this.expression();
    this.expect(")");
    return { kind: "if", condition, then, otherwise };
  }
}

export function parseFormula(source: string | null | undefined): FormulaParseResult {
  const text = (source ?? "").trim();
  if (!text) return { ok: false, error: "The formula is empty." };
  const reader = new FormulaReader(text);
  try {
    const root = reader.expression();
    if (reader.peek() !== "") {
      return { ok: false, error: `Unexpected "${text.slice(reader.pos, reader.pos + 12)}" after the formula.` };
    }
    return { ok: true, formula: { root, variables: reader.variables } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The columns a formula reads. */
export function formulaVariables(source: string | null | undefined): string[] {
  const parsed = parseFormula(source);
  return parsed.ok ? parsed.formula.variables : [];
}

/** What a formula answers, where it can be told without a record. */
export function formulaResultKind(node: FormulaNode): "number" | "text" | "unknown" {
  switch (node.kind) {
    case "number":
    case "negate":
    case "binary":
      return "number";
    case "text":
      return "text";
    case "variable":
      return "unknown";
    case "call":
      if (node.fn === "concat") return "text";
      if (node.fn === "coalesce" || node.fn === "min" || node.fn === "max") {
        const kinds = node.args.map(formulaResultKind);
        return kinds.every((k) => k === kinds[0]) ? (kinds[0] as "number" | "text" | "unknown") : "unknown";
      }
      return "number";
    case "if": {
      const a = formulaResultKind(node.then);
      const b = formulaResultKind(node.otherwise);
      return a === b ? a : "unknown";
    }
  }
}

type FormulaValue = number | string | null;

function operand(value: unknown): FormulaValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? "Y" : "N";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const text = typeof value === "string" ? value : contextValue(value);
  if (text.trim() === "") return null;
  const number = numericValue(text);
  return number !== null && /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(text) ? number : text;
}

function evaluateNode(node: FormulaNode, record: Record<string, unknown>): FormulaValue {
  switch (node.kind) {
    case "number":
      return node.value;
    case "text":
      return node.value;
    case "variable":
      return operand(record[node.name]);
    case "negate": {
      const value = evaluateNode(node.operand, record);
      return typeof value === "number" ? -value : null;
    }
    case "binary": {
      const left = evaluateNode(node.left, record);
      const right = evaluateNode(node.right, record);
      if (typeof left !== "number" || typeof right !== "number") return null;
      if (node.op === "+") return left + right;
      if (node.op === "-") return left - right;
      if (node.op === "*") return left * right;
      return right === 0 ? null : left / right;
    }
    case "if":
      return evaluateLogic(node.condition, record)
        ? evaluateNode(node.then, record)
        : evaluateNode(node.otherwise, record);
    case "call": {
      const values = node.args.map((arg) => evaluateNode(arg, record));
      switch (node.fn) {
        case "round": {
          const value = values[0];
          const places = values.length > 1 ? values[1] : 0;
          if (typeof value !== "number" || typeof places !== "number") return null;
          const factor = Math.pow(10, Math.max(0, Math.min(10, Math.trunc(places))));
          return Math.round(value * factor + (value >= 0 ? 1e-9 : -1e-9)) / factor;
        }
        case "abs":
          return typeof values[0] === "number" ? Math.abs(values[0]) : null;
        case "min":
        case "max": {
          const numbers = values.filter((v): v is number => typeof v === "number");
          if (!numbers.length) return null;
          return node.fn === "min" ? Math.min(...numbers) : Math.max(...numbers);
        }
        case "coalesce":
          return values.find((v) => v !== null) ?? null;
        case "concat":
          return values.map((v) => (v === null ? "" : String(v))).join("");
        case "days": {
          const a = dateTime(values[0]);
          const b = dateTime(values[1]);
          if (a === null || b === null) return null;
          return Math.round((a - b) / 86400000);
        }
      }
      return null;
    }
  }
}

/**
 * Evaluate a formula against a record. A formula that does not parse is null —
 * the checker and the administrator's window refuse one, so reaching here means
 * a dictionary edited by hand, and a broken formula must draw nothing rather
 * than a wrong number.
 */
export function evaluateFormula(
  source: string | null | undefined,
  record: Record<string, unknown>
): number | string | null {
  const parsed = parseFormula(source);
  if (!parsed.ok) return null;
  const value = evaluateNode(parsed.formula.root, record);
  return typeof value === "number" ? (Number.isFinite(value) ? clean(value) : null) : value;
}

/* ------------------------------------------------------- the field list */

export interface ComputeField {
  column_name: string;
  name?: string | null;
  computed_kind?: string | null;
  computed_expression?: string | null;
}

export function isComputed(field: ComputeField | null | undefined): boolean {
  return !!field && (field.computed_kind === "rollup" || field.computed_kind === "calculated");
}

/** Parse either kind: the reason it does not parse, or null. */
export function computedExpressionError(
  kind: string | null | undefined,
  expression: string | null | undefined
): string | null {
  if (kind === "rollup") {
    const parsed = parseRollup(expression);
    return parsed.ok ? null : parsed.error;
  }
  if (kind === "calculated") {
    const parsed = parseFormula(expression);
    return parsed.ok ? null : parsed.error;
  }
  return `"${kind}" is not a computed kind: use rollup or calculated.`;
}

/**
 * The order calculated fields are evaluated in, and the cycle that prevents
 * one. A calculated field after every computed field it reads; rollups first,
 * because they read child rows and never the record's own computed values.
 */
export function computeOrder(fields: ComputeField[]): { order: string[]; cycle: string[] | null } {
  const computed = fields.filter(isComputed);
  const byName = new Map(computed.map((f) => [f.column_name, f]));
  const order: string[] = computed
    .filter((f) => f.computed_kind === "rollup")
    .map((f) => f.column_name);
  const state = new Map<string, "visiting" | "done">();
  for (const name of order) state.set(name, "done");
  let cycle: string[] | null = null;
  const visit = (name: string, path: string[]): void => {
    if (cycle) return;
    const seen = state.get(name);
    if (seen === "done") return;
    if (seen === "visiting") {
      cycle = path.slice(path.indexOf(name)).concat(name);
      return;
    }
    state.set(name, "visiting");
    const field = byName.get(name);
    for (const dep of formulaVariables(field ? field.computed_expression : null)) {
      if (byName.has(dep)) visit(dep, path.concat(name));
    }
    state.set(name, "done");
    order.push(name);
  };
  for (const field of computed) {
    if (field.computed_kind === "calculated") visit(field.column_name, []);
  }
  return { order, cycle };
}

/**
 * Whether a computed field needs the record's child rows: a rollup does, and so
 * does a formula that reads one, however indirectly. A list loads no child rows,
 * so such a field is on the form only — in a grid it could only ever be empty.
 */
export function readsRollup(fields: ComputeField[], column: string): boolean {
  const byName = new Map(fields.filter(isComputed).map((f) => [f.column_name, f]));
  const seen = new Set<string>();
  const visit = (name: string): boolean => {
    if (seen.has(name)) return false;
    seen.add(name);
    const field = byName.get(name);
    if (!field) return false;
    if (field.computed_kind === "rollup") return true;
    return formulaVariables(field.computed_expression).some(visit);
  };
  return visit(column);
}

/**
 * Every computed value of one record. `rowsByField` holds, for each rollup,
 * the child rows of this record (by the rollup's column name); a rollup with
 * no rows given — not loaded, or refused — is null, not zero, because the
 * screen does not know. A calculated field reads the record with the computed
 * values before it in place, so it may read a rollup or another formula.
 */
export function computeValues(
  fields: ComputeField[],
  record: Record<string, unknown>,
  rowsByField?: Record<string, Array<Record<string, unknown>> | null | undefined> | null
): Record<string, number | string | null> {
  const values: Record<string, number | string | null> = {};
  const { order, cycle } = computeOrder(fields);
  const byName = new Map(fields.filter(isComputed).map((f) => [f.column_name, f]));
  const context: Record<string, unknown> = { ...record };
  for (const name of order) {
    const field = byName.get(name);
    if (!field) continue;
    let value: number | string | null = null;
    if (field.computed_kind === "rollup") {
      const parsed = parseRollup(field.computed_expression);
      const rows = rowsByField ? rowsByField[name] : undefined;
      value = parsed.ok && rows ? aggregate(parsed.rollup, rows) : null;
    } else if (!cycle || !cycle.includes(name)) {
      value = evaluateFormula(field.computed_expression, context);
    }
    values[name] = value;
    context[name] = value;
  }
  for (const field of fields) {
    if (isComputed(field) && !(field.column_name in values)) values[field.column_name] = null;
  }
  return values;
}

/** A write without the computed columns: they are drawn, never stored. */
export function stripComputed<T extends Record<string, unknown>>(
  fields: ComputeField[],
  payload: T
): T {
  const computed = new Set(fields.filter(isComputed).map((f) => f.column_name));
  if (!computed.size) return payload;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(payload)) {
    if (!computed.has(key)) result[key] = payload[key];
  }
  return result as T;
}
