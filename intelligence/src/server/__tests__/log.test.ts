import { describe, expect, test } from "bun:test";
import { createLogger, EVENTS } from "../log";

const capture = (env: Record<string, string> = {}) => {
  const lines: any[] = [];
  return { lines, logger: createLogger(env, { write: (line) => lines.push(JSON.parse(line)) }) };
};

describe("log events", () => {
  test("a known event carries its catalogue level and message, and its fields", () => {
    const { lines, logger } = capture();
    logger.event("assistant.started", { port: 4200 });
    expect(lines[0]).toMatchObject({ level: "info", event: "assistant.started", message: EVENTS["assistant.started"].message, port: 4200 });
  });
  test("an unknown event is reported at warn, never dropped", () => {
    const { lines, logger } = capture();
    logger.event("assistant.typo");
    expect(lines[0]).toMatchObject({ level: "warn", event: "assistant.typo" });
  });
  test("LOG_LEVEL silences what is quieter", () => {
    const { lines, logger } = capture({ LOG_LEVEL: "error" });
    logger.event("assistant.started");
    logger.event("assistant.run.record_failed");
    expect(lines.map((l) => l.event)).toEqual(["assistant.run.record_failed"]);
  });
});
