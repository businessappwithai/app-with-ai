import { describe, expect, test } from "bun:test";
import { buildPrompt, firstJson } from "../../../scripts/claude-model";

describe("claude-model shim", () => {
  test("firstJson reads an object out of surrounding prose and fences", () => {
    expect(firstJson('Sure:\n```json\n{"tool":"find_pages","args":{}}\n```')).toEqual({ tool: "find_pages", args: {} });
    expect(firstJson('{"text":"a {b} c"}')).toEqual({ text: "a {b} c" });
    expect(firstJson("no json")).toBeNull();
  });
  test("the prompt carries the system message, the tools and the tool results", () => {
    const prompt = buildPrompt(
      [
        { role: "system", content: "SYS" },
        { role: "user", content: "find acme" },
        { role: "assistant", content: "", tool_calls: [{ function: { name: "search_records", arguments: '{"query":"acme"}' } }] },
        { role: "tool", content: '{"matches":[]}' },
      ],
      [{ function: { name: "search_records", description: "Search", parameters: { type: "object" } } }]
    );
    for (const part of ["SYS", "find acme", "search_records", '[tool result] {"matches":[]}']) expect(prompt).toContain(part);
  });
});
