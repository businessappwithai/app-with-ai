/**
 * The assistant's process: the HTTP surface from `src/server/app.ts`, plus the
 * built client served from `dist/client` under the same prefix.
 */
import { resolve } from "node:path";
import { createAssistant } from "./src/server/app";
import { createAuditLog } from "./src/server/audit";
import { loadConfig } from "./src/server/config";
import { log } from "./src/server/log";
import { openDatabase } from "./src/server/database";
import { createClientServer } from "./src/server/static";
import { hexToBytes } from "nostr-tools/utils";
import type { Intelligence } from "./src/interface/types";
import { createBuzzIntelligence, encryptionKeyFrom, MemoryKeyVault, PostgresKeyVault } from "./src/providers/buzz";
import { createMemoryIntelligence } from "./src/providers/memory";
import { createSwitchStore } from "./src/server/switches";
import { MemoryTicketStore, PostgresTicketStore, TicketService } from "./src/server/tickets";

const config = loadConfig();
const clientDir = resolve(import.meta.dir, "dist/client");
// One pool for everything the assistant keeps; in memory when no database is configured.
const database = config.databaseUrl ? openDatabase(config.databaseUrl) : null;
const tickets = database ? new PostgresTicketStore(database) : new MemoryTicketStore();

/**
 * Threads, finished runs and memory: on the Buzz relay when it is configured, in memory otherwise.
 * Each person's relay key is kept in chatdb; without a database it lives only as long as the process,
 * which is fine for local development and nothing else.
 */
function intelligenceFor(): Intelligence {
  if (!config.buzz) return createMemoryIntelligence();
  return createBuzzIntelligence({
    relayUrl: config.buzz.relayUrl,
    operatorSecret: hexToBytes(config.buzz.operatorSecret),
    botSecret: hexToBytes(config.buzz.botSecret),
    keys: database ? new PostgresKeyVault(database, encryptionKeyFrom(config.buzz.keyEncryptionKey)) : new MemoryKeyVault(),
    admitMembers: true,
  });
}

const serveClient = createClientServer(clientDir);

const handle = createAssistant({
  config,
  audit: createAuditLog(database),
  switches: createSwitchStore(database),
  intelligence: intelligenceFor(),
  tickets: new TicketService(tickets, config.ticketTtlSeconds),
  serveClient,
});

setInterval(() => void tickets.sweep(Date.now()).catch(() => undefined), 30_000).unref();

const server = Bun.serve({
  port: config.port,
  hostname: "0.0.0.0",
  // A model thinking between tool calls is quiet for a long time.
  idleTimeout: 255,
  fetch: async (request, server) => {
    // OpenBot's conversation-events socket; every other request is ordinary HTTP.
    if (await handle.upgrade(request, server)) return undefined;
    return handle(request);
  },
  websocket: handle.websocket,
});

log.event("assistant.started", { port: server.port, basePath: config.basePath, durable: config.buzz !== null, database: config.databaseUrl !== null });
