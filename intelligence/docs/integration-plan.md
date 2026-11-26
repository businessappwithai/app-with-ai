# Integrating `intelligence/` into app-with-ai — architectural design plan

**Status: proposal, awaiting approval. Nothing here is implemented yet.**

This plan integrates the chat and natural-language interface in `intelligence/` with this repository and with
the applications it generates. It does **not** change the service's architecture: the layers, the identity
model, the intent registry, tickets, the propose-and-confirm write path, the Intelligence interface and its
providers all stay as they are. The work is plumbing, hygiene, delivery and verification around them.

---

## 1. What the code is (as built)

`intelligence/` is a standalone Bun 1.4.6 service: a Vite + React client and a `Bun.serve` server on the
open-source CopilotKit 1.88.0 runtime. It is a third, optional way into the two products a model generates —
the NestJS + TanStack application and the Enterprise Reporting platform. A person asks; the assistant finds,
reads, opens and proposes changes, always as that person.

### 1.1 Layers

```
browser ──/chat/*────────────────────────────────────────────► src/client/ (own React client today;
                                                                 OpenBot's MIT app is the planned client)
        ──/chat/api/*, /chat/api/copilotkit/*, /chat/api/v2/*──► server.ts → src/server/app.ts (one fetch fn)
                                                                     │
  src/server/      identity (forwarded app cookie) · tools (13 + recall_memory) · registry (intent → path)
                   tickets · actions (propose/confirm) · switches · audit · rate limits · skills · signing
  src/openbot/     the ~35 OpenBot operations its client calls; everything else 501 problem+json
  src/runtime/     IntelligenceRunner — CopilotKit AgentRunner over the interface (no CopilotKit internals)
  src/interface/   the Intelligence contract: threads · runs · memory · changes  (+ conformance suite)
  src/providers/   memory/ (tests, dev)    buzz/ (production: Nostr relay, NIP-98/42/44/AE/AR)
                                                                     │
               generated app backend (:4001, /api/*)       reporting platform (/report/api/*)
               — called with the person's own cookie        — called with a delegated per-person session
```

### 1.2 The five flows that define it

| Flow | How it works | Where |
|---|---|---|
| **Identity** | The service shares an origin with the generated app, reads its Better Auth session cookie, and forwards it on every call. It has no users, roles or passwords. Sign-in posts pass through to the app's `/api/auth/*`. | `app.ts` `identify`, `passAuthThrough`; `products.ts` `AppClient.me` |
| **Reporting** | A 60 s single-use HMAC assertion (`aud: report-delegate`) carrying email, name, app roles and admin flag — read from the app, never the browser — is exchanged at `POST /report/api/chat/delegate` for a per-person reporting session. | `products.ts` `delegateReportSession`; `signing.ts` |
| **Navigate by intent** | Tools return `{product, kind, object, id}`. The chat exchanges it for a 256-bit, 60 s, single-use, person-bound ticket; `/chat/open/<ticket>` sets a signed `chat_embed` cookie and 302s to the real page with `?embed=1`. `registry.ts` is the only place a path is written, and only after the product confirmed read access. | `registry.ts`, `tickets.ts`, `app.ts` `/open/` |
| **Writes** | `propose_move` / `propose_update` only file a proposal (version-pinned, status/identity/audit columns refused). The person's own same-origin JSON POST to `/chat/api/actions/<id>/confirm` runs the app's own transition or PATCH with `If-Match`, so guards, rules, workflows and the 409 apply. | `actions.ts`, `tools.ts`, `app.ts` |
| **Administrator control** | `CHAT_ENABLED` / `CHAT_ONLY_MODE` live in the app's `sys_system`, read via `/api/sys/app-info`, relayed at `/chat/switches` (503 until known, persisted in `chatdb`). Chat-only is enforced by the app's `SessionAuthGuard` (403 `CHAT_ONLY`) and by reporting. | `switches.ts`; generator `chat-bridge.ts` |

### 1.3 State

