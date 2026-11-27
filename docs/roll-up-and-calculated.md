# Rollup and Calculated fields in the Application Dictionary — architectural design

## Context

Generated applications can only show values that are stored in a database column. Users want two
**read-only, on-screen-only** field types in the Application Dictionary:

- **Rollup** — a field on a parent record that aggregates a column of its child records
  (`sum`, `avg`, `count`, `min`, `max`), e.g. `Order.total_amount = sum(OrderLine.line_amount)`.
  When a child row is added, changed or deleted, the parent's value changes.
- **Calculated** — a field whose value is a formula over the record's other fields,
  e.g. `OrderLine.line_amount = @quantity@ * @unit_price@`.

Decisions confirmed with the user:

| Question | Decision |
|---|---|
| Persistence | **Purely virtual.** No database column. Never sent on save. Not seen by reports, rules, workflows, sort or filter |
| Rollups in the list grid | **Form only.** Rollups appear on the record form and are hidden from the grid. Calculated fields can appear in the grid, computed per row from the row's own data |
| Where they are defined | **The model and the Admin windows.** Declared in EML and checked by the checker, seeded into `sys_column`/`sys_field`, and editable in Admin → Column without regenerating, like display/read-only logic today |

"Client-side, no server call" means three things:
- The **server never computes** these values.
- **No new endpoint** is added.
- The browser computes everything from data it already loads. For a rollup that is the child rows,
  fetched by the same request and React Query key the record screen's child tab already uses.

## 1. The language: two new `%%field` keys

```
%%field Order.total_amount   rollup: sum(OrderLine.line_amount)
%%field Order.line_count     rollup: count(OrderLine)
%%field Order.open_total     rollup: sum(OrderLine.line_amount) where @status@!cancelled
%%field Account.won_value    rollup: sum(Opportunity.amount via account_id)
%%field OrderLine.line_amount calculated: round(@quantity@ * @unit_price@ * (1 - coalesce(@discount_pct@, 0) / 100), 2)
%%field Order.grand_total    calculated: @total_amount@ + coalesce(@shipping@, 0)
```

The column is still declared in the `erDiagram` block, for example `decimal total_amount`, so the
diagram stays readable. Its declared type controls how the value is formatted: Amount, Integer,
Number or Date. The `%%field` key is what makes the column virtual.

### Rollup grammar

`<fn>(<Child>[.<column>] [via <link_column>]) [where <field-logic>]`

- **Functions:** `sum`, `avg`, `min`, `max`, `count`.
  - `count(Child)` counts rows. `count(Child.col)` counts rows where `col` is not null.
  - `min` and `max` also accept date columns.
- **Child:** a line item of the parent (`parent:`), linked on `parentLinkColumn`, or any entity with
  exactly one foreign key to the parent. `via` names the link column when there are two.
- **`where`:** the existing Compiere field-logic syntax (`common/language/field-logic.ts`),
  evaluated against each child row.
- **Null and empty rules:**
  - Nulls are skipped.
  - `sum` and `count` of no rows give `0`. `avg`, `min` and `max` of no rows give null, shown as "—".
- **Precision:** results are rounded to the column's scale (Amount 2, Number 6) to remove
  floating-point noise. Numeric strings from `pg`, such as `"12.50"`, are converted to numbers.

### Calculated grammar

A small expression language:

- **Operands:** `@column@`, numbers, and `'text'`.
- **Operators:** `+ - * /`, unary minus, and parentheses. `&` and `|` are not operators here,
  because field logic already uses them for and/or.
- **Functions:** `round(x[,n])`, `abs`, `min(…)`, `max(…)`, `coalesce(…)`, `concat(…)`,
  `days(a, b)` (days between two dates), and `if(<field-logic>, a, b)`.
- **Null and error rules:** arithmetic involving null gives null. Division by zero gives null.
  A formula that does not parse gives null; the checker and the Admin window refuse such a
  formula before it can be stored.
- **Inputs:** a calculated field may read stored columns, rollups, and other calculated fields of
  the same record. The values are evaluated in dependency order. A cycle is an error.

### One shared module: `common/language/field-compute.ts`

This follows the `field-logic.ts` pattern. It imports only `./field-logic`, so a byte copy sitting
beside `field-logic.ts` resolves everywhere. It exports:

