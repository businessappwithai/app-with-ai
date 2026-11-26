#!/usr/bin/env bun
/**
 * Put the assistant into a generated application's project.
 *
 *   bun scripts/install-into.ts <generated-project-dir>
 *
 * Copies this service's source to `<dir>/assistant` (no node_modules, build output, checkouts,
 * tests or preview), and appends the chat entries to `<dir>/.env`, once: CHAT_BRIDGE_SECRET is
 * never replaced, because the application, the reporting platform and the assistant must all hold
 * the same one. Then:
 *
 *   docker compose -f docker-compose.yml -f assistant/deploy/docker-compose.chat.yml --profile chat up --build
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SKIP = /(^|\/)(node_modules|dist|\.checkouts|__tests__|\.git)(\/|$)|(^|\/)preview\.ts$|\.test\.ts$/;

export function install(target: string, source = resolve(import.meta.dir, "..")): { env: string; wroteSecret: boolean } {
  if (!existsSync(target) || !statSync(target).isDirectory()) throw new Error(`${target} is not a directory`);
  if (!existsSync(join(target, "docker-compose.yml"))) throw new Error(`${target} has no docker-compose.yml: not a generated project`);
  const destination = join(target, "assistant");
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, {
    recursive: true,
    filter: (path) => !SKIP.test(path.slice(source.length + 1)),
  });

  const env = join(target, ".env");
  const current = existsSync(env) ? readFileSync(env, "utf8") : "";
  const has = (name: string) => new RegExp(`^${name}=.+`, "m").test(current);
  const lines: string[] = [];
  let wroteSecret = false;
  if (!has("CHAT_BRIDGE_SECRET")) {
    lines.push(`CHAT_BRIDGE_SECRET=${randomBytes(32).toString("base64url")}`);
    wroteSecret = true;
  }
  for (const [name, value] of [["PUBLIC_ORIGIN", "http://localhost:4080"], ["GATEWAY_PORT", "4080"]] as const) {
    if (!has(name)) lines.push(`${name}=${value}`);
  }
  if (lines.length) appendFileSync(env, `${current && !current.endsWith("\n") ? "\n" : ""}${lines.join("\n")}\n`);
  return { env, wroteSecret };
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir || process.argv.length > 3) {
    console.error("usage: bun scripts/install-into.ts <generated-project-dir>");
    process.exit(2);
  }
  const { env, wroteSecret } = install(resolve(dir));
  console.log(`assistant installed in ${join(resolve(dir), "assistant")}; ${wroteSecret ? "wrote CHAT_BRIDGE_SECRET to" : "kept the existing secret in"} ${env}`);
}