| What | Store | Notes |
|---|---|---|
| Tickets, audit, switches | `chatdb` (PostgreSQL) via `CHAT_DATABASE_URL`, else memory | Tables self-create on first use (`database.ts`) |
| Threads, runs, memory | Intelligence interface → Buzz relay when `BUZZ_*` + `KEY_ENCRYPTION_KEY` are all set, else memory | A partial Buzz config is refused |
| Custodial Nostr keys | `ob_keys` in `chatdb`, AES-256-GCM under `KEY_ENCRYPTION_KEY` | Never rotate casually |
| Pending proposals, rate-limit counters, live runs, caches | Process memory | Single replica today |

### 1.4 What the generated application already provides for it

Already in this repository's generator (CLAUDE.md, "The chat assistant's side of a generated application"):
`CHAT_ENABLED` / `CHAT_ONLY_MODE` seeds; `/api/sys/app-info` `chatEnabled`/`chatOnlyMode`; `backend/src/common/chat-bridge.ts`
(verifies `chat_embed` and `x-chat-bridge`); `CHAT_ONLY` in the error catalogue; embed mode in `app-layout.tsx`;
`app:signed-out` postMessage; `/chat/` redirect in `api-client.ts`; `assistant-skills/` written by `manual/skills.ts`;
`/api/me`, `/api/me/permissions`, `/api/sys/tables`, `/bus/:e?search=&awaiting=me`, `/bus/:e/:id/actions`,
`/bus/:e/:id/transition`. Held by `templates/__tests__/chat-bridge.test.ts`.

The orchestrator copy (`common/app_and_report/`) already wires the service: compose `assistant`, `buzz-relay`,
`buzz-redis` under profile `chat`, nginx `location /chat/`, `pg-init` `chatdb`/`buzzdb`, `start.sh --with-chat`.

---

## 2. Findings from the review (verified in this session)

These are why the integration is more than "add a compose service". Each was checked, not inferred.

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| F1 | **The root `.gitignore` silently drops part of the service.** `*.test.ts` (line 9) and `*.generated.*` (line 115) match `intelligence/**`, and only `packages/**` is negated. | `git check-ignore -v` on `src/server/__tests__/app.test.ts` and `src/openbot/operations.generated.json`; only `__tests__/fakes.ts` is present; `src/interface/__tests__/`, `src/openbot/__tests__/`, provider tests are absent | `bun check` fails: `TS2307 Cannot find module './operations.generated.json'` (1 error, 35 files). `bun test src` finds **0 tests**. `server.ts` → `app.ts` → `openbot/api.ts` cannot import, so **the service does not start** from this tree |
| F2 | **Two byte-identical copies**: `intelligence/` and `common/app_and_report/intelligence/` | `diff -rq` empty | Violates "shared files live once and are synced"; both will drift |
| F3 | **Bun pin violated**: `Dockerfile` uses `oven/bun:1.4.4`. Type-check/lint do not run `scripts/require-bun.ts` | `Dockerfile` lines 3, 11 | Against the 1.4.6-only rule; bundle bytes differ by version |
| F4 | `package.json` `start` runs `server-static-wrapper.mjs`, which does not exist | file listing | `bun run start` fails (Docker `CMD` uses `server.ts`, so the image is unaffected) |
| F5 | `scripts/openbot-operations.ts` reads `../deps.json`, which exists only in the orchestrator copy | root has no `deps.json` | The operations table cannot be regenerated or `--check`ed from the root copy |
| F6 | Not built, type-checked or tested by this repository's CI; not a workspace; no CI job | `.github/workflows/ci.yml` has no chat job | Breakage (like F1) is invisible |
| F7 | **A generated application's own deliverable has no assistant.** Its `docker-compose.yml` serves frontend `:4000`, backend `:4001`, report `:3100` (report at its root, not `/report`), and has no single-origin gateway | `templates/tanstack-start-nestjs/docker-compose.yml.hbs` | The assistant needs one origin for the cookie, `Origin` checks and framing, and `REPORT_BASE_PATH` (`/report`) |
| F8 | Planned phases 13–14 (OpenBot client, approvals view, proposals in `chatdb`, cut-over) are not done; `docker/openbot-app.Dockerfile` does not exist | `intelligence.md` §13–14 | `/chat/api/v2/*` is served but no OpenBot client ships; `src/client/` is the UI |
| F9 | Proposals (`ActionStore`), rate limits and live runs are in process; `Idempotency-Key` is not honoured | `actions.ts`, `ratelimit.ts`, `intelligence.md` §11 | One replica only |
| F10 | Logs are bare `console.*`; the repository's rule is named events from `log-spec.json` | `server.ts`, `intelligence-runner.ts` | Inconsistent with every other service here |
| F11 | Default model differs from the repo's (`qwen3.6:27b-mlx` vs `LOCAL_AI_MODEL` default) and the env names differ (`AI_*` vs `LOCAL_AI_*`) | `config.ts` | Set by compose; no code change needed |
| F12 | CopilotKit 1.88.0 here, 1.68.1 in the generated frontend | `package.json`s | Fine while they stay separate packages; must never be hoisted together |

