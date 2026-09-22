// A small TrueType writer (4.0 D3): glyf outlines, quadratic, no hinting. Enough for `hdf hand --export-ttf` to
// hand a hand to anything that sets type (davidup's text item, a word processor): simple glyphs of overlapping
// contours, all wound one way, so the non-zero fill every TrueType rasteriser uses unions them with no boolean
// work, and composite glyphs that place other glyphs (a base and its marks). opentype.js writes CFF outlines only,
// with no composites, so the tables are written here.
//
// ttfBytes({ family, style, unitsPerEm, ascender, descender, lineGap, capHeight, xHeight, italicAngle, caret,
//   copyright, licence, version, glyphs }) => Buffer. glyphs[0] is .notdef; each glyph is { name, unicode?,
// advance, contours: [[[x, y, on], ...], ...] } or { name, unicode?, advance, components: [{ glyph, x, y, scale? }] }
// (glyph an index into glyphs, scale a uniform one, -2 < scale < 2). Coordinates are font units, y up.

const TAGS = ['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post'];
const EPOCH = 3850070400;   // head.created and modified, 2026-01-01 (seconds since 1904): fixed, so a font's bytes are a function of its hand

class Out {
  constructor() { this.b = []; }
  u8(v) { this.b.push(v & 255); return this; }
  u16(v) { this.b.push((v >> 8) & 255, v & 255); return this; }
  i16(v) { return this.u16(v < 0 ? v + 65536 : v); }
  u32(v) { return this.u16(Math.floor(v / 65536) & 0xffff).u16(v & 0xffff); }
  fixed(v) { const n = Math.round(v * 65536); return this.u32(n < 0 ? n + 2 ** 32 : n); }
  f2dot14(v) { return this.i16(Math.round(v * 16384)); }
  tag(s) { for (const c of s.padEnd(4)) this.u8(c.charCodeAt(0)); return this; }
  bytes(a) { for (const v of a) this.b.push(v); return this; }
  pad4() { while (this.b.length % 4) this.b.push(0); return this; }
  get length() { return this.b.length; }
}

const sum32 = (b) => {
  let s = 0;
  for (let i = 0; i < b.length; i += 4) s = (s + ((b[i] << 24) >>> 0) + ((b[i + 1] ?? 0) << 16) + ((b[i + 2] ?? 0) << 8) + (b[i + 3] ?? 0)) >>> 0;
  return s;
};

function bboxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x0 === Infinity ? null : [x0, y0, x1, y1];
}

// A simple glyph's bytes (every contour's first point carries OVERLAP_SIMPLE on the first flag).
function simpleGlyph(contours, box) {
  const o = new Out(), flags = [], xs = new Out(), ys = new Out();
  o.i16(contours.length).i16(box[0]).i16(box[1]).i16(box[2]).i16(box[3]);
  let end = -1, px = 0, py = 0;
  for (const c of contours) { end += c.length; o.u16(end); }
  o.u16(0);   // no instructions
  for (const c of contours) for (const [x, y, on] of c) {
    const dx = x - px, dy = y - py;
    let f = on ? 1 : 0;
    if (dx === 0) f |= 0x10;
    else if (Math.abs(dx) < 256) { f |= 0x02 | (dx > 0 ? 0x10 : 0); xs.u8(Math.abs(dx)); } else xs.i16(dx);
    if (dy === 0) f |= 0x20;
    else if (Math.abs(dy) < 256) { f |= 0x04 | (dy > 0 ? 0x20 : 0); ys.u8(Math.abs(dy)); } else ys.i16(dy);
    if (!flags.length) f |= 0x40;
    flags.push(f); px = x; py = y;
  }
  return o.bytes(flags).bytes(xs.b).bytes(ys.b).pad4().b;
}

function compositeGlyph(components, box) {
  const o = new Out();
  o.i16(-1).i16(box[0]).i16(box[1]).i16(box[2]).i16(box[3]);
  components.forEach((c, i) => {
    const words = c.x < -128 || c.x > 127 || c.y < -128 || c.y > 127, scaled = (c.scale ?? 1) !== 1;
    let f = 0x0002 | 0x0004 | (words ? 0x0001 : 0) | (scaled ? 0x0008 : 0) | (i < components.length - 1 ? 0x0020 : 0);
    if (i === 0) f |= 0x0200 | 0x0400;   // USE_MY_METRICS on the base; OVERLAP_COMPOUND
    o.u16(f).u16(c.glyph);
    if (words) o.i16(c.x).i16(c.y); else o.u8(c.x < 0 ? c.x + 256 : c.x).u8(c.y < 0 ? c.y + 256 : c.y);
    if (scaled) o.f2dot14(c.scale);
  });
  return o.pad4().b;
}

