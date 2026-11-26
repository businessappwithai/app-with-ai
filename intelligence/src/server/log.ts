/**
 * Named log events, one JSON line each on stdout.
 *
 * A call site names an event and gives its fields; the level and the wording live here, once, as
 * they do in the rest of this repository (`packages/core/src/logging/log-spec.json`). This service
 * cannot import that package (it is a standalone Bun project with its own lockfile), so it keeps a
 * small catalogue of its own in the same shape. Never log a request body, a record's values, a
 * query, a cookie or a ticket: fields are identifiers and counts.
 *
 * An unknown id is reported at `warn`, not dropped, so a typo is never silence.
 */
export type Level = "debug" | "info" | "warn" | "error";

export const EVENTS = {
  "assistant.started": { level: "info", message: "Assistant listening" },
  "assistant.run.record_failed": { level: "error", message: "A finished run could not be recorded" },
} as const satisfies Record<string, { level: Level; message: string }>;

export type EventId = keyof typeof EVENTS;

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogSink {
  write(line: string): void;
}

export function createLogger(env: Record<string, string | undefined> = process.env, sink: LogSink = { write: (line) => console.log(line) }) {
  const threshold = ORDER[(env.LOG_LEVEL as Level) in ORDER ? (env.LOG_LEVEL as Level) : "info"];
  return {
    event(id: EventId | (string & {}), fields: Record<string, unknown> = {}): void {
      const known = EVENTS[id as EventId];
      const level: Level = known ? known.level : "warn";
      if (ORDER[level] < threshold) return;
      const message = known ? known.message : `Unknown log event ${id}`;
      sink.write(JSON.stringify({ time: new Date().toISOString(), level, event: id, message, ...fields }));
    },
  };
}

export const log = createLogger();
