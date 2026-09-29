// What some bytes are, without decoding them (asset-library plan §2): the payload's type by its magic, a
// raster's size and alpha from its header, and the palette, light and room of pixels a host decoded.
//
//   sniff(bytes, 'audio')        'wav' | 'mp3' | 'm4a' | ... | null (the kind picks between a container's names)
//   imageInfo(bytes)             { type, w, h, alpha } from a PNG, JPEG, WebP or GIF header, or null
//   colours({ data, width, height }, { sil })   the top 8 swatches, as `hdf photo` writes them
//   lightFacts({ data, width, height })         { dark, room }: dark on the whole, and how busy each third is (D6)
//
// Zero dependencies: nothing here decodes pixels. A host that can (skia in both apps) hands them to colours().

const ascii = (b, at, n) => String.fromCharCode(...b.subarray(at, at + n));
const u16be = (b, at) => (b[at] << 8) | b[at + 1];
const u32be = (b, at) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const u16le = (b, at) => b[at] | (b[at + 1] << 8);
const u24le = (b, at) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
const bytesOf = (bytes) => (bytes instanceof Uint8Array ? bytes : typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes));

// The image type of some bytes by their magic (hdf's imageType, plus gif and svg), or null.
export function imageType(bytes) {
  const b = bytesOf(bytes);
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (b.length > 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (ascii(b, 0, 4) === 'GIF8') return 'gif';
  const head = new TextDecoder().decode(b.subarray(0, 1024)).replace(/^﻿/, '').trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  return null;
}

// The payload's extension by its magic, or null. `kind` settles the names one container goes by: an ISO
// media file is m4a for audio kinds and mp4 (mov when branded qt) otherwise; Matroska is webm or mkv by doctype.
export function sniff(bytes, kind) {
  const b = bytesOf(bytes);
  const img = imageType(b);
  if (img) return img;
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return 'wav';
  if (ascii(b, 0, 4) === 'OggS') return 'ogg';
  if (ascii(b, 0, 4) === 'fLaC') return 'flac';
  if (ascii(b, 4, 4) === 'ftyp') {
    if (kind === 'audio' || kind === 'sample') return 'm4a';
    return ascii(b, 8, 4) === 'qt  ' ? 'mov' : 'mp4';
  }
  if (b.length > 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return ascii(b, 0, 64).includes('webm') ? 'webm' : 'mkv';
  if (ascii(b, 0, 3) === 'ID3') return 'mp3';
  if (b.length > 2 && b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return 'aac';        // ADTS
  if (b.length > 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'mp3';        // an MPEG audio frame
  const tag = ascii(b, 0, 4);
  if (tag === 'wOFF') return 'woff';
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'OTTO') return 'otf';
  if (tag === 'true' || (b.length > 4 && b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0)) return 'ttf';
  return null;
}

// Extensions that name the same container, so a caller's ext is kept when the bytes agree with it.
const FAMILY = { mp4: 'iso', mov: 'iso', m4a: 'iso', webm: 'mkv', mkv: 'mkv', jpg: 'jpg', jpeg: 'jpg' };
export const sameContainer = (a, b) => a === b || (!!FAMILY[a] && FAMILY[a] === FAMILY[b]);

// A raster's type, size and whether it has an alpha channel, from its header alone; null when the bytes are
// not a PNG, JPEG, WebP or GIF, or the header is cut short. `alpha` says the format can carry alpha here (a
// PNG with an alpha channel or tRNS, a WebP flagged so), not that a pixel uses it.
export function imageInfo(bytes) {
  const b = bytesOf(bytes), type = imageType(b);
  try {
    if (type === 'png') {
      if (ascii(b, 12, 4) !== 'IHDR') return null;
      const ct = b[25];
      let alpha = ct === 4 || ct === 6;
      for (let at = 8; !alpha && at + 8 <= b.length;) {
        const len = u32be(b, at), name = ascii(b, at + 4, 4);
        if (name === 'tRNS') alpha = true;
        if (name === 'IDAT' || name === 'IEND') break;
        at += 12 + len;
      }
      return { type, w: u32be(b, 16), h: u32be(b, 20), alpha };
    }
    if (type === 'jpg') {
      for (let at = 2; at + 9 < b.length;) {
        if (b[at] !== 0xff) return null;
        const m = b[at + 1];
        if (m === 0xff) { at++; continue; }
        if (m === 0x01 || (m >= 0xd0 && m <= 0xd9)) { at += 2; continue; }
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { type, w: u16be(b, at + 7), h: u16be(b, at + 5), alpha: false };
        at += 2 + u16be(b, at + 2);
      }
      return null;
    }
    if (type === 'webp') {
      const chunk = ascii(b, 12, 4);
      if (chunk === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) return { type, w: u16le(b, 26) & 0x3fff, h: u16le(b, 28) & 0x3fff, alpha: false };
      if (chunk === 'VP8L' && b[20] === 0x2f) {
        const [b0, b1, b2, b3] = b.subarray(21, 25);
        return { type, w: 1 + (b0 | ((b1 & 0x3f) << 8)), h: 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)), alpha: ((b3 >> 4) & 1) === 1 };
      }
      if (chunk === 'VP8X') return { type, w: 1 + u24le(b, 24), h: 1 + u24le(b, 27), alpha: (b[20] & 0x10) !== 0 };
      return null;
    }
    if (type === 'gif') return b.length >= 10 ? { type, w: u16le(b, 6), h: u16le(b, 8), alpha: false } : null;
  } catch { /* a header cut short */ }
  return null;
}

// ---------- the palette ----------

// The palette of some RGBA pixels (moved from hdf's cli/photo.mjs, plan S1): opaque pixels posterised to 5
// bits per channel, bins within MERGE of a kept colour folded into it, the biggest 8 by area. `area` is the
// share of the opaque pixels, so a few large flat colours come first -- the order derive({ from }) hands to
// `fills`. `data` is RGBA, 4 bytes a pixel, already clipped to whatever should count.
const MERGE = 40, KEEP = 8, MAX_BINS = 64;
const hex = (rgb) => '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
export function quantise(data) {
  const d = data, n = Math.floor(d.length / 4), bins = new Map();
  let tot = 0;
  for (let p = 0; p < n; p++) {
    if (d[p * 4 + 3] < 200) continue;
    const r = d[p * 4], gg = d[p * 4 + 1], b = d[p * 4 + 2], k = ((r >> 3) << 10) | ((gg >> 3) << 5) | (b >> 3);
    let e = bins.get(k);
    if (!e) bins.set(k, e = [0, 0, 0, 0]);
    e[0] += r; e[1] += gg; e[2] += b; e[3]++; tot++;
  }
  if (!tot) return [];
  const kept = [];
  for (const [, e] of [...bins].sort((a, b) => b[1][3] - a[1][3] || a[0] - b[0])) {
    const r = e[0] / e[3], gg = e[1] / e[3], b = e[2] / e[3];
    let near = null, best = MERGE;
    for (const c of kept) {
      const dd = Math.hypot(c[0] / c[3] - r, c[1] / c[3] - gg, c[2] / c[3] - b);
      if (dd < best) { best = dd; near = c; }
    }
    if (near) for (let i = 0; i < 4; i++) near[i] += e[i];
    else if (kept.length < MAX_BINS) kept.push([...e]);
  }
  return kept.sort((a, b) => b[3] - a[3]).slice(0, KEEP)
    .map((c) => ({ hex: hex([c[0] / c[3], c[1] / c[3], c[2] / c[3]]), area: +(c[3] / tot).toFixed(4) }));
}

// The palette of a decoded image. With `sil` (a cutout's traced silhouette, in its own pixels) only the
// pixels whose centres it encloses count, holes included (even-odd): hdf clips with skia's anti-aliased
// path instead, so an edge pixel may land differently, never a swatch that matters.
export function colours({ data, width, height }, { sil } = {}) {
  if (!sil?.sub?.length) return quantise(data);
  const inside = new Uint8Array(width * height), edges = [];
  for (const { pts } of sil.sub) {
    for (let i = 0; i < pts.length; i += 2) {
      const j = (i + 2) % pts.length;
      edges.push([pts[i], pts[i + 1], pts[j], pts[j + 1]]);
    }
  }
  for (let y = 0; y < height; y++) {
    const cy = y + 0.5, xs = [];
    for (const [x0, y0, x1, y1] of edges) if ((y0 <= cy) !== (y1 <= cy)) xs.push(x0 + ((cy - y0) / (y1 - y0)) * (x1 - x0));
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x < width && x + 0.5 <= xs[k + 1]; x++) inside[y * width + x] = 1;
    }
  }
  const kept = new Uint8ClampedArray(data.length);
  for (let p = 0; p < width * height; p++) if (inside[p]) for (let c = 0; c < 4; c++) kept[p * 4 + c] = data[p * 4 + c];
  return quantise(kept);
}