// The points of a glyph, components resolved (for boxes and maxp).
function pointsOf(glyphs, i, depth = 0) {
  const g = glyphs[i];
  if (g.contours) return g.contours.flat();
  if (depth > 4) throw new Error(`ttf: glyph '${g.name}' nests components too deep`);
  return (g.components ?? []).flatMap((c) => pointsOf(glyphs, c.glyph, depth + 1).map(([x, y, on]) => [Math.round(x * (c.scale ?? 1) + c.x), Math.round(y * (c.scale ?? 1) + c.y), on]));
}

// cmap: format 4 over the BMP, a segment per run of consecutive codes with consecutive glyph ids.
function cmapTable(map) {
  const codes = [...map.keys()].filter((c) => c < 0xffff).sort((a, b) => a - b), segs = [];
  for (const c of codes) {
    const s = segs.at(-1);
    if (s && c === s.end + 1 && map.get(c) === map.get(s.end) + 1) s.end = c; else segs.push({ start: c, end: c });
  }
  segs.push({ start: 0xffff, end: 0xffff, delta: 1 });
  const n = segs.length, pow = 2 ** Math.floor(Math.log2(n)), f4 = new Out();
  f4.u16(4).u16(16 + 8 * n).u16(0).u16(2 * n).u16(2 * pow).u16(Math.log2(pow)).u16(2 * n - 2 * pow);
  for (const s of segs) f4.u16(s.end);
  f4.u16(0);
  for (const s of segs) f4.u16(s.start);
  for (const s of segs) f4.u16(((s.delta ?? map.get(s.start) - s.start) + 65536) % 65536);
  for (let i = 0; i < n; i++) f4.u16(0);
  return new Out().u16(0).u16(1).u16(3).u16(1).u32(12).bytes(f4.b).b;
}

function nameTable(names) {
  const recs = Object.entries(names).filter(([, v]) => v).map(([id, v]) => [Number(id), String(v)]).sort((a, b) => a[0] - b[0]);
  const o = new Out(), strs = new Out();
  o.u16(0).u16(recs.length).u16(6 + 12 * recs.length);
  for (const [id, v] of recs) {
    const off = strs.length;
    for (const ch of v) { const c = ch.codePointAt(0); if (c > 0xffff) { const u = c - 0x10000; strs.u16(0xd800 + (u >> 10)).u16(0xdc00 + (u & 1023)); } else strs.u16(c); }
    o.u16(3).u16(1).u16(0x409).u16(id).u16(strs.length - off).u16(off);
  }
  return o.bytes(strs.b).b;
}

// Unicode ranges (OS/2 ulUnicodeRange1) the font covers: bits 0 Basic Latin, 1 Latin-1, 2 Latin Extended-A,
// 3 Latin Extended-B, 7 Greek, 9 Cyrillic, 31 General Punctuation, 38 Mathematical Operators (range 2, bit 6).
function unicodeRanges(codes) {
  const r = [0, 0, 0, 0], set = (bit) => { r[bit >> 5] = (r[bit >> 5] | (1 << (bit & 31))) >>> 0; };
  const spans = [[0, 0x20, 0x7e], [1, 0xa0, 0xff], [2, 0x100, 0x17f], [3, 0x180, 0x24f], [7, 0x370, 0x3ff], [9, 0x400, 0x4ff], [31, 0x2000, 0x206f], [37, 0x2190, 0x21ff], [38, 0x2200, 0x22ff]];
  for (const c of codes) for (const [bit, a, b] of spans) if (c >= a && c <= b) set(bit);
  return r;
}

const psName = (s) => String(s).replace(/[^A-Za-z0-9-]/g, '').slice(0, 63) || 'Hand';

