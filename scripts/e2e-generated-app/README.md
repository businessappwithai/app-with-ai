# Validating a generated application end to end

A Playwright suite that holds a **running generated application** (the NestJS +
TanStack stack on PostgreSQL) to what its **model** says. Every expectation comes
from the model through the generator's own reader — `facts.ts` runs `parseModel`
and `deriveAccess` and writes `.facts/facts.json` — never from the application, so
a test passes only when the application does what the model declares.

```bash
# the hospital model with computed fields, against an application already running on :4000/:4001
bun run test:e2e:generated-app

# any model, starting the application from a generated project if it is not running
bun scripts/e2e-generated-app/run.ts --model <model.eml.mmd> --project <generated dir> --api-suites

# generate first, then validate
bun scripts/e2e-generated-app/run.ts --model <model> --project <dir> --generate --database-url <url>

# Playwright options after --, e.g. one spec
bun run test:e2e:generated-app -- specs/06-computed-fields.spec.ts
```

`--api-suites` also runs the application's own API suites (`tests/run.ts`) before
the browser suite. When the runner starts the backend it raises the sign-in limit
(`AUTH_SIGNIN_MAX`), because every test signs in from one address; attached to an
application someone else started, a `429` is waited out instead.

| Spec | Holds the application to |
|---|---|
| `01-navigation-and-lists` | Sign-in; the navigation offers every top-level entity under its dictionary label; every list opens with no page error and no 5xx; no rollup (or formula that reads one) is a list column |
| `02-record-screens` | Every entity's record opens and draws a value for each column the model declares (except the key, the managed columns, the state field, a line item's parent link, and fields with display logic); a parent shows a tab per line item |
| `03-edit-round-trip` | Per top-level entity: Edit, type into a text field, Save — the API has the value and a new version, or the page shows the model's refusal |
| `04-record-lifecycle` | Per state machine: the moves offered are exactly the drawn edges; a move's button moves the record and stamps `<state>_at`, or the page shows the refusal; an undrawn move is 409 `INVALID_TRANSITION` |
| `05-roles` | Per seeded role: the navigation offers exactly the entities `%%rbac … .read` admits; a forbidden list answers 403 |
| `06-computed-fields` | Every rollup and formula drawn equals the definition evaluated over the record and its rows; none is stored; a formula recomputes while typing; a parent's rollup follows a child's save |

**What is a failure.** An uncaught page error or a 5xx from the API fails any test
that sees one (`watchErrors`). A refusal the model asks for — a rule, a workflow
bound to a state — is not a failure: it is recorded as a `refused` annotation in
the report, so a run says how many saves and moves the model itself declined.

**Expected values for computed fields** are evaluated with
`common/language/field-compute.ts`, whose arithmetic `field-compute.test.ts` holds
to hand-written results. This suite checks everything the application adds around
it: the metadata, the rollup's child and link, loading every row, the order
formulas run in, and how a value is drawn.

The HTML report is written to `playwright-report/`, traces of failures to
`test-results/`; both, and `.facts/`, are git-ignored.
