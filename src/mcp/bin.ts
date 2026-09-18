#!/usr/bin/env node
// Entry point invoked by MCP clients (Claude Desktop, Claude Code, etc.) via
// the `command` field in their config. Stays as thin as possible: instantiate
// the server, attach stdio transport, run.
//
// Flags: `--session-ttl <seconds>` (or DAVIDUP_SESSION_TTL) — auto-reset all
// state after that much idle time; default 0 = never (R-29).

import { createServer, resolveSessionTtl } from "./server.js";

async function main(): Promise<void> {
  const sessionTtlSeconds = resolveSessionTtl(process.argv.slice(2), process.env);
  const server = createServer({ sessionTtlSeconds });
  await server.start();
}

main().catch((err) => {
  // Surface the failure on stderr (stdio transport owns stdout for the JSON-RPC
  // framing, so anything we write there would corrupt the protocol).
  // eslint-disable-next-line no-console
  console.error("[davidup] fatal:", err);
  process.exit(1);
});
