#!/usr/bin/env bun
// Entry point invoked by MCP clients (Claude Desktop, Claude Code, etc.) via
// the `command` field in their config. Stays as thin as possible: instantiate
// the server, attach stdio transport, run.

import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  await server.start();
}

main().catch((err) => {
  // Surface the failure on stderr (stdio transport owns stdout for the JSON-RPC
  // framing, so anything we write there would corrupt the protocol).
  // eslint-disable-next-line no-console
  console.error("[motionforge] fatal:", err);
  process.exit(1);
});
