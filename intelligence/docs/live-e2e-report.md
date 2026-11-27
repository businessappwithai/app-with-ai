# Live E2E report: the assistant in a generated application

Run 2026-11-27 on a CRM project generated with `--with-chat`, with Claude Code as the model (`scripts/claude-model.ts`)
and a real browser (Chromium, Playwright). Two ways of running it, the same scripts against each:

| Run | How | Folder |
|---|---|---|
| Local | PostgreSQL, NestJS :4001, TanStack :4000 (production build), the reporting platform :3100, `assistant/scripts/run-chat.ts` (gateway :4080) | `docs/e2e-screenshots/live/` |
| Docker | `docker compose --profile chat up` (postgres, electric, backend, frontend, report, report-seeder, assistant, nginx gateway) | `docs/e2e-screenshots/docker/` |

| Script | What it holds the assistant to | Local | Docker |
|---|---|---|---|
| `e2e/generated.e2e.ts` | the app's sign-in, a list and a record opened in the frame (ticket link, embed mode), a proposed change that waits for Confirm, the save checked in the application's API, sign-out | 7/7 | 7/7 |
| `e2e/generated-reports.e2e.ts` | the real reporting platform in the frame on a delegated session; a role that may not read a report's tables is refused by the platform (403) and by the assistant | 4/4 | 4/4 |
| `e2e/generated-roles.e2e.ts` | a Support Agent (5 of 17 entities): the application's answer is the standard; the assistant issues no ticket for Opportunity (same answer as a missing record), lists exactly the 5 readable entities, and opens the allowed list | 4/4 | 4/4 |
| `e2e/generated-switches.e2e.ts` | chat-only (browser sent into the chat, API 403 `CHAT_ONLY`, administrator exempt, assistant still works) and switched-off (assistant says so, no tickets, application unaffected); both switches restored | 8/8 | 8/8 |

## Found while doing it

1. **`vendor-assistant.ts` imported `node:crypto`**, so `build:fullstack-browser` bundled crypto-browserify and elliptic: 1.1 MB to 2.0 MB.
   Fixed with Web Crypto; `vendor-assistant.test.ts` fails without the fix.
2. **`deploy/docker-compose.chat.yml` was not valid YAML** (an unquoted colon in a `${VAR:?message}`). Found by `docker compose config`;
   quoted, and `deploy.test.ts` now parses it.
3. **`website/html/assets/appwithai-fullstack.js` was already stale** at the base commit (the admin Tabs/Users/Roles pages were added
   without a rebuild). Rebuilt. Every line outside the changed regions is byte-identical to the previously committed bundle.
4. **The generated app's own login form returns to itself** after a successful sign-in, in a local run, with chat-only on or off and
   directly on :4000 (the session cookie is set and `get-session` returns the session; the SPA then bounces from `/dashboard` to
   `/auth/login`). Opening `/dashboard` with a session already present works. **Not fixed**; it is in the generated frontend and
   not part of the chat work. The chat-only test signs in through `POST /api/auth/sign-in/email` instead.
5. **A model turn can end silently.** Once the model shim's `claude -p` call failed, and the chat showed the first tool chip and then
   nothing: no error text. It did not reproduce. Not fixed; the assistant should say something when a turn fails.
6. The generated Dockerfiles for backend, frontend and report do not trust an extra CA (only the root Dockerfile does), so they cannot
   build behind a TLS-intercepting proxy without help. Not changed.

## Limits

- **Bun 1.4.6 is not published** (npm's latest is 1.4.5, no 1.4.6 tag). Every Dockerfile pins `oven/bun:1.4.6`; for the Docker run
  the `1.4.5` images were retagged locally as `1.4.6`, with a CA layer for this sandbox's proxy. The full-stack bundle was built
  with Bun 1.4.4; `--check` passes locally, which proves only that the file matches what this Bun builds.
- The Docker run used `overlay2` after `vfs` ran out of disk, and the model shim listened on all interfaces for the containers.
- The model is Claude Code behind an OpenAI-style shim: a real model, but not the local Qwen the product defaults to.
- Not covered: the Buzz relay (threads and memory are in memory here), the WebSocket sidebar updates, a second replica, `chat` against a
  model with weak tool calling.
