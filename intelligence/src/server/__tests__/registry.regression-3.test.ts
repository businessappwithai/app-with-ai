// Regression: QA — found live on 2026-11-27 (a chart whose data the platform refuses was opened and described as working)
// Report: intelligence/docs/live-e2e-report.md
import { afterAll, describe, expect, test } from "bun:test";
import { createAssistant } from "../app";
import { MemoryAuditLog } from "../audit";
import { loadConfig } from "../config";
import { MemoryTicketStore, TicketService } from "../tickets";
import { SECRET, startFakeApp, startFakeModel, startFakeReport } from "./fakes";

const app = startFakeApp();
const report = startFakeReport();
const model = startFakeModel([
  { tool: "open_report", args: { kind: "chart", id: "c1", title: "Pipeline chart" } },
  { text: "That chart is not available to you." },
]);
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

const AGENT = "tok-agent"; // Support Agent: may not read Opportunity
const SALES = "tok-sales";
const ticket = (token: string, kind: string, id: string) =>
  handle(
    new Request("http://localhost/chat/api/tickets", {
      method: "POST",
      headers: { cookie: `crm_app.session_token=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ product: "report", kind, object: kind, id, title: "x" }),
    })
  );

describe("a chart or report is opened only for somebody the platform will draw it for", () => {
  test("a chart that reads a table the role may not read gets no ticket, with the same neutral answer as a missing one", async () => {
    const denied = await ticket(AGENT, "chart", "c1");
    const missing = await ticket(AGENT, "chart", "nope");
    expect(denied.status).toBe(404);
    expect(await denied.text()).toBe(await missing.text());
  });
  test("the same chart opens for a role that may read it, and a chart on readable tables opens for both", async () => {
    expect((await ticket(SALES, "chart", "c1")).status).toBe(200);
    expect((await ticket(AGENT, "chart", "c2")).status).toBe(200);
    expect((await ticket(SALES, "chart", "c2")).status).toBe(200);
  });
  test("a report is held to the same rule", async () => {
    expect((await ticket(AGENT, "report", "r2")).status).toBe(404);
    expect((await ticket(AGENT, "report", "r3")).status).toBe(200);
    expect((await ticket(SALES, "report", "r2")).status).toBe(200);
  });
  test("a dashboard still opens: its widgets answer for themselves", async () => {
    expect((await ticket(AGENT, "dashboard", "d1")).status).toBe(200);
  });
  test("the open_report tool tells the model it is not available, so it does not describe the chart as open", async () => {
    const response = await handle(
      new Request("http://localhost/chat/api/copilotkit/agent/default/run", {
        method: "POST",
        headers: { cookie: `crm_app.session_token=${AGENT}`, "content-type": "application/json" },
        body: JSON.stringify({ threadId: "t-chart", runId: "r-chart", messages: [{ id: "m1", role: "user", content: "open the pipeline chart" }], tools: [], context: [], state: {}, forwardedProps: {} }),
      })
    );
    const stream = await response.text();
    expect(stream).toContain("not available");
    expect(stream).not.toContain('\\"opened\\"');
    expect(JSON.stringify(model.requests.at(-1))).toContain("available");
  });
});