// Whether any pixel is less than opaque.
export function usesAlpha({ data }) {
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

// ---------- light and room (plan D6) ----------

// `dark`: the mean luma (Rec. 709 weights over the sRGB values, 0..1) of the pixels, each counted by its
// alpha, is under DARK_LUMA. `room`: how busy each third of the frame is, as the share of its pixels on an
// edge, in the cells ROOM_CELLS name (tl t tr / l c r / bl b br); under ROOM a cell is quiet enough to letter
// on. Edges are found on the frame averaged down to ROOM_SIZE on its longer side (paper grain and video noise
// average out, a drawn line does not), by a Sobel step over EDGE on the luma premultiplied by alpha or on the
// alpha itself, so a cutout's outline is an edge and the transparent field around it is room.
export const DARK_LUMA = 0.4;
export const ROOM = 0.2;
export const ROOM_CELLS = Object.freeze(['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br']);
export const ROOM_SIZE = 128;
const EDGE = 0.1;
const luma = (d, i) => (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;

// The pixels' mean luma counted by alpha, or null when every pixel is transparent.
export function meanLuma({ data }) {
  let sum = 0, weight = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (!a) continue;
    sum += luma(data, i) * a;
    weight += a;
  }
  return weight > 0 ? sum / weight : null;
}

// The 3×3 grid of edge density, { tl, t, tr, l, c, r, bl, b, br }, each 0..1 to 2 places.
export function roomOf({ data, width, height }) {
  // Box-average down to at most ROOM_SIZE on the longer side: premultiplied luma and alpha, per cell.
  const scale = Math.max(1, Math.max(width, height) / ROOM_SIZE);
  const w = Math.max(1, Math.round(width / scale)), h = Math.max(1, Math.round(height / scale));
  const lum = new Float64Array(w * h), alp = new Float64Array(w * h), n = new Float64Array(w * h);
  for (let y = 0; y < height; y++) {
    const row = Math.min(h - 1, Math.floor((y * h) / height)) * w;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, k = row + Math.min(w - 1, Math.floor((x * w) / width)), a = data[i + 3] / 255;
      lum[k] += luma(data, i) * a; alp[k] += a; n[k]++;
    }
  }
  for (let k = 0; k < w * h; k++) if (n[k]) { lum[k] /= n[k]; alp[k] /= n[k]; }
  // A Sobel step, clamped at the borders; a unit step reads 4, so it is divided by 4.
  const at = (g, x, y) => g[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  const step = (g, x, y) => {
    const gx = at(g, x + 1, y - 1) + 2 * at(g, x + 1, y) + at(g, x + 1, y + 1) - at(g, x - 1, y - 1) - 2 * at(g, x - 1, y) - at(g, x - 1, y + 1);
    const gy = at(g, x - 1, y + 1) + 2 * at(g, x, y + 1) + at(g, x + 1, y + 1) - at(g, x - 1, y - 1) - 2 * at(g, x, y - 1) - at(g, x + 1, y - 1);
    return Math.hypot(gx, gy) / 4;
  };
  const edges = new Array(9).fill(0), count = new Array(9).fill(0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cell = Math.min(2, Math.floor((3 * y) / h)) * 3 + Math.min(2, Math.floor((3 * x) / w));
      count[cell]++;
      if (step(lum, x, y) > EDGE || step(alp, x, y) > EDGE) edges[cell]++;
    }
  }
  return Object.fromEntries(ROOM_CELLS.map((c, i) => [c, count[i] ? +(edges[i] / count[i]).toFixed(2) : 0]));
}

// The light facts of some pixels: { dark, room }; `dark` is left out when every pixel is transparent.
export function lightFacts(px) {
  const l = meanLuma(px);
  return { ...(l === null ? {} : { dark: l < DARK_LUMA }), room: roomOf(px) };
}
