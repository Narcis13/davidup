// In-engine Gaussian blur for the `blur` effect (v1.1 S21).
//
// Why not `ctx.filter = "blur(σpx)"`: measured during S21, skia-canvas applies
// a filter blur on `drawImage` at half the σ Chromium uses (its blur(8px)
// matches Chromium's blur(4px)), so a blurred item would render visibly
// differently in the editor than in the exported video. Shadows do agree
// between the two hosts, so shadow/glow stay on the Canvas2D shadow state;
// only blur runs here, on raw pixels, identically on both.
//
// The kernel is the Filter Effects spec's approximation of a Gaussian
// (feGaussianBlur): three successive box blurs of width
//   d = floor(σ · 3·√(2π) / 4 + 0.5)
// per axis — centred when d is odd; when d is even, two boxes of width d
// offset half a pixel left and then right, and a third of width d + 1
// centred, so the result stays centred. Browsers are permitted exactly this
// approximation, and it lands within the parity tolerance of Chromium's own.
//
// Blurring happens on premultiplied values (colour × alpha), or transparent
// pixels — whose RGB is arbitrary — would bleed their colour into the edge.

/** RGBA8 pixels, row-major, unpremultiplied — the ImageData layout. */
export interface PixelBuffer {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

/** A box window `[x − lo, x + hi]` around each output pixel. */
type Box = readonly [lo: number, hi: number];

/**
 * The three box windows approximating a Gaussian of standard deviation
 * `sigma`, or an empty list when the blur would be a no-op (d ≤ 1).
 */
export function boxesForSigma(sigma: number): Box[] {
  if (!(sigma > 0)) return [];
  const d = Math.floor((sigma * 3 * Math.sqrt(2 * Math.PI)) / 4 + 0.5);
  if (d <= 1) return [];
  if (d % 2 === 1) {
    const r = (d - 1) / 2;
    return [
      [r, r],
      [r, r],
      [r, r],
    ];
  }
  const h = d / 2;
  return [
    [h, h - 1],
    [h - 1, h],
    [h, h],
  ];
}

/** How far a blur of `sigma` can spread coverage past an edge, in pixels. */
export function blurReach(sigma: number): number {
  let reach = 0;
  for (const [lo, hi] of boxesForSigma(sigma)) reach += Math.max(lo, hi);
  return reach;
}

/**
 * σ at or above which the blur runs on a downscaled copy (v1.3 G8, P-1).
 *
 * The three box passes are O(pixels) whatever the box width, but a wide window
 * walks far ahead of the write position and falls out of cache — measured on
 * an M-series Mac, a 1080 × 1920 surface costs 133 ms at σ = 10 and 345 ms at
 * σ = 140. Blurring a k× smaller copy cuts that to the resample passes plus a
 * k² smaller kernel.
 *
 * A blur of standard deviation σ has no detail finer than σ, so sampling it
 * every k ≤ σ/10 pixels is a tenfold oversample and the difference is not
 * visible — but it *is* a difference, so the threshold is set above every
 * radius in the repo's examples and fixtures (the largest is 10) and every
 * golden frame is byte-identical across it. Content blurred at σ ≥ 20 does
 * move: measured against a full-resolution reference kernel, by up to three
 * units of 8-bit alpha (tests/engine/blur.test.ts).
 */
export const BLUR_DOWNSAMPLE_SIGMA = 20;

/**
 * Integer factor {@link blurPixels} downscales by at `sigma`: 1 (no
 * downscale) below the threshold, then σ/10 rounded down, capped at 4.
 *
 * The cap is where the win stops: past 4 the kernel is already a rounding
 * error next to the two full-resolution resample passes that bracket it, so a
 * larger factor buys nothing and only coarsens the grid.
 */
export function blurDownsampleFactor(sigma: number): number {
  if (!(sigma >= BLUR_DOWNSAMPLE_SIGMA)) return 1;
  return Math.min(4, Math.floor(sigma / 10));
}

/**
 * Blur `img` in place with a Gaussian of standard deviation `sigma` (px).
 *
 * Only the bounding box of non-transparent pixels, grown by the kernel's
 * reach, is processed — an item's scratch surface is composition-sized but
 * usually mostly empty. Pixels outside the buffer count as transparent.
 */
export function blurPixels(img: PixelBuffer, sigma: number): void {
  const boxes = boxesForSigma(sigma);
  if (boxes.length === 0) return;
  const { data, width, height } = img;

  // Bounding box of everything with coverage.
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return;
  const reach = blurReach(sigma);
  const x0 = Math.max(0, minX - reach);
  const y0 = Math.max(0, minY - reach);
  const x1 = Math.min(width - 1, maxX + reach);
  const y1 = Math.min(height - 1, maxY + reach);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;

  // Wide kernels run on a downscaled copy (v1.3 G8) — see
  // {@link blurDownsampleFactor}. The factor is derived from σ alone, so the
  // same content blurs the same way in node and in the browser.
  const factor = blurDownsampleFactor(sigma);
  const smallBoxes = factor > 1 ? boxesForSigma(sigma / factor) : [];
  if (factor > 1 && smallBoxes.length > 0) {
    blurRegionDownscaled(data, width, x0, y0, w, h, factor, smallBoxes);
    return;
  }

  // Premultiplied float copy of the region.
  let a = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((y + y0) * width + (x + x0)) * 4;
      const t = (y * w + x) * 4;
      const al = data[s + 3]! / 255;
      a[t] = data[s]! * al;
      a[t + 1] = data[s + 1]! * al;
      a[t + 2] = data[s + 2]! * al;
      a[t + 3] = data[s + 3]!;
    }
  }
  let b = new Float32Array(w * h * 4);

  for (const box of boxes) {
    for (let y = 0; y < h; y++) boxLine(a, b, y * w * 4, 4, w, box);
    [a, b] = [b, a];
  }
  for (const box of boxes) {
    for (let x = 0; x < w; x++) boxLine(a, b, x * 4, w * 4, h, box);
    [a, b] = [b, a];
  }

  // Unpremultiply back into the buffer.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const t = ((y + y0) * width + (x + x0)) * 4;
      writeUnpremultiplied(data, t, a[s]!, a[s + 1]!, a[s + 2]!, a[s + 3]!);
    }
  }
}

