// Per-item effects (v1.1 S21) — schema shape, the `effects.<i>.<field>`
// tweenables, validation of effect tweens, and resolver interpolation.

import { describe, expect, it } from "vitest";

import { computeStateAt } from "../../src/engine/resolver.js";
import {
  getItemTweenable,
  getTweenable,
  parseEffectPath,
} from "../../src/schema/tweenable.js";
import type { Composition, Item } from "../../src/schema/types.js";
import { validate } from "../../src/schema/validator.js";
import { ItemSchema } from "../../src/schema/zod.js";
import { baseComposition } from "./fixtures.js";

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

function shape(effects: unknown): unknown {
  return { type: "shape", kind: "rect", width: 10, height: 10, fillColor: "#fff", effects, transform: T };
}

describe("effects schema", () => {
  it("accepts every effect type on every item type", () => {
    const effects = [
      { type: "blur", radius: 4 },
      { type: "shadow", color: "rgba(0,0,0,0.5)", blur: 8, offsetX: 2, offsetY: 4 },
      { type: "shadow", color: "#000" },
      { type: "glow", color: "#40c8ff", radius: 6 },
    ];
    const items = [
      shape(effects),
      { type: "sprite", asset: "a", width: 1, height: 1, effects, transform: T },
      { type: "text", text: "x", font: "f", fontSize: 10, color: "#fff", effects, transform: T },
      { type: "group", items: [], effects, transform: T },
      { type: "video", asset: "v", width: 1, height: 1, start: 0, effects, transform: T },
    ];
    for (const item of items) {
      const r = ItemSchema.safeParse(item);
      expect(r.success, JSON.stringify(item)).toBe(true);
      if (r.success) expect(r.data.effects).toEqual(effects);
    }
  });

  it("rejects negative radii, missing colours and unknown effect types", () => {
    for (const bad of [
      [{ type: "blur", radius: -1 }],
      [{ type: "blur" }],
      [{ type: "glow", radius: 4 }],
      [{ type: "glow", color: "#fff", radius: -2 }],
      [{ type: "shadow", color: "#000", blur: -1 }],
      [{ type: "sepia", amount: 1 }],
    ]) {
      expect(ItemSchema.safeParse(shape(bad)).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("effect tweenables", () => {
  it("parses effects.<index>.<field> paths only", () => {
    expect(parseEffectPath("effects.0.radius")).toEqual({ index: 0, field: "radius" });
    expect(parseEffectPath("effects.12.color")).toEqual({ index: 12, field: "color" });
    expect(parseEffectPath("effects.01.radius")).toBeUndefined();
    expect(parseEffectPath("effects.radius")).toBeUndefined();
    expect(parseEffectPath("effects.0.radius.x")).toBeUndefined();
    expect(parseEffectPath("transform.x")).toBeUndefined();
  });

  it("type-level lookup accepts any known effect field on any item type", () => {
    expect(getTweenable("group", "effects.0.radius")).toEqual({ path: "effects.0.radius", kind: "number" });
    expect(getTweenable("text", "effects.3.color")).toEqual({ path: "effects.3.color", kind: "color" });
    expect(getTweenable("video", "effects.0.offsetY")?.kind).toBe("number");
    expect(getTweenable("shape", "effects.0.type")).toBeUndefined();
  });

  it("item-level lookup checks the effect exists and carries the field", () => {
    const item = ItemSchema.parse(
      shape([
        { type: "blur", radius: 2 },
        { type: "shadow", color: "#000" },
      ]),
    ) as Item;
    expect(getItemTweenable(item, "effects.0.radius")?.kind).toBe("number");
    expect(getItemTweenable(item, "effects.1.offsetX")?.kind).toBe("number");
    expect(getItemTweenable(item, "effects.1.color")?.kind).toBe("color");
    // A shadow's blur field is `blur`, not `radius`; a blur has no colour.
    expect(getItemTweenable(item, "effects.1.radius")).toBeUndefined();
    expect(getItemTweenable(item, "effects.0.color")).toBeUndefined();
    // Out of range.
    expect(getItemTweenable(item, "effects.2.radius")).toBeUndefined();
    // Non-effect paths still go through the per-type table.
    expect(getItemTweenable(item, "fillColor")?.kind).toBe("color");
  });
});

function compWithEffectTween(
  effects: unknown,
  property: string,
  from: number | string,
  to: number | string,
): Composition {
  const comp = baseComposition();
  comp.items["glowy"] = shape(effects) as Item;
  comp.layers[1]!.items.push("glowy");
  comp.tweens.push({
    id: "fx-tween",
    target: "glowy",
    property,
    from,
    to,
    start: 0,
    duration: 2,
    easing: "linear",
  });
  return comp;
}

describe("validate — effect tweens", () => {
  it("accepts a tween on an existing effect field", () => {
    const r = validate(compWithEffectTween([{ type: "glow", color: "#fff", radius: 2 }], "effects.0.radius", 0, 10));
    expect(r.errors).toEqual([]);
  });

  it("names the missing index", () => {
    const r = validate(compWithEffectTween([{ type: "blur", radius: 2 }], "effects.1.radius", 0, 10));
    const err = r.errors.find((e) => e.code === "E_PROPERTY_INVALID");
    expect(err?.message).toMatch(/has 1 effect, so there is no effects\[1\]/);
  });

  it("names the effect type that lacks the field", () => {
    const r = validate(compWithEffectTween([{ type: "blur", radius: 2 }], "effects.0.color", "#000", "#fff"));
    const err = r.errors.find((e) => e.code === "E_PROPERTY_INVALID");
    expect(err?.message).toMatch(/effects\[0\] is a blur effect, which has no "color"/);
  });

  it("checks value kinds and colours like any other tween", () => {
    const kind = validate(
      compWithEffectTween([{ type: "shadow", color: "#000" }], "effects.0.offsetX", "#000", "#fff"),
    );
    expect(kind.errors.some((e) => e.code === "E_VALUE_KIND")).toBe(true);
  });
});

describe("resolver — effect tweens", () => {
  it("interpolates numbers and colours inside the effect without touching the source", () => {
    const comp = compWithEffectTween(
      [
        { type: "blur", radius: 0 },
        { type: "glow", color: "#000000", radius: 4 },
      ],
      "effects.0.radius",
      0,
      8,
    );
    comp.tweens.push({
      id: "fx-color",
      target: "glowy",
      property: "effects.1.color",
      from: "#000000",
      to: "#ffffff",
      start: 0,
      duration: 2,
      easing: "linear",
    });
    const mid = computeStateAt(comp, 1).items["glowy"]!;
    expect(mid.effects?.[0]).toEqual({ type: "blur", radius: 4 });
    expect(mid.effects?.[1]?.type).toBe("glow");
    expect((mid.effects?.[1] as { color: string }).color).not.toBe("#000000");
    // The authored composition is untouched — effects are cloned per frame.
    expect(comp.items["glowy"]!.effects?.[0]).toEqual({ type: "blur", radius: 0 });
  });

  it("clamps an overshooting radius at zero", () => {
    const comp = compWithEffectTween([{ type: "blur", radius: 4 }], "effects.0.radius", 4, 0);
    // easeOutBack overshoots past `to` (0) near the end.
    comp.tweens[comp.tweens.length - 1]!.easing = "easeOutBack";
    let sawClamp = false;
    for (let t = 0; t <= 2; t += 0.05) {
      const r = (computeStateAt(comp, t).items["glowy"]!.effects?.[0] as { radius: number }).radius;
      expect(r).toBeGreaterThanOrEqual(0);
      if (r === 0 && t < 2) sawClamp = true;
    }
    expect(sawClamp).toBe(true);
  });
});
