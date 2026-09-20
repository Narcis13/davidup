// In-engine Gaussian blur (v1.1 S21) — the kernel math, independent of any
// canvas. Parity with Chromium's own `blur()` is checked by the node↔browser
// parity test; skia pixels by tests/engine/effects.pixels.test.ts.

import { describe, expect, it } from "vitest";

import {
  BLUR_DOWNSAMPLE_SIGMA,
  blurDownsampleFactor,
  blurPixels,
  blurReach,
  boxesForSigma,
} from "../../src/engine/blur.js";

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

describe("blurDownsampleFactor (v1.3 G8)", () => {
  it("leaves everything below the threshold at full resolution", () => {
    for (const sigma of [0, 1, 6, 10, 19.9]) expect(blurDownsampleFactor(sigma)).toBe(1);
    // Every blur radius in the repo's examples, fixtures and goldens is at or
    // below 10 — which is why crossing this threshold moves no golden hash.
    expect(BLUR_DOWNSAMPLE_SIGMA).toBeGreaterThan(10);
  });

  it("scales with sigma from the threshold up, capped at 4", () => {
    expect(blurDownsampleFactor(BLUR_DOWNSAMPLE_SIGMA)).toBe(2);
    expect(blurDownsampleFactor(26)).toBe(2);
    expect(blurDownsampleFactor(40)).toBe(4);
    expect(blurDownsampleFactor(140)).toBe(4);
    expect(blurDownsampleFactor(10_000)).toBe(4);
  });
});

/**
 * The same three-box kernel written the obvious way — premultiply, six box
 * passes over the whole buffer, unpremultiply — with no downscale anywhere.
 * Slow and plainly correct, which is the point: it is what the downscaled
 * path is held against.
 */
function referenceBlur(img: ReturnType<typeof buffer>, sigma: number) {
  const boxes = boxesForSigma(sigma);
  const { width: w, height: h } = img;
  let a = new Float64Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const al = img.data[i * 4 + 3]! / 255;
    a[i * 4] = img.data[i * 4]! * al;
    a[i * 4 + 1] = img.data[i * 4 + 1]! * al;
    a[i * 4 + 2] = img.data[i * 4 + 2]! * al;
    a[i * 4 + 3] = img.data[i * 4 + 3]!;
  }
  const pass = (step: number, n: number, lines: number, lineStep: number) => {
    for (const [lo, hi] of boxes) {
      const b = new Float64Array(a.length);
      for (let l = 0; l < lines; l++) {
        const start = l * lineStep;
        for (let i = 0; i < n; i++) {
          for (let c = 0; c < 4; c++) {
            let sum = 0;
            for (let k = i - lo; k <= i + hi; k++) {
              if (k >= 0 && k < n) sum += a[start + k * step + c]!;
            }
            b[start + i * step + c] = sum / (lo + hi + 1);
          }
        }
      }
      a = b;
    }
  };
  pass(4, w, h, w * 4);
  pass(w * 4, h, w, 4);
  for (let i = 0; i < w * h; i++) {
    const al = a[i * 4 + 3]!;
    if (al < 0.5) {
      img.data.set([0, 0, 0, 0], i * 4);
      continue;
    }
    const k = 255 / al;
    img.data[i * 4] = Math.round(Math.min(255, a[i * 4]! * k));
    img.data[i * 4 + 1] = Math.round(Math.min(255, a[i * 4 + 1]! * k));
    img.data[i * 4 + 2] = Math.round(Math.min(255, a[i * 4 + 2]! * k));
    img.data[i * 4 + 3] = Math.round(Math.min(255, al));
  }
}

describe("blurPixels — downscaled path (v1.3 G8)", () => {
  it("tracks the full-resolution kernel to within a couple of 8-bit units", () => {
    const shape = (img: ReturnType<typeof buffer>) => {
      paint(img, 30, 30, 130, 90, [220, 40, 90, 255]);
      paint(img, 100, 70, 150, 140, [40, 200, 255, 255]);
    };
    for (const sigma of [20, 45]) {
      const fast = buffer(180, 180);
      shape(fast);
      blurPixels(fast, sigma);

      const slow = buffer(180, 180);
      shape(slow);
      referenceBlur(slow, sigma);

      expect(blurDownsampleFactor(sigma)).toBeGreaterThan(1);
      let worstAlpha = 0;
      let worstColor = 0;
      for (let i = 0; i < fast.data.length; i += 4) {
        worstAlpha = Math.max(worstAlpha, Math.abs(fast.data[i + 3]! - slow.data[i + 3]!));
        // Colour only means something where there is coverage to see it.
        if (slow.data[i + 3]! > 8 && fast.data[i + 3]! > 8) {
          for (let c = 0; c < 3; c++) {
            worstColor = Math.max(worstColor, Math.abs(fast.data[i + c]! - slow.data[i + c]!));
          }
        }
      }
      expect(worstAlpha, `sigma ${sigma} alpha`).toBeLessThanOrEqual(3);
      expect(worstColor, `sigma ${sigma} colour`).toBeLessThanOrEqual(3);
    }
  });

  it("still conserves coverage and stays symmetric", () => {
    // A block much wider than the kernel, so its edge is a genuine step and
    // the mid-edge sample means "half coverage" rather than "narrow blob".
    const img = buffer(500, 500);
    paint(img, 100, 100, 400, 400, [255, 255, 255, 255]);
    blurPixels(img, 24);
    let sum = 0;
    for (let i = 3; i < img.data.length; i += 4) sum += img.data[i]!;
    // 90 000 opaque pixels' worth of alpha, give or take 8-bit rounding.
    expect(sum / 255).toBeGreaterThan(89_500);
    expect(sum / 255).toBeLessThan(90_500);
    expect(alphaAt(img, 60, 250)).toBe(alphaAt(img, 439, 250));
    expect(alphaAt(img, 250, 60)).toBe(alphaAt(img, 250, 439));
    // The edge of the original block still sits near half coverage.
    expect(alphaAt(img, 100, 250)).toBeGreaterThan(100);
    expect(alphaAt(img, 100, 250)).toBeLessThan(160);
    expect(alphaAt(img, 250, 250)).toBe(255);
  });

  it("never bleeds a transparent pixel's colour, downscaled either", () => {
    const img = buffer(200, 120);
    paint(img, 0, 0, 200, 120, [0, 255, 0, 0]);
    paint(img, 70, 30, 130, 90, [255, 0, 0, 255]);
    blurPixels(img, 30);
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3]! > 0) expect(img.data[i + 1]).toBeLessThanOrEqual(1);
    }
  });

  it("leaves an empty buffer empty at a downscaling sigma", () => {
    const empty = buffer(64, 64);
    blurPixels(empty, 40);
    expect(empty.data.every((v) => v === 0)).toBe(true);
  });
});
