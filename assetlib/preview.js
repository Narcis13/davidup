// Previews (asset-library plan §2, §5 A4): every record can be looked at.
//
// Previews are a contract, not a renderer. A shelf keeps one thumb per blob, `thumbs/<sha>.png`, and the
// thumb says in a PNG text chunk who drew it:
//
//   assetlib: "preview 1 card:3f09c2a1d4"     the fallback card, for a record whose lettering hashes so
//   assetlib: "preview 1 hdf@2"               a host's previewer named hdf, version 2
//
// A host registers `previewers[kind]` (a function, or { name, version, render }) that turns a blob into PNG
// bytes PREVIEW_WIDTH wide; anything with no previewer gets the card, drawn here with no dependency: a field
// in the record's first colour, the kind and id lettered in a built-in 5x7 bitmap font, its size or length,
// its licence, and its palette as a strip. `sheet` tiles previews into one contact sheet with id captions.
//
//   card(record)                          PNG bytes, CARD_W x CARD_H, tagged
//   tagOf(png)                            { v, by } from a thumb, or null
//   fresh(tag, record, previewer)         whether a cached thumb still answers for the record
//   contactSheet([{ id, pixels }], opts)  { png, width, height, cols, rows, cells }
//   encodePng / decodePng / withText      the little PNG this needs (node:zlib, nothing else)
//
// The library (index.js) owns the paths and the cache: lib.preview(ref) and lib.sheet(refs).
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { mediaOf } from './record.js';
import { DARK, fold, lightness } from './search.js';

// Bump when the card or the cache rule changes: every thumb drawn under another version is redrawn.
export const PREVIEW_VERSION = 1;
// What a previewer is asked for, and the card's size.
export const PREVIEW_WIDTH = 480;
export const CARD_W = 480, CARD_H = 320;
// The PNG text chunk keyword a thumb's tag lives under.
export const TAG_KEY = 'assetlib';

