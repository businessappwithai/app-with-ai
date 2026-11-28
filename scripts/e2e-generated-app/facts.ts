/**
 * What the generated application must be, read from the model — never from the
 * application.
 *
 * The specs beside this file hold a running application to these facts. They
 * come from the generator's own reading of the model (`parseModel`,
 * `deriveAccess`), so a test can only pass when the application does what the
 * model says; reading them back from the application's dictionary would prove
 * only that the application agrees with itself.
 *
 *   bun scripts/e2e-generated-app/facts.ts <model.eml.mmd> [--project-id my-app]
 *
 * Writes `scripts/e2e-generated-app/.facts/facts.json`.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isComputedAttribute } from "@appwithai/core/types";
import { stateFieldOf } from "../../common/language/state-field";
import { parseModel } from "../../packages/generator/src/pipeline/parse-model";
import { deriveAccess } from "../../packages/generator/src/rbac/roles";
import { tableNameFor } from "../../packages/generator/src/naming/tables";

export interface FactColumn {
  name: string;
  type: string;
  required: boolean;
  foreignKey: boolean;
  enumValues?: string[];
  computedKind?: "rollup" | "calculated";
  computedExpression?: string;
  /** Display logic: the field is on the form only while it holds. */
  displayLogic?: string;
}

export interface FactEntity {
  name: string;
  table: string;
  /** `/bus/<segment>` — the table without its `bus_` prefix. */
  apiSegment: string;
  primaryKey: string;
  /** A line item of `parent`, drawn as a tab in its window; it has no list of its own. */
  parent?: string;
  parentLink?: string;
  /** The line items drawn as tabs in this entity's window. */
  children: string[];
  columns: FactColumn[];
}

export interface FactMachine {
  entity: string;
  table: string;
  stateField: string;
  initial?: string;
  terminal: string[];
  edges: Array<{ from: string; to: string; event: string }>;
}

export interface FactRole {
  role: string;
  email: string;
  isAdmin: boolean;
  /** The entities this role's navigation must offer — top-level only. */
  visible: string[];
}

export interface Facts {
  model: string;
  projectId: string;
  entities: FactEntity[];
  machines: FactMachine[];
  roles: FactRole[];
}

function main(): void {
  const modelPath = process.argv[2];
  if (!modelPath) {
    console.error("usage: bun scripts/e2e-generated-app/facts.ts <model.eml.mmd> [--project-id <id>]");
    process.exit(2);
  }
  const idIndex = process.argv.indexOf("--project-id");
  const projectId = idIndex > 0 ? (process.argv[idIndex + 1] ?? "my-app") : "my-app";
  const model = parseModel(readFileSync(modelPath, "utf8"));

  const entities: FactEntity[] = model.entities.map((entity) => {
    const table = tableNameFor(entity);
    return {
      name: entity.name,
      table,
      apiSegment: table.replace(/^bus_/, ""),
      primaryKey: entity.primaryKey || "id",
      parent: entity.parentEntity,
      parentLink: entity.parentLinkColumn,
      children: model.entities.filter((c) => c.parentEntity === entity.name).map((c) => c.name),
      columns: entity.attributes.map((a) => ({
        name: a.name,
        type: a.type,
        required: !!a.required,
        foreignKey: !!a.isForeignKey,
        ...(a.enumValues?.length ? { enumValues: a.enumValues } : {}),
        ...(a.displayLogic ? { displayLogic: a.displayLogic } : {}),
        ...(isComputedAttribute(a)
          ? { computedKind: a.computedKind, computedExpression: a.computedExpression }
          : {}),
      })),
    };
  });

  const machines: FactMachine[] = [];
  for (const workflow of model.workflows) {
    const entity = entities.find((e) => e.name === workflow.entity);
    if (!entity) continue;
    const stateField = stateFieldOf(entity.columns.map((c) => c.name));
    if (!stateField) continue;
    machines.push({
      entity: entity.name,
      table: entity.table,
      stateField,
      initial: workflow.initial,
      terminal: workflow.terminal,
      edges: workflow.transitions
        .filter((t) => t.from !== "[*]" && t.to !== "[*]")
        .map((t) => ({ from: t.from, to: t.to, event: t.trigger ?? "" })),
    });
  }

  const access = deriveAccess(model.rbac, {
    projectId,
    entities: model.entities.map((e) => e.name),
  });
  const topLevel = entities.filter((e) => !e.parent).map((e) => e.name);
  const roles: FactRole[] = access.users.map((user) => {
    const declared = access.roles.find((r) => r.name === user.roleName)?.declaredAs ?? user.roleName;
    const visible = user.isAdmin
      ? topLevel
      : topLevel.filter((name) => {
          const admitted = access.entityVisibility[name];
          // An entity with no read rule is open to every signed-in user.
          if (!admitted || admitted.length === 0) return true;
          return admitted.some((r) => r.toLowerCase() === declared.toLowerCase());
        });
    return { role: user.roleName, email: user.email, isAdmin: user.isAdmin, visible };
  });

  const facts: Facts = { model: modelPath, projectId, entities, machines, roles };
  const dir = join(import.meta.dirname, ".facts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "facts.json"), JSON.stringify(facts, null, 2));
  console.log(
    `facts: ${entities.length} entities (${topLevel.length} top-level), ${machines.length} state machines, ` +
      `${roles.length} accounts, ${entities.flatMap((e) => e.columns).filter((c) => c.computedKind).length} computed fields`
  );
}

if (import.meta.main) main();
