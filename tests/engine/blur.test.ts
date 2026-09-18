// In-engine Gaussian blur (v1.1 S21) — the kernel math, independent of any
// canvas. Parity with Chromium's own `blur()` is checked by the node↔browser
// parity test; skia pixels by tests/engine/effects.pixels.test.ts.

import { describe, expect, it } from "vitest";

import { blurPixels, blurReach, boxesForSigma } from "../../src/engine/blur.js";

function buffer(w: number, h: number) {
  return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
}

function paint(
  img: ReturnType<typeof buffer>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgba: [number, number, number, number],
) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) img.data.set(rgba, (y * img.width + x) * 4);
  }
}

const alphaAt = (img: ReturnType<typeof buffer>, x: number, y: number) =>
  img.data[(y * img.width + x) * 4 + 3]!;

describe("boxesForSigma", () => {
  it("is a no-op below one pixel of box width", () => {
    expect(boxesForSigma(0)).toEqual([]);
    expect(boxesForSigma(-3)).toEqual([]);
    expect(boxesForSigma(0.5)).toEqual([]);
  });

  it("uses three centred boxes for an odd width", () => {
    // σ = 2 → d = floor(2 · 1.88 + 0.5) = 4 (even); σ = 1.5 → d = 3 (odd).
    expect(boxesForSigma(1.5)).toEqual([
      [1, 1],
      [1, 1],
      [1, 1],
    ]);
  });

  it("offsets two boxes left then right, then one wider centred box, for an even width", () => {
    expect(boxesForSigma(2)).toEqual([
      [2, 1],
      [1, 2],
      [2, 2],
    ]);
  });

  it("reports how far coverage can spread", () => {
    expect(blurReach(2)).toBe(6);
    expect(blurReach(0)).toBe(0);
  });
});

describe("blurPixels", () => {
  it("conserves coverage and stays symmetric", () => {
    const img = buffer(60, 60);
    paint(img, 25, 25, 35, 35, [255, 255, 255, 255]);
    blurPixels(img, 3);
    let sum = 0;
    for (let i = 3; i < img.data.length; i += 4) sum += img.data[i]!;
    // 100 opaque pixels' worth of alpha, give or take 8-bit rounding.
    expect(sum / 255).toBeGreaterThan(97);
    expect(sum / 255).toBeLessThan(103);
    expect(alphaAt(img, 20, 30)).toBe(alphaAt(img, 39, 30));
    expect(alphaAt(img, 30, 20)).toBe(alphaAt(img, 30, 39));
    // Edge pixels sit near half coverage.
    expect(alphaAt(img, 25, 30)).toBeGreaterThan(100);
    expect(alphaAt(img, 25, 30)).toBeLessThan(160);
  });

  it("never bleeds the colour of transparent pixels into the edge", () => {
    const img = buffer(40, 20);
    // Transparent *green* around an opaque red block: premultiplied blurring
    // must ignore the green entirely.
    paint(img, 0, 0, 40, 20, [0, 255, 0, 0]);
    paint(img, 15, 5, 25, 15, [255, 0, 0, 255]);
    blurPixels(img, 2);
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3]! > 0) expect(img.data[i + 1]).toBe(0);
    }
  });

  it("leaves an empty buffer untouched and a tiny sigma a no-op", () => {
    const empty = buffer(10, 10);
    blurPixels(empty, 5);
    expect(empty.data.every((v) => v === 0)).toBe(true);

    const img = buffer(10, 10);
    paint(img, 3, 3, 6, 6, [10, 20, 30, 255]);
    const before = Uint8ClampedArray.from(img.data);
    blurPixels(img, 0.4);
    expect(img.data).toEqual(before);
  });

  it("clips at the buffer edge, treating the outside as transparent", () => {
    const img = buffer(20, 20);
    paint(img, 0, 0, 20, 20, [255, 255, 255, 255]);
    blurPixels(img, 2);
    // The corner loses coverage to the transparent outside; the centre keeps it.
    expect(alphaAt(img, 0, 0)).toBeLessThan(128);
    expect(alphaAt(img, 10, 10)).toBe(255);
  });
});