// ---------- PNG ----------

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(name, data) {
  const body = Buffer.concat([Buffer.from(name, 'latin1'), data]), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const textChunk = (key, value) => chunk('tEXt', Buffer.from(`${key}\0${value}`, 'latin1'));

// The chunks of a PNG, [{ name, data, at, end }], or an error saying what is wrong with it.
function chunks(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (b.length < 8 || !b.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG (bad signature)');
  const out = [];
  for (let at = 8; at + 8 <= b.length;) {
    const len = b.readUInt32BE(at), name = b.toString('latin1', at + 4, at + 8), end = at + 12 + len;
    if (end > b.length) throw new Error(`PNG cut short in its ${name} chunk`);
    out.push({ name, data: b.subarray(at + 8, at + 8 + len), at, end });
    at = end;
    if (name === 'IEND') break;
  }
  return out;
}

const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

// RGBA pixels as a PNG (8 bits a channel, each row filtered the way that sums smallest), with `text` as tEXt
// chunks ({ keyword: value }, latin1).
export function encodePng({ data, width, height }, { text = {} } = {}) {
  const stride = width * 4, raw = Buffer.alloc(height * (stride + 1)), cand = Array.from({ length: 5 }, () => Buffer.alloc(stride));
  const px = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  for (let y = 0; y < height; y++) {
    const row = px.subarray(y * stride, (y + 1) * stride), up = y ? px.subarray((y - 1) * stride, y * stride) : null;
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = cand[f];
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? row[i - 4] : 0, b = up ? up[i] : 0, c = up && i >= 4 ? up[i - 4] : 0;
        const v = (row[i] - (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c))) & 0xff;
        out[i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    raw[y * (stride + 1)] = best;
    cand[best].copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    SIGNATURE, chunk('IHDR', ihdr),
    ...Object.entries(text).map(([k, v]) => textChunk(k, v)),
    chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// A PNG's pixels as 8-bit RGBA: every colour type, bit depths 1 to 16, not interlaced (no previewer this
// library knows of writes Adam7; one that does gets a clear error, and the sheet shows its card instead).
export function decodePng(bytes) {
  const cs = chunks(bytes), head = cs.find((c) => c.name === 'IHDR')?.data;
  if (!head) throw new Error('PNG has no IHDR');
  const width = head.readUInt32BE(0), height = head.readUInt32BE(4), depth = head[8], type = head[9];
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels || ![1, 2, 4, 8, 16].includes(depth)) throw new Error(`PNG colour type ${type} at ${depth} bits is not one PNG allows`);
  if (head[12]) throw new Error('interlaced PNG (Adam7) is not read here');
  const plte = cs.find((c) => c.name === 'PLTE')?.data, trns = cs.find((c) => c.name === 'tRNS')?.data;
  if (type === 3 && !plte) throw new Error('palette PNG has no PLTE');
  const bits = channels * depth, bpp = Math.max(1, bits >> 3), stride = Math.ceil((width * bits) / 8);
  const raw = inflateSync(Buffer.concat(cs.filter((c) => c.name === 'IDAT').map((c) => c.data)));
  if (raw.length < height * (stride + 1)) throw new Error('PNG image data is cut short');
  const rows = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), at = y * stride;
    if (f > 4) throw new Error(`PNG row ${y} has filter ${f}`);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? rows[at + i - bpp] : 0, b = y ? rows[at - stride + i] : 0, c = y && i >= bpp ? rows[at - stride + i - bpp] : 0;
      rows[at + i] = (src[i] + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c))) & 0xff;
    }
  }
  // One sample (0..255) at sample index s of row y.
  const max = (1 << depth) - 1;
  const sample = (y, s) => {
    const at = y * stride;
    if (depth === 8) return rows[at + s];
    if (depth === 16) return rows[at + s * 2];
    const bit = s * depth, v = (rows[at + (bit >> 3)] >> (8 - depth - (bit & 7))) & max;
    return type === 3 ? v : Math.round((v * 255) / max);
  };
  const key = (y, s) => (depth === 16 ? rows.readUInt16BE(y * stride + s * 2) : depth === 8 ? rows[y * stride + s] : (rows[y * stride + ((s * depth) >> 3)] >> (8 - depth - ((s * depth) & 7))) & max);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, s = x * channels;
      if (type === 3) {
        const i = sample(y, s);
        data[o] = plte[i * 3]; data[o + 1] = plte[i * 3 + 1]; data[o + 2] = plte[i * 3 + 2];
        data[o + 3] = trns && i < trns.length ? trns[i] : 255;
      } else if (type === 0 || type === 4) {
        const g = sample(y, s);
        data[o] = data[o + 1] = data[o + 2] = g;
        data[o + 3] = type === 4 ? sample(y, s + 1) : trns && key(y, s) === trns.readUInt16BE(0) ? 0 : 255;
      } else {
        data[o] = sample(y, s); data[o + 1] = sample(y, s + 1); data[o + 2] = sample(y, s + 2);
        data[o + 3] = type === 6 ? sample(y, s + 3)
          : trns && [0, 1, 2].every((k) => key(y, s + k) === trns.readUInt16BE(k * 2)) ? 0 : 255;
      }
    }
  }
  return { data, width, height };
}

// The tEXt chunks of a PNG as { keyword: value }.
export function pngText(bytes) {
  const out = {};
  for (const c of chunks(bytes)) {
    if (c.name !== 'tEXt') continue;
    const z = c.data.indexOf(0);
    if (z > 0) out[c.data.toString('latin1', 0, z)] = c.data.toString('latin1', z + 1);
  }
  return out;
}

