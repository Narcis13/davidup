import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validate } from "../../src/schema/validator.js";
import { AudioTrackSchema, CompositionMetaSchema } from "../../src/schema/zod.js";
import { baseComposition } from "./fixtures.js";

// Audio tracks — schema + parser coverage for v0.2 §S1.
//
// Field validations live in the Zod layer, so an invalid track surfaces as an
// E_SCHEMA error from `validate()`. S1 deliberately does NOT cross-check the
// `asset` reference (audio asset registration is S2) — a track may name an
// asset that isn't registered yet and still parse.

function loadFixture(name: string): unknown {
  const url = new URL(`./fixtures/audio/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8"));
}

describe("audio tracks — fixture JSON", () => {
  it("accepts the valid fixture", () => {
    const result = validate(loadFixture("valid.json"));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects the invalid-duration fixture (end <= start) as E_SCHEMA", () => {
    const result = validate(loadFixture("invalid-duration.json"));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "E_SCHEMA")).toBe(true);
    expect(result.errors.some((e) => e.path?.startsWith("audio"))).toBe(true);
  });

  it("rejects the invalid-volume fixture (volume > 2) as E_SCHEMA", () => {
    const result = validate(loadFixture("invalid-volume.json"));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "E_SCHEMA")).toBe(true);
    expect(result.errors.some((e) => e.path?.startsWith("audio"))).toBe(true);
  });
});

describe("audio tracks — composition integration", () => {
  it("keeps a composition with no audio key valid (backwards compatible)", () => {
    const comp = baseComposition();
    expect("audio" in comp).toBe(false);
    expect(validate(comp).valid).toBe(true);
  });

  it("accepts a base composition with a valid audio[] section", () => {
    const comp = baseComposition() as Record<string, unknown>;
    comp.audio = [
      { id: "vo", asset: "narration", start: 1, end: 10, volume: 1.2, fadeIn: 0.5, fadeOut: 0.5 },
      { asset: "music", start: 0 },
    ];
    const result = validate(comp);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("flags an out-of-range volume nested in a full composition", () => {
    const comp = baseComposition() as Record<string, unknown>;
    comp.audio = [{ asset: "music", start: 0, volume: -0.1 }];
    const result = validate(comp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "E_SCHEMA")).toBe(true);
  });
});

describe("AudioTrackSchema — field rules", () => {
  const base = { asset: "voiceover", start: 0 };

  it("accepts the minimal track (asset + start only)", () => {
    expect(AudioTrackSchema.safeParse(base).success).toBe(true);
  });

  it("requires a non-empty asset", () => {
    expect(AudioTrackSchema.safeParse({ asset: "", start: 0 }).success).toBe(false);
    expect(AudioTrackSchema.safeParse({ start: 0 }).success).toBe(false);
  });

  it("requires start >= 0", () => {
    expect(AudioTrackSchema.safeParse({ ...base, start: -1 }).success).toBe(false);
    expect(AudioTrackSchema.safeParse({ ...base, start: 0 }).success).toBe(true);
  });

  it("requires end > start when present", () => {
    expect(AudioTrackSchema.safeParse({ ...base, start: 2, end: 2 }).success).toBe(false);
    expect(AudioTrackSchema.safeParse({ ...base, start: 2, end: 1 }).success).toBe(false);
    expect(AudioTrackSchema.safeParse({ ...base, start: 2, end: 3 }).success).toBe(true);
  });

  it("flags end <= start at the `end` path", () => {
    const parsed = AudioTrackSchema.safeParse({ ...base, start: 5, end: 3 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.join(".") === "end")).toBe(true);
    }
  });

  it("constrains volume to [0, 2]", () => {
    expect(AudioTrackSchema.safeParse({ ...base, volume: 0 }).success).toBe(true);
    expect(AudioTrackSchema.safeParse({ ...base, volume: 2 }).success).toBe(true);
    expect(AudioTrackSchema.safeParse({ ...base, volume: -0.01 }).success).toBe(false);
    expect(AudioTrackSchema.safeParse({ ...base, volume: 2.01 }).success).toBe(false);
  });

  it("requires fadeIn / fadeOut >= 0 when present", () => {
    expect(AudioTrackSchema.safeParse({ ...base, fadeIn: 0 }).success).toBe(true);
    expect(AudioTrackSchema.safeParse({ ...base, fadeOut: 1.5 }).success).toBe(true);
    expect(AudioTrackSchema.safeParse({ ...base, fadeIn: -0.1 }).success).toBe(false);
    expect(AudioTrackSchema.safeParse({ ...base, fadeOut: -1 }).success).toBe(false);
  });

  it("accepts an optional boolean `loop` (v1.1 S10)", () => {
    expect(AudioTrackSchema.safeParse({ ...base, loop: true }).success).toBe(true);
    expect(AudioTrackSchema.safeParse({ ...base, loop: false, end: 9 }).success).toBe(true);
    expect(AudioTrackSchema.safeParse({ ...base, loop: "yes" }).success).toBe(false);
  });
});

describe("composition.audioMaster (v1.1 S10)", () => {
  const meta = { width: 64, height: 64, fps: 30, duration: 1, background: "#000" };

  it("is optional and accepts limiter / targetLufs", () => {
    expect(CompositionMetaSchema.safeParse(meta).success).toBe(true);
    expect(CompositionMetaSchema.safeParse({ ...meta, audioMaster: {} }).success).toBe(true);
    expect(
      CompositionMetaSchema.safeParse({ ...meta, audioMaster: { limiter: false, targetLufs: -23 } })
        .success,
    ).toBe(true);
  });

  it("bounds targetLufs to [-70, -5] and types limiter", () => {
    const at = (audioMaster: unknown) =>
      CompositionMetaSchema.safeParse({ ...meta, audioMaster }).success;
    expect(at({ targetLufs: -70 })).toBe(true);
    expect(at({ targetLufs: -5 })).toBe(true);
    expect(at({ targetLufs: -4 })).toBe(false);
    expect(at({ targetLufs: -71 })).toBe(false);
    expect(at({ limiter: "on" })).toBe(false);
  });

  it("surfaces an invalid audioMaster from validate() as E_SCHEMA", () => {
    const comp = baseComposition() as { composition: Record<string, unknown> };
    comp.composition.audioMaster = { targetLufs: 3 };
    const result = validate(comp);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "E_SCHEMA")).toBe(true);
  });
});
