// B-3: every item has exactly one parent. A group inside a scene or template
// owns its children, so the scene wrapper / the template's layer must not list
// them as well — otherwise the renderer paints them twice.

import { describe, expect, it } from "vitest";

import { topLevelIds } from "../../src/compose/ownership.js";
import { precompile } from "../../src/compose/precompile.js";
import { renderFrame } from "../../src/engine/index.js";
import type { Canvas2DContext, OffscreenSurface } from "../../src/engine/types.js";
import { MCPToolError } from "../../src/mcp/errors.js";
import type { Composition } from "../../src/schema/types.js";
import { validateComposition } from "../../src/schema/index.js";

const T = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  anchorX: 0,
  anchorY: 0,
  opacity: 1,
};

function box(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "shape",
    kind: "rect",
    width: 10,
    height: 10,
    fillColor: "#ff0000",
    transform: T,
    ...extra,
  };
}

function group(items: string[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "group", items, transform: T, ...extra };
}

function comp(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    version: "0.1",
    composition: { width: 40, height: 40, fps: 30, duration: 1, background: "transparent" },
    assets: [],
    layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["si"] }],
    items: {},
    tweens: [],
    ...extra,
  };
}

function scene(items: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { id: "s", duration: 1, params: [], items, tweens: [], ...extra };
}

type Resolved = {
  layers: Array<{ items: string[] }>;
  items: Record<string, { items?: string[] }>;
};

async function compile(c: Record<string, unknown>): Promise<Resolved> {
  return (await precompile(c)) as Resolved;
}