- `parseFormula`, `evaluateFormula`, `formulaVariables`
- `parseRollup`, `aggregate(spec, rows)`
- `computeOrder(fields)`: topological order, reporting any cycle
- `computeValues(fields, record, rowsByChildTable)`: the values to draw
- `isComputed(field)`, `stripComputed(fields, payload)`

| Copy | Where |
|---|---|
| canonical | `common/language/field-compute.ts` (checker, parser) |
| byte-identical | `packages/generator/templates/common/field-compute.ts`, which is copied to `backend/src/common/` and `frontend/src/lib/` (same `copyFile` / `this.component` calls as `field-logic.ts` in `nestjs-backend.generator.ts` ~l.1959 and `tanstack-start-frontend.generator.ts` ~l.534) |
| JavaScript twin | `templates/wasm/server/lib/field-compute.js`, built with `bun build … --format esm --no-bundle` under a header comment, like `field-logic.js` |

The backend copy is used **only** to parse (Admin edits) and strip (writes). It never evaluates a value.

### Checker (`common/language/checker.ts`), codes EML180–EML198

- Add `rollup` and `calculated` to `validFieldKeys` (l.370). Dispatch them from
  `checkFieldDirectives` (l.1059), next to the `checkFieldLogic` call.

| Code | Sev | Check |
|---|---|---|
| EML180 | error | rollup does not parse |
| EML181 | error | rollup child entity is undeclared, or has no foreign key to the parent |
| EML182 | error | child column is undeclared, or is not numeric for `sum`/`avg` (not numeric or date for `min`/`max`) |
| EML183 | error | link is ambiguous (two foreign keys to the parent and no `via`), or `via` is not a foreign key to the parent |
| EML184 | error | `where` does not parse, or names a column the child does not have |
| EML185 | error | rollup of a rollup column (a calculated child column is allowed) |
| EML186 | warn | result type does not suit the column (`sum` into text, `count` into a date) |
| EML190 | error | calculated formula does not parse |
| EML191 | error | `@column@` is not a column of the entity |
| EML192 | error | cycle among computed fields, including a field that reads itself |
| EML193 | warn | formula type does not suit the column (numeric formula into text, `concat` into a number) |
| EML195 | error | a computed column is also used where storage is required: PK, FK, state field, `identifier:`, `%%index`, `unique`, required, `enum:`, `default:`/`mandatory:`/`readonly:` logic |
| EML196 | error | both `rollup:` and `calculated:` on one column |
| EML197 | error | `%%action`/`%%guard`/`%%rule`/`%%step` conditions or `%%report` SQL name a computed column. Those run on the server, which never sees the value |

- None of the codes is auto-fixable.
- Add range label `"EML180-EML198": "Computed fields (rollup, calculated)."` to
  `appwithai-language.json`.

### Language documents

| Document | Change |
|---|---|
| `appwithai-language.json` | New `applicationDictionary.computedFields` block (describe, grammar, evaluation, enforcement, checkerCodes). Update the `%%field` directive's `consumedBy`/`examples`, the stale `conformance.levels.reserved` text, and `fieldLogic.notSupported` (it says a computed value belongs in a hook) |
| `common/language/spec/05-directives.md`, `common/language/README.md` | Add the new keys |
| `website/llmtext/eml-syntax.txt` | The `%%field` keys |
| `website/llmtext/eml-dictionary.txt` | §3.7, which must track what the generator derives |
| `website/llmtext/checker-rules.txt` | The new codes |

`bun run test:llmtext` must stay green. Every fenced example must check 0/0.

## 2. The generator: carrying the spec, and keeping virtual columns out of storage

1. **Types** (`packages/core/src/types/entity.types.ts`, `EntityAttribute`): add
   `rollup?: { fn; childEntity; childColumn?; linkColumn; where? }` and `formula?: string`.
   `attributeToBusAttribute` spreads `...attr`, so both reach the templates.
2. **Parser** (`packages/generator/src/parsers/mermaid.parser.ts`):
   - `parseFieldComputeDirective`, anchored at `^%%field\s+(\w+)\.(\w+)\s+(rollup|calculated)\s*:`.
   - `attachComputed`, run **after** `attachParents`, so the link column resolves from
     `parentLinkColumn`, else from the unique foreign key, else from `via`.
   - Test: `parsers/__tests__/computed-fields.test.ts`.
