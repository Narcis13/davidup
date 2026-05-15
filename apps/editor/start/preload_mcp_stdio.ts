/*
|--------------------------------------------------------------------------
| MCP-on-stdio (opt-in) — step 07 wiring
|--------------------------------------------------------------------------
|
| When `DAVIDUP_MCP_STDIO=1`, mount the editor's MCP server on the process
| stdio so an agent client (Claude Code, Claude Desktop) can drive the same
| composition store the editor's UI mutates. Routed via `commandBus.apply()`
| with `source: 'mcp'` — see `app/services/mcp_bridge.ts`.
|
| Disabled by default. The flag is opt-in because attaching MCP to stdio
| conflicts with AdonisJS's normal dev logging on stdout. Configurations
| that need both (run editor + accept MCP simultaneously) launch the server
| with `DAVIDUP_MCP_STDIO=1` and redirect AdonisJS logs to a file so stdout
| stays clean JSON-RPC framing.
*/

import logger from '@adonisjs/core/services/logger'

const enabled = process.env.DAVIDUP_MCP_STDIO === '1'

if (enabled) {
  const { createEditorMcpServer } = await import('#services/mcp_bridge')
  const server = createEditorMcpServer()
  try {
    await server.start()
    logger.info('preload_mcp_stdio: MCP server attached to stdio')
  } catch (err) {
    logger.error({ err }, 'preload_mcp_stdio: failed to attach MCP stdio')
  }
} else {
  logger.debug('preload_mcp_stdio: DAVIDUP_MCP_STDIO not set, skipping')
}
