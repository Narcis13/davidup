// Schema defaults reaching the resolved composition (v1.3 Session G2, B-6).
//
// Covers the table derived from ItemSchema, the fill itself (identity when
// there is nothing to do, extension keys preserved, explicit values kept), and
// a drift guard: a `.default()` added anywhere in CompositionSchema that
// `applySchemaDefaults` would not fill fails this file.

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  applySchemaDefaults,
  defaultFactory,
  ITEM_DEFAULTS,
} from "../../src/schema/defaults.js";
import { CompositionSchema } from "../../src/schema/zod.js";

const IDENTITY = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  anchorX: 0,
  anchorY: 0,
  opacity: 1,
} as const;

function comp(items: Record<string, unknown>): Record<string, unknown> {
  return {
    version: "0.1",
    composition: { width: 16, height: 16, fps: 30, duration: 1, background: "#000" },
    assets: [],
    layers: [{ id: "L", z: 0, opacity: 1, blendMode: "normal", items: Object.keys(items) }],
    items,
    tweens: [],
  };
}

/** A hand-written video item — exactly the shape B-6 crashed on. */
function authoredVideo(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "video",
    asset: "clip",
    width: 100,
    height: 100,
    start: 0,
    transform: { ...IDENTITY },
    ...extra,
  };
}

describe("ITEM_DEFAULTS", () => {
  it("carries the video defaults and nothing for default-free item types", () => {
    expect([...ITEM_DEFAULTS.keys()]).toEqual(["video"]);
    const video = ITEM_DEFAULTS.get("video")!;
    expect(Object.keys(video).sort()).toEqual(["fit", "loop"]);
    expect(video.fit!()).toBe("contain");
    expect(video.loop!()).toBe(false);
  });

  it("reports no factory for a schema without a default", () => {
    expect(defaultFactory(z.string())).toBeUndefined();
    expect(defaultFactory(z.string().optional())).toBeUndefined();
    expect(defaultFactory(z.string().default("x"))).toBeTypeOf("function");
  });

  it("hands out a fresh value per call so object defaults are never shared", () => {
    const factory = defaultFactory(z.object({ a: z.number() }).default({ a: 1 }))!;
    expect(factory()).not.toBe(factory());
  });
});

describe("applySchemaDefaults", () => {
  it("fills fit and loop on a hand-written video item", () => {
    const out = applySchemaDefaults(comp({ v: authoredVideo() })) as {
      items: { v: Record<string, unknown> };
    };
    expect(out.items.v.fit).toBe("contain");
    expect(out.items.v.loop).toBe(false);
  });

  it("keeps values the author wrote, including falsy ones", () => {
    const out = applySchemaDefaults(
      comp({ v: authoredVideo({ fit: "cover", loop: true }) }),
    ) as { items: { v: Record<string, unknown> } };
    expect(out.items.v.fit).toBe("cover");
    expect(out.items.v.loop).toBe(true);
  });

  it("treats an explicit undefined like a missing key, as Zod does", () => {
    const out = applySchemaDefaults(comp({ v: authoredVideo({ fit: undefined }) })) as {
      items: { v: Record<string, unknown> };
    };
    expect(out.items.v.fit).toBe("contain");
  });

  it("returns the same reference when nothing is missing", () => {
    const input = comp({
      v: authoredVideo({ fit: "fill", loop: false }),
      s: { type: "shape", kind: "rect", width: 4, height: 4, fillColor: "#fff" },
    });
    expect(applySchemaDefaults(input)).toBe(input);
  });

  it("leaves other item types and unrelated keys untouched", () => {
    const sprite = { type: "sprite", asset: "a", width: 1, height: 1, transform: { ...IDENTITY } };
    const input = comp({ s: sprite, v: authoredVideo() });
    const out = applySchemaDefaults(input) as { items: Record<string, unknown> };
    expect(out.items.s).toBe(sprite);
  });

  it("preserves $ and x- extension keys (unlike a strict parse)", () => {
    const out = applySchemaDefaults(
      comp({ v: authoredVideo({ $comment: "hero clip", "x-author": "me" }) }),
    ) as { items: { v: Record<string, unknown> } };
    expect(out.items.v.$comment).toBe("hero clip");
    expect(out.items.v["x-author"]).toBe("me");
    expect(out.items.v.fit).toBe("contain");
  });

  it("passes through non-composition input unchanged (it runs before validation)", () => {
    expect(applySchemaDefaults(42)).toBe(42);
    expect(applySchemaDefaults(null)).toBe(null);
    expect(applySchemaDefaults("hi")).toBe("hi");
    const noItems = { version: "0.1" };
    expect(applySchemaDefaults(noItems)).toBe(noItems);
    const junkItems = { items: { v: 7, w: null } };
    expect(applySchemaDefaults(junkItems)).toBe(junkItems);
  });
});

// ─────────────────── drift guard ───────────────────

/**
 * Every `.default()` in the composition schema, as a path string. A default
 * anywhere other than a top-level item field is invisible to
 * `applySchemaDefaults` — the engine would keep reading a key the types say
 * is always there.
 */
function collectDefaultPaths(schema: z.ZodTypeAny, path: string, out: string[]): void {
  const def = (schema as { _def?: Record<string, unknown> })._def;
  const typeName = def?.typeName as string | undefined;
  switch (typeName) {
    case "ZodDefault":
      out.push(path);
      collectDefaultPaths(def!.innerType as z.ZodTypeAny, path, out);
      return;
    case "ZodOptional":
    case "ZodNullable":
    case "ZodReadonly":
      collectDefaultPaths(def!.innerType as z.ZodTypeAny, path, out);
      return;
    case "ZodEffects":
      collectDefaultPaths(def!.schema as z.ZodTypeAny, path, out);
      return;
    case "ZodArray":
      collectDefaultPaths(def!.type as z.ZodTypeAny, `${path}[]`, out);
      return;
    case "ZodRecord":
      collectDefaultPaths(def!.valueType as z.ZodTypeAny, `${path}.*`, out);
      return;
    case "ZodTuple":
      (def!.items as z.ZodTypeAny[]).forEach((item, i) =>
        collectDefaultPaths(item, `${path}.${i}`, out),
      );
      return;
    case "ZodUnion":
    case "ZodDiscriminatedUnion": {
      for (const option of def!.options as z.ZodTypeAny[]) {
        const variant = (option as z.ZodObject<z.ZodRawShape>).shape?.type;
        const label =
          variant instanceof z.ZodLiteral ? `${path}[${String(variant.value)}]` : path;
        collectDefaultPaths(option, label, out);
      }
      return;
    }
    case "ZodObject": {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      for (const [key, child] of Object.entries(shape)) {
        collectDefaultPaths(child, `${path}.${key}`, out);
      }
      return;
    }
    default:
      return;
  }
}

describe("schema defaults are all reachable", () => {
  it("declares defaults only where applySchemaDefaults fills them", () => {
    const found: string[] = [];
    collectDefaultPaths(CompositionSchema, "", found);
    const expected: string[] = [];
    for (const [type, factories] of ITEM_DEFAULTS) {
      for (const key of Object.keys(factories)) expected.push(`.items.*[${type}].${key}`);
    }
    expect(found.sort()).toEqual(expected.sort());
  });

  it("finds the two video defaults (the walker actually walks)", () => {
    const found: string[] = [];
    collectDefaultPaths(CompositionSchema, "", found);
    expect(found.sort()).toEqual([".items.*[video].fit", ".items.*[video].loop"]);
  });
});
