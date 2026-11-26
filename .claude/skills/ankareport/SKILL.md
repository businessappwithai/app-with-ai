# ankareport: design and generate AnkaReport layouts

This skill covers creating, bulk-generating, and saving report designs for
generated applications that use the AnkaReport designer (`ankareport` package).

A "report design" is a JSON layout stored in `sys_report_designs` that the
AnkaReport designer renders when an administrator visits
`/admin/reports/<table_name>`. Once designed, users see a **Print** button on
any record view.

---

## Package and types

```
ankareport@0.1.0-beta.19
dist/index.d.ts   # canonical type reference
```

The core interface is `ILayout`:

```typescript
interface ILayout extends IStyle {
  width: number;          // canvas width in pixels (760 is the standard)
  headerSection: ISection;
  contentSection: ISection;
  footerSection: ISection;
}

interface ISection extends IStyle {
  height: number;         // pixels
  binding: string;        // "" for single-record; a field name to repeat over a list
  items?: IReportItem[];
  sections?: ISection[];  // nested sub-sections (optional)
}

interface ITextReportItem extends IBaseReportItem {
  type: "text";
  text: string;           // static label or fallback text
  binding?: string;       // field name from dataSource (e.g. "patient_name")
  format?: string;
}

interface IBaseReportItem extends IStyle {
  x: number; y: number; width: number; height: number;
  name: string;           // must be unique within the layout
}

interface IStyle {
  color?: string; backgroundColor?: string; textAlign?: "left"|"center"|"right";
  borderWidth?: number; borderStyle?: string; borderColor?: string;
  fontFamily?: string; fontSize?: string; fontWeight?: string;
}
```

**Binding rules:**
- Section `binding` on **header/footer** = `""` (renders once from root data).
- Section `binding` on **content** = `"records"` — the renderer only renders a section when `binding` is truthy AND `data[binding]` is an array. The print modal passes `data = { ...record, records: [record] }`, so `binding: "records"` iterates once over the single-record array. Using `binding: ""` makes the content section invisible.
- Text item `binding` = the field name from the `dataSource` (e.g. `"patient_name"`). Inside a bound section the renderer resolves `currentRecord[binding]`.
- Text item `text` = shown when there is no bound data, or used as a static label.
- Item `name` must be unique within the layout. Use a stable prefix + field name: `"lbl_patient_name"`, `"val_patient_name"`.

---

## Standard single-record layout

The hospital management system uses a **760 × (variable)** canvas.

```
Header (height: 90)
  ┌────────────────────────────────────────────────────────────────────────┐
  │                      ENTITY DISPLAY NAME                               │
  │  ════════════════════════════════════════════════════════════════════  │  ← color bar
  │                                                           Date: ______ │
  └────────────────────────────────────────────────────────────────────────┘

Content (height: numFields × 28 + 20)
  ┌──────────────────────┬──────────────────────────────────────────────────┐
  │  Field Label:        │  {binding_value}                                  │
  ├──────────────────────┼──────────────────────────────────────────────────┤  ← even rows shaded
  │  Field Label:        │  {binding_value}                                  │
  └──────────────────────┴──────────────────────────────────────────────────┘

Footer (height: 50)
  ┌──────────────────────────────────────────────────────────────────────┐
  │  Hospital Management System                          Page {page_no}  │
  └──────────────────────────────────────────────────────────────────────┘
```

**Layout constants:**
```
CANVAS_WIDTH = 760
CONTENT_X    = 20
LABEL_WIDTH  = 200
VALUE_X      = 224
VALUE_WIDTH  = 516
ROW_HEIGHT   = 26
ROW_GAP      = 2
ROW_STEP     = ROW_HEIGHT + ROW_GAP   (= 28)
CONTENT_TOP  = 10
```

---

## Column metadata

