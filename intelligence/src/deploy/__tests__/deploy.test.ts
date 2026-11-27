import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { install } from "../../../scripts/install-into";

const root = resolve(import.meta.dir, "../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("the deploy bundle", () => {
  const compose = read("deploy/docker-compose.chat.yml");
  const gateway = read("deploy/gateway.nginx.conf");

  test("the overlay is valid YAML (a colon in an unquoted message once made compose refuse it)", () => {
    const doc = Bun.YAML.parse(compose) as { services: Record<string, { environment?: Record<string, string>; profiles?: string[] }> };
    expect(Object.keys(doc.services).sort()).toEqual(["assistant", "backend", "gateway", "report"]);
    expect(doc.services.assistant!.environment!.CHAT_BRIDGE_SECRET).toContain("${CHAT_BRIDGE_SECRET:?");
    expect(doc.services.assistant!.profiles).toEqual(["chat"]);
    // The text that failed: an unquoted `:?message with: a colon`.
    expect(() => Bun.YAML.parse("a:\n  B: ${B:?B is required: do this}\n")).toThrow();
  });
  test("assistant and gateway sit behind the chat profile; nothing else is added", () => {
    expect(compose.match(/profiles: \["chat"\]/g)?.length).toBe(2);
    expect(compose).toContain("assistant:");
    expect(compose).toContain("gateway:");
  });
  test("the bridge secret is required by the assistant and shared by backend and report", () => {
    expect(compose).toMatch(/CHAT_BRIDGE_SECRET: "?\$\{CHAT_BRIDGE_SECRET:\?/);
    expect(compose.match(/CHAT_BRIDGE_SECRET: \$\{CHAT_BRIDGE_SECRET:-\}/g)?.length).toBe(2);
  });
  test("the gateway routes the three prefixes without stripping them, and upgrades WebSockets", () => {
    for (const prefix of ["/chat/", "/report/", "/"]) expect(gateway).toContain(`location ${prefix} {`);
    expect(gateway).not.toMatch(/proxy_pass [^;]*\/;/);
    expect(gateway).toContain("$connection_upgrade");
  });
  test("the gateway never forwards a client-supplied address", () => {
    expect(gateway).not.toContain("$proxy_add_x_forwarded_for");
  });
  test("health checks use 127.0.0.1, and telemetry is off", () => {
    expect(compose).toContain("127.0.0.1:4200");
    expect(compose).not.toContain("localhost:4200");
    expect(compose).toContain('COPILOTKIT_TELEMETRY_DISABLED: "true"');
  });
});

describe("install-into", () => {
  const project = () => {
    const dir = mkdtempSync(join(tmpdir(), "gen-"));
    writeFileSync(join(dir, "docker-compose.yml"), "services: {}\n");
    return dir;
  };
  test("copies the service without tests, build output or checkouts, and keeps the bridge secret on a second run", () => {
    const dir = project();
    expect(install(dir).wroteSecret).toBe(true);
    for (const present of ["server.ts", "src/server/app.ts", "deploy/docker-compose.chat.yml", "Dockerfile"]) expect(existsSync(join(dir, "assistant", present))).toBe(true);
    for (const absent of ["src/server/__tests__", "node_modules", ".checkouts", "scripts/preview.ts"]) expect(existsSync(join(dir, "assistant", absent))).toBe(false);
    const first = readFileSync(join(dir, ".env"), "utf8");
    expect(first).toMatch(/^CHAT_BRIDGE_SECRET=.{40,}$/m);
    expect(install(dir).wroteSecret).toBe(false);
    expect(readFileSync(join(dir, ".env"), "utf8")).toBe(first);
  });
  test("refuses a directory that is not a generated project", () => {
    expect(() => install(mkdtempSync(join(tmpdir(), "nope-")))).toThrow(/not a generated project/);
  });
});