export function ttfBytes(font) {
  const { glyphs, unitsPerEm = 1000, ascender, descender, lineGap = 0, capHeight = 0, xHeight = 0, italicAngle = 0 } = font;
  const family = font.family ?? 'Hand', style = font.style ?? 'Regular', version = font.version ?? 'Version 1.000';
  if (!glyphs?.length || glyphs[0].name !== '.notdef') throw new Error('ttf: glyphs[0] must be .notdef');
  if (glyphs.length > 65535) throw new Error('ttf: too many glyphs');

  // glyf, loca, and what maxp and head need
  const glyf = new Out(), loca = [0], boxes = [];
  let maxPoints = 0, maxContours = 0, maxCPoints = 0, maxCContours = 0, maxComponents = 0;
  glyphs.forEach((g, i) => {
    const pts = pointsOf(glyphs, i), box = bboxOf(pts);
    boxes.push(box);
    if (box) {
      if (g.contours) {
        glyf.bytes(simpleGlyph(g.contours, box));
        maxPoints = Math.max(maxPoints, pts.length); maxContours = Math.max(maxContours, g.contours.length);
      } else {
        glyf.bytes(compositeGlyph(g.components, box));
        const contours = g.components.reduce((t, c) => t + (glyphs[c.glyph].contours?.length ?? 0), 0);
        maxCPoints = Math.max(maxCPoints, pts.length); maxCContours = Math.max(maxCContours, contours);
        maxComponents = Math.max(maxComponents, g.components.length);
      }
    }
    loca.push(glyf.length);
  });
  if (glyf.length > 0xffffffff) throw new Error('ttf: glyf too big');
  const all = boxes.filter(Boolean), head4 = all.length ? [Math.min(...all.map((b) => b[0])), Math.min(...all.map((b) => b[1])), Math.max(...all.map((b) => b[2])), Math.max(...all.map((b) => b[3]))] : [0, 0, 0, 0];

  const cmapMap = new Map();
  glyphs.forEach((g, i) => { if (g.unicode !== undefined && !cmapMap.has(g.unicode)) cmapMap.set(g.unicode, i); });
  const codes = [...cmapMap.keys()].sort((a, b) => a - b);
  const advances = glyphs.map((g) => Math.max(0, Math.round(g.advance ?? 0)));
  const lsb = boxes.map((b) => (b ? b[0] : 0)), rsb = boxes.map((b, i) => (b ? advances[i] - b[2] : 0));
  const inked = advances.filter((a) => a > 0);
  const winAscent = Math.max(ascender, head4[3]), winDescent = Math.max(-descender, -head4[1]);
  const slope = Math.tan(-italicAngle * Math.PI / 180);

  const T = {};
  T.head = new Out().fixed(1).fixed(1).u32(0).u32(0x5f0f3cf5).u16(0x0003).u16(unitsPerEm)
    .u32(0).u32(EPOCH).u32(0).u32(EPOCH)
    .i16(head4[0]).i16(head4[1]).i16(head4[2]).i16(head4[3])
    .u16(0).u16(8).i16(2).i16(1).i16(0).b;
  T.hhea = new Out().fixed(1).i16(ascender).i16(descender).i16(lineGap).u16(Math.max(0, ...advances))
    .i16(Math.min(0, ...lsb)).i16(Math.min(0, ...rsb)).i16(Math.max(0, ...boxes.map((b) => (b ? b[2] : 0))))
    .i16(slope ? 1000 : 1).i16(slope ? Math.round(slope * 1000) : 0).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).u16(glyphs.length).b;
  const hmtx = new Out();
  glyphs.forEach((_, i) => hmtx.u16(advances[i]).i16(lsb[i]));
  T.hmtx = hmtx.b;
  T.maxp = new Out().fixed(1).u16(glyphs.length).u16(maxPoints).u16(maxContours).u16(maxCPoints).u16(maxCContours)
    .u16(2).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(maxComponents).u16(maxComponents ? 1 : 0).b;
  const lo = new Out();
  for (const v of loca) lo.u32(v);
  T.loca = lo.b;
  T.glyf = glyf.b;
  T.cmap = cmapTable(cmapMap);
  const ur = unicodeRanges(codes), os2 = new Out();
  os2.u16(4).i16(inked.length ? Math.round(inked.reduce((a, b) => a + b, 0) / inked.length) : 0).u16(400).u16(5).u16(0)
    .i16(650).i16(600).i16(0).i16(75).i16(650).i16(600).i16(0).i16(350)   // sub- and superscript sizes and offsets
    .i16(50).i16(300).i16(0)                                              // strikeout size, position; family class
    .bytes([2, 0, 5, 3, 0, 0, 0, 0, 0, 0])                                // panose: text, any, book, regular width
    .u32(ur[0]).u32(ur[1]).u32(ur[2]).u32(ur[3]).tag('HDF ')
    .u16(0x40 | 0x80 | (italicAngle ? 0x01 : 0)).u16(Math.min(0xffff, codes[0] ?? 0)).u16(Math.min(0xffff, codes.at(-1) ?? 0))
    .i16(ascender).i16(descender).i16(lineGap).u16(winAscent).u16(winDescent)
    .u32((codes.some((c) => c > 0x7f && c < 0x250) ? 0b11 : 0b1) | (codes.some((c) => c >= 0x400 && c < 0x500) ? 1 << 2 : 0) | (codes.some((c) => c >= 0x370 && c < 0x400) ? 1 << 3 : 0)).u32(0)
    .i16(xHeight).i16(capHeight).u16(0).u16(32).u16(0);
  T['OS/2'] = os2.b;
  T.name = nameTable({
    0: font.copyright, 1: family, 2: style, 3: `${psName(family)}-${style};${version}`, 4: style === 'Regular' ? family : `${family} ${style}`,
    5: version, 6: `${psName(family)}-${psName(style)}`, 13: font.licence,
  });
  T.post = new Out().fixed(3).fixed(italicAngle).i16(-100).i16(Math.max(1, Math.round(unitsPerEm * 0.045))).u32(0).u32(0).u32(0).u32(0).u32(0).b;

  // the file: offset table, directory (tags sorted), tables each padded to 4, then head's checkSumAdjustment
  const n = TAGS.length, pow = 2 ** Math.floor(Math.log2(n)), out = new Out();
  out.u32(0x00010000).u16(n).u16(pow * 16).u16(Math.log2(pow)).u16(n * 16 - pow * 16);
  let off = 12 + 16 * n;
  const dir = [];
  for (const tag of TAGS) { const b = T[tag]; dir.push({ tag, b, off }); off += Math.ceil(b.length / 4) * 4; }
  for (const d of dir) out.tag(d.tag).u32(sum32(d.b)).u32(d.off).u32(d.b.length);
  for (const d of dir) out.bytes(d.b).pad4();
  const buf = Buffer.from(out.b), at = dir.find((d) => d.tag === 'head').off + 8;
  buf.writeUInt32BE((0xb1b0afba - sum32(buf) + 2 ** 32) % 2 ** 32, at);
  return buf;
}