The `/api/bus/<table_name>/meta` endpoint returns:
```json
{
  "table": { "table_name": "bus_patient", "name": "Patient", ... },
  "columns": [
    { "column_name": "id",         "name": "Id",         "is_displayed": false, "seq_no": 10 },
    { "column_name": "first_name", "name": "First Name", "is_displayed": true,  "seq_no": 20 },
    ...
  ]
}
```

**Filter columns for the report:** `is_displayed === true`. Sort by `seq_no`. Skip `id`, `version`, `created_at`, `updated_at`, `created_by`, `updated_by`, `doc_status`, `doc_status_message`.

---

## Layout generator function

```typescript
const SKIP_COLS = new Set([
  "id","version","created_at","updated_at","created_by","updated_by",
  "doc_status","doc_status_message",
]);

function toLabel(col: string): string {
  return col.replace(/_id$/, "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function buildLayout(entityName: string, columns: { column_name: string; name: string }[]) {
  const STEP = 28;
  const TOP  = 10;
  const rows = columns.filter(c => !SKIP_COLS.has(c.column_name));
  const contentH = rows.length * STEP + TOP * 2;

  const contentItems = rows.flatMap((col, i) => {
    const y   = TOP + i * STEP;
    const bg  = i % 2 === 0 ? "#f9fafb" : undefined;
    const lbl: object = {
      type: "text", name: `lbl_${col.column_name}`,
      x: 20, y, width: 200, height: 26,
      text: (col.name ?? toLabel(col.column_name)) + ":",
      fontWeight: "bold", fontSize: "10px", color: "#374151",
      ...(bg ? { backgroundColor: bg } : {}),
    };
    const val: object = {
      type: "text", name: `val_${col.column_name}`,
      x: 224, y, width: 516, height: 26,
      text: "", binding: col.column_name, fontSize: "10px", color: "#111827",
      ...(bg ? { backgroundColor: bg } : {}),
    };
    return [lbl, val];
  });

  return {
    width: 760,
    fontFamily: "Helvetica, Arial, sans-serif",
    fontSize: "11px",
    color: "#111827",
    headerSection: {
      height: 90,
      binding: "",
      items: [
        { type:"text", name:"hdr_title", x:20, y:12, width:720, height:38,
          text: entityName, fontFamily:"Helvetica, Arial, sans-serif",
          fontSize:"22px", fontWeight:"bold", textAlign:"center", color:"#1a2e44" },
        { type:"text", name:"hdr_bar", x:20, y:53, width:720, height:3,
          text:"", backgroundColor:"#1a3d6e" },
        { type:"text", name:"hdr_date", x:490, y:63, width:250, height:18,
          text:"Hospital Management System", fontSize:"10px",
          textAlign:"right", color:"#6b7280" },
      ],
    },
    contentSection: {
      height: contentH,
      binding: "records",   // MUST be truthy — "" silently skips rendering
      items: contentItems,
    },
    footerSection: {
      height: 50,
      binding: "",
      items: [
        { type:"text", name:"ftr_name", x:20, y:15, width:400, height:20,
          text:"Hospital Management System", fontSize:"10px", color:"#9ca3af" },
        { type:"text", name:"ftr_page", x:580, y:15, width:160, height:20,
          text:"Page 1", fontSize:"10px", textAlign:"right", color:"#9ca3af" },
      ],
    },
  };
}
```

---

## Authentication

The backend uses **session cookies**, not Bearer tokens. The sign-in response
sets `<app>.session_token` and `<app>.session_data`. Carry them on every
subsequent request:

```typescript
async function auth() {
  const r = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@admin.com", password: "admin123" }),
  });
  const d: any = await r.json();
  if (!d.token) throw new Error("Auth failed");
  const cookieHeader = r.headers.getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return cookieHeader;
}
```