/**
 * The σ ≥ {@link BLUR_DOWNSAMPLE_SIGMA} path: box-average the region down by
 * `factor`, run the (correspondingly narrower) kernel there, and bilinearly
 * scale the result back over the region.
 *
 * Both resamples work on premultiplied values, for the same reason the
 * full-resolution path does — averaging a transparent pixel's arbitrary RGB
 * into its neighbours would tint the edge. The k × k average is also the right
 * prefilter for the downscale, so nothing aliases on the way down, and the
 * blurred field has no detail near the sampling grid on the way back up.
 *
 * `region` is already the bounding box of coverage grown by the *full*
 * kernel's reach, which is `factor` times the small kernel's — so the small
 * blur can never reach the edge of its own buffer before the content has
 * faded out, and partial blocks along the right/bottom edge average in the
 * transparency that is genuinely there.
 */
function blurRegionDownscaled(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  factor: number,
  boxes: Box[],
): void {
  const sw = Math.ceil(w / factor);
  const sh = Math.ceil(h / factor);
  let a = new Float32Array(sw * sh * 4);

  // Down: accumulate each factor × factor block, then scale by 1/factor².
  // Dividing by the full block area (not by how many source pixels the block
  // actually covered) is what makes a partial edge block read as transparent.
  const colOf = new Int32Array(w);
  for (let x = 0; x < w; x++) colOf[x] = Math.floor(x / factor) * 4;
  for (let y = 0; y < h; y++) {
    const srcRow = ((y + y0) * width + x0) * 4;
    const dstRow = Math.floor(y / factor) * sw * 4;
    for (let x = 0; x < w; x++) {
      const s = srcRow + x * 4;
      const alpha = data[s + 3]!;
      if (alpha === 0) continue;
      const al = alpha / 255;
      const t = dstRow + colOf[x]!;
      a[t] = a[t]! + data[s]! * al;
      a[t + 1] = a[t + 1]! + data[s + 1]! * al;
      a[t + 2] = a[t + 2]! + data[s + 2]! * al;
      a[t + 3] = a[t + 3]! + alpha;
    }
  }
  const inv = 1 / (factor * factor);
  for (let i = 0; i < a.length; i++) a[i]! *= inv;

  let b = new Float32Array(sw * sh * 4);
  for (const box of boxes) {
    for (let y = 0; y < sh; y++) boxLine(a, b, y * sw * 4, 4, sw, box);
    [a, b] = [b, a];
  }
  for (const box of boxes) {
    for (let x = 0; x < sw; x++) boxLine(a, b, x * 4, sw * 4, sh, box);
    [a, b] = [b, a];
  }

  // Up: pixel x of the region samples the small grid at (x + ½)/factor − ½,
  // i.e. block centres land exactly on their own samples.
  const ix0 = new Int32Array(w);
  const ix1 = new Int32Array(w);
  const fx = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const sx = (x + 0.5) / factor - 0.5;
    const i = Math.floor(sx);
    const lo = i < 0 ? 0 : i >= sw - 1 ? sw - 1 : i;
    ix0[x] = lo * 4;
    ix1[x] = (lo + 1 < sw ? lo + 1 : sw - 1) * 4;
    fx[x] = i < 0 || i >= sw - 1 ? 0 : sx - i;
  }
  for (let y = 0; y < h; y++) {
    const sy = (y + 0.5) / factor - 0.5;
    const j = Math.floor(sy);
    const lo = j < 0 ? 0 : j >= sh - 1 ? sh - 1 : j;
    const fy = j < 0 || j >= sh - 1 ? 0 : sy - j;
    const rowTop = lo * sw * 4;
    const rowBot = (lo + 1 < sh ? lo + 1 : sh - 1) * sw * 4;
    const dstRow = ((y + y0) * width + x0) * 4;
    for (let x = 0; x < w; x++) {
      const gx = fx[x]!;
      const l = ix0[x]!;
      const r = ix1[x]!;
      const tl = rowTop + l;
      const tr = rowTop + r;
      const bl = rowBot + l;
      const br = rowBot + r;
      const t = dstRow + x * 4;
      writeUnpremultiplied(
        data,
        t,
        bilinear(a, tl, tr, bl, br, 0, gx, fy),
        bilinear(a, tl, tr, bl, br, 1, gx, fy),
        bilinear(a, tl, tr, bl, br, 2, gx, fy),
        bilinear(a, tl, tr, bl, br, 3, gx, fy),
      );
    }
  }
}

