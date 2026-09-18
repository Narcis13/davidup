// Text v2 fields (v1.1 S13) — schema bounds and the new tweenables.

import { describe, expect, it } from "vitest";

import { getTweenable } from "../../src/schema/tweenable.js";
import { TextItemSchema } from "../../src/schema/zod.js";

function textItem(overrides: Record<string, unknown> = {}) {
  return {
    type: "text",
    text: "Ship faster.\nBreak nothing.",
    font: "font-display",
    fontSize: 64,
    color: "#ffffff",
    transform: {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      anchorX: 0,
      anchorY: 0,
      opacity: 1,
    },
    ...overrides,
  };
}

describe("TextItemSchema — v2 fields", () => {
  it("accepts every new field and keeps them on parse", () => {
    const fields = {
      maxWidth: 720,
      lineHeight: 1.1,
      letterSpacing: -1.5,
      fontWeight: 700,
      fontStyle: "italic",
      strokeColor: "#000000",
      strokeWidth: 4,
      shadow: { color: "rgba(0,0,0,0.6)", blur: 12, offsetX: 0, offsetY: 6 },
    };
    const parsed = TextItemSchema.parse(textItem(fields));
    expect(parsed).toMatchObject(fields);
  });

  it("accepts a shadow with only a color and weight keywords", () => {
    expect(TextItemSchema.safeParse(textItem({ shadow: { color: "#000" } })).success).toBe(true);
    expect(TextItemSchema.safeParse(textItem({ fontWeight: "bold" })).success).toBe(true);
  });

  it.each([
    ["maxWidth 0", { maxWidth: 0 }],
    ["lineHeight 0", { lineHeight: 0 }],
    ["negative strokeWidth", { strokeWidth: -1 }],
    ["fontWeight 0", { fontWeight: 0 }],
    ["fontWeight 1001", { fontWeight: 1001 }],
    ["fontWeight 'heavy'", { fontWeight: "heavy" }],
    ["fontStyle 'slanted'", { fontStyle: "slanted" }],
    ["shadow without color", { shadow: { blur: 2 } }],
    ["negative shadow blur", { shadow: { color: "#000", blur: -1 } }],
  ])("rejects %s", (_label, fields) => {
    expect(TextItemSchema.safeParse(textItem(fields)).success).toBe(false);
  });
});

describe("text tweenables", () => {
  it.each(["letterSpacing", "lineHeight", "strokeWidth"])("%s is a numeric tweenable", (path) => {
    expect(getTweenable("text", path)).toEqual({ path, kind: "number" });
  });

  it("maxWidth and shadow are not tweenable", () => {
    expect(getTweenable("text", "maxWidth")).toBeUndefined();
    expect(getTweenable("text", "shadow")).toBeUndefined();
  });
});