Pass `Cookie: <cookieHeader>` on all subsequent fetches. Bearer tokens alone
(`Authorization: Bearer …`) are **not** sufficient — the sys/tables and bus/*/meta
endpoints require the session cookie.

---

## Saving a layout

```
PUT /api/sys/report-designs/<table_name>
Content-Type: application/json
Cookie: <session-cookies>

{ "layout": <ILayout> }
```

Returns 200 with the saved design. Idempotent — re-saving replaces the layout.

---

## Bulk generation script pattern

```typescript
// generate-report-designs.ts — run with: bun generate-report-designs.ts
const BASE = "http://localhost:4001";

async function auth() {
  const r = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@admin.com", password: "admin123" }),
  });
  const d: any = await r.json();
  return d.token as string;
}

async function getTables(token: string) {
  const r = await fetch(`${BASE}/api/sys/tables?limit=200`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const d: any = await r.json();
  return d.data as { table_name: string; name: string }[];
}

async function getMeta(token: string, tableName: string) {
  const r = await fetch(`${BASE}/api/bus/${tableName}/meta`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const d: any = await r.json();
  return d.columns as { column_name: string; name: string; is_displayed: boolean; seq_no: number }[];
}

async function saveLayout(token: string, tableName: string, layout: object) {
  const r = await fetch(`${BASE}/api/sys/report-designs/${tableName}`, {
    method: "PUT", headers: {
      "Content-Type": "application/json", Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ layout }),
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
}

async function main() {
  const token = await auth();
  const tables = await getTables(token);
  let ok = 0, skip = 0;
  for (const tbl of tables) {
    const cols = await getMeta(token, tbl.table_name);
    if (!cols) { skip++; continue; }
    const visible = cols.filter(c => c.is_displayed && !SKIP_COLS.has(c.column_name))
                        .sort((a, b) => a.seq_no - b.seq_no);
    const layout = buildLayout(tbl.name, visible);
    await saveLayout(token, tbl.table_name, layout);
    console.log(`✓  ${tbl.table_name}  (${visible.length} fields)`);
    ok++;
  }
  console.log(`\nDone: ${ok} designed, ${skip} skipped`);
}
main();
```

---

## Lessons from the hospital deployment

| Issue | Detail |
|---|---|
| **Content section invisible** | AnkaReport renderer checks `binding && Array.isArray(data[binding])` before rendering. Use `binding: "records"` for the content section and pass `data: { ...record, records: [record] }` from the print modal. `binding: ""` silently skips the whole content section |
| Empty layout crashes designer | AnkaReport throws when layout is `{}`. Pass `undefined` instead — always check `Object.keys(layout).length > 0` |
| Binding uses raw field name | Pass `column_name` (e.g. `"patient_name"`) as `binding`, not `"{patient_name}"` |
| Non-fatal designer throw | AnkaReport can throw during layout hydration but still mount. Catch and re-throw only when `el.children.length === 0` |
| `name` must be unique | Two items with the same `name` cause the designer to silently drop one |
| Header/footer `binding: ""` | For header and footer sections, `binding: ""` is correct — they render once from root data |
| Corrupted stored layout | Clear with SQL: `UPDATE sys_report_designs SET layout = NULL WHERE table_name = '...'` |
| `/bus/<table>/meta` path | The `table_name` from `/sys/tables` already has the `bus_` prefix; pass it as-is |

---

## Route structure (generated app)

```
/admin/reports/           → reports.index.tsx  — grid of all entity cards
/admin/reports/$tableName → reports.$tableName.tsx  — AnkaReport designer

reports.tsx  → pure <Outlet /> (parent layout, no content of its own)
```

If `reports.tsx` renders anything other than `<Outlet />`, the child designer
route is invisible — the most common setup error.

---

## Skill: how to use this

When asked to design or generate AnkaReport layouts for a generated app:

1. Authenticate and get tables: `GET /api/sys/tables?limit=200`
2. For each table: `GET /api/bus/<table_name>/meta` → filter `is_displayed`, sort `seq_no`
3. Call `buildLayout(displayName, visibleColumns)`
4. `PUT /api/sys/report-designs/<table_name>` with `{ layout }`
5. Enhance individual layouts by opening them in the browser if the user asks for custom styling or branding
6. Add this skill to CLAUDE.md's skill routing table when it's been used