3. **Keep virtual columns out of storage.** Every place that turns an attribute into a stored
   value has to skip them:

   | Where | File |
   |---|---|
   | NestJS DDL | `templates/common/migrations/bus-tables.migration.ts.hbs` (l.18–21): `{{#unless (isComputed this)}}` |
   | Browser DDL | `generators/wasm/model-bundle.ts` `buildSchema` (l.215) |
   | Seed data | `templates/common/seeds/business-data.ts.hbs` |
   | Browser sample data | `generators/wasm/sample-data.ts` |
   | Test harness | `tests/harness/entities.ts.hbs` / `factory.ts.hbs` (writable fields) |
   | Reporting pack | `reporting/pack.ts`: measures, groupings, register columns. Suite 28 runs every derived report, and SQL naming a missing column would fail |
   | Rule model | `rules/rule-model.ts` (`RULE_MODEL`): the rule and workflow editors must not offer a value the server cannot see |
   | Assistant model context | `model-context` RAG |

4. **Dictionary** (`generators/dictionary.generator.ts`):
   - `sys_column`: `computed_kind` (`rollup` | `calculated`), `computed_expression` (the text as
     written), `is_updateable: false`.
   - `sys_field`: `is_read_only: true`. Rollups also get `is_displayed_grid: false`.
   - No new reference id is needed. The declared type's reference id (12 Amount, 11 Integer,
     15 Date…) drives formatting, which avoids the unseeded-reference trap.
5. **Schema migration:** new `templates/tanstack-start-nestjs/backend/src/migrations/026_computed_columns.ts.hbs`.
   - `ALTER TABLE sys_column ADD COLUMN IF NOT EXISTS computed_kind VARCHAR(12) CHECK (…)`
     and `computed_expression TEXT`.
   - **Add the slug to the `scaffold` array** in `generateMigrations`.
   - Browser: the same `ADD COLUMN IF NOT EXISTS` in `templates/wasm/app/schema.sys.sql`.
6. **Seeds:**
   - `templates/common/seeds/sys-dictionary.ts.hbs`: add the two `sys_column` values (l.641–671)
     and the field flags (l.879–910).
   - `model-bundle.ts`: add them to the columns (l.560) and fields (l.620).
   - `templates/wasm/server/migrate.js`: insert them.

## 3. NestJS backend: serve the definition, never the value

In `bus.service.ts.hbs`:

- **`getEntityMetadata`**
  - Select `computed_kind` and `computed_expression`, and serve them on `FieldMetadata`.
  - For a rollup, also serve `rollup: { fn, child_table, child_column, link_column, where }`,
    resolved from the stored text with `parseRollup`. The child entity is mapped to its table
    through `sys_table` / `MODEL_TABLES`. Resolving here means an Admin edit takes effect
    without regenerating.
  - Force `is_read_only: true` and `is_updateable: false`. Rollups get `is_displayed_grid: false`.
- **`create` / `update`:** run `stripComputed(metadata, data)` before `validateData`. The form
  sends the whole record (today only `_label` is stripped, l.442/587), and the API would
  otherwise write to a column that does not exist. Stripping is silent, because the value is
  only a copy of what the screen drew.
- **Filtering and sorting:** `parseFilters` and the list sort refuse a computed column with
  400 `COMPUTED_FIELD_NOT_QUERYABLE`.
  - Add the code to `log-spec.json` and `common/errors/catalogue.ts`. An uncatalogued code is
    rewritten to `FORBIDDEN` on the way out.
  - Window Order By and `sort_no` skip computed columns.

`sys.service.ts.hbs` (the Admin Column window):

- Accept `computed_kind` and `computed_expression`. Validate them with
  `parseFormula`/`parseRollup`, check that referenced columns and child tables exist in the
  dictionary, and run `computeOrder` to catch cycles. Refusals are 400 with the reason, the same
  pattern as `normalizeLogic` (l.729).
- **Allowed:** editing an existing computed column's expression, and creating a new virtual
  `sys_column` row with a kind. A virtual column needs no DDL.
- **Refused:** turning a stored column into a computed one, or the reverse. That would hide data,
  or point a column at storage that does not exist.
- Clear the metadata cache on save, as today.

## 4. NestJS front end: compute in the browser

- **`lib/field-compute.ts`:** the byte copy of the shared module.
- **`hooks/use-entities.ts` / the `FieldMetadata` type:** carry `computed_kind`,
  `computed_expression` and `rollup`.
