// Regression: QA-F1 — found by /qa on 2026-11-27
// Report: intelligence/docs/qa-report-2026-11-27.md
import { afterAll, describe, expect, test } from "bun:test";
import { createAssistant } from "../app";
import { MemoryAuditLog } from "../audit";
import { loadConfig } from "../config";
import { MemoryTicketStore, TicketService } from "../tickets";
import { SECRET, startFakeApp, startFakeModel, startFakeReport } from "./fakes";

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

const ticket = (title: unknown) =>
  handle(
    new Request("http://localhost/chat/api/tickets", {
      method: "POST",
      headers: { cookie: "crm_app.session_token=tok-agent", "content-type": "application/json" },
      body: JSON.stringify({ product: "app", kind: "record", object: "bus_account", id: "a1", title }),
    })
  );

describe("QA-F1: a ticket's title is a short string", () => {
  test("a title of 200 characters is accepted", async () => {
    expect((await ticket("t".repeat(200))).status).toBe(200);
  });
  test("a longer title, or one that is not text, is refused before anything is stored", async () => {
    expect((await ticket("t".repeat(201))).status).toBe(400);
    expect((await ticket({ nested: true })).status).toBe(400);
    expect((await ticket(12)).status).toBe(400);
  });
});
