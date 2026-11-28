/**
 * Computed fields — a Rollup and a Calculated field — for the browser application.
 *
 * The JavaScript twin of common/language/field-compute.ts, which is the one reading
 * of both: a rollup (`sum(OrderLine.line_amount) where @status@!cancelled`) and a
 * formula (`round(@quantity@ * @unit_price@, 2)`). This runtime is plain JavaScript
 * with no build step, so it carries its own copy, built from the TypeScript with
 * `bun build common/language/field-compute.ts --format esm --no-bundle` under this
 * header (the import below then names `./field-logic.js`). `field-compute.test.ts`
 * runs the same cases through both and fails if they disagree. Change the
 * TypeScript first, then rebuild this.
 *
 * Imported by the server (bus.routes.js drops computed values from a write and
 * refuses to filter by one) and by the form (ui/views/entity-form.js draws them
 * as the record is edited).
 */

import { contextValue, evaluateLogic, parseLogic } from "./field-logic.js";
export const ROLLUP_FUNCTIONS = ["sum", "avg", "min", "max", "count"];
export const FORMULA_FUNCTIONS = [
  "round",
  "abs",
  "min",
  "max",
  "coalesce",
  "concat",
  "days",
  "if"
];
const ROLLUP_PATTERN = /^([A-Za-z]+)\s*\(\s*([A-Za-z_]\w*)(?:\s*\.\s*([A-Za-z_]\w*))?(?:\s+via\s+([A-Za-z_]\w*))?\s*\)\s*(?:where\s+([\s\S]+))?$/i;
export function parseRollup(source) {
  const text = (source ?? "").trim();
  if (!text)
    return { ok: false, error: "The rollup is empty." };
  const match = ROLLUP_PATTERN.exec(text);
  if (!match) {
    return {
      ok: false,
      error: "A rollup is <fn>(<Child>.<column>) — sum, avg, min, max or count — optionally " + "followed by `via <link_column>` inside the brackets and `where <logic>` after them."
    };
  }
  const fn = match[1].toLowerCase();
  if (!ROLLUP_FUNCTIONS.includes(fn)) {
    return { ok: false, error: `"${match[1]}" is not a rollup: use ${ROLLUP_FUNCTIONS.join(", ")}.` };
  }
  const column = match[3];
  if (!column && fn !== "count") {
    return { ok: false, error: `${fn}() needs a column: write ${fn}(${match[2]}.<column>).` };
  }
  const rollup = { fn, child: match[2] };
  if (column)
    rollup.column = column;
  if (match[4])
    rollup.via = match[4];
  const where = match[5] ? match[5].trim() : "";
  if (where) {
    const parsed = parseLogic(where);
    if (!parsed.ok)
      return { ok: false, error: `The where condition: ${parsed.error}` };
    rollup.where = where;
  }
  return { ok: true, rollup };
}
export function numericValue(value) {
  if (value === null || value === undefined)
    return null;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean")
    return null;
  const text = String(value).trim();
  if (text === "")
    return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
function clean(value) {
  return Number(value.toFixed(10));
}
function dateTime(value) {
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value))
    return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}
export function aggregate(rollup, rows) {
  const counted = (rows ?? []).filter((row) => !rollup.where || evaluateLogic(rollup.where, row));
  if (!rollup.column)
    return rollup.fn === "count" ? counted.length : null;
  const column = rollup.column;
  const present = counted.map((row) => row[column]).filter((value) => value !== null && value !== undefined && String(value).trim() !== "");
  if (rollup.fn === "count")
    return present.length;
  const numbers = present.map(numericValue).filter((n) => n !== null);
  if (rollup.fn === "sum")
    return clean(numbers.reduce((total, n) => total + n, 0));
  if (rollup.fn === "avg") {
    return numbers.length ? clean(numbers.reduce((total, n) => total + n, 0) / numbers.length) : null;
  }
  if (numbers.length && numbers.length === present.length) {
    return rollup.fn === "min" ? Math.min(...numbers) : Math.max(...numbers);
  }
  let best = null;
  let bestTime = null;
  for (const value of present) {
    const time = dateTime(value);
    if (time === null)
      continue;
    if (bestTime === null || (rollup.fn === "min" ? time < bestTime : time > bestTime)) {
      bestTime = time;
      best = value;
    }
  }
  if (best === null)
    return null;
  return best instanceof Date ? best.toISOString() : String(best);
}
const ARITY = {
  round: [1, 2],
  abs: [1, 1],
  min: [1, 1 / 0],
  max: [1, 1 / 0],
  coalesce: [1, 1 / 0],
  concat: [1, 1 / 0],
  days: [2, 2]
};