// The same PNG with `text` as tEXt chunks right after IHDR, replacing any with the same keyword. The pixels'
// bytes are untouched, so a host's preview is stored as it drew it.
export function withText(bytes, text) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), cs = chunks(b), keys = new Set(Object.keys(text));
  const parts = [SIGNATURE];
  for (const c of cs) {
    if (c.name === 'tEXt' && keys.has(c.data.toString('latin1', 0, Math.max(0, c.data.indexOf(0))))) continue;
    parts.push(b.subarray(c.at, c.end));
    if (c.name === 'IHDR') for (const [k, v] of Object.entries(text)) parts.push(textChunk(k, v));
  }
  return Buffer.concat(parts);
}

// ---------- the cache tag ----------

// The tag a thumb carries, parsed: { v, by }, or null when it has none (or is not a PNG).
export function tagOf(bytes) {
  let t;
  try { t = pngText(bytes)[TAG_KEY]; } catch { return null; }
  const m = /^preview (\d+) (\S+)$/.exec(t ?? '');
  return m ? { v: Number(m[1]), by: m[2] } : null;
}
const tagText = (by) => `preview ${PREVIEW_VERSION} ${by}`;

// A host's previewer, normalised: a function is { name: 'host', render }; `by` is what its thumbs are tagged.
export function previewer(p) {
  if (!p) return null;
  const { name = 'host', version, render } = typeof p === 'function' ? { render: p } : p;
  if (typeof render !== 'function') throw new Error('a previewer is a function (file, record, { width }) -> PNG bytes, or { name, version, render }');
  if (!/^[\w.-]+$/.test(name) || (version !== undefined && !/^[\w.-]+$/.test(String(version)))) throw new Error(`previewer name '${name}' / version '${version}': letters, digits, dots, dashes`);
  return { name, version, render, by: version === undefined ? name : `${name}@${version}` };
}

// Whether a cached thumb (its tag) still answers for a record, given the previewer the host has for its kind:
//   - drawn under another PREVIEW_VERSION, or untagged: no;
//   - a card: only while no previewer is registered and the record still letters the same;
//   - a host's picture: yes, unless it is this previewer's own at another version. Another host's picture is
//     kept (davidup and hdf share shelves; they would otherwise redraw each other's thumbs forever).
export function fresh(tag, record, p) {
  if (!tag || tag.v !== PREVIEW_VERSION) return false;
  if (tag.by.startsWith('card:')) return !p && tag.by === cardKey(record);
  if (!p) return true;
  const [name] = tag.by.split('@');
  return name !== p.name || tag.by === p.by;
}

// ---------- drawing ----------

// A 5x7 bitmap font: each glyph is 7 rows of 5 bits, the high bit the left column. Upper case, digits and
// what records say (ids, sizes, licences); anything else draws as '?'.
const GLYPHS = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14],
  D: [28, 18, 17, 17, 17, 18, 28], E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4], U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 17, 10, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31],
  3: [31, 2, 4, 2, 1, 17, 14], 4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14],
  6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8], 8: [14, 17, 17, 14, 17, 17, 14],
  9: [14, 17, 17, 15, 1, 2, 12],
  ' ': [0, 0, 0, 0, 0, 0, 0], '-': [0, 0, 0, 31, 0, 0, 0], '.': [0, 0, 0, 0, 0, 12, 12],
  ':': [0, 12, 12, 0, 12, 12, 0], '/': [0, 1, 2, 4, 8, 16, 0], '@': [14, 17, 23, 21, 23, 16, 15],
  '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8], ',': [0, 0, 0, 0, 12, 4, 8],
  '_': [0, 0, 0, 0, 0, 0, 31], "'": [12, 4, 8, 0, 0, 0, 0], '#': [10, 10, 31, 10, 31, 10, 10],
  '%': [24, 25, 2, 4, 8, 19, 3], '+': [0, 4, 4, 31, 4, 4, 0], '?': [14, 17, 1, 2, 4, 0, 4],
  '!': [4, 4, 4, 4, 4, 0, 4], '&': [12, 18, 20, 8, 21, 18, 13], '×': [0, 17, 10, 4, 10, 17, 0],
  '·': [0, 0, 0, 4, 0, 0, 0],
};
export const GLYPH_W = 5, GLYPH_H = 7;
// Letters as the font draws them: folded, upper case, anything it has no glyph for as '?'.
export const lettering = (s) => [...fold(s).toUpperCase()].map((c) => (GLYPHS[c] ? c : '?')).join('');
// The width in pixels of a line of lettering at `scale` (a pixel of gap between letters).
export const textWidth = (s, scale = 1) => Math.max(0, [...s].length * (GLYPH_W + 1) - 1) * scale;

