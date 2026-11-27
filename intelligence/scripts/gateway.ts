#!/usr/bin/env bun
/**
 * One origin in front of a generated application and the assistant, for running without Docker.
 *
 *   /chat/*    the assistant        ASSISTANT_URL  (http://127.0.0.1:4200)
 *   /report/*  the reporting site   REPORT_URL     (unset: a plain 502 page)
 *   anything else                   APP_URL        (http://127.0.0.1:4000, the front end)
 *
 * Prefixes are not stripped (the assistant and the reporting platform are built for theirs). It sets
 * `X-Real-IP` from the connection and forwards no address the client sent, as the nginx gateway does,
 * because the assistant's rate limits trust it. WebSockets (the conversation-events socket) are relayed.
 */
import type { Server, ServerWebSocket } from "bun";

export interface GatewayOptions {
  assistantUrl: string;
  appUrl: string;
  reportUrl?: string | null;
}

interface Relay {
  target: string;
  upstream?: WebSocket;
  queued: Array<string | ArrayBuffer>;
}

const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "host", "content-length", "x-real-ip", "x-forwarded-for"]);

/** A copy of a received binary frame, as the plain ArrayBuffer `WebSocket.send` accepts. */
const bytes = (message: Buffer): ArrayBuffer => message.buffer.slice(message.byteOffset, message.byteOffset + message.byteLength) as ArrayBuffer;

const pick = (pathname: string, options: GatewayOptions): { base: string | null } => {
  if (pathname === "/chat" || pathname.startsWith("/chat/")) return { base: options.assistantUrl };
  if (pathname === "/report" || pathname.startsWith("/report/")) return { base: options.reportUrl ?? null };
  return { base: options.appUrl };
};

export function createGateway(options: GatewayOptions) {
  async function fetchHandler(request: Request, server: Server<Relay>): Promise<Response | undefined> {
    const url = new URL(request.url);
    if (url.pathname === "/chat") return new Response(null, { status: 301, headers: { location: "/chat/" } });
    if (url.pathname === "/report") return new Response(null, { status: 301, headers: { location: "/report/" } });
    const { base } = pick(url.pathname, options);
    if (!base) return new Response("The reporting platform is not running here.", { status: 502 });
    const address = server.requestIP(request)?.address ?? "unknown";

    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const target = `${base.replace(/^http/, "ws")}${url.pathname}${url.search}`;
      return server.upgrade(request, { data: { target, queued: [] } satisfies Relay, headers: {} }) ? undefined : new Response("Upgrade failed", { status: 400 });
    }

    const headers = new Headers();
    for (const [name, value] of request.headers) if (!HOP.has(name)) headers.set(name, value);
    headers.set("host", url.host);
    headers.set("x-real-ip", address);
    headers.set("x-forwarded-for", address);
    headers.set("x-forwarded-proto", url.protocol.replace(":", ""));
    // Compressed bodies are passed through as bytes, so the encoding header stays truthful.
    try {
      const upstream = await fetch(`${base}${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        redirect: "manual",
        // @ts-expect-error Bun: stream a request body with no content-length
        duplex: "half",
        decompress: false,
      });
      const out = new Headers(upstream.headers);
      return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
    } catch {
      return new Response("The service behind this address is not answering.", { status: 502 });
    }
  }

  const websocket = {
    open(ws: ServerWebSocket<Relay>) {
      const upstream = new WebSocket(ws.data.target);
      ws.data.upstream = upstream;
      upstream.onopen = () => {
        for (const message of ws.data.queued) upstream.send(message);
        ws.data.queued = [];
      };
      upstream.onmessage = (event) => ws.send(event.data as string);
      upstream.onclose = () => ws.close();
      upstream.onerror = () => ws.close();
    },
    message(ws: ServerWebSocket<Relay>, message: string | Buffer) {
      const upstream = ws.data.upstream;
      const frame = typeof message === "string" ? message : bytes(message);
      if (upstream && upstream.readyState === WebSocket.OPEN) upstream.send(frame);
      else ws.data.queued.push(frame);
    },
    close(ws: ServerWebSocket<Relay>) {
      ws.data.upstream?.close();
    },
  };

  return { fetch: fetchHandler, websocket };
}

if (import.meta.main) {
  const gateway = createGateway({
    assistantUrl: process.env.ASSISTANT_URL ?? "http://127.0.0.1:4200",
    appUrl: process.env.APP_URL ?? "http://127.0.0.1:4000",
    reportUrl: process.env.REPORT_URL ?? null,
  });
  const server = Bun.serve<Relay>({ port: Number(process.env.GATEWAY_PORT ?? 4080), idleTimeout: 255, fetch: gateway.fetch, websocket: gateway.websocket });
  console.log(`gateway on http://localhost:${server.port}  (/ app, /chat assistant)`);
}