/** Every id listed by more than one parent (layer or group). */
function multiParented(resolved: Resolved): string[] {
  const seen = new Map<string, number>();
  const lists = [
    ...resolved.layers.map((l) => l.items),
    ...Object.values(resolved.items).flatMap((i) =>
      (i as { type?: string }).type === "group" && Array.isArray(i.items) ? [i.items] : [],
    ),
  ];
  for (const list of lists) for (const id of list) seen.set(id, (seen.get(id) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
}

describe("topLevelIds", () => {
  it("drops ids owned by a group and keeps declaration order", () => {
    const items = { c: box(), g: group(["a"]), a: box(), b: box() };
    expect(topLevelIds(items, ["c", "g", "a", "b"])).toEqual(["c", "g", "b"]);
  });

  it("returns the order unchanged when there is no group", () => {
    const order = ["a", "b"];
    expect(topLevelIds({ a: box(), b: box() }, order)).toBe(order);
  });
});

describe("single parent after compile (B-3)", () => {
  it("the repro: template layer entries and scene wrapper children are top-level only", async () => {
    const resolved = await compile(
      comp({
        templates: {
          t: { id: "t", params: [], items: { g: group(["kid"]), kid: box() }, tweens: [] },
        },
        scenes: { s: scene({ g: group(["kid"]), kid: box() }) },
        layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: ["ti", "si"] }],
        items: { ti: { $template: "t", params: {} }, si: { type: "scene", scene: "s", transform: T } },
      }),
    );
    expect(resolved.layers[0]!.items).toEqual(["ti__g", "si"]);
    expect(resolved.items.ti__g!.items).toEqual(["ti__kid"]);
    expect(resolved.items.si!.items).toEqual(["si__g"]);
    expect(resolved.items.si__g!.items).toEqual(["si__kid"]);
    expect(multiParented(resolved)).toEqual([]);
    expect(validateComposition(resolved).valid).toBe(true);
  });

  it("group → group → leaf inside a scene", async () => {
    const resolved = await compile(
      comp({
        scenes: {
          s: scene({ outer: group(["inner"]), inner: group(["leaf"]), leaf: box(), free: box() }),
        },
        items: { si: { type: "scene", scene: "s", transform: T } },
      }),
    );
    expect(resolved.items.si!.items).toEqual(["si__outer", "si__free"]);
    expect(resolved.items.si__outer!.items).toEqual(["si__inner"]);
    expect(resolved.items.si__inner!.items).toEqual(["si__leaf"]);
    expect(multiParented(resolved)).toEqual([]);
  });

  it("$repeat products referenced by a scene group stay under the group", async () => {
    const resolved = await compile(
      comp({
        scenes: {
          s: scene({
            row: group(["dots"]),
            dots: { $repeat: { count: 3 }, item: box() },
          }),
        },
        items: { si: { type: "scene", scene: "s", transform: T } },
      }),
    );
    expect(resolved.items.si!.items).toEqual(["si__row"]);
    expect(resolved.items.si__row!.items).toEqual([
      "si__dots__r0",
      "si__dots__r1",
      "si__dots__r2",
    ]);
    expect(multiParented(resolved)).toEqual([]);
  });

  it("a nested scene instance held by a scene group is owned by that group", async () => {
    const resolved = await compile(
      comp({
        scenes: {
          inner: { id: "inner", duration: 1, params: [], items: { dot: box() }, tweens: [] },
          s: scene({ holder: group(["child"]), child: { type: "scene", scene: "inner", transform: T } }),
        },
        items: { si: { type: "scene", scene: "s", transform: T } },
      }),
    );
    expect(resolved.items.si!.items).toEqual(["si__holder"]);
    expect(resolved.items.si__holder!.items).toEqual(["si__child"]);
    expect(resolved.items.si__child!.items).toEqual(["si__child__dot"]);
    expect(multiParented(resolved)).toEqual([]);
  });

  it("a template emitting a group, expanded inside a scene", async () => {
    const resolved = await compile(
      comp({
        templates: {
          t: { id: "t", params: [], items: { g: group(["kid"]), kid: box() }, tweens: [] },
        },
        scenes: { s: scene({ lower: { $template: "t", params: {} }, other: box() }) },
        items: { si: { type: "scene", scene: "s", transform: T } },
      }),
    );
    // expandTemplatesInScene leaves `lower__kid` in the scene map; the scene
    // pass drops it from the wrapper because `lower__g` owns it.
    expect(resolved.items.si!.items).toEqual(["si__lower__g", "si__other"]);
    expect(resolved.items.si__lower__g!.items).toEqual(["si__lower__kid"]);
    expect(multiParented(resolved)).toEqual([]);
  });

  it("rejects a scene group that lists a template instance key", async () => {
    let err: unknown;
    try {
      await compile(
        comp({
          templates: { t: { id: "t", params: [], items: { kid: box() }, tweens: [] } },
          scenes: { s: scene({ g: group(["lower"]), lower: { $template: "t", params: {} } }) },
          items: { si: { type: "scene", scene: "s", transform: T } },
        }),
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MCPToolError);
    expect((err as MCPToolError).code).toBe("E_INVALID_VALUE");
    expect((err as MCPToolError).message).toContain(
      "groups inside a scene can't reference a template instance; list its emitted ids",
    );
  });
});

// ──────────────── Paint count ────────────────

interface SkiaModule {
  Canvas: new (
    width: number,
    height: number,
  ) => {
    getContext(kind: "2d"): Canvas2DContext;
    toBuffer(format: "raw"): Promise<Uint8Array> | Uint8Array;
  };
}

describe("paint count (B-3)", () => {
  it("a scene group's child paints once: alpha 0.5 under a half-opacity instance, not 0.75", async () => {
    const specifier = "skia-canvas";
    const skia = (await import(/* @vite-ignore */ specifier)) as SkiaModule;
    // The instance wrapper carries the 0.5. Painted once (through `g`) the
    // child reads 0.5; painted twice (through `g` and again as a direct
    // wrapper child) it reads 0.5 + 0.5·(1 − 0.5) = 0.75.
    const resolved = (await precompile(
      comp({
        scenes: { s: scene({ g: group(["kid"]), kid: box() }) },
        items: { si: { type: "scene", scene: "s", transform: { ...T, opacity: 0.5 } } },
      }),
    )) as Composition;
    const canvas = new skia.Canvas(40, 40);
    const ctx = canvas.getContext("2d");
    const createOffscreen = (w: number, h: number): OffscreenSurface => {
      const off = new skia.Canvas(w, h);
      return { context: off.getContext("2d"), source: off };
    };
    ctx.clearRect(0, 0, 40, 40);
    renderFrame(resolved, 0, ctx, { createOffscreen });
    const data = await Promise.resolve(canvas.toBuffer("raw"));
    const alpha = data[(5 * 40 + 5) * 4 + 3]!;
    expect(alpha).toBeGreaterThanOrEqual(127);
    expect(alpha).toBeLessThanOrEqual(128);
  });
});