const rgbOf = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null;
};

// An RGBA canvas and the three things the card and the sheet draw on it.
function canvas(width, height, rgb) {
  const data = new Uint8ClampedArray(width * height * 4);
  const img = { data, width, height };
  rect(img, 0, 0, width, height, rgb);
  return img;
}
function rect(img, x, y, w, h, [r, g, b]) {
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(img.width, Math.round(x + w)), y1 = Math.min(img.height, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const o = (yy * img.width + xx) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  }
}
// Letters `s` (already lettering) with its top left at x, y.
function text(img, s, x, y, scale, rgb) {
  let at = x;
  for (const c of s) {
    const g = GLYPHS[c] ?? GLYPHS['?'];
    for (let row = 0; row < GLYPH_H; row++) {
      for (let col = 0; col < GLYPH_W; col++) if (g[row] & (1 << (GLYPH_W - 1 - col))) rect(img, at + col * scale, y + row * scale, scale, scale, rgb);
    }
    at += (GLYPH_W + 1) * scale;
  }
}
// `s` cut to `chars` letters, the last two dots when it did not fit.
const clip = (s, chars) => ([...s].length <= chars ? s : [...s].slice(0, Math.max(0, chars - 2)).join('') + '..');

// `s` (lettering) in lines of at most `chars`: broken after a dash or colon where it can be, else mid-word.
function wrap(s, chars) {
  const parts = s.match(/[^-:]+[-:]?|[-:]/g) ?? [], lines = [];
  let line = '';
  for (let p of parts) {
    if (line && line.length + p.length > chars) { lines.push(line); line = ''; }
    while (p.length > chars) { lines.push(p.slice(0, chars)); p = p.slice(chars); }
    line += p;
  }
  if (line) lines.push(line);
  return lines;
}

// A field colour for each media when a record has no colours.
const MEDIA_FIELD = { raster: '#8a8f98', video: '#3d4a66', audio: '#4f6b5a', font: '#e9e4d8', vector: '#b9a37a', data: '#5d556e' };
const INK_DARK = [28, 28, 30], INK_LIGHT = [246, 244, 238];

const fin = Number.isFinite;
const round = (v, digits) => String(+v.toFixed(digits));
const dims = (w, h) => (fin(w) && fin(h) ? `${Math.round(w)}×${Math.round(h)}` : null);
const when = (v, fmt) => (v !== undefined && v !== null && v !== '' && v !== false ? fmt(v) : null);

// The one line of facts a card gives for a record: size, length, rate, family... whatever its kind has.
export function factsOf(r) {
  let media;
  try { media = mediaOf(r.kind); } catch { media = null; }
  const box = Array.isArray(r.box) ? dims(r.box[2], r.box[3]) : null;
  const sec = when(fin(r.sec) && r.sec, (v) => `${round(v, 1)} s`), fps = when(fin(r.fps) && r.fps, (v) => `${round(v, 2)} fps`);
  const parts = {
    raster: [dims(r.w, r.h) ?? box, when(r.alpha, () => 'alpha')],
    video: [sec, dims(r.w, r.h), fps, when(r.audio, () => 'sound')],
    audio: [sec, when(r.rate, (v) => `${v} hz`), when(r.channels, (v) => `${v} ch`), when(r.align, () => 'words'), when(r.mouth, () => 'mouth')],
    font: [r.family, r.weight, r.style, when(r.glyphs, (v) => `${v} glyphs`)],
    vector: [box],
    data: r.kind === 'clip' ? [when(r.n, (v) => `${v} frames`), fps, r.track]
      : r.kind === 'hand' ? [when(r.glyphs, (v) => `${v} glyphs`), when(r.marks, (v) => `${v} marks`)]
        : [box],
  }[media] ?? [];
  return parts.filter((p) => p !== null && p !== undefined && p !== '').map(String).join(' · ');
}

