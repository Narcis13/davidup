// Guard against tool-count drift between the canonical TOOL_NAMES registry
// and the human-/registry-facing surfaces that advertise the catalog:
//
//   - server.json          (consumed by MCP registries and Claude clients)
//   - README.md            (the headline "N atomic MCP tools" line)
//   - examples/mcp-demo.md (the "registers the N tools" prose and the
//                          "the N tools become callable" sentence)
//
// TOOL_NAMES is the single source of truth; everything else must agree on
// both the count and (for server.json) the exact tool names. If you add or
// remove a tool, these checks make sure the docs and manifest are updated
// in the same PR.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TOOL_NAMES } from "../../src/mcp/index.js";

const REPO_ROOT = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..");
})();

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

describe("MCP tool catalog — server.json / README / mcp-demo stay in sync with TOOL_NAMES", () => {
  it("server.json lists exactly the TOOL_NAMES tools (same set, same order)", () => {
    const manifest = JSON.parse(read("server.json")) as { tools: string[] };
    expect(manifest.tools).toEqual([...TOOL_NAMES]);
  });

  it("README.md advertises the correct tool count", () => {
    const readme = read("README.md");
    const expected = `${TOOL_NAMES.length} atomic MCP tools`;
    expect(readme).toContain(expected);
  });

  it("examples/mcp-demo.md advertises the correct tool count", () => {
    const demo = read("examples/mcp-demo.md");
    const n = TOOL_NAMES.length;
    expect(demo).toContain(`registers the ${n} tools`);
    expect(demo).toContain(`the ${n} tools become callable`);
  });

  it("examples/mcp-demo.md's catalog table mentions every tool", () => {
    const demo = read("examples/mcp-demo.md");
    const missing = TOOL_NAMES.filter((name) => !demo.includes(`\`${name}\``));
    expect(missing).toEqual([]);
  });
});
