/**
 * A project generated with `chat` carries the assistant and what runs it; one generated without
 * carries none of it. The assistant has one source, `intelligence/`, copied at generation time.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chatBackendEnv, chatEnvLines, findAssistantSource, writeAssistant } from "../vendor-assistant";

const TEMPLATES = join(import.meta.dirname, "../../../../templates");
const project = () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-gen-"));
  mkdirSync(join(dir, "backend"));
  writeFileSync(join(dir, "backend/.env"), "PORT=4001\nCORS_ORIGIN=http://localhost:4000\n");
  return dir;
};

describe("writeAssistant", () => {
  it("copies the service, its deploy bundle and its runner, and none of its tests, previews or build output", async () => {
    const dir = project();
    const { files } = await writeAssistant(dir, TEMPLATES);
    expect(files).toBeGreaterThan(30);
    for (const present of ["server.ts", "Dockerfile", "src/server/app.ts", "deploy/docker-compose.chat.yml", "deploy/gateway.nginx.conf", "scripts/gateway.ts", "scripts/run-chat.ts"]) {
      expect(existsSync(join(dir, "assistant", present)), present).toBe(true);
    }
    for (const absent of ["node_modules", "dist", ".checkouts", "e2e", "ci", "src/server/__tests__", "scripts/preview.ts", "scripts/qa-claude.ts", "scripts/claude-model.ts", "docs/e2e-screenshots"]) {
      expect(existsSync(join(dir, "assistant", absent)), absent).toBe(false);
    }
  });

  it("writes .env so compose picks the overlay up, with one secret shared with the backend", async () => {
    const dir = project();
    await writeAssistant(dir, TEMPLATES);
    const env = readFileSync(join(dir, ".env"), "utf8");
    expect(env).toContain("COMPOSE_FILE=docker-compose.yml:assistant/deploy/docker-compose.chat.yml");
    const secret = /^CHAT_BRIDGE_SECRET=(.{40,})$/m.exec(env)?.[1];
    expect(secret).toBeTruthy();
    const backend = readFileSync(join(dir, "backend/.env"), "utf8");
    expect(backend).toContain(`CHAT_BRIDGE_SECRET=${secret}`);
    expect(backend).toContain("CORS_ORIGIN=http://localhost:4000,http://localhost:4080");
  });

  it("never replaces a secret that is already there, and is the same on a second run", async () => {
    const dir = project();
    await writeAssistant(dir, TEMPLATES);
    const first = [readFileSync(join(dir, ".env"), "utf8"), readFileSync(join(dir, "backend/.env"), "utf8")];
    await writeAssistant(dir, TEMPLATES);
    expect([readFileSync(join(dir, ".env"), "utf8"), readFileSync(join(dir, "backend/.env"), "utf8")]).toEqual(first);
  });

  it("finds its source in a checkout, and says so when there is none", async () => {
    expect(await findAssistantSource(TEMPLATES)).toMatch(/intelligence$/);
    await expect(findAssistantSource(join(tmpdir(), "nowhere/a/b"))).rejects.toThrow(/not found/);
  });
});

describe("the env text", () => {
  it("keeps what is set and adds what is missing", () => {
    expect(chatEnvLines("CHAT_BRIDGE_SECRET=keep-me\nGATEWAY_PORT=9000\n", "x")).toEqual([
      "COMPOSE_FILE=docker-compose.yml:assistant/deploy/docker-compose.chat.yml",
      "PUBLIC_ORIGIN=http://localhost:4080",
    ]);
  });
  it("adds the gateway origin to a CORS list once", () => {
    const once = chatBackendEnv("CORS_ORIGIN=http://a\n", "s");
    expect(once).toContain("CORS_ORIGIN=http://a,http://localhost:4080");
    expect(chatBackendEnv(once, "s")).toBe(once);
  });
});

describe("the reporting build", () => {
  const dockerfile = readFileSync(join(TEMPLATES, "tanstack-start-nestjs/reporting/Dockerfile.hbs"), "utf8");
  it("applies the /report prefix overlay only inside the chat markers, before the build", () => {
    const block = /^# <chat>\n([\s\S]*?)^# <\/chat>\n/m.exec(dockerfile)?.[1] ?? "";
    expect(block).toContain("subpath-overlay.ts --dir /app --base /report");
    const without = dockerfile.replace(/^# <chat>\n[\s\S]*?^# <\/chat>\n/gm, "");
    expect(without).not.toContain("subpath-overlay");
    expect(dockerfile.indexOf("# <chat>")).toBeLessThan(dockerfile.indexOf("RUN bun run build"));
  });
});