---

## 3. Integration principles (what does not change)

1. **Architecture is frozen.** No change to the layer boundaries in §1.1, the tool set, the registry's sole
   ownership of paths, ticket semantics, the propose/confirm path, the signed-statement format, or the
   Intelligence interface. Code changes are limited to defects (F1, F3–F5) and configuration surfaces.
2. **The assistant decides nothing about access.** The person's session is forwarded; the app's and reporting's
   guards answer. Every integration test asserts parity with the product's own API, never the assistant's view.
3. **The model never sees or writes an address.**
4. **Nothing is written without the person's own press.**
5. **Open source only**: no CopilotKit Intelligence, no licence key, `COPILOTKIT_TELEMETRY_DISABLED=true`, `DO_NOT_TRACK=1`.
6. **Repository rules apply**: Bun 1.4.6 only; `bun check` is the only static check; no script named `check`;
   one home per shared file, synced copies; generator inputs added once in `GenerationSettings`; nothing scans a
   template directory implicitly.
7. **Optional and off by default.** A generated application without the chat profile is byte-for-byte what it is
   today, and the WASM / `--standalone` stack gets nothing (there is no assistant in a tab).

---

## 4. Target architecture

### 4.1 Where the code lives

```
app-with-ai/
├── intelligence/                    ◄ the one home (standalone Bun project, own bun.lock, NOT a workspace)
│   ├── deps.json                    ◄ new: pins buzz + openbot for this copy (fixes F5)
│   └── …unchanged layout…
├── common/app_and_report/
│   └── intelligence/                ◄ synced copy written by `bun run sync:common`, git-ignored (fixes F2)
├── packages/generator/
│   ├── src/generators/tanstack-start-nestjs/vendor-assistant.ts   ◄ new, modelled on vendor-editors.ts
│   └── templates/tanstack-start-nestjs/
│       ├── assistant/               ◄ vendored at generation time, git-ignored, never committed
│       ├── gateway/nginx.conf.hbs   ◄ new: single origin for the chat profile
│       └── docker-compose.yml.hbs   ◄ + `assistant`, `gateway` (profile chat), `<e2e>`-style markers
└── .github/workflows/ci.yml         ◄ + "Chat assistant" job
```

**Why not a Bun workspace member:** it would put CopilotKit 1.88 and `@ag-ui/*` into the same resolution as
`packages/web` (CopilotKit 1.68 line) and `packages/ai` (Mastra). The service already has its own lockfile and
its own Docker context; keeping it standalone keeps both trees reproducible. Root scripts call into it with
`cd intelligence && bun run …`.

### 4.2 Three delivery surfaces

| Surface | Today | After |
|---|---|---|
| **This repository** (source of truth) | Copy that does not compile or test (F1) | Builds, type-checks, tests and is held by CI |
| **Orchestrator** (`common/app_and_report`, one origin via nginx: `/app`, `/report`, `/chat`) | Wired, but its own copy | Consumes the synced copy; wiring unchanged |
| **A generated application's own compose** (`docker compose --profile chat up`) | No assistant (F7) | `assistant` + `gateway` under profile `chat`, opt-in at generation |

### 4.3 The generated application with chat — topology

