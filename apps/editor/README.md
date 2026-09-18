# @davidup/editor

The Davidup visual editor: an AdonisJS + Inertia + Vue 3 app that hosts an
embedded MCP server. Every editor action is an MCP command dispatched through
the same `dispatchTool` an AI agent uses.

It is not run on its own — launch it through the CLI: `davidup edit ./my-project`.

Documentation (component roster, shortcuts, project layout) lives in the root
README: [The editor (`apps/editor`)](../../README.md#the-editor-appseditor).
Architecture: [`ARCHITECTURE.md`](../../ARCHITECTURE.md).
