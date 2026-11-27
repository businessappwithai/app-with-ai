import { afterAll, describe, expect, test } from "bun:test";
import { createGateway } from "../../../scripts/gateway";

const seen: Array<{ who: string; path: string; headers: Headers }> = [];
const upstream = (who: string) =>
  Bun.serve({
    port: 0,
    fetch(request, server) {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/socket") && server.upgrade(request)) return undefined;
      seen.push({ who, path: url.pathname + url.search, headers: request.headers });
      return new Response(`${who}:${request.method}:${url.pathname}`, { headers: { "set-cookie": "a=1; Path=/" } });
    },
    websocket: {
      message(ws, message) {
        ws.send(`echo:${message}`);
      },
    },
  });
const app = upstream("app");
const assistant = upstream("assistant");
const gateway = createGateway({ appUrl: `http://127.0.0.1:${app.port}`, assistantUrl: `http://127.0.0.1:${assistant.port}`, reportUrl: null });
const front = Bun.serve({ port: 0, fetch: gateway.fetch, websocket: gateway.websocket });
const url = (path: string) => `http://127.0.0.1:${front.port}${path}`;
afterAll(() => [app, assistant, front].forEach((s) => s.stop(true)));

describe("the one-origin gateway", () => {
  test("routes / to the application and /chat/ to the assistant, without stripping the prefix", async () => {
    expect(await (await fetch(url("/bus_account/a1"))).text()).toBe("app:GET:/bus_account/a1");
    expect(await (await fetch(url("/chat/api/session?x=1"))).text()).toBe("assistant:GET:/chat/api/session");
    expect(seen.at(-1)!.path).toBe("/chat/api/session?x=1");
  });
  test("passes the body and the Set-Cookie of a write through", async () => {
    const response = await fetch(url("/chat/api/tickets"), { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    expect(await response.text()).toBe("assistant:POST:/chat/api/tickets");
    expect(response.headers.get("set-cookie")).toContain("a=1");
  });
  test("sets the caller's address itself and forwards none the client sent", async () => {
    await fetch(url("/chat/api/session"), { headers: { "x-real-ip": "6.6.6.6", "x-forwarded-for": "6.6.6.6, 7.7.7.7" } });
    const headers = seen.at(-1)!.headers;
    expect(headers.get("x-real-ip")).toBe("127.0.0.1");
    expect(headers.get("x-forwarded-for")).toBe("127.0.0.1");
  });
  test("/chat and /report without a slash redirect; an absent reporting site is a 502, not a hang", async () => {
    expect((await fetch(url("/chat"), { redirect: "manual" })).headers.get("location")).toBe("/chat/");
    expect((await fetch(url("/report/dashboard"))).status).toBe(502);
  });
  test("a service that is down is a 502", async () => {
    const down = createGateway({ appUrl: "http://127.0.0.1:1", assistantUrl: "http://127.0.0.1:1" });
    const s = Bun.serve({ port: 0, fetch: down.fetch, websocket: down.websocket });
    expect((await fetch(`http://127.0.0.1:${s.port}/`)).status).toBe(502);
    s.stop(true);
  });
  test("a WebSocket under /chat is relayed both ways", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${front.port}/chat/socket`);
    const got = await new Promise<string>((resolve, reject) => {
      ws.onopen = () => ws.send("hi");
      ws.onmessage = (event) => resolve(String(event.data));
      ws.onerror = () => reject(new Error("socket error"));
      setTimeout(() => reject(new Error("timeout")), 4000);
    });
    expect(got).toBe("echo:hi");
    ws.close();
  });
});