// What a card letters and paints for a record; its hash is the card's tag, so a record that changes what it
// would letter (a new licence, a new palette) gets a new card.
function cardSpec(r) {
  let media;
  try { media = mediaOf(r.kind); } catch { media = 'data'; }
  const swatches = (Array.isArray(r.colours) ? r.colours : []).filter((c) => rgbOf(c?.hex) && c.area > 0).slice(0, 8);
  const field = swatches[0]?.hex ?? MEDIA_FIELD[media];
  return {
    field, swatches: swatches.map((c) => [c.hex.toLowerCase(), c.area]),
    ink: lightness([{ hex: field, area: 1 }]) < DARK ? 'light' : 'dark',
    kind: lettering(r.kind ?? '?'), ext: lettering(r.ext ?? ''), id: lettering(r.id ?? '?'),
    facts: lettering(factsOf(r)), licence: lettering(r.licence ?? '?'),
  };
}
export const cardKey = (r) => 'card:' + createHash('sha256').update(JSON.stringify([PREVIEW_VERSION, cardSpec(r)])).digest('hex').slice(0, 10);

// The fallback card for a record (with its id): CARD_W x CARD_H PNG bytes, tagged with cardKey(record).
//
//   CUTOUT                    WEBP
//   TEAPOT                               <- the id, as large as fits in three lines
//   815×739 · ALPHA
//   CC0
//   [ palette strip, by area ]
export function card(record) {
  const s = cardSpec(record), M = 24;
  const img = canvas(CARD_W, CARD_H, rgbOf(s.field));
  const ink = s.ink === 'light' ? INK_LIGHT : INK_DARK;
  const strip = s.swatches.length ? 20 : 0;
  // The palette as a strip along the bottom, each swatch as wide as its share.
  if (strip) {
    const total = s.swatches.reduce((a, [, area]) => a + area, 0);
    let x = 0;
    s.swatches.forEach(([hex, area], i) => {
      const w = i === s.swatches.length - 1 ? CARD_W - x : Math.round((area / total) * CARD_W);
      rect(img, x, CARD_H - strip, w, strip, rgbOf(hex));
      x += w;
    });
  }
  text(img, clip(s.kind, 20), M, M, 3, ink);
  if (s.ext) text(img, s.ext, CARD_W - M - textWidth(s.ext, 2), M + 2, 2, ink);
  // The id: the largest scale at which it fits the space between the kind and the facts.
  const top = M + 7 * 3 + 20, bottom = CARD_H - strip - M - 2 * (7 * 2) - 10 - 16, room = bottom - top, width = CARD_W - 2 * M;
  let lines = null, scale = 6;
  for (; scale >= 2; scale--) {
    const l = wrap(s.id, Math.floor((width + scale) / ((GLYPH_W + 1) * scale)));
    if (l.length * (GLYPH_H + 2) * scale - 2 * scale <= room) { lines = l; break; }
  }
  if (!lines) {
    scale = 2;
    const chars = Math.floor((width + 2) / 12), fit = Math.floor((room + 4) / 18);
    lines = wrap(s.id, chars).slice(0, fit);
    lines[lines.length - 1] = clip(lines[lines.length - 1] + '...', chars);
  }
  lines.forEach((l, i) => text(img, l, M, top + i * (GLYPH_H + 2) * scale, scale, ink));
  const chars = Math.floor((width + 2) / 12);
  text(img, clip(s.facts, chars), M, CARD_H - strip - M - 14 - 10 - 14, 2, ink);
  text(img, clip(s.licence, chars), M, CARD_H - strip - M - 14, 2, ink);
  return encodePng(img, { text: { [TAG_KEY]: tagText(cardKey(record)) } });
}

