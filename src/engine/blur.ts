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
      const al = a[s + 3]!;
      // Below half a unit of alpha the pixel rounds to transparent; its
      // colour would only be float noise divided by ~0.
      if (al < 0.5) {
        data[t] = 0;
        data[t + 1] = 0;
        data[t + 2] = 0;
        data[t + 3] = 0;
        continue;
      }
      const k = 255 / al;
      data[t] = clamp8(a[s]! * k);
      data[t + 1] = clamp8(a[s + 1]! * k);
      data[t + 2] = clamp8(a[s + 2]! * k);
      data[t + 3] = clamp8(al);
    }
  }
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
