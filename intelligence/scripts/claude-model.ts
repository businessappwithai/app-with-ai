#!/usr/bin/env bun
/**
 * A language model for testing: an OpenAI-compatible endpoint answered by Claude Code (`claude -p`).
 *
 *   bun scripts/claude-model.ts                # http://127.0.0.1:8000/v1
 *   AI_BASE_URL=http://127.0.0.1:8000/v1 bun server.ts
 *
 * For development and QA only. The assistant itself speaks to any OpenAI-compatible endpoint
 * (`AI_BASE_URL`) and has no Anthropic code in it; this shim is a stand-in endpoint. Each request
 * becomes one non-interactive `claude -p` call with Claude's own tools turned off, asked to answer
 * with exactly one JSON object: a tool call, or the final text. The assistant's tools still run in
 * the assistant, as the signed-in person, so everything the model does goes through the real guards.
 *
 * CLAUDE_MODEL picks the model (default: Claude Code's own); CLAUDE_MODEL_PORT the port (8000);
 * CLAUDE_MODEL_HOST the address it listens on (127.0.0.1).
 */
const port = Number(process.env.CLAUDE_MODEL_PORT ?? 8000);
// 127.0.0.1 unless a container has to reach it (then 0.0.0.0, and only on a machine you control).
const host = process.env.CLAUDE_MODEL_HOST ?? "127.0.0.1";
const claudeModel = process.env.CLAUDE_MODEL;

interface ToolDef {
  function?: { name: string; description?: string; parameters?: unknown };
}
interface Message {
  role: string;
  content?: unknown;
  tool_calls?: Array<{ id?: string; function?: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

const text = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => (typeof part === "string" ? part : ((part as { text?: string })?.text ?? ""))).join("")
      : content == null
        ? ""
        : JSON.stringify(content);

export function buildPrompt(messages: Message[], tools: ToolDef[]): string {
  const catalogue = tools
    .map((tool) => tool.function)
    .filter((fn): fn is NonNullable<ToolDef["function"]> => Boolean(fn))
    .map((fn) => `- ${fn.name}: ${fn.description ?? ""}\n  parameters (JSON Schema): ${JSON.stringify(fn.parameters ?? {})}`)
    .join("\n");
  const transcript = messages
    .map((message) => {
      if (message.role === "assistant" && message.tool_calls?.length) {
        const calls = message.tool_calls.map((call) => `${call.function?.name}(${call.function?.arguments})`).join("; ");
        return `[assistant called] ${calls}${text(message.content) ? ` — ${text(message.content)}` : ""}`;
      }
      if (message.role === "tool") return `[tool result] ${text(message.content)}`;
      return `[${message.role}] ${text(message.content)}`;
    })
    .join("\n\n");
  return `You are the language model behind a tool-calling chat assistant. Follow the system message in the transcript.
You can call exactly ONE tool per reply, or give the final answer. Reply with ONE JSON object and nothing else:
  {"tool": "<tool name>", "args": { ... }}      to call a tool
  {"text": "<your answer to the person>"}        when you are done, or no tool is needed
If the last entry is a [tool result], decide whether another tool is needed; otherwise answer.

Tools:
${catalogue || "(none)"}

Transcript:
${transcript}

Your reply (one JSON object):`;
}

/** The first balanced JSON object in `output`, parsed; null when there is none. */
export function firstJson(output: string): any {
  const start = output.indexOf("{");
  for (let end = output.lastIndexOf("}"); end > start; end = output.lastIndexOf("}", end - 1)) {
    try {
      return JSON.parse(output.slice(start, end + 1));
    } catch {
      /* try a shorter slice */
    }
  }
  return null;
}

async function ask(prompt: string): Promise<string> {
  const args = ["-p", "--tools", "", "--no-session-persistence", ...(claudeModel ? ["--model", claudeModel] : [])];
  const child = Bun.spawn(["claude", ...args], { stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe" });
  const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (code !== 0) throw new Error(`claude exited ${code}: ${await new Response(child.stderr).text()}`);
  return out;
}

const chunk = (delta: unknown, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: "claude", object: "chat.completion.chunk", created: 0, model: "claude-code", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

export function serve() {
  return Bun.serve({
    port,
    hostname: host,
    idleTimeout: 255,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/models")) return Response.json({ object: "list", data: [{ id: "claude-code", object: "model" }] });
      if (!url.pathname.endsWith("/chat/completions") || request.method !== "POST") return new Response("Not found", { status: 404 });
      const body = (await request.json()) as { messages: Message[]; tools?: ToolDef[] };
      let reply: any;
      try {
        reply = firstJson(await ask(buildPrompt(body.messages, body.tools ?? [])));
      } catch (error) {
        return new Response(String(error), { status: 502 });
      }
      const known = new Set((body.tools ?? []).map((tool) => tool.function?.name));
      const sse =
        reply && typeof reply.tool === "string" && known.has(reply.tool)
          ? chunk({ role: "assistant", tool_calls: [{ index: 0, id: `call_${crypto.randomUUID().slice(0, 8)}`, type: "function", function: { name: reply.tool, arguments: JSON.stringify(reply.args ?? {}) } }] }) + chunk({}, "tool_calls")
          : chunk({ role: "assistant", content: typeof reply?.text === "string" ? reply.text : "I could not form an answer." }) + chunk({}, "stop");
      return new Response(`${sse}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    },
  });
}

if (import.meta.main) {
  const server = serve();
  console.log(`claude-model listening on http://127.0.0.1:${server.port}/v1`);
}
