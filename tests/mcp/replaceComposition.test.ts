// v1.1 S29: replace_composition swaps a whole document — validated, atomic,
// with authoring constructs lowered first.

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

function doc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: "0.1",
    composition: { width: 320, height: 180, fps: 30, duration: 2, background: "#101010" },
    assets: [],
    layers: [{ id: "bg", z: 0, opacity: 1, blendMode: "normal", items: ["box"], name: "Back" }],
    items: {
      box: {
        type: "shape",
        kind: "rect",
        width: 40,
        height: 40,
        fillColor: "#ff0000",
        transform: { x: 10, y: 10, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 },
      },
    },
    tweens: [{ id: "t1", target: "box", property: "transform.x", from: 10, to: 200, start: 0, duration: 1 }],
    ...overrides,
  };
}

describe("replace_composition", () => {
  it("replaces the default composition and round-trips through get_composition", async () => {
    const deps = makeDeps();
    await dispatchTool(getTool("create_composition"), { width: 100, height: 100, fps: 24, duration: 1 }, deps);
    const input = doc();
    const out = await dispatchTool(getTool("replace_composition"), { json: input }, deps);
    expect(out.ok).toBe(true);
    const id = (out as { result: { compositionId: string } }).result.compositionId;
    expect(id).toBe(deps.store.getDefaultId());
    expect(deps.store.toJSON()).toEqual(input);
  });

  it("creates the composition when none exists", async () => {
    const deps = makeDeps();
    const out = await dispatchTool(getTool("replace_composition"), { json: doc(), compositionId: "c1" }, deps);
    expect(out).toMatchObject({ ok: true, result: { compositionId: "c1" } });
    expect(deps.store.getDefaultId()).toBe("c1");
  });

  it("rejects an invalid document with issues and leaves the store untouched", async () => {
    const deps = makeDeps();
    await dispatchTool(getTool("replace_composition"), { json: doc() }, deps);
    const before = deps.store.toJSON();
    const bad = doc({ tweens: [{ id: "t1", target: "ghost", property: "transform.x", from: 0, to: 1, start: 0, duration: 1 }] });
    const out = await dispatchTool(getTool("replace_composition"), { json: bad }, deps);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe("E_VALIDATION_FAILED");
    expect(out.error.issues?.length).toBeGreaterThan(0);
    expect(deps.store.toJSON()).toEqual(before);
  });

  it("lowers $behavior tweens before validating", async () => {
    const deps = makeDeps();
    const out = await dispatchTool(
      getTool("replace_composition"),
      { json: doc({ tweens: [{ $behavior: "fadeIn", target: "box", start: 0, duration: 0.5 }] }) },
      deps,
    );
    expect(out.ok).toBe(true);
    const tweens = deps.store.toJSON().tweens;
    expect(tweens.length).toBeGreaterThan(0);
    expect(tweens.every((t) => t.target === "box")).toBe(true);
  });

  it("refuses $ref (no source path to resolve against)", async () => {
    const deps = makeDeps();
    const out = await dispatchTool(
      getTool("replace_composition"),
      { json: doc({ items: { box: { $ref: "./box.json" } } }) },
      deps,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("E_INVALID_VALUE");
  });
});
