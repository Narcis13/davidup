// Text v2 through the MCP surface (v1.1 S14): add_text / update_item accept
// the S13 fields, toJSON round-trips them (the editor re-hydrates the store
// from it on every command), `null` clears maxWidth / shadow, and the fields
// stay text-only.

import { describe, expect, it } from "vitest";

import {
  CompositionStore,
  TOOLS,
  dispatchTool,
  type ToolDef,
  type ToolDeps,
} from "../../src/mcp/index.js";
import { ItemSchema } from "../../src/schema/zod.js";
import type { TextItem } from "../../src/schema/types.js";

function getTool(name: string): ToolDef {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool;
}

async function call(deps: ToolDeps, name: string, args: Record<string, unknown>) {
  return dispatchTool(getTool(name), args, deps);
}

async function setup(): Promise<{ deps: ToolDeps; layerId: string }> {
  const deps: ToolDeps = { store: new CompositionStore() };
  await call(deps, "create_composition", { width: 640, height: 360, fps: 30, duration: 2 });
  await call(deps, "register_asset", { id: "f", type: "font", src: "f.ttf", family: "F" });
  const layer = await call(deps, "add_layer", { z: 0, id: "fg" });
  expect(layer.ok).toBe(true);
  return { deps, layerId: "fg" };
}

function textItem(deps: ToolDeps, id: string): TextItem {
  const item = deps.store.toJSON().items[id];
  expect(item?.type).toBe("text");
  return item as TextItem;
}

const V2_FIELDS = {
  maxWidth: 400,
  lineHeight: 1.4,
  letterSpacing: 2,
  fontWeight: 700,
  fontStyle: "italic",
  strokeColor: "#000000",
  strokeWidth: 3,
  shadow: { color: "#00000080", blur: 6, offsetX: 2, offsetY: 4 },
} as const;

describe("add_text — text v2 fields", () => {
  it("stores every new field and round-trips it through toJSON", async () => {
    const { deps, layerId } = await setup();
    const out = await call(deps, "add_text", {
      layerId,
      id: "title",
      text: "Ship faster.\nBreak nothing, even when the copy runs long.",
      font: "f",
      fontSize: 48,
      color: "#ffffff",
      x: 120,
      y: 80,
      ...V2_FIELDS,
    });
    expect(out.ok).toBe(true);
    const item = textItem(deps, "title");
    expect(item).toMatchObject(V2_FIELDS);
    expect(ItemSchema.safeParse(item).success).toBe(true);
    expect(deps.store.validate().errors).toEqual([]);
  });

  it("keeps a v1.0-shaped text item free of v2 keys", async () => {
    const { deps, layerId } = await setup();
    await call(deps, "add_text", {
      layerId,
      id: "plain",
      text: "hi",
      font: "f",
      fontSize: 12,
      color: "#fff",
      x: 0,
      y: 0,
    });
    expect(Object.keys(textItem(deps, "plain")).sort()).toEqual(
      ["color", "font", "fontSize", "text", "transform", "type"].sort(),
    );
  });

  it("rejects out-of-range values at the tool boundary", async () => {
    const { deps, layerId } = await setup();
    const base = { layerId, text: "x", font: "f", fontSize: 12, color: "#fff", x: 0, y: 0 };
    for (const bad of [
      { maxWidth: 0 },
      { lineHeight: -1 },
      { strokeWidth: -2 },
      { fontWeight: 1001 },
      { fontStyle: "slanted" },
      { shadow: { blur: 2 } },
    ]) {
      const out = await call(deps, "add_text", { ...base, ...bad });
      expect(out.ok, JSON.stringify(bad)).toBe(false);
      if (out.ok) continue;
      expect(out.error.code).toBe("E_INVALID_VALUE");
    }
  });
});

describe("update_item — text v2 fields", () => {
  it("patches, then clears maxWidth and shadow with null", async () => {
    const { deps, layerId } = await setup();
    await call(deps, "add_text", {
      layerId,
      id: "t",
      text: "hello",
      font: "f",
      fontSize: 24,
      color: "#fff",
      x: 0,
      y: 0,
    });

    const patched = await call(deps, "update_item", { id: "t", props: V2_FIELDS });
    expect(patched.ok).toBe(true);
    expect(textItem(deps, "t")).toMatchObject(V2_FIELDS);

    const cleared = await call(deps, "update_item", {
      id: "t",
      props: { maxWidth: null, shadow: null, fontWeight: "normal" },
    });
    expect(cleared.ok).toBe(true);
    const item = textItem(deps, "t");
    expect("maxWidth" in item).toBe(false);
    expect("shadow" in item).toBe(false);
    expect(item.fontWeight).toBe("normal");
    expect(item.strokeWidth).toBe(3);
  });

  it("rejects text-only fields on a shape", async () => {
    const { deps, layerId } = await setup();
    await call(deps, "add_shape", { layerId, id: "box", kind: "rect", x: 0, y: 0, width: 10, height: 10 });
    for (const props of [{ maxWidth: 100 }, { lineHeight: 1.5 }, { shadow: { color: "#000" } }]) {
      const out = await call(deps, "update_item", { id: "box", props });
      expect(out.ok, JSON.stringify(props)).toBe(false);
      if (out.ok) continue;
      expect(out.error.code).toBe("E_INVALID_PROPERTY");
    }
  });

  it("accepts tweens on the new tweenable text properties", async () => {
    const { deps, layerId } = await setup();
    await call(deps, "add_text", {
      layerId,
      id: "t",
      text: "hello",
      font: "f",
      fontSize: 24,
      color: "#fff",
      x: 0,
      y: 0,
    });
    for (const property of ["letterSpacing", "lineHeight", "strokeWidth"]) {
      const out = await call(deps, "add_tween", {
        target: "t",
        property,
        from: 0.5,
        to: 4,
        start: 0,
        duration: 1,
      });
      expect(out.ok, property).toBe(true);
    }
    expect(deps.store.validate().errors).toEqual([]);
  });
});