function bilinear(
  a: Float32Array,
  tl: number,
  tr: number,
  bl: number,
  br: number,
  c: number,
  fx: number,
  fy: number,
): number {
  const top = a[tl + c]! + (a[tr + c]! - a[tl + c]!) * fx;
  const bot = a[bl + c]! + (a[br + c]! - a[bl + c]!) * fx;
  return top + (bot - top) * fy;
}

// One premultiplied RGBA sample, written back unpremultiplied at `t`.
function writeUnpremultiplied(
  data: Uint8ClampedArray | Uint8Array,
  t: number,
  r: number,
  g: number,
  b: number,
  al: number,
): void {
  // Below half a unit of alpha the pixel rounds to transparent; its colour
  // would only be float noise divided by ~0.
  if (al < 0.5) {
    data[t] = 0;
    data[t + 1] = 0;
    data[t + 2] = 0;
    data[t + 3] = 0;
    return;
  }
  const k = 255 / al;
  data[t] = clamp8(r * k);
  data[t + 1] = clamp8(g * k);
  data[t + 2] = clamp8(b * k);
  data[t + 3] = clamp8(al);
}

// One box pass along a line of `n` RGBA pixels starting at `start`, `step`
// floats apart, from `src` into `dst`. A running sum keeps it O(n) whatever
// the box width; samples past either end are zero.
function boxLine(
  src: Float32Array,
  dst: Float32Array,
  start: number,
  step: number,
  n: number,
  [lo, hi]: Box,
): void {
  const inv = 1 / (lo + hi + 1);
  for (let c = 0; c < 4; c++) {
    let sum = 0;
    // Prime the window for output 0: samples [−lo, hi].
    for (let i = 0; i <= hi && i < n; i++) sum += src[start + i * step + c]!;
    for (let i = 0; i < n; i++) {
      dst[start + i * step + c] = sum * inv;
      const enter = i + hi + 1;
      const leave = i - lo;
      if (enter < n) sum += src[start + enter * step + c]!;
      if (leave >= 0) sum -= src[start + leave * step + c]!;
    }
  }
}

function clamp8(v: number): number {
  return v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
}