class FormulaReader {
  pos = 0;
  variables = [];
  text;
  constructor(text) {
    this.text = text;
  }
  fail(message) {
    throw new Error(message);
  }
  skip() {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos]))
      this.pos++;
  }
  peek() {
    this.skip();
    return this.text[this.pos] ?? "";
  }
  expect(ch) {
    if (this.peek() !== ch) {
      this.fail(this.pos >= this.text.length ? `Expected "${ch}" at the end.` : `Expected "${ch}" at "${this.text.slice(this.pos, this.pos + 12)}".`);
    }
    this.pos++;
  }
  note(name) {
    if (!this.variables.includes(name))
      this.variables.push(name);
  }
  expression() {
    let left = this.term();
    for (;; ) {
      const ch = this.peek();
      if (ch !== "+" && ch !== "-")
        return left;
      this.pos++;
      left = { kind: "binary", op: ch, left, right: this.term() };
    }
  }
  term() {
    let left = this.unary();
    for (;; ) {
      const ch = this.peek();
      if (ch !== "*" && ch !== "/")
        return left;
      this.pos++;
      left = { kind: "binary", op: ch, left, right: this.unary() };
    }
  }
  unary() {
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
  primary() {
    const ch = this.peek();
    if (ch === "")
      this.fail("The formula ends where a value was expected.");
    if (ch === "(") {
      this.pos++;
      const inner = this.expression();
      this.expect(")");
      return inner;
    }
    if (ch === "@") {
      const end = this.text.indexOf("@", this.pos + 1);
      if (end < 0)
        this.fail("A variable is not closed: write it as @column@.");
      const name = this.text.slice(this.pos + 1, end).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
        this.fail(`"@${name}@" is not a column name.`);
      this.pos = end + 1;
      this.note(name);
      return { kind: "variable", name };
    }
    if (ch === "'" || ch === '"') {
      const end = this.text.indexOf(ch, this.pos + 1);
      if (end < 0)
        this.fail("A quoted text is not closed.");
      const value = this.text.slice(this.pos + 1, end);
      this.pos = end + 1;
      return { kind: "text", value };
    }
    const number = /^(\d+(?:\.\d+)?|\.\d+)/.exec(this.text.slice(this.pos));
    if (number) {
      this.pos += number[1].length;
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
      if (fn === "if")
        return this.conditional();
      const arity = ARITY[fn];
      if (!arity)
        this.fail(`"${word[0]}" is not a function: use ${FORMULA_FUNCTIONS.join(", ")}.`);
      const args = [];
      if (this.peek() !== ")") {
        args.push(this.expression());
        while (this.peek() === ",") {
          this.pos++;
          args.push(this.expression());
        }
      }
      this.expect(")");
      if (args.length < arity[0] || args.length > arity[1]) {
        const wanted = arity[0] === arity[1] ? `${arity[0]}` : arity[1] === 1 / 0 ? `at least ${arity[0]}` : `${arity[0]} or ${arity[1]}`;
        this.fail(`${fn}() takes ${wanted} value${wanted === "1" ? "" : "s"}, not ${args.length}.`);
      }
      return { kind: "call", fn, args };
    }
    return this.fail(`Unexpected "${ch}" at "${this.text.slice(this.pos, this.pos + 12)}".`);
  }
  conditional() {
    this.skip();
    const start = this.pos;
    let quote = null;
    let inVariable = false;
    let end = -1;
    for (let i = start;i < this.text.length; i++) {
      const c = this.text[i];
      if (quote) {
        if (c === quote)
          quote = null;
        continue;
      }
      if (c === "'" || c === '"')
        quote = c;
      else if (c === "@")
        inVariable = !inVariable;
      else if (!inVariable && c === ",") {
        end = i;
        break;
      }
    }
    if (end < 0)
      this.fail("if() takes a condition, a value and another value.");
    const condition = this.text.slice(start, end).trim();
    const parsed = parseLogic(condition);
    if (!parsed.ok)
      this.fail(`The if() condition: ${parsed.error}`);
    for (const name of parsed.logic.variables)
      this.note(name);
    this.pos = end + 1;
    const then = this.expression();
    this.expect(",");
    const otherwise = this.expression();
    this.expect(")");
    return { kind: "if", condition, then, otherwise };
  }
}
export function parseFormula(source) {
  const text = (source ?? "").trim();
  if (!text)
    return { ok: false, error: "The formula is empty." };
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
export function formulaVariables(source) {
  const parsed = parseFormula(source);
  return parsed.ok ? parsed.formula.variables : [];
}
export function formulaResultKind(node) {
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
      if (node.fn === "concat")
        return "text";
      if (node.fn === "coalesce" || node.fn === "min" || node.fn === "max") {
        const kinds = node.args.map(formulaResultKind);
        return kinds.every((k) => k === kinds[0]) ? kinds[0] : "unknown";
      }
      return "number";
    case "if": {
      const a = formulaResultKind(node.then);
      const b = formulaResultKind(node.otherwise);
      return a === b ? a : "unknown";
    }
  }
}
function operand(value) {
  if (value === null || value === undefined)
    return null;
  if (typeof value === "number")
    return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean")
    return value ? "Y" : "N";
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const text = typeof value === "string" ? value : contextValue(value);
  if (text.trim() === "")
    return null;
  const number = numericValue(text);
  return number !== null && /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/.test(text) ? number : text;
}
function evaluateNode(node, record) {
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
      if (typeof left !== "number" || typeof right !== "number")
        return null;
      if (node.op === "+")
        return left + right;
      if (node.op === "-")
        return left - right;
      if (node.op === "*")
        return left * right;
      return right === 0 ? null : left / right;
    }
    case "if":
      return evaluateLogic(node.condition, record) ? evaluateNode(node.then, record) : evaluateNode(node.otherwise, record);
    case "call": {
      const values = node.args.map((arg) => evaluateNode(arg, record));
      switch (node.fn) {
        case "round": {
          const value = values[0];
          const places = values.length > 1 ? values[1] : 0;
          if (typeof value !== "number" || typeof places !== "number")
            return null;
          const factor = Math.pow(10, Math.max(0, Math.min(10, Math.trunc(places))));
          return Math.round(value * factor + (value >= 0 ? 0.000000001 : -0.000000001)) / factor;
        }
        case "abs":
          return typeof values[0] === "number" ? Math.abs(values[0]) : null;
        case "min":
        case "max": {
          const numbers = values.filter((v) => typeof v === "number");
          if (!numbers.length)
            return null;
          return node.fn === "min" ? Math.min(...numbers) : Math.max(...numbers);
        }
        case "coalesce":
          return values.find((v) => v !== null) ?? null;
        case "concat":
          return values.map((v) => v === null ? "" : String(v)).join("");
        case "days": {
          const a = dateTime(values[0]);
          const b = dateTime(values[1]);
          if (a === null || b === null)
            return null;
          return Math.round((a - b) / 86400000);
        }
      }
      return null;
    }
  }
}
export function evaluateFormula(source, record) {
  const parsed = parseFormula(source);
  if (!parsed.ok)
    return null;
  const value = evaluateNode(parsed.formula.root, record);
  return typeof value === "number" ? Number.isFinite(value) ? clean(value) : null : value;
}
export function isComputed(field) {
  return !!field && (field.computed_kind === "rollup" || field.computed_kind === "calculated");
}
export function computedExpressionError(kind, expression) {
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
export function computeOrder(fields) {
  const computed = fields.filter(isComputed);
  const byName = new Map(computed.map((f) => [f.column_name, f]));
  const order = computed.filter((f) => f.computed_kind === "rollup").map((f) => f.column_name);
  const state = new Map;
  for (const name of order)
    state.set(name, "done");
  let cycle = null;
  const visit = (name, path) => {
    if (cycle)
      return;
    const seen = state.get(name);
    if (seen === "done")
      return;
    if (seen === "visiting") {
      cycle = path.slice(path.indexOf(name)).concat(name);
      return;
    }
    state.set(name, "visiting");
    const field = byName.get(name);
    for (const dep of formulaVariables(field ? field.computed_expression : null)) {
      if (byName.has(dep))
        visit(dep, path.concat(name));
    }
    state.set(name, "done");
    order.push(name);
  };
  for (const field of computed) {
    if (field.computed_kind === "calculated")
      visit(field.column_name, []);
  }
  return { order, cycle };
}
export function readsRollup(fields, column) {
  const byName = new Map(fields.filter(isComputed).map((f) => [f.column_name, f]));
  const seen = new Set;
  const visit = (name) => {
    if (seen.has(name))
      return false;
    seen.add(name);
    const field = byName.get(name);
    if (!field)
      return false;
    if (field.computed_kind === "rollup")
      return true;
    return formulaVariables(field.computed_expression).some(visit);
  };
  return visit(column);
}
export function computeValues(fields, record, rowsByField) {
  const values = {};
  const { order, cycle } = computeOrder(fields);
  const byName = new Map(fields.filter(isComputed).map((f) => [f.column_name, f]));
  const context = { ...record };
  for (const name of order) {
    const field = byName.get(name);
    if (!field)
      continue;
    let value = null;
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
    if (isComputed(field) && !(field.column_name in values))
      values[field.column_name] = null;
  }
  return values;
}
export function stripComputed(fields, payload) {
  const computed = new Set(fields.filter(isComputed).map((f) => f.column_name));
  if (!computed.size)
    return payload;
  const result = {};
  for (const key of Object.keys(payload)) {
    if (!computed.has(key))
      result[key] = payload[key];
  }
  return result;
}
