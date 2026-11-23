/**
 * Regression: `entityToBusEntity` strips system-managed column declarations.
 *
 * Every `bus_` table unconditionally receives `created_at`, `updated_at`,
 * `deleted_at`, `version`, `created_by`, `updated_by` and `is_active` from
 * the migration template. If the EML model also declares one of these (say,
 * `is_active BOOLEAN` for a soft-delete flag the author wants to track), the
 * migration would emit a duplicate column in `CREATE TABLE` and PostgreSQL
 * would refuse the migration.
 *
 * The fix lives in `entityToBusEntity`: it filters the entity's declared
 * attributes through `SYSTEM_COLUMN_NAMES` before mapping them. This test
 * pins the behaviour so a future edit to that function does not accidentally
 * re-expose system columns as regular attributes.
 */

import { describe, expect, it } from "vitest";
import { entityToBusEntity } from "../bus-entity.types";
import type { Entity, EntityAttribute } from "../entity.types";

/** Build a minimal Entity with only the given attribute names. */
const entity = (name: string, columnNames: string[]): Entity =>
  ({
    name,
    tableName: `bus_${name.toLowerCase()}`,
    primaryKey: "id",
    timestamps: true,
    attributes: columnNames.map(
      (col): EntityAttribute => ({
        name: col,
        type: "string",
        required: false,
      })
    ),
  }) as Entity;

describe("entityToBusEntity — system column stripping", () => {
  it("strips every system-managed column from the converted attributes", () => {
    const SYSTEM_COLS = [
      "created_at",
      "updated_at",
      "deleted_at",
      "version",
      "created_by",
      "updated_by",
      "is_active",
    ];

    // Build an entity whose EML model explicitly declares all seven system columns
    // plus two user columns that must survive.
    const e = entity("Invoice", [...SYSTEM_COLS, "total_amount", "status"]);
    const bus = entityToBusEntity(e);

    const names = bus.attributes.map((a) => a.name);

    // None of the system columns should appear in the converted attributes.
    for (const col of SYSTEM_COLS) {
      expect(names, `system column "${col}" must be stripped`).not.toContain(col);
    }

    // The two user columns must still be there.
    expect(names).toContain("total_amount");
    expect(names).toContain("status");
  });

  it("leaves an entity with no system column declarations untouched", () => {
    const e = entity("Product", ["id", "name", "price", "sku"]);
    const bus = entityToBusEntity(e);
    const names = bus.attributes.map((a) => a.name);
    expect(names).toContain("name");
    expect(names).toContain("price");
    expect(names).toContain("sku");
  });

  it("strips a single mixed-in system column without touching the others", () => {
    // A model that added `is_active` as a plain BOOLEAN column to track something.
    const e = entity("Subscription", ["customer_id", "plan", "is_active", "started_on"]);
    const bus = entityToBusEntity(e);
    const names = bus.attributes.map((a) => a.name);

    expect(names).not.toContain("is_active");
    expect(names).toContain("customer_id");
    expect(names).toContain("plan");
    expect(names).toContain("started_on");
  });
});
