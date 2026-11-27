#!/usr/bin/env bun
/**
 * Run the assistant and its one-origin gateway beside a running generated application, without Docker.
 *
 *   bun assistant/scripts/run-chat.ts        # from a generated project, with the app on :4000 and :4001
 *
 * Reads the project's `.env` (written by the generator: CHAT_BRIDGE_SECRET, PUBLIC_ORIGIN, GATEWAY_PORT),
 * installs and builds the assistant on first use, starts it on :4200 and the gateway on GATEWAY_PORT.
 * People then use http://localhost:4080 : `/` is the application, `/chat/` the assistant, `/report/` the
 * reporting platform when it runs on REPORT_URL (default http://127.0.0.1:3100).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const here = resolve(import.meta.dir, "..");
const project = resolve(here, "..");

export function readEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) out[match[1]!] = match[2]!;
  }
  return out;
}

if (import.meta.main) {
  const envFile = join(project, ".env");
  const file = existsSync(envFile) ? readEnv(readFileSync(envFile, "utf8")) : {};
  const secret = file.CHAT_BRIDGE_SECRET ?? process.env.CHAT_BRIDGE_SECRET;
  if (!secret) {
    console.error(`No CHAT_BRIDGE_SECRET in ${envFile}. Generate the project with --with-chat.`);
    process.exit(1);
  }
  const run = (command: string[], env: Record<string, string> = {}) =>
    Bun.spawn(command, { cwd: here, env: { ...process.env, ...env }, stdout: "inherit", stderr: "inherit" });

  if (!existsSync(join(here, "node_modules"))) await run(["bun", "install", "--frozen-lockfile", "--ignore-scripts"]).exited;
  if (!existsSync(join(here, "dist/client"))) await run(["bun", "run", "build"], { CHAT_BASE_PATH: "/chat" }).exited;

  const port = file.GATEWAY_PORT ?? "4080";
  const origin = file.PUBLIC_ORIGIN ?? `http://localhost:${port}`;
  const skills = join(project, "assistant-skills");
  const children = [
    run(["bun", "server.ts"], {
      PORT: "4200",
      CHAT_BASE_PATH: "/chat",
      PUBLIC_ORIGIN: origin,
      CHAT_BRIDGE_SECRET: secret,
      APP_API_URL: process.env.APP_API_URL ?? "http://127.0.0.1:4001",
      APP_BASE_PATH: "",
      REPORT_URL: process.env.REPORT_URL ?? "http://127.0.0.1:3100",
      REPORT_BASE_PATH: "/report",
      CHAT_SKILLS_DIR: existsSync(skills) ? skills : "",
      AI_BASE_URL: file.AI_BASE_URL ?? process.env.AI_BASE_URL ?? "http://127.0.0.1:8000/v1",
      AI_MODEL: file.AI_MODEL ?? process.env.AI_MODEL ?? "qwen3.6:27b-mlx",
      COPILOTKIT_TELEMETRY_DISABLED: "true",
      DO_NOT_TRACK: "1",
    }),
    run(["bun", "scripts/gateway.ts"], { GATEWAY_PORT: port, APP_URL: process.env.APP_URL ?? "http://127.0.0.1:4000", ASSISTANT_URL: "http://127.0.0.1:4200", REPORT_URL: process.env.REPORT_URL ?? "http://127.0.0.1:3100" }),
  ];
  console.log(`\nChat: ${origin}/chat/   (the application at ${origin}/)`);
  const stop = () => children.forEach((child) => child.kill());
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await Promise.race(children.map((child) => child.exited));
  stop();
}
