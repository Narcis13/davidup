import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validate } from "../../src/schema/validator.js";
import { VideoItemSchema } from "../../src/schema/zod.js";
import { baseComposition } from "./fixtures.js";

// Video items — schema + parser coverage for v0.2 §S5.
//
// Simple bounds (trimIn ≥ 0, trimOut > 0, start ≥ 0, end > 0, fit ∈ enum) live
// in the Zod layer, so a malformed field surfaces as E_SCHEMA from `validate()`.
// The cross-field / cross-reference invariants — trimIn < trimOut ≤
// asset.duration and end > start — are checked by the semantic validator and
// surface as E_VIDEO_RANGE. Like audio §S1, S5 deliberately does NOT cross-check
// that the `asset` reference is a registered video asset (registration is §S6);
// a clip may name an asset that isn't registered yet and still parse.

function loadFixture(name: string): unknown {
  const url = new URL(`./fixtures/video/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

// A fully-specified transform, reused across the synthetic items below.
function transform() {
  return {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    anchorX: 0,
    anchorY: 0,
    opacity: 1,
  };
}

function videoItem(overrides: Record<string, unknown> = {}) {
  return {
    type: "video",
    asset: "clip",
    width: 1920,
    height: 1080,
    start: 0,
    transform: transform(),
    ...overrides,
  };
}

describe("video items — fixture JSON", () => {
  it("accepts the valid fixture", () => {
    const result = validate(loadFixture("valid.json"));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects the invalid-trim fixture (trimIn >= trimOut) as E_VIDEO_RANGE", () => {
    const result = validate(loadFixture("invalid-trim.json"));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "E_VIDEO_RANGE")).toBe(true);
    expect(result.errors.some((e) => e.path?.startsWith("items"))).toBe(true);
  });

  it("rejects the invalid-timing fixture (end <= start) as E_VIDEO_RANGE", () => {
    const result = validate(loadFixture("invalid-timing.json"));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "E_VIDEO_RANGE")).toBe(true);
    expect(result.errors.some((e) => e.path?.startsWith("items"))).toBe(true);
  });
});

describe("video items — composition integration", () => {
  it("accepts a base composition with a video item added", () => {
    const comp = baseComposition() as Record<string, unknown>;
    (comp.items as Record<string, unknown>)["clip"] = videoItem({
      end: 10,
      trimIn: 1,
      trimOut: 9,
      fit: "contain",
    });
    (comp.layers as Array<{ items: string[] }>)[0]!.items.push("clip");
    const result = validate(comp);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("flags an empty trim window nested in a full composition", () => {
    const comp = baseComposition() as Record<string, unknown>;
    (comp.items as Record<string, unknown>)["clip"] = videoItem({
      trimIn: 5,
      trimOut: 5,
    });
    const result = validate(comp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "E_VIDEO_RANGE")).toBe(true);
  });

  it("keeps the asset reference unchecked at S5 (registration is S6)", () => {
    // No video asset type exists yet, so the clip names an unregistered asset.
    // Mirrors audio §S1: this must still validate.
    const comp = baseComposition() as Record<string, unknown>;
    (comp.items as Record<string, unknown>)["clip"] = videoItem();
    expect(validate(comp).valid).toBe(true);
  });
});

describe("VideoItemSchema — field rules (Zod layer)", () => {
  it("accepts the minimal item and applies fit/loop defaults", () => {
    const parsed = VideoItemSchema.parse(videoItem());
    expect(parsed.fit).toBe("contain");
    expect(parsed.loop).toBe(false);
  });

  it("requires a non-empty asset", () => {
    expect(VideoItemSchema.safeParse(videoItem({ asset: "" })).success).toBe(false);
  });

  it("requires width / height to be non-negative", () => {
    expect(VideoItemSchema.safeParse(videoItem({ width: -1 })).success).toBe(false);
    expect(VideoItemSchema.safeParse(videoItem({ height: -1 })).success).toBe(false);
  });

  it("requires start >= 0", () => {
    expect(VideoItemSchema.safeParse(videoItem({ start: -1 })).success).toBe(false);
    expect(VideoItemSchema.safeParse(videoItem({ start: 0 })).success).toBe(true);
  });

  it("requires end / trimOut to be positive and trimIn to be non-negative", () => {
    expect(VideoItemSchema.safeParse(videoItem({ end: 0 })).success).toBe(false);
    expect(VideoItemSchema.safeParse(videoItem({ trimOut: 0 })).success).toBe(false);
    expect(VideoItemSchema.safeParse(videoItem({ trimIn: -0.1 })).success).toBe(false);
    expect(VideoItemSchema.safeParse(videoItem({ trimIn: 0, trimOut: 1 })).success).toBe(true);
  });

  it("constrains fit to the four object-fit modes", () => {
    for (const fit of ["cover", "contain", "fill", "none"]) {
      expect(VideoItemSchema.safeParse(videoItem({ fit })).success).toBe(true);
    }
    expect(VideoItemSchema.safeParse(videoItem({ fit: "stretch" })).success).toBe(false);
  });

  it("carries ZERO audio fields — audio-only keys are stripped, not stored", () => {
    const parsed = VideoItemSchema.parse(
      videoItem({ volume: 0.5, fadeIn: 1, fadeOut: 1 }),
    ) as Record<string, unknown>;
    expect("volume" in parsed).toBe(false);
    expect("fadeIn" in parsed).toBe(false);
    expect("fadeOut" in parsed).toBe(false);
  });
});

describe("video items — E_VIDEO_RANGE (validator layer)", () => {
  function compWith(item: Record<string, unknown>, assets: unknown[] = []) {
    const comp = baseComposition() as Record<string, unknown>;
    comp.assets = assets;
    (comp.items as Record<string, unknown>)["clip"] = item;
    return comp;
  }

  it("rejects trimIn >= trimOut", () => {
    const result = validate(compWith(videoItem({ trimIn: 4, trimOut: 2 })));
    expect(result.errors.some((e) => e.code === "E_VIDEO_RANGE")).toBe(true);
  });

  it("rejects end <= start", () => {
    const result = validate(compWith(videoItem({ start: 5, end: 5 })));
    expect(result.errors.some((e) => e.code === "E_VIDEO_RANGE")).toBe(true);
  });

  it("rejects trimOut beyond a registered asset's duration", () => {
    // The duration gate is asset-type-agnostic by design (video asset
    // registration arrives in §S6). An audio asset carries a `duration`, so it
    // exercises the same `trimOut ≤ asset.duration` path the future video
    // asset will use.
    const asset = { id: "clip", type: "audio", src: "./clip.mp3", duration: 5 };
    const result = validate(compWith(videoItem({ trimIn: 0, trimOut: 10 }), [asset]));
    expect(result.errors.some((e) => e.code === "E_VIDEO_RANGE")).toBe(true);
  });

  it("accepts trimOut within a registered asset's duration", () => {
    const asset = { id: "clip", type: "audio", src: "./clip.mp3", duration: 30 };
    const result = validate(compWith(videoItem({ trimIn: 0, trimOut: 10 }), [asset]));
    expect(result.errors.filter((e) => e.code === "E_VIDEO_RANGE")).toEqual([]);
  });
});
