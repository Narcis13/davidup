// B-2: create_composition / set_composition_property surface the validator's
// dimension issues eagerly, and a clean call keeps its original shape.

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

async function call(name: string, args: Record<string, unknown>, deps: ToolDeps) {
  const out = await dispatchTool(getTool(name), args, deps);
  if (!out.ok) throw new Error(`${name} failed: ${out.error.code}`);
  return out.result as Record<string, unknown>;
}

describe("create_composition — eager dimension issues", () => {
  it("returns E_DIMENSION_ODD issues for a 1001x501 canvas", async () => {
    const deps = makeDeps();
    const result = await call(
      "create_composition",
      { width: 1001, height: 501, fps: 30, duration: 1 },
      deps,
    );
    expect(result.compositionId).toEqual(expect.any(String));
    const issues = result.issues as Array<{ code: string; path: string }>;
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ["E_DIMENSION_ODD", "composition.width"],
      ["E_DIMENSION_ODD", "composition.height"],
    ]);
    // Same codes the full validator reports.
    const validation = deps.store.validate();
    expect(validation.errors.filter((e) => e.code === "E_DIMENSION_ODD")).toEqual(issues);
  });

  it("returns W_DIMENSION_LARGE above 4096", async () => {
    const result = await call(
      "create_composition",
      { width: 8192, height: 4320, fps: 30, duration: 1 },
      makeDeps(),
    );
    expect(result.issues).toBeUndefined();
    const warnings = result.warnings as Array<{ code: string }>;
    expect(warnings.map((w) => w.code)).toEqual(["W_DIMENSION_LARGE", "W_DIMENSION_LARGE"]);
  });

  it("keeps the plain { compositionId } shape for even dimensions", async () => {
    const result = await call(
      "create_composition",
      { width: 1920, height: 1080, fps: 30, duration: 1 },
      makeDeps(),
    );
    expect(Object.keys(result)).toEqual(["compositionId"]);
  });
});

describe("set_composition_property — eager dimension issues", () => {
  it("reports E_DIMENSION_ODD after an odd height and clears after fixing it", async () => {
    const deps = makeDeps();
    await call("create_composition", { width: 640, height: 360, fps: 30, duration: 1 }, deps);

    const odd = await call("set_composition_property", { property: "height", value: 361 }, deps);
    expect(odd.ok).toBe(true);
    expect((odd.issues as Array<{ code: string; path: string }>).map((i) => [i.code, i.path])).toEqual([
      ["E_DIMENSION_ODD", "composition.height"],
    ]);

    const fixed = await call("set_composition_property", { property: "height", value: 360 }, deps);
    expect(fixed).toEqual({ ok: true });
  });

  it("does not attach dimension issues to non-dimension properties", async () => {
    const deps = makeDeps();
    await call("create_composition", { width: 641, height: 360, fps: 30, duration: 1 }, deps);
    const result = await call("set_composition_property", { property: "fps", value: 24 }, deps);
    expect(result).toEqual({ ok: true });
  });
});
