/**
 * Regression: a tab's Order By and Filter were saved and never read.
 *
 * `sys_tab.order_by_clause` and `.where_clause` are editable in the Window, Tab
 * and Field window, but only the window's pair reached the list, so a tab's
 * declaration changed nothing. The list now loads the entity's own tab: its
 * order wins over the window's, and its filter holds alongside the window's.
 * The list API also read `startsWith` and `endsWith` case-sensitively while
 * the window clauses are case-insensitive, so `startswith` fell through to an
 * exact match.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(
    join(import.meta.dirname, "../../../templates/tanstack-start-nestjs/backend/src/modules/bus", path),
    "utf8"
  );

describe("tab list defaults", () => {
  const service = read("bus.service.ts.hbs");

  it("loads the entity's own tab beside its window", () => {
    expect(service).toContain(".selectFrom('sys_tab')");
    expect(service).toContain("tab_where_clause");
    expect(service).toContain("tab_order_by_clause");
  });

  it("lets the tab's ordering win over the window's", () => {
    expect(service).toMatch(
      /metadata\.window\?\.tab_order_by_clause\?\.trim\(\) \|\| metadata\.window\?\.order_by_clause/
    );
  });

  it("applies the window's filter and the tab's, the caller's last", () => {
    expect(service).toContain("['tab', metadata.window?.tab_where_clause?.trim()]");
    expect(service).toContain("{ ...declaredFilters, ...filters }");
  });
});

describe("list API filter operators", () => {
  const controller = read("bus.controller.ts.hbs");

  it("reads the operator case-insensitively", () => {
    expect(controller).toContain("switch (operator.toLowerCase())");
    for (const op of ["startswith", "endswith", "notequals"]) {
      expect(controller).toContain(`case '${op}':`);
    }
  });
});
