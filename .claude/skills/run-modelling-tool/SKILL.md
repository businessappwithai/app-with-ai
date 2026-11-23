---
name: run-modelling-tool
description: Start the AppWithAI modelling tool (the TanStack Start web app on :3000) in a macOS or Linux container environment — Postgres, bun install, the admin account, the dev server — and drive it in Chromium. Use when asked to run the app, show a screenshot of it, or check a change in the real UI.
---

# Run the modelling tool

Use `bun`, never `npm`/`pnpm`. The tool is `packages/web`; generated apps are a different thing (see `generate-and-run-app`).

## Start it, in this order

> **Environment note:** Steps 2–3 differ between macOS (local dev) and a Linux cloud container. The dev server launch (step 5) also differs. See the environment-specific notes below.

1. `bun install --frozen-lockfile` — with no `node_modules`, `type-check` lies (see `ship-checks`).
2. **Postgres:**
   - **macOS (local dev):** Postgres is already installed and running as a system service. Check with `pg_isready -h /tmp -U postgres`. If the `appwithai` database exists (`psql -h /tmp -U postgres -c "\l" | grep appwithai`), skip to step 3.
   - **Linux cloud container:** Postgres 16 is installed but not running. As root, put the data directory outside `/tmp/claude-*` (the `postgres` user cannot write there):
     ```bash
     B=/usr/lib/postgresql/16/bin; D=/var/tmp/pgdata
     mkdir -p $D && chown postgres $D
     su postgres -c "$B/initdb -D $D -A trust" && su postgres -c "$B/pg_ctl -D $D -o '-k /tmp' -l $D/log start"
     psql -h /tmp -U postgres -c "create role appwithai superuser login password 'password'" -c "create database appwithai owner appwithai"
     ```
     Use full paths to `pg_ctl`/`initdb`; `su` resets `PATH`. There is **no pgvector** — migrations pass, the model-context assistant will not work.
3. `cp .env.example .env`, set `DB_ENCRYPTION_KEY` to `$(head -c32 /dev/urandom | base64)`. On macOS this is already configured in `.env` — skip if `.env` exists.
4. `bun run seed:admin -- --email x@y.z` — runs the migrations. It **ignores the email** and creates `admin@admin.com` / `administrator`. Skip if migrations have already run.
5. Start the dev server:
   - **macOS:** `nohup bun run dev > /tmp/dev.log 2>&1 &` then poll `grep -m1 'Local:' <(tail -f /tmp/dev.log)` to wait for `Local: http://localhost:3000/`.
   - **Linux container:** `setsid nohup bun run dev > /var/tmp/dev.log 2>&1 < /dev/null &` then poll `curl localhost:3000/api/health` for 200.
   - Add `AUTH_LOGIN_MAX_PER_MINUTE=100 AUTH_REGISTER_MAX_PER_MINUTE=100` to `.env` when Playwright will register users, or registration answers 429 after three.

## Drive it (agent path)

There is no `chromium-cli` here; `driver.mjs` (Playwright, headless, signs in as the seeded admin) is the way to see a page. Paths are relative to the repository root.

```bash
node .claude/skills/run-modelling-tool/driver.mjs /projects /tmp/projects.png
node .claude/skills/run-modelling-tool/driver.mjs "/projects/{id}/logic" /tmp/logic.png \
  --new-project common/language/examples/crm.eml.mmd --wait 5000
node .claude/skills/run-modelling-tool/driver.mjs /projects/<id>/logic /tmp/x.png --click "Lead Qualification"
```

It prints the project id, final URL, the page's `h1` and the screenshot path; then read the PNG. `--new-project` creates a project from a model file as the signed-in account and fills `{id}`. Env: `BASE_URL`, `TOOL_EMAIL`, `TOOL_PASSWORD`, `PLAYWRIGHT_CHROMIUM_PATH`. For multi-step editor flows use the spec harness instead (`rule-editor-e2e` skill).

## Things that bite

- **A project is reachable only by its owner.** A 404 on `/api/projects/:id/eml` (page stuck on a load error) means the id belongs to another account — use `--new-project`.

- **Background processes die between tool calls** (Postgres and the dev server both). Re-check `pg_isready -h /tmp` and the health URL before a long script; restart with the lines above. Never `pkill -f` a pattern your own command line contains — it kills the shell.
- After a dependency or config change Vite re-optimises and reloads the page once; a script that clicks during that gets a "Something went wrong" overlay. Wait for `.jdm-scope .react-flow` (the rule editor) rather than a fixed sleep.
- **Chromium path is environment-specific:**
  - **macOS:** `PLAYWRIGHT_CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"` — Chrome runs headed (a display exists on macOS).
  - **Linux container:** `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium` (headless only — there is no display). Launch Playwright with `executablePath: "/opt/pw-browsers/chromium"`.
- The container's proxy denies most hosts. Anything fetched from a CDN fails; the app itself must not need one.
- Import a model through the UI: **Import a model** opens a modal with a hidden `input[type=file]` — wait for it to attach, `setInputFiles`, then press the modal's Import button.

## Where things are

Projects list `/projects` · Logic step `/projects/:id/logic` (rules and workflows) · Enhance `/projects/:id/enhance` then `/enhance/<Entity>Service` (hooks, Trigger.dev workflows, Business Rules).
