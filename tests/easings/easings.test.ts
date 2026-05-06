import { describe, expect, it } from "vitest";
import {
  EASINGS,
  EASING_NAMES,
  easeInBack,
  easeInOutBack,
  easeInOutQuad,
  easeInQuad,
  easeOutBack,
  easeOutQuad,
  getEasing,
  isEasingName,
  linear,
} from "../../src/easings/index.js";

const EPS = 1e-9;

describe("easing identity at endpoints", () => {
  for (const name of EASING_NAMES) {
    it(`${name}(0) ≈ 0 and ${name}(1) ≈ 1`, () => {
      const f = EASINGS[name];
      expect(Math.abs(f(0))).toBeLessThan(EPS);
      expect(Math.abs(f(1) - 1)).toBeLessThan(EPS);
    });
  }
});

describe("known midpoint values", () => {
  it("linear is identity", () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(linear(t)).toBe(t);
    }
  });

  it("easeInQuad(0.5) === 0.25", () => {
    expect(easeInQuad(0.5)).toBe(0.25);
  });

  it("easeOutQuad(0.5) === 0.75", () => {
    expect(easeOutQuad(0.5)).toBe(0.75);
  });

  it("easeInOutQuad(0.5) === 0.5", () => {
    expect(easeInOutQuad(0.5)).toBe(0.5);
  });
});

describe("monotonic easings stay within tolerance", () => {
  // back easings overshoot on purpose; exclude them from monotonicity check.
  const monotonic = EASING_NAMES.filter((n) => !n.toLowerCase().includes("back"));
  for (const name of monotonic) {
    it(`${name} is non-decreasing on a 0..1 grid`, () => {
      const f = EASINGS[name];
      let prev = f(0);
      for (let i = 1; i <= 100; i++) {
        const v = f(i / 100);
        expect(v).toBeGreaterThanOrEqual(prev - EPS);
        prev = v;
      }
    });
  }
});

describe("back easings overshoot", () => {
  it("easeInBack dips below 0", () => {
    expect(easeInBack(0.2)).toBeLessThan(0);
  });
  it("easeOutBack rises above 1", () => {
    expect(easeOutBack(0.8)).toBeGreaterThan(1);
  });
  it("easeInOutBack overshoots on both ends", () => {
    expect(easeInOutBack(0.2)).toBeLessThan(0);
    expect(easeInOutBack(0.8)).toBeGreaterThan(1);
  });
});

describe("getEasing dispatcher", () => {
  it("returns linear for undefined", () => {
    expect(getEasing(undefined)).toBe(linear);
  });
  it("returns the requested easing", () => {
    expect(getEasing("easeInQuad")).toBe(easeInQuad);
  });
});

describe("isEasingName guard", () => {
  it("recognises known names", () => {
    expect(isEasingName("easeInQuad")).toBe(true);
  });
  it("rejects unknown names", () => {
    expect(isEasingName("easeBogus")).toBe(false);
  });
});