// ---------- reading back (tests, `hdf hand --export-ttf`'s report) ----------

// The tables of a TrueType file as { tag: { off, len, sum } }, and whether every checksum holds.
export function ttfTables(buf) {
  const n = buf.readUInt16BE(4), tables = {};
  let ok = true;
  for (let i = 0; i < n; i++) {
    const p = 12 + 16 * i, tag = buf.toString('latin1', p, p + 4), sum = buf.readUInt32BE(p + 4), off = buf.readUInt32BE(p + 8), len = buf.readUInt32BE(p + 12);
    const b = [...buf.subarray(off, off + len)];
    if (tag === 'head') b[8] = b[9] = b[10] = b[11] = 0;
    if (sum32(b) !== sum) ok = false;
    tables[tag] = { off, len, sum };
  }
  return { tables, ok: ok && sum32([...buf]) === 0xb1b0afba };
}

// The glyph id a code point maps to in a font's format 4 cmap (0 when none).
export function ttfGlyphId(buf, code) {
  const { tables } = ttfTables(buf), c = tables.cmap.off;
  const n = buf.readUInt16BE(c + 2);
  for (let i = 0; i < n; i++) {
    const st = c + buf.readUInt32BE(c + 4 + 8 * i + 4);
    if (buf.readUInt16BE(st) !== 4) continue;
    const seg = buf.readUInt16BE(st + 6) / 2, ends = st + 14, starts = ends + 2 * seg + 2, deltas = starts + 2 * seg;
    for (let s = 0; s < seg; s++) {
      if (code > buf.readUInt16BE(ends + 2 * s)) continue;
      if (code < buf.readUInt16BE(starts + 2 * s)) return 0;
      return (code + buf.readUInt16BE(deltas + 2 * s)) % 65536;
    }
  }
  return 0;
}

// Contours in a glyph (-1 for a composite, 0 for an empty one).
export function ttfContours(buf, gid) {
  const { tables } = ttfTables(buf), a = buf.readUInt32BE(tables.loca.off + 4 * gid), b = buf.readUInt32BE(tables.loca.off + 4 * gid + 4);
  return a === b ? 0 : buf.readInt16BE(tables.glyf.off + a);
}
