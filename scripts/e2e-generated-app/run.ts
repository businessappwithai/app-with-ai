/**
 * Validate a generated application end to end.
 *
 *   bun scripts/e2e-generated-app/run.ts --model <model.eml.mmd> [options] [<playwright args>]
 *
 *   --project <dir>        the generated application (backend/, frontend/, tests/)
 *   --generate             generate --project from --model first (needs --database-url)
 *   --database-url <url>   the database to generate into
 *   --api-suites           also run the application's own API suites (tests/run.ts)
 *   --project-id <id>      the seeded accounts' domain (default my-app)
 *
 * With no --project, the application must already be running at E2E_APP_URL
 * (default http://127.0.0.1:4000) and E2E_API_URL (http://127.0.0.1:4001).
 * With one, any half that is not answering is started from it: the backend on
 * Bun with the auth rate limits raised (every request comes from one address), and
 * the front end's production build (built first if it has none) — never the dev
 * server, which peaks near 14 GB.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { join, resolve } from "node:path";

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, "../..");
const args = process.argv.slice(2);
/** The runner's own options, and which of them take a value. */
const OWN = new Map([
  ["--model", true],
  ["--project", true],
  ["--database-url", true],
  ["--project-id", true],
  ["--generate", false],
  ["--api-suites", false],
]);
/*
 * Everything that is not one of the runner's options goes to Playwright — a spec
 * path, `-g <title>`, `--reporter=list`. `bun run test:e2e:generated-app -- <spec>`
 * delivers the spec here without a second `--`, so requiring one silently ran
 * every spec instead of the one asked for.
 */
const pass: string[] = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "--") continue;
  if (OWN.has(arg)) {
    if (OWN.get(arg)) i++;
    continue;
  }
  pass.push(arg);
}
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const model = resolve(option("--model") ?? join(ROOT, "tests/test-data/hospital-computed-fields.eml.mmd"));
const project = option("--project") ? resolve(option("--project")!) : undefined;
const projectId = option("--project-id") ?? "my-app";
const appUrl = process.env.E2E_APP_URL ?? "http://127.0.0.1:4000";
const apiUrl = process.env.E2E_API_URL ?? "http://127.0.0.1:4001";

function run(command: string, argv: string[], cwd: string, env: Record<string, string> = {}): number {
  const result = spawnSync(command, argv, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
  return result.status ?? 1;
}

async function answers(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { redirect: "manual" });
    return response.status > 0;
  } catch {
    return false;
  }
}

async function waitFor(url: string, label: string, seconds: number): Promise<void> {
  for (let i = 0; i < seconds; i++) {
    if (await answers(url)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${label} did not answer at ${url} within ${seconds}s`);
}

function start(command: string, argv: string[], cwd: string, log: string, env: Record<string, string>): void {
  const out = openSync(log, "a");
  spawn(command, argv, { cwd, detached: true, stdio: ["ignore", out, out], env: { ...process.env, ...env } }).unref();
}

async function main(): Promise<void> {
  if (flag("--generate")) {
    if (!project) throw new Error("--generate needs --project <dir>");
    const database = option("--database-url");
    if (!database) throw new Error("--generate needs --database-url <url>");
    const code = run("bun", ["packages/generator/src/cli/generate.ts", "generate", "-i", model, "-o", project, "--force", "--database-url", database], ROOT);
    if (code !== 0) process.exit(code);
  }

  if (run("bun", [join(HERE, "facts.ts"), model, "--project-id", projectId], ROOT) !== 0) process.exit(1);

  if (project) {
    if (!(await answers(`${apiUrl}/api/auth/get-session`))) {
      console.log("starting the backend");
      // One address makes every request of the run: lift the per-client limits
      // on signing in and on the session reads every page makes (/api/auth).
      start("bun", ["run", "src/main.ts"], join(project, "backend"), join(project, "e2e-backend.log"), {
        AUTH_SIGNIN_MAX: "1000",
        AUTH_RATE_MAX: "100000",
        // The API's own limiter: one bucket per route handler, shared by every
        // entity, so a run over a large model exceeds the development default
        // and each refusal costs a 60-second window. As CI and compose set it.
        THROTTLE_LIMIT: "1000000",
      });
    }
    if (!(await answers(appUrl))) {
      const frontend = join(project, "frontend");
      if (!existsSync(join(frontend, ".output"))) {
        console.log("building the front end (first run takes several minutes)");
        if (run("bun", ["run", "build"], frontend) !== 0) process.exit(1);
      }
      console.log("starting the front end");
      start("bun", ["run", "start"], frontend, join(project, "e2e-frontend.log"), {});
    }
  }
  await waitFor(`${apiUrl}/api/auth/get-session`, "the backend", 180);
  await waitFor(appUrl, "the front end", 180);

  let failed = false;
  if (flag("--api-suites")) {
    if (!project) throw new Error("--api-suites needs --project <dir>");
    console.log("\n== the application's API suites");
    failed ||= run("node", ["run.ts", "--no-server", "--small"], join(project, "tests"), { E2E_API_URL: apiUrl }) !== 0;
  }

  console.log("\n== the browser suite");
  // A machine whose installed Chromium is not the build this Playwright version
  // expects (a container with browsers pre-installed) runs the one it has.
  const preinstalled = "/opt/pw-browsers/chromium";
  const browser =
    process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync(preinstalled) ? preinstalled : undefined);
  failed ||= run("bunx", ["--bun", "playwright", "test", "-c", "playwright.config.ts", ...pass], HERE, {
    E2E_APP_URL: appUrl,
    E2E_API_URL: apiUrl,
    ...(browser ? { PLAYWRIGHT_CHROMIUM_PATH: browser } : {}),
  }) !== 0;
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