- **New `hooks/use-rollup-rows.ts`**, used by `ADDetailShell`:
  - Collects the rollup child tables from the parent's form fields.
  - For each child it runs `useQuery` with **the same key and request as `ChildPanel`**:
    `["ad-child", "/bus/<child>", parentId]` with `{ limit, [link]: parentId }`. React Query
    then de-duplicates. When the tab is open there is one request; when it is not, it is the
    request the tab would make anyway.
  - The limit becomes a shared `CHILD_ROWS_LIMIT` constant. When `total` exceeds it, the hook
    reads the remaining pages, so the rollup is never computed from a truncated list.
  - It also loads the child's form fields (existing key `["bus-form-fields", child]`), so a
    rollup over a **calculated** child column computes that column on each row first.
  - If the child list is refused (403, or the column is withheld by field access), the rollup
    shows "—" with the tooltip "You cannot read <Child window>". A rollup therefore never
    reveals anything the API did not already return to this user.
- **`components/forms/dynamic-form.tsx`:**
  - New optional prop `rollupRows`.
  - In the existing `useMemo` (l.1069–1088), call
    `computeValues(dictionaryFields, context, rollupRows)` and merge the result into the context
    **before** `fieldLogicState`. Display logic may then read a computed value, for example
    "show Discount reason when `@grand_total@>1000`".
  - `FieldRenderer`: a computed branch draws the formatted value, using the same formatter as
    view mode, in view, edit **and** create modes. It is never an input. It carries a small
    "Σ" / "ƒx" badge with the expression as a tooltip.
  - `isInputField` (l.905) excludes computed fields.
  - Both submit paths, `form.onSubmit` (l.1028) and `handleFormSubmit` (l.1215), drop computed
    keys.
  - In create mode a rollup shows `0` or "—", and a calculated field updates as the user types.
- **`components/admin/ad-detail-shell.tsx`:**
  - Pass `rollupRows` to `DynamicForm`.
  - The Highlights `SummaryPanel` receives the record merged with its computed values, so a
    total can sit in Highlights.
- **Recomputing when a child changes:**
  - Inline child create already invalidates `["ad-child", …]`, so the rollup recomputes on the
    same screen.
  - Child edit and delete happen on the child's own detail page. Its `saveMutation` (l.845) and
    `deleteMutation` (l.930) will also invalidate the prefix `["ad-child", "/bus/<child>"]` (any
    parent) and `["ad-child-count", …]`. Returning to the parent then refetches instead of
    showing a cached total for up to 60 seconds.
- **`components/tables/dynamic-table.tsx`:**
  - Calculated columns are computed per row from that row alone (`computeValues(fields, row)`).
  - Their header has no sort control, since the server cannot sort by them.
  - Rollups are not in the grid.
- **Other screens that list fields**, such as `hooks/use-dictionary-windows.ts` readers (Report
  Designs, document designer, rule editor): expose `computed` and exclude these fields wherever
  a server-side engine would evaluate the field.

## 5. Browser (`--standalone`) stack

- **`templates/wasm/server/lib/field-compute.js`:** the twin.
- **`server/modules/bus.routes.js`:**
  - `entityMetadata()` (l.72) serves `computed_kind`, `computed_expression` and the resolved
    `rollup`.
  - `sanitize()` (l.247) additionally drops computed attributes. They are in
    `entity.attributes`, so today they would pass.
  - List filters on a computed column are refused with 400.
- **`server/modules/sys.routes.js`:** the same Admin validation as NestJS.
- **`ui/views/entity-form.js`:**
  - `control()` draws a computed field as an `<output>`, never an `<input>`, so `submit()`,
    which sends every input, cannot send it.
  - `applyLogic()` (l.167) recomputes calculated values on every `input`/`change`.
  - `renderDetails()` already fetches each child's rows (`?<link>=<id>&limit=100`). It feeds
    them to `aggregate` (paging when `total` exceeds the page), then fills the rollup outputs.
  - Child edits navigate away and back, so the parent re-renders with fresh rows.
- After editing `templates/wasm/**`, run `bun run build:wasm-runtime`.

## 6. Documentation for the people using the application

- **`manual/index.ts`:** in `fieldRows` (l.161), add the detail line "Rollup: sum of Order Line →
  Line amount, computed on screen, not stored" / "Calculated: = …". The control label
  (`controlFor`) is "Computed (read only)".
- **`manual/skills.ts`:** in `renderSkills` (l.250–268), say the value is computed on screen and
  is **not** returned by the API or searchable. The chat assistant reads records through the API
  and must not claim to see it.

