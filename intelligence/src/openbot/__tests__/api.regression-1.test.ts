// Regression: QA-F2, QA-F4 — found by /qa on 2026-11-27
// Report: intelligence/docs/qa-report-2026-11-27.md
import { afterAll, describe, expect, test } from "bun:test";
import { createAssistant } from "../../server/app";
import { MemoryAuditLog } from "../../server/audit";
import { loadConfig } from "../../server/config";
import { MemoryTicketStore, TicketService } from "../../server/tickets";
import { SECRET, startFakeApp, startFakeModel, startFakeReport } from "../../server/__tests__/fakes";

const app = startFakeApp();
const report = startFakeReport();
const model = startFakeModel([{ text: "Hello." }]);
const config = loadConfig({
  CHAT_BRIDGE_SECRET: SECRET,
  APP_API_URL: `http://127.0.0.1:${app.port}`,
  REPORT_URL: `http://127.0.0.1:${report.server.port}`,
  AI_BASE_URL: `http://127.0.0.1:${model.server.port}/v1`,
  AI_MODEL: "fake",
  PUBLIC_ORIGIN: "http://localhost",
});
const handle = createAssistant({ config, audit: new MemoryAuditLog(), tickets: new TicketService(new MemoryTicketStore(), 60) });
afterAll(() => {
  app.stop(true);
  report.server.stop(true);
  model.server.stop(true);
});

const V = "/chat/api/v2/organizations/default";
const as = (path: string, init: RequestInit = {}) =>
  handle(new Request(`http://localhost${path}`, { ...init, headers: { cookie: "crm_app.session_token=tok-agent", origin: "http://localhost", ...(init.body ? { "content-type": "application/json" } : {}) } }));

describe("QA-F2: an address that cannot be decoded is an answer, not a crash", () => {
  test("an invalid percent-escape in a path is a problem+json 404, never a 500", async () => {
    const response = await as(`${V}/conversations/%E0%A4%A`);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });
});

describe("QA-F4: a memory is at most 4000 characters however it is written", () => {
  test("updating a memory past the limit is refused, and the memory is left as it was", async () => {
    const created = await as(`${V}/people/me/memories`, { method: "POST", body: JSON.stringify({ content: "I prefer short answers" }) });
    const { id } = (await created.json()) as { id: string };
    const update = await as(`${V}/people/me/memories/${id}`, { method: "PATCH", body: JSON.stringify({ content: "a".repeat(4001) }) });
    expect(update.status).toBe(400);
    const listed = (await (await as(`${V}/people/me/memories`)).json()) as { memories: Array<{ id: string; content: string }> };
    expect(listed.memories.find((m) => m.id === id)?.content).toBe("I prefer short answers");
  });
  test("an update at the limit is accepted", async () => {
    const created = await as(`${V}/people/me/memories`, { method: "POST", body: JSON.stringify({ content: "x" }) });
    const { id } = (await created.json()) as { id: string };
    const update = await as(`${V}/people/me/memories/${id}`, { method: "PATCH", body: JSON.stringify({ content: "b".repeat(4000) }) });
    expect(update.status).toBe(200);
  });
});