// A host's PNG tagged as drawn by previewer `p`.
export const tagged = (png, p) => withText(png, { [TAG_KEY]: tagText(p.by) });

// ---------- the contact sheet ----------

// Pixels scaled into w x h, keeping their aspect, centred, over a checkerboard (so a cutout's alpha shows):
// each target pixel is the premultiplied mean of the source pixels under it (or the nearest one, going up).
function fitInto(img, src, x, y, w, h) {
  const k = Math.min(w / src.width, h / src.height), dw = Math.max(1, Math.round(src.width * k)), dh = Math.max(1, Math.round(src.height * k));
  const ox = x + Math.floor((w - dw) / 2), oy = y + Math.floor((h - dh) / 2), sx = src.width / dw, sy = src.height / dh;
  for (let ty = 0; ty < dh; ty++) {
    const y0 = Math.floor(ty * sy), y1 = Math.max(y0 + 1, Math.floor((ty + 1) * sy));
    for (let tx = 0; tx < dw; tx++) {
      const x0 = Math.floor(tx * sx), x1 = Math.max(x0 + 1, Math.floor((tx + 1) * sx));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * src.width + xx) * 4, al = src.data[o + 3];
          r += src.data[o] * al; g += src.data[o + 1] * al; b += src.data[o + 2] * al; a += al; n++;
        }
      }
      const o = ((oy + ty) * img.width + ox + tx) * 4, alpha = a / n / 255;
      const under = (((ox + tx - x) >> 3) + ((oy + ty - y) >> 3)) & 1 ? CHECK[1] : CHECK[0];
      for (let c = 0; c < 3; c++) img.data[o + c] = (a ? [r, g, b][c] / a : 0) * alpha + under[c] * (1 - alpha);
      img.data[o + 3] = 255;
    }
  }
}
const SHEET_BG = [24, 24, 28], CELL_BG = [40, 40, 46], CHECK = [[52, 52, 58], [64, 64, 70]], CAPTION = [236, 234, 228];

// Previews tiled into one PNG, `cols` across (default: the square root, rounded up), each cell a `cell` x
// (cell * 2/3) picture over its id. `items` are [{ id, pixels }]. Returns { png, width, height, cols, rows,
// cells: [{ id, x, y, w, h }] } where x, y, w, h is the picture's box in the sheet.
export function contactSheet(items, { cols, cell = 240, gap = 12 } = {}) {
  const n = items.length;
  if (!n) throw new Error('a contact sheet needs at least one preview');
  cols = Math.max(1, Math.min(n, Math.round(cols ?? Math.ceil(Math.sqrt(n)))));
  const rows = Math.ceil(n / cols), w = Math.round(cell), h = Math.round((cell * 2) / 3), capH = 28;
  const width = gap + cols * (w + gap), height = gap + rows * (h + capH + gap);
  const img = canvas(width, height, SHEET_BG), cells = [];
  items.forEach(({ id, pixels }, i) => {
    const x = gap + (i % cols) * (w + gap), y = gap + Math.floor(i / cols) * (h + capH + gap);
    rect(img, x, y, w, h + capH, CELL_BG);
    fitInto(img, pixels, x, y, w, h);
    const label = lettering(id), scale = textWidth(label, 2) <= w - 12 ? 2 : 1;
    const line = clip(label, Math.floor((w - 12 + scale) / ((GLYPH_W + 1) * scale)));
    text(img, line, x + 6, y + h + Math.round((capH - GLYPH_H * scale) / 2), scale, CAPTION);
    cells.push({ id, x, y, w, h });
  });
  return { png: encodePng(img), width, height, cols, rows, cells };
}
