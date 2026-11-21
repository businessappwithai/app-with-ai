/**
 * What a record is called — `%%entity <E> identifier:` — and the derivation it
 * replaces.
 *
 * A record's display value is its `sys_column.is_identifier` columns, joined:
 * what a dropdown lists and what a grid shows in place of a foreign key. A model
 * that declares it is taken at its word. One that does not gets
 * `identifierColumnNames`' derivation, which for an entity with no name, no
 * person's two names and no code is a guess; the checker reports that guess as
 * EML165, naming the columns. The checker cannot import the generator, so its
 * copy of the derivation is held here to the real one over every example model.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { entityToBusEntity } from "@appwithai/core/types";
import { checkSource } from "../../../../../common/language/checker";
import { parseModel } from "../../pipeline/parse-model";

const EXAMPLES = join(__dirname, "../../../../../common/language/examples");

const model = (directives: string[]) => `%%meta name: Stock
erDiagram
    Sample {
        string id PK
        string sample_barcode UK
    }
    InventoryTransaction {
        string id PK
        string sample_id FK
        string performed_by_id FK OPTIONAL
        datetime occurred_at OPTIONAL
        text reason OPTIONAL
    }
    Sample ||--o{ InventoryTransaction : moves
${directives.join("\n")}
`;

const codes = (source: string, code: string) =>
  checkSource(source).issues.filter((entry) => entry.code === code);

const identifiersOf = (source: string, entity: string) => {
  const parsed = parseModel(source).entities.find((candidate) => candidate.name === entity);
  if (!parsed) throw new Error(`no ${entity}`);
  return entityToBusEntity(parsed)
    .attributes.filter((attribute) => attribute.isIdentifier)
    .map((attribute) => attribute.name);
};

describe("%%entity identifier:", () => {
  it("is what the dictionary marks, instead of the derivation", () => {
    const source = model([
      "%%entity InventoryTransaction identifier: sample_id, occurred_at",
      "%%entity Sample identifier: sample_barcode",
    ]);
    expect(identifiersOf(source, "InventoryTransaction")).toEqual(["sample_id", "occurred_at"]);
    expect(identifiersOf(source, "Sample")).toEqual(["sample_barcode"]);
    expect(codes(source, "EML165")).toEqual([]);
  });

  it("falls back to the derivation without one, and the checker names the guess", () => {
    const source = model([]);
    expect(identifiersOf(source, "InventoryTransaction")).toEqual(["sample_id", "performed_by_id"]);
    const guesses = codes(source, "EML165").map((issue) => issue.message);
    expect(guesses).toHaveLength(2);
    expect(guesses.join("\n")).toContain("sample_id and performed_by_id");
    expect(guesses.join("\n")).toContain("sample_barcode");
  });

  it("drops a column the entity does not declare, and the checker refuses it", () => {
    const source = model(["%%entity Sample identifier: barcode, sample_barcode"]);
    expect(identifiersOf(source, "Sample")).toEqual(["sample_barcode"]);
    expect(codes(source, "EML163")).toHaveLength(1);
  });

  it("warns on the key and on an enum-bound column", () => {
    const source = `${model([
      "%%entity Sample identifier: id",
      "%%entity InventoryTransaction identifier: kind",
      "%%enum Kind: received, consumed",
      "%%field InventoryTransaction.kind enum: Kind",
    ]).replace("text reason OPTIONAL", "text reason OPTIONAL\n        string kind")}`;
    expect(codes(source, "EML164")).toHaveLength(2);
  });
});

describe("EML165 and identifierColumnNames agree", () => {
  const models = readdirSync(EXAMPLES).filter((file) => file.endsWith(".eml.mmd"));

  it.each(models)("%s", (file) => {
    const source = readFileSync(join(EXAMPLES, file), "utf8");
    const parsed = parseModel(source).entities;
    for (const issue of codes(source, "EML165")) {
      const entity = /^"(\w+)"/.exec(issue.message)?.[1];
      const named = /identifier: ([^`]*)`/.exec(issue.hint ?? "")?.[1] ?? "";
      const guess = named.includes("<") ? [] : named.split(",").map((column) => column.trim());
      const subject = parsed.find((candidate) => candidate.name === entity);
      expect(subject, `${file}: ${entity}`).toBeDefined();
      if (!subject) continue;
      const derived = entityToBusEntity({ ...subject, identifierColumns: undefined })
        .attributes.filter((attribute) => attribute.isIdentifier)
        .map((attribute) => attribute.name);
      expect(derived, `${file}: ${entity}`).toEqual(guess);
    }
  });
});
