/**
 * Put the chat assistant into a generated project.
 *
 * The assistant has one source, `intelligence/` at the root of this repository. A generated
 * project is standalone, so when it is generated with `chat` it receives that source at
 * `assistant/` — including `assistant/deploy/`, the compose overlay and the one-origin gateway
 * that run it — and a `.env` that makes `docker compose --profile chat up` pick the overlay up
 * (`COMPOSE_FILE`). Nothing is written without `chat`, so a project generated without it is
 * byte-for-byte what it was.
 *
 * Where the source comes from:
 *  - a checkout: `<repo>/intelligence`;
 *  - a published package: `templates/assistant`, which the generator's build fills.
 *
 * Only `node:fs/promises` and `node:path`, and Web Crypto for the secret — never `node:crypto`: the
 * full-stack browser bundle reaches this file, and Bun polyfills `node:crypto` there with
 * crypto-browserify and elliptic, which doubled that bundle (1.1 MB to 2.0 MB). `chat` is off in the
 * browser, so none of this runs there.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Present in the source, so its presence says the copy is whole. */
const MARKER = "server.ts";

/** What a project does not want from the service: dependencies, build output, tests, previews, QA output. */
const SKIP =
  /(^|\/)(node_modules|dist|\.checkouts|__tests__|\.git|e2e|ci)(\/|$)|(^|\/)docs\/(e2e-screenshots|qa-report[^/]*)|(^|\/)scripts\/(preview|qa-claude|claude-model|install-into|chat-keys|openbot-operations)\.ts$|\.test\.ts$/;

/** Written to `.env` once; the bridge secret is generated here and never replaced. */
export const CHAT_COMPOSE_FILE = "docker-compose.yml:assistant/deploy/docker-compose.chat.yml";

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function copyTree(source: string, destination: string, relative = ""): Promise<number> {
  const entries = await fs.readdir(source, { withFileTypes: true });
  await fs.mkdir(destination, { recursive: true });
  let copied = 0;
  for (const entry of entries) {
    const inner = relative ? `${relative}/${entry.name}` : entry.name;
    if (SKIP.test(inner)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copied += await copyTree(from, to, inner);
    else {
      await fs.copyFile(from, to);
      copied++;
    }
  }
  return copied;
}

/** The assistant's source: the checkout's `intelligence/`, else the one a published package ships. */
export async function findAssistantSource(templatesDir: string): Promise<string> {
  for (const candidate of [path.resolve(templatesDir, "../../../intelligence"), path.join(templatesDir, "assistant")]) {
    if (await exists(path.join(candidate, MARKER))) return candidate;
  }
  throw new Error(
    "The chat assistant's source was not found. In a checkout it is intelligence/ at the repository " +
      "root; in a published package it ships inside templates/assistant."
  );
}

/** 32 random bytes as base64url, from Web Crypto (global in Node and in the browser). */
export function newSecret(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The gateway's address: the one origin people use when the assistant is on. */
export const CHAT_ORIGIN = "http://localhost:4080";

/** The value of `name` in an env file's text, or null. */
const envValue = (text: string, name: string): string | null => new RegExp(`^${name}=(.+)$`, "m").exec(text)?.[1]?.trim() ?? null;

/** The `.env` lines chat needs, skipping any name the file already sets. Never replaces a secret. */
export function chatEnvLines(existing: string, secret: string = newSecret()): string[] {
  const has = (name: string) => envValue(existing, name) !== null;
  const lines: string[] = [];
  if (!has("COMPOSE_FILE")) lines.push(`COMPOSE_FILE=${CHAT_COMPOSE_FILE}`);
  if (!has("CHAT_BRIDGE_SECRET")) lines.push(`CHAT_BRIDGE_SECRET=${secret}`);
  if (!has("PUBLIC_ORIGIN")) lines.push(`PUBLIC_ORIGIN=${CHAT_ORIGIN}`);
  if (!has("GATEWAY_PORT")) lines.push("GATEWAY_PORT=4080");
  return lines;
}

/**
 * The backend's own `.env`, for running without Docker: it must trust the gateway's origin (Better
 * Auth refuses a sign-in from one it does not know) and hold the same bridge secret the assistant
 * does, or chat-only mode could never apply. Adds to what is there; replaces nothing but the list.
 */
export function chatBackendEnv(existing: string, secret: string): string {
  let text = existing;
  const cors = envValue(text, "CORS_ORIGIN");
  if (cors === null) text += `${text && !text.endsWith("\n") ? "\n" : ""}CORS_ORIGIN=${CHAT_ORIGIN}\n`;
  else if (!cors.split(",").map((o) => o.trim()).includes(CHAT_ORIGIN)) {
    text = text.replace(/^CORS_ORIGIN=.*$/m, `CORS_ORIGIN=${cors},${CHAT_ORIGIN}`);
  }
  if (envValue(text, "CHAT_BRIDGE_SECRET") === null) text += `${text.endsWith("\n") ? "" : "\n"}CHAT_BRIDGE_SECRET=${secret}\n`;
  return text;
}

/** Copy the assistant to `<outputDir>/assistant`, write the chat entries into `.env`, and enable them in `backend/.env`. */
export async function writeAssistant(outputDir: string, templatesDir: string): Promise<{ files: number }> {
  const source = await findAssistantSource(templatesDir);
  const destination = path.join(outputDir, "assistant");
  await fs.rm(destination, { recursive: true, force: true });
  const files = await copyTree(source, destination);

  const envPath = path.join(outputDir, ".env");
  const current = (await exists(envPath)) ? await fs.readFile(envPath, "utf8") : "";
  const secret = envValue(current, "CHAT_BRIDGE_SECRET") ?? newSecret();
  const lines = chatEnvLines(current, secret);
  if (lines.length > 0) {
    const header = current ? "" : "# Written by the generator for the chat assistant. .env is not committed.\n";
    await fs.writeFile(envPath, `${current}${current && !current.endsWith("\n") ? "\n" : ""}${header}${lines.join("\n")}\n`);
  }

  const backendEnv = path.join(outputDir, "backend", ".env");
  if (await exists(backendEnv)) {
    await fs.writeFile(backendEnv, chatBackendEnv(await fs.readFile(backendEnv, "utf8"), secret));
  }
  return { files };
}
