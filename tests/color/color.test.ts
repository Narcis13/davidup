import { describe, expect, it } from "vitest";
import {
  formatColor,
  lerpColor,
  lerpColorString,
  lerpNumber,
  parseColor,
  type RGBA,
} from "../../src/color/index.js";

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe("parseColor — hex", () => {
  it("parses #fff", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });
  it("parses #000", () => {
    expect(parseColor("#000")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });
  it("parses #ff0000", () => {
    expect(parseColor("#ff0000")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });
  it("parses 4-digit hex with alpha", () => {
    const c = parseColor("#f008");
    expect(c.r).toBe(255);
    expect(c.g).toBe(0);
    expect(c.b).toBe(0);
    expect(close(c.a, 0x88 / 255)).toBe(true);
  });
  it("parses 8-digit hex with alpha", () => {
    const c = parseColor("#ff000080");
    expect(c.r).toBe(255);
    expect(c.g).toBe(0);
    expect(c.b).toBe(0);
    expect(close(c.a, 128 / 255)).toBe(true);
  });
  it("rejects malformed hex", () => {
    expect(() => parseColor("#xyz")).toThrow();
    expect(() => parseColor("#fffff")).toThrow(); // 5 chars, not a valid form
  });
});

describe("parseColor — rgb()/rgba()", () => {
  it("parses rgb()", () => {
    expect(parseColor("rgb(10, 20, 30)")).toEqual({
      r: 10,
      g: 20,
      b: 30,
      a: 1,
    });
  });
  it("parses rgba() with alpha", () => {
    expect(parseColor("rgba(10, 20, 30, 0.5)")).toEqual({
      r: 10,
      g: 20,
      b: 30,
      a: 0.5,
    });
  });
  it("tolerates whitespace", () => {
    expect(parseColor("  rgba(  255 , 0 , 0 , 1 )  ")).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 1,
    });
  });
  it("rejects malformed", () => {
    expect(() => parseColor("rgba(1,2)")).toThrow();
    expect(() => parseColor("rgb(a,b,c)")).toThrow();
  });
});

describe("formatColor", () => {
  it("rounds channels and emits CSS rgba()", () => {
    expect(formatColor({ r: 10.4, g: 20.6, b: 30.5, a: 0.5 })).toBe(
      "rgba(10, 21, 31, 0.5)",
    );
  });
  it("clamps out-of-range channels", () => {
    expect(formatColor({ r: 300, g: -10, b: 0, a: 2 })).toBe(
      "rgba(255, 0, 0, 1)",
    );
  });
});

describe("lerpColor", () => {
  const a: RGBA = { r: 0, g: 0, b: 0, a: 0 };
  const b: RGBA = { r: 200, g: 100, b: 50, a: 1 };

  it("returns a at t=0", () => {
    expect(lerpColor(a, b, 0)).toEqual(a);
  });
  it("returns b at t=1", () => {
    expect(lerpColor(a, b, 1)).toEqual(b);
  });
  it("returns midpoint at t=0.5", () => {
    expect(lerpColor(a, b, 0.5)).toEqual({ r: 100, g: 50, b: 25, a: 0.5 });
  });
});

describe("lerpColorString", () => {
  it("interpolates black → white as gray", () => {
    expect(lerpColorString("#000000", "#ffffff", 0.5)).toBe(
      "rgba(128, 128, 128, 1)",
    );
  });
  it("interpolates red → blue as purple at midpoint", () => {
    expect(lerpColorString("#ff0000", "#0000ff", 0.5)).toBe(
      "rgba(128, 0, 128, 1)",
    );
  });
});

describe("lerpNumber", () => {
  it("returns endpoints exactly", () => {
    expect(lerpNumber(0, 10, 0)).toBe(0);
    expect(lerpNumber(0, 10, 1)).toBe(10);
  });
  it("interpolates linearly", () => {
    expect(lerpNumber(0, 10, 0.25)).toBe(2.5);
    expect(lerpNumber(-5, 5, 0.5)).toBe(0);
  });
});
