/**
 * Computed fields in the generated NestJS + TanStack application — the joints
 * that only exist once the templates are rendered.
 *
 * A rollup or a calculated field has no column, so three things have to hold or
 * the feature breaks in a way that looks like something else: the API drops the
 * value the form sends back (else every save writes to a column that does not
 * exist), it refuses to filter or sort by one with a code the error catalogue
 * names (else a database error, or FORBIDDEN on the way out), and the form and
 * the record screen compute it from rows they already hold, invalidated when a
 * child changes (else a total that lags its lines for a minute).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TEMPLATES = join(import.meta.dirname, "../../../templates");
const read = (relative: string) => readFileSync(join(TEMPLATES, relative), "utf8");
const BACKEND = "tanstack-start-nestjs/backend/src";
const FRONTEND = "tanstack-start-nestjs/frontend/src";

describe("the API serves the definition and never stores the value", () => {
  const service = read(`${BACKEND}/modules/bus/bus.service.ts.hbs`);

  it("reads computed_kind and computed_expression and serves them, with the rollup resolved", () => {
    expect(service).toContain("'sys_column.computed_kind'");
    expect(service).toContain("'sys_column.computed_expression'");
    expect(service).toContain("col.rollup = await this.resolveRollup(table.table_name, col.computed_expression)");
  });

  it("makes a computed field read-only, never updateable, and keeps a rollup off the list", () => {
    expect(service).toContain("is_updateable: isStateField || computedKind ? false : col.is_updateable");
    expect(service).toContain("is_read_only: isStateField || computedKind ? true");
    expect(service).toContain("computedKind !== 'rollup'");
  });

  it("drops computed values from every write: validateData, create and update", () => {
    expect(service).toContain("if (isComputed(column)) delete data[column.column_name];");
    expect(service.match(/this\.withoutComputed\(/g)?.length).toBe(2);
  });

  it("refuses to filter or sort by a computed column, on the list endpoint", () => {
    expect(service).toContain("code: 'COMPUTED_FIELD_NOT_QUERYABLE'");
    expect(read(`${BACKEND}/modules/bus/bus.controller.ts.hbs`)).toContain(
      "await this.busService.assertQueryable(entity, ["
    );
  });

  it("names the refusal in the error catalogue and the log spec, or it would leave as FORBIDDEN", () => {
    expect(read(`${BACKEND}/common/errors/catalogue.ts`)).toContain("COMPUTED_FIELD_NOT_QUERYABLE:");
    const spec = readFileSync(join(TEMPLATES, "../../core/src/logging/log-spec.json"), "utf8");
    expect(spec).toContain('"code": "COMPUTED_FIELD_NOT_QUERYABLE"');
  });

  it("validates an administrator's edit, and refuses turning a stored column computed or back", () => {
    const sys = read(`${BACKEND}/modules/sys/sys.service.ts.hbs`);
    expect(sys).toContain("computedExpressionError(kind, expression)");
    expect(sys).toContain("computeOrder(next)");
    expect(sys).toContain("A stored column cannot become a computed one");
    expect(sys).toContain("A computed column cannot become a stored one");
    // A computed column has no table column: no ALTER TABLE for one.
    expect(sys).toContain("if (!computed) {");
    expect(sys).toContain("!isVirtual && 'is_mandatory' in data");
  });

  it("runs the migration that adds the dictionary columns", () => {
    const generator = readFileSync(
      join(import.meta.dirname, "../../generators/tanstack-start-nestjs/nestjs-backend.generator.ts"),
      "utf8"
    );
    expect(generator).toContain('template: "src/migrations/026_computed_columns.ts.hbs"');
    expect(read(`${BACKEND}/migrations/026_computed_columns.ts.hbs`)).toContain(
      "ADD COLUMN IF NOT EXISTS computed_kind"
    );
  });
});

describe("the browser computes, from rows it already holds", () => {
  const form = read(`${FRONTEND}/components/forms/dynamic-form.tsx`);
  const shell = read(`${FRONTEND}/components/admin/ad-detail-shell.tsx`);
  const hook = read(`${FRONTEND}/hooks/use-rollup-rows.ts`);

  it("the form computes before field logic, so logic may read a computed value", () => {
    expect(form).toContain("computeValues(dictionaryFields, record, rollupRows)");
    expect(form).toContain("const context = { ...(parentContext ?? {}), ...record, ...computed };");
  });

  it("draws a computed field as an output, never an input, and sends it on neither submit path", () => {
    expect(form).toContain("if (isComputed(field)) return <ComputedFieldView");
    expect(form).toContain("!field.included_tab && !isComputed(field)");
    expect(form.match(/stripComputed\(dictionaryFields, filteredValues\)/g)?.length).toBe(2);
  });

  it("the rollup hook shares the child tab's query key, so the two are one fetch", () => {
    expect(hook).toContain('return ["ad-child", endpoint, parentId, link ?? ""] as const;');
    expect(shell).toContain("queryKey: childRowsKey(childLevel.endpoint, parentId, childLevel.parentField)");
    expect(shell).toContain("rollupRows={rollupRows}");
  });

  it("reads every page of child rows before computing a total", () => {
    expect(hook).toContain("enabled: enabled && total > CHILD_ROWS_LIMIT");
  });

  it("a child's save or delete refreshes every parent's tab and rollups", () => {
    expect(shell.match(/invalidateQueries\(\{ queryKey: \["ad-child"\] \}\)/g)?.length).toBe(2);
  });

  it("the grid computes calculated columns per row", () => {
    expect(read(`${FRONTEND}/components/tables/dynamic-table.tsx`)).toContain(
      "data.map((row) => ({ ...row, ...computeValues(calculated, row) }))"
    );
  });
});
