import { describe, expect, it } from "vitest";
import {
  fpsArg,
  fpsRational,
  fpsValue,
  framesForDuration,
  frameTime,
  isRationalFps,
} from "../../src/schema/fps.js";
import { validate } from "../../src/schema/validator.js";
import { videoFrameIndex } from "../../src/engine/render.js";
import { baseComposition } from "./fixtures.js";

describe("fps helpers (v1.1 S7)", () => {
  it("recognises only positive integer N/D strings", () => {
    expect(isRationalFps("30000/1001")).toBe(true);
    expect(isRationalFps("24/1")).toBe(true);
    for (const bad of ["0/1", "30/0", "29.97", "30000/1001/2", "-30/1", " 30/1", "", 30]) {
      expect(isRationalFps(bad)).toBe(false);
    }
  });

  it("splits numbers and rationals", () => {
    expect(fpsRational(30)).toEqual({ num: 30, den: 1 });
    expect(fpsRational(29.97)).toEqual({ num: 29.97, den: 1 });
    expect(fpsRational("30000/1001")).toEqual({ num: 30000, den: 1001 });
    expect(() => fpsRational("nope")).toThrow(/Invalid fps/);
    expect(fpsValue("60000/1001")).toBeCloseTo(59.94006, 5);
  });

  it("keeps the number form bit-identical to i / fps", () => {
    for (const fps of [12, 24, 30, 29.97, 60]) {
      for (let i = 0; i < 500; i++) expect(frameTime(i, fps)).toBe(i / fps);
      expect(framesForDuration(1.001, fps)).toBe(Math.ceil(1.001 * fps));
    }
    expect(fpsArg(30)).toBe("30");
    expect(fpsArg(29.97)).toBe("29.97");
  });

  it("uses the exact NTSC timebase for rationals", () => {
    expect(frameTime(30000, "30000/1001")).toBe(1001);
    expect(frameTime(1, "30000/1001")).toBe(1001 / 30000);
    expect(fpsArg("30000/1001")).toBe("30000/1001");
    // 10 s at 29.97 → 299.7 frames → 300; 10.01 s is exactly 300 frames.
    expect(framesForDuration(10, "30000/1001")).toBe(300);
    expect(framesForDuration(10.01, "30000/1001")).toBe(300);
    expect(framesForDuration(10.02, "30000/1001")).toBe(301);
  });

  it("round-trips frame index → time → video frame index", () => {
    for (const fps of ["24000/1001", "30000/1001", "60000/1001"]) {
      for (let i = 0; i < 20000; i += 7) {
        expect(videoFrameIndex(frameTime(i, fps), 0, fpsValue(fps), 1e9, false)).toBe(i + 1);
      }
    }
  });
});

describe("validate — composition.fps", () => {
  it("accepts a rational string", () => {
    const comp = baseComposition();
    (comp.composition as { fps: number | string }).fps = "30000/1001";
    expect(validate(comp).errors).toEqual([]);
  });

  it("rejects malformed fps strings and non-positive numbers", () => {
    for (const bad of ["29.97", "30000/0", "abc", 0, -1]) {
      const comp = baseComposition();
      (comp.composition as { fps: unknown }).fps = bad;
      const result = validate(comp);
      expect(result.valid, String(bad)).toBe(false);
      expect(result.errors.some((e) => e.path.startsWith("composition.fps")), String(bad)).toBe(true);
    }
  });
});
