// Unit tests for the dispatch envelope. Confirms every tool's handler is
// reachable from the in-process dispatcher (no transport spawn) and that
// MCPToolError thrown from any layer round-trips into the canonical
// `{ ok:false, error:{code,message,hint?} }` envelope.

import { describe, expect, it } from "vitest";

import {
  CompositionStore,
  TOOLS,
  dispatchTool,
  type ToolDef,
  type ToolDeps,
} from "../../src/mcp/index.js";

function getTool(name: string): ToolDef {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

function makeDeps(): ToolDeps {
  return { store: new CompositionStore() };
}

describe("dispatchTool — success envelope", () => {
  it("wraps successful handler results in { ok: true, result }", async () => {
    const deps = makeDeps();
    const out = await dispatchTool(
      getTool("create_composition"),
      { width: 10, height: 10, fps: 1, duration: 1 },
      deps,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result).toMatchObject({ compositionId: expect.any(String) });
  });
});

describe("dispatchTool — error envelope", () => {
  it("returns E_NO_COMPOSITION when no composition exists", async () => {
    const deps = makeDeps();
    const out = await dispatchTool(getTool("get_composition"), {}, deps);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_NO_COMPOSITION");
    expect(typeof out.error.hint).toBe("string");
  });

  it("returns E_INVALID_VALUE when input fails Zod validation", async () => {
    const deps = makeDeps();
    const out = await dispatchTool(
      getTool("create_composition"),
      { width: -1, height: 10, fps: 30, duration: 1 },
      deps,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_INVALID_VALUE");
  });

  it("returns E_TWEEN_OVERLAP for an overlapping tween", async () => {
    const deps = makeDeps();
    await dispatchTool(
      getTool("create_composition"),
      { width: 10, height: 10, fps: 30, duration: 1 },
      deps,
    );
    const layerOut = await dispatchTool(getTool("add_layer"), { z: 0 }, deps);
    if (!layerOut.ok) throw new Error("add_layer failed");
    const layerId = (layerOut.result as { layerId: string }).layerId;
    const shapeOut = await dispatchTool(
      getTool("add_shape"),
      { layerId, kind: "rect", x: 0, y: 0, width: 5, height: 5 },
      deps,
    );
    if (!shapeOut.ok) throw new Error("add_shape failed");
    const itemId = (shapeOut.result as { itemId: string }).itemId;
    await dispatchTool(
      getTool("add_tween"),
      {
        target: itemId,
        property: "transform.x",
        from: 0,
        to: 1,
        start: 0,
        duration: 0.5,
      },
      deps,
    );
    const overlap = await dispatchTool(
      getTool("add_tween"),
      {
        target: itemId,
        property: "transform.x",
        from: 0,
        to: 1,
        start: 0.4,
        duration: 0.5,
      },
      deps,
    );
    expect(overlap.ok).toBe(false);
    if (overlap.ok) return;
    expect(overlap.error.code).toBe("E_TWEEN_OVERLAP");
  });
});