```
                        http://localhost:${GATEWAY_PORT:-4080}   (one origin = PUBLIC_ORIGIN)
                                         │
                                   gateway (nginx, profile chat)
            ┌────────────────────────────┼─────────────────────────────┐
         /  │ /api/* /assets …        /chat/                        /report/
            ▼                            ▼                              ▼
     frontend :4000 ──/api──► backend :4001     assistant :4200      report :3000 (built for /report)
                                  ▲    ▲            │  │                    ▲
                                  │    └── cookie ──┘  └── delegated ───────┘
                                  │      + x-chat-bridge     session
                                postgres: appdb · enterprise_config · chatdb
```

- `APP_BASE_PATH=""` (the generated app lives at the origin root; `$entity.$id` routes already exist, so the
  registry's `/<table>/<id>?embed=1` resolves). `REPORT_BASE_PATH=/report`.
- `CHAT_BRIDGE_SECRET` is shared by backend, report and assistant. The backend's `CORS_ORIGIN` and the report's
  `CORS_ORIGIN` / `BETTER_AUTH_URL` gain the gateway origin.
- The direct ports (4000, 4001, 3100) keep working exactly as today for anyone not using the chat profile.
- `CHAT_SKILLS_DIR` mounts the project's own `assistant-skills/` read-only.
- Threads/memory: the **memory provider** by default; Buzz is a second opt-in profile (`chat-durable`), see D3.

### 4.4 Generation-time switch

One new input, added once in `GenerationSettings` (`generate-application.ts`): `chat: boolean` (CLI
`--with-chat`, `/api/generate` field). When false nothing changes. When true:

1. `ensureAssistantVendored` copies `intelligence/` (minus `node_modules`, `dist`, `.checkouts`, `__tests__`,
   `scripts/preview.ts`) into the output's `assistant/`. Same rules as `vendor-editors.ts`: only
   `node:fs/promises` + `node:path`, never reached by the browser bundles with a source tree.
2. The compose template renders the `assistant` and `gateway` services and the gateway `nginx.conf`.
3. `.env.example` gains `CHAT_BRIDGE_SECRET`, `GATEWAY_PORT`, `AI_*` (with a note to generate the secret once).
4. The generated README and `manual.html` gain a "Chat" section.
5. The generated `tests/` gain suite `30-chat` (see §6).

---

## 5. Phased plan

Each phase ends green on its own and is a separate commit. Phases A–C are prerequisites; D is the main
integration; E is the proof; F is a separate decision.

### Phase A — Make the service whole in this repository (fixes F1, F3, F4, F5)

| Step | Change |
|---|---|
| A1 | `.gitignore`: negate `!intelligence/**/__tests__/*.test.ts` and `!intelligence/src/openbot/operations.generated.json` (comment why, like the existing E2E negation) |
| A2 | Restore the missing files — tests (`src/server/__tests__/*.test.ts`, `src/interface/__tests__/`, `src/openbot/__tests__/`, `src/providers/*/__tests__/`, runner tests) and `operations.generated.json` — from the orchestrator repository at the commit this copy came from (D2). If unavailable, regenerate the table with `bun scripts/openbot-operations.ts` against OpenBot at the pinned `3d8a716` and rewrite the tests from `intelligence.md` §Verification |
| A3 | `intelligence/deps.json` with the `buzz` and `openbot` pins; `openbot-operations.ts` reads it (one-line path change) |
| A4 | `Dockerfile`: `oven/bun:1.4.6` in both stages; add `DO_NOT_TRACK=1` |
| A5 | `type-check` / `lint`: `bun ../scripts/require-bun.ts && bun check`; `start`: `bun server.ts` |
| A6 | Root `package.json`: `assistant:check` (`cd intelligence && bun install --frozen-lockfile && bun run check:all`) and `assistant:build` |

**Done when:** `bun check` 0 errors; `bun test src` runs the restored suites green, including the memory provider's
conformance suite; `bun run build`; `bun scripts/preview.ts` serves the stand-in chat on :4300.

### Phase B — CI (fixes F6)

New job **Chat assistant** in `.github/workflows/ci.yml`, `BUN_VERSION: "1.4.6"`:
install (frozen) → `type-check` → `test` → `build` → `check:openbot-operations` (sparse checkout of OpenBot
`api/` at the pin) → `bun run sync:common -- --check`. The Buzz conformance run against a real relay stays in the
orchestrator's composed workflow (it needs a Rust build, ~4 min); here it is skipped with a visible notice, never
silently.

### Phase C — One home, synced (fixes F2)

Add `intelligence/` to the lists in `scripts/sync-common.ts` with destination
`common/app_and_report/intelligence/`; remove the committed copy and let the managed `.gitignore` block cover
it. The orchestrator compose (`context: ./intelligence`) is unchanged. Document in CLAUDE.md that the orchestrator
repository's `assistant/` must be brought level the same way the language copies are.

### Phase D — Deliver it in every generated application (fixes F7)

| Step | Change |
|---|---|
| D1 | `GenerationSettings.chat` + CLI `--with-chat` + `/api/generate` field (one definition, no call-site defaults) |
| D2 | `vendor-assistant.ts` + `bun run vendor:assistant`; template `assistant/` git-ignored; a test that fails if the template holds a tracked copy (as `vendor-editors.test.ts` does) |
| D3 | `docker-compose.yml.hbs`: `assistant` and `gateway` services under profile `chat`, rendered only when `chat` is on (`# <chat>` markers, like `# <e2e>`); `chatdb` created by the assistant itself (it already does) |
| D4 | `gateway/nginx.conf.hbs`: `/` → frontend, `/chat/` → assistant (WebSocket upgrade for `conversation-events`, `X-Real-IP`, long read timeout for model turns), `/report/` → report. Health checks on `127.0.0.1` (CLAUDE.md docker rule) |
| D5 | Reporting under `/report`: pass the platform's base-path build argument in `reporting/Dockerfile` when chat is on (D4 decision; depends on the reporting repository supporting it — the orchestrator already builds it "for its prefix") |
| D6 | Env plumbing: `CHAT_BRIDGE_SECRET` on backend/report/assistant; gateway origin added to both `CORS_ORIGIN`s and report `BETTER_AUTH_URL`; `CHAT_EMBED=1`, `CHAT_SWITCHES_URL=http://assistant:4200/chat/switches`, `CHAT_URL=/chat/` on report |
| D7 | Generated README / `manual.html` "Chat" section; `.env.example` entries |
| D8 | `templates/__tests__/chat-profile.test.ts`: with `chat` off the compose and file set are unchanged; with it on the services, env and gateway routes are present and every secret is shared by name |
| D9 | Regenerate the active project (CLAUDE.md "Regenerate after design changes"), then `build:fullstack-browser --check` and the other four `--check`s — the pipeline change can stale the browser bundle; rebuild on linux-x64 Bun 1.4.6 if so |

### Phase E — Prove it

1. **Generated suite `30-chat`** (no language model needed — it drives the HTTP surface): sign in through
   `/chat/api/auth`; `/chat/api/session`; issue tickets for a readable and an unreadable entity and compare with
   `/api/bus/...` as the same person (**RBAC parity**: identical allow/deny, one neutral wording); redeem a ticket
   twice, late, and as another person; `CHAT_ONLY_MODE` on → direct `/api` refused with `CHAT_ONLY`, same call
   with `x-chat-bridge` admitted, administrator exempt; `CHAT_ENABLED` off → `/chat/api/*` 403; confirm a proposal
   with wrong `Origin` / non-JSON refused.
2. **Scripted-model E2E** (Playwright, `tests/ui`): the existing `fakes.ts` model drives search → open → frame
   renders without chrome → propose → confirm → record changed through the app's transition.
3. **Per-role parity on the CRM model** for every declared role, as `intelligence.md` requires.
4. **A real model run** against the local OpenAI-compatible endpoint (`./scripts/start-llm.sh`), recorded in
   `docs/`, since none has been made yet.
5. QA with `qa-lifecycle-workflows` and `qa-app-with-ai` on the composed stack.

### Phase F — Not part of this approval: the planned next shape

`intelligence.md` phases 13–14 (OpenBot client at `/chat`, proposals in OpenBot's approvals view and in `chatdb`,
`Idempotency-Key`, deleting `src/client/`) are the service's own roadmap. They change what a person sees, not
how it integrates, and they need their own review. This plan leaves the seams for them untouched.

---

## 6. Verification matrix

| Level | What | Command / place |
|---|---|---|
| Static | `bun check` in `intelligence/`; root type-check unaffected | `bun run assistant:check`, `bun run type-check` |
| Unit | tickets, signing, registry, tools, actions, switches, rate limits, runner, OpenBot contract | `bun test src` |
| Contract | every provider passes `interface/conformance.ts`; OpenBot responses validated against `openapi.yaml` | same |
| Generator | `chat-profile.test.ts`, existing `chat-bridge.test.ts`, vendoring test | `bun run test` |
| Artifacts | five `--check` comparisons; `sync:common -- --check` | CI job 1 |
| Generated app | suite `30-chat` with the rest, run twice on one database (CLAUDE.md harness rule) | `docker compose --profile chat run --rm e2e` |
| Browser | scripted-model E2E | `docker compose --profile chat run --rm e2e-ui` |
| Security | review of key custody, the delegate endpoint, tickets, chat-only, gateway headers | before merge |

---

## 7. Security notes for the review

- `CHAT_BRIDGE_SECRET` ≥ 32 chars, generated once, never defaulted in production (`config.ts` already throws).
  The generated `.env.example` leaves it empty, and the backend then never applies chat-only (fail-open on
  *where people work*, never on *what they may read*).
- The gateway must set `X-Real-IP` from the connection and must not forward a client-supplied one
  (`ratelimit.ts` trusts it).
- `frame-ancestors` on the app and report must name only the gateway origin when chat is on.
- The frame's real address is visible in developer tools; chat-only refusal outside the frame is the control.
- Custodial keys only exist with Buzz (D3); losing `KEY_ENCRYPTION_KEY` loses every identity.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| The missing tests cannot be recovered and must be rewritten (A2) | Rewrite from `intelligence.md` §Verification; conformance suite first, it is the provider contract |
| Reporting cannot be built for `/report` from the generated project | Fall back to proxying report at root of a second gateway port with `REPORT_BASE_PATH=""` — registry already supports an empty prefix; costs one origin, so the reporting frame needs its own `frame-ancestors` |
| The vendored assistant inflates every generated zip | Opt-in only; ~50 source files, no `node_modules` |
| Local model tool calling is weak | Measured in E4; the system prompt and tool shapes are unchanged by this plan |
| Version skew (Bun 1.4.4 in this container, CopilotKit 1.88 vs 1.68) | Builds and bundle checks done on 1.4.6 in Docker; packages kept separate |
| In-memory proposals / single replica | Documented limit; replicas stay at 1 until Phase F moves proposals to `chatdb` |

---

## 9. Decisions needed before implementation

| # | Question | Recommendation |
|---|---|---|
| **D1** | Which copy is canonical? | Root `intelligence/`; the orchestrator copy synced from it; the upstream orchestrator repo kept level by hand, as the language copies are |
| **D2** | Where do the lost tests and `operations.generated.json` come from? | Recover from the orchestrator repository (`businessappwithai/app-and-report-with-ai-tanstack`) — needs read access added to this session; else regenerate and rewrite |
| **D3** | Threads and memory in a generated app: memory provider, or Buzz? | Memory provider by default (no Rust build, no Redis); Buzz behind a second profile `chat-durable`. Conversations do not survive a restart without it, which the README states |
| **D4** | Single origin for the generated app via a new `gateway` nginx, with reporting under `/report`? | Yes (§4.3); fallback in §8 if the reporting image cannot take a base path |
| **D5** | Should the assistant adopt the repository's `log-spec.json` events (F10)? | Yes, as a derived copy like `generated-spec.ts` (the service cannot import `@appwithai/core`). Small, but it touches every log line, so it needs your yes |
| **D6** | Is Phase F (OpenBot cut-over) in or out of this piece of work? | Out; separate plan and approval |

## 10. Out of scope

The WASM / `--standalone` stack; any change to tools, prompts, the registry or the Intelligence interface;
multi-replica operation; field-level access in the generated application; new language (EML) directives.