## 7. Tests

| Test | Holds |
|---|---|
| `generators/__tests__/field-compute.test.ts` (modelled on `field-logic.test.ts`) | Byte identity of the template copy; the same `CASES` table run through the TypeScript module **and** the JavaScript twin; checker codes EML180–197; dictionary output; rendered seed; DDL has no column for a computed attribute |
| `parsers/__tests__/computed-fields.test.ts` | Directive parsing, link resolution (`parent:`, unique FK, `via`) |
| `templates/__tests__/computed-fields-templates.test.ts` | `stripComputed` called in create/update; filter refusal; both submit paths drop computed keys; child save/delete invalidation present; `COMPUTED_FIELD_NOT_QUERYABLE` in the catalogue; migration 026 in `scaffold` |
| `generators/__tests__/field-properties.test.ts` | The new `sys_column` columns are served |
| `templates/__tests__/declared-templates.test.ts` `OUTPUT_ONLY_PATHS` | The two new output paths |
| `reporting/__tests__` | The pack never names a computed column |
| Fixture `tests/test-data/computed-fields.eml.mmd` | `Order`/`OrderLine` with every rollup function, `where`, `via`, a calculated child column rolled up, and a calculated field reading a rollup |
| Generated suite `tests/suites/02f-computed-fields` (only when the model has computed fields; expectations from `harness/model.ts`, not the dictionary) | Metadata serves kind/expression/read-only; rollups are not grid-visible; a write carrying a computed key is stored without it; filtering by it is a 400 |
| Generated UI spec `tests/ui/computed-fields.spec.ts` | Opening an order shows the rollup equal to the sum of its lines. Adding a line inline updates it with no reload. Editing quantity updates the calculated amount live. Recording the page's network shows **no request other than the child-list endpoint** |

## 8. Rollout order

1. **Language:** `field-compute.ts`, checker, JSON, spec documents and llmtext.
   Check with `type-check:language` and `test:llmtext`.
2. **Generator core:** types, parser, storage exclusions, dictionary, migration 026, seeds.
3. **NestJS backend:** metadata, strip, refusal, Admin validation.
4. **NestJS front end:** shared module, rollup hook, form, grid, invalidation.
5. **Browser stack**, then `build:wasm-runtime`.
6. **Manual and skills, tests, fixture.**
7. **Rebuild the five committed bundles** with Bun 1.4.6 on linux-x64 (in docker if `--check`
   reports a different runtime). The checker is inlined in all five. Then run `sync:common`.
8. **Regenerate the active project**
   `packages/web/generated/proj_1793092671630_17aoi4dli`, as CLAUDE.md requires.

## Verification

- **Static checks:** `bun install`; `bun run type-check`; `bun run type-check:language`;
  `bun run test`; `bun run test:language-tools`; `bun run test:llmtext`; all five
  `build:* --check`.
- **Checker:** `bun common/language/checker.ts tests/test-data/computed-fields.eml.mmd` gives
  0 errors and 0 warnings. Negative cases for each code are covered in the unit test.
- **Generate and run locally:**
  `bun packages/generator/src/cli/generate.ts generate -i tests/test-data/computed-fields.eml.mmd -o <dir> --force --database-url <url> --run`,
  then `bun run test:e2e` in the output. Run the suite **twice on one database**.
- **In the browser, via `qa-lifecycle-workflows`:**
  - Open an order and confirm the rollup equals the sum of its lines.
  - Add, edit and delete lines and watch the total follow.
  - Type a quantity and watch the line amount change.
  - In Admin → Column, change a rollup to `avg`; with no regeneration the form shows the average.
  - Confirm a bad formula is refused with its reason.
  - Confirm no network call other than the child list.
- **The same model on the browser stack:** `bun run wasm generate … --standalone`, then
  `bun run test:wasm`.
- **CI's model**, to prove nothing regressed for models without computed fields:
  `common/language/examples/drug-discovery.eml.mmd` with `--records-per-entity 25`, built and its
  suite run with `run.ts --no-server`.

## Out of scope (stated, not silently skipped)

- **`eml --stack node-rest`:** creates the column physically and ignores the key. The value stays
  null and is not shown.
- **Grandchildren:** a rollup across two levels is not possible, because nested line items are
  already flattened to two levels.
- **Server use of the value:** reports, rules, workflows and the chat assistant cannot see it, by
  design. EML197 tells the author.
