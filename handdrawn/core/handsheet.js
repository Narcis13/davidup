// The hand sheet (plan 1.4, S12): the template `hdf hand --template` prints, and reading a photo of it back
// into a hand record. Pure: images come in as a luminance plane { data, w, h } (0..1), drawing goes to any
// canvas 2D context, so the same geometry serves the PDF, the tests' synthetic sheets and the reader.
//
// The sheet is a frame FRAME mm wide and tall, centred on A4 or letter, with a thick black L at each corner
// (the one at the top left has a square key beside it, so a photo taken sideways still reads). A sheet has
// pages (PAGES): latin, 62 boxes (a-z, A-Z, 0-9) and a last row for the pen: three lines drawn left to right, a
// circle, a square, a zigzag, a long S; symbols, 32 boxes of punctuation and signs. Each box has its baseline,
// x-height and cap line in light blue and a small grey exemplar. A page is told by its code, filled squares
// along the bottom edge (latin has none, so sheets printed before pages existed read as latin).
// Every box is laid out in em units (UNIT mm each), the 100-unit em of core/glyphs.js, so what is written on
// the baseline comes back at the size the house glyphs are drawn at.
//
// Reading: find the four marks, map the frame onto the photo with a 4-point homography, sample each box at
// PPU pixels per em unit, threshold against the box's own paper, thin to a skeleton (core/skeleton.js), trace
// strokes, scale to the em. The pen profile is fitted from the last row: wobble, hook and pressure from the
// lines, overshoot and rounding from the square, tremor from the lines' high-frequency residual.
import { GLYPHS } from './glyphs.js';
import { components, distanceTransform, degrees, prune, simplify, traceSkeleton, zhangSuen } from './skeleton.js';

export const PAPERS = Object.freeze({ a4: [210, 297], letter: [215.9, 279.4] });   // mm
export const FRAME = Object.freeze([180, 250]);                                  // mm, outer corners of the marks
export const MARK = Object.freeze({ arm: 12, thick: 3, key: [5, 5, 4] });        // key: x, y, side, inside the top-left L
export const UNIT = 0.2;                                                          // mm per em unit
export const CHARS = Object.freeze([...'abcdefghijklmnopqrstuvwxyz', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', ...'0123456789']);
export const SYMBOLS = Object.freeze([...'.,:;\'"-!?&()[]/+=%°×÷→←↑↓~*_#@$€']);
// The pages of the sheet: index is the page's code (bit k set: the k-th square filled), pen whether it has the pen row.
export const PAGES = Object.freeze({
  latin: Object.freeze({ index: 0, chars: CHARS, pen: true }),
  symbols: Object.freeze({ index: 1, chars: SYMBOLS, pen: false }),
});
export const CODE = Object.freeze({ x: 20, y: 241, side: 5, step: 8, bits: 3 });   // mm: the code squares, left to right
const pageOf = (page) => {
  const p = PAGES[page];
  if (!p) throw new Error(`hand sheet: page '${page}' (expected ${Object.keys(PAGES).join(' | ')})`);
  return p;
};
export const BOX = Object.freeze({ w: 90, h: 120, base: 84 });                    // em units; base: baseline below the top
const COLS = 9, TOP = 18, GAP = [2.25, 3];                                        // mm
export const ROW = Object.freeze({ y: 208, h: 140 });                             // the pen row: mm from the top, em tall
export const PPU = 2;                                                             // pixels per em unit when reading

// The glyph boxes of a page in frame mm: { ch, x, y, w, h }; em (ex, ey) of a box is at x + ex * UNIT, y + (base + ey) * UNIT.
export function glyphBoxes(page = 'latin') {
  const bw = BOX.w * UNIT, bh = BOX.h * UNIT;
  return pageOf(page).chars.map((ch, i) => ({ ch, x: (i % COLS) * (bw + GAP[0]), y: TOP + Math.floor(i / COLS) * (bh + GAP[1]), w: bw, h: bh }));
}
export const emToFrame = (box, ex, ey) => [box.x + ex * UNIT, box.y + (BOX.base + ey) * UNIT];

// The pen row: cells in frame mm, each with its ideal strokes in cell em units (y down from the cell top).
const polyline = (...xy) => { const out = []; for (let i = 0; i < xy.length; i += 2) out.push([xy[i], xy[i + 1]]); return out; };
const dense = (pts, step = 8) => {             // a polyline with a vertex every `step` units (the pen jitters vertices)
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) out.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
  }
  return out;
};
export const LINES_Y = Object.freeze([30, 70, 110]);
export const SQUARE = Object.freeze([35, 30, 80]);                                // x, y, side in cell em units (room for 0.35 overshoot)
export const SHAPES = Object.freeze([
  { name: 'line', x: 0, w: 44, paths: LINES_Y.map((y) => dense(polyline(10, y, 210, y))) },
  { name: 'circle', x: 46, w: 30, paths: [Array.from({ length: 49 }, (_, k) => [75 + 55 * Math.cos(-Math.PI / 2 + k * Math.PI / 24), 70 + 55 * Math.sin(-Math.PI / 2 + k * Math.PI / 24)])] },
  { name: 'square', x: 78, w: 30, paths: [polyline(35, 30, 115, 30, 115, 110, 35, 110, 35, 30)] },
  { name: 'zigzag', x: 110, w: 38, paths: [polyline(10, 110, 44, 30, 78, 110, 112, 30, 146, 110, 180, 30)] },
  { name: 's', x: 150, w: 30, paths: [(() => { const p = GLYPHS.S.s[0], out = []; for (let i = 0; i < p.length; i += 2) out.push([40 + p[i] * 1.6, 128 + p[i + 1] * 1.6]); return out; })()] },
]);
export const cellToFrame = (cell, ex, ey) => [cell.x + ex * UNIT, ROW.y + ey * UNIT];

// Where the frame sits on a page (mm), centred.
export function frameOrigin(paper = 'a4') {
  const p = PAPERS[paper];
  if (!p) throw new Error(`hand sheet: paper '${paper}' (expected ${Object.keys(PAPERS).join(' | ')})`);
  return [(p[0] - FRAME[0]) / 2, (p[1] - FRAME[1]) / 2];
}

// The four marks' centroids in frame mm, clockwise from the top left (what the homography is fitted to).
export function markCentroids() {
  const { arm: a, thick: t } = MARK, A1 = a * t, A2 = t * (a - t);
  const c = (A1 * a / 2 + A2 * t / 2) / (A1 + A2), [W, H] = FRAME;
  return [[c, c], [W - c, c], [W - c, H - c], [c, H - c]];
}

// ---------- drawing the template ----------

const INK = '#000', GUIDE = '#9cc3e6', FAINT = '#c6ddf0', EXEMPLAR = '#bdbdbd', LABEL = '#6a6a6a';

// One page of the template, drawn with ctx in mm (the caller scales to points or pixels). paper: 'a4' | 'letter'.
export function drawTemplate(ctx, paper = 'a4', page = 'latin') {
  const [pw, ph] = PAPERS[paper] ?? PAPERS.a4, [ox, oy] = frameOrigin(paper), [W, H] = FRAME, pg = pageOf(page);
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, pw, ph);
  ctx.translate(ox, oy);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // The marks: an L at each corner, arms pointing in, and the key beside the top-left one.
  const { arm: a, thick: t, key } = MARK;
  ctx.fillStyle = INK;
  for (const [sx, sy, cx, cy] of [[1, 1, 0, 0], [-1, 1, W, 0], [-1, -1, W, H], [1, -1, 0, H]]) {
    ctx.beginPath();
    ctx.moveTo(cx, cy); ctx.lineTo(cx + sx * a, cy); ctx.lineTo(cx + sx * a, cy + sy * t); ctx.lineTo(cx + sx * t, cy + sy * t);
    ctx.lineTo(cx + sx * t, cy + sy * a); ctx.lineTo(cx, cy + sy * a); ctx.closePath(); ctx.fill();
  }
  ctx.fillRect(key[0], key[1], key[2], key[2]);
  for (let k = 0; k < CODE.bits; k++) if (pg.index >> k & 1) ctx.fillRect(CODE.x + k * CODE.step, CODE.y, CODE.side, CODE.side);

  // The header.
  ctx.fillStyle = '#333';
  ctx.font = '5px sans-serif';
  ctx.fillText('hand sheet', 18, 7);
  ctx.fillStyle = LABEL;
  ctx.font = '2.3px sans-serif';
  ctx.fillText(`${paper === 'letter' ? 'US letter' : 'A4'}  ·  print at 100%, no scaling`, 18, 11);
  ctx.fillText(`page: ${page}`, 18, 14.3);
  const say = pg.pen ? [
    'Write each character once in its box, standing on the blue baseline, small letters up to the dashed line,',
    'capitals and figures up to the dotted one, in a dark pen. Last row: three lines left to right, a circle, a square,',
    'a zigzag and a long S over the faint guides. Photograph the whole sheet, flat, with all four black corners in it.',
  ] : [
    'Write each mark once in its box where it sits in a sentence, as the grey exemplar shows: on the baseline,',
    'brackets from the dotted line down to the faint one, + = × ÷ and arrows halfway to the dashed line. Dark pen.',
    'Photograph the whole sheet, flat, with all four black corners and the square along the bottom in the picture.',
  ];
  say.forEach((line, i) => ctx.fillText(line, 58, 5 + 3.2 * i));

  // The glyph boxes.
  for (const b of glyphBoxes(page)) {
    ctx.strokeStyle = EXEMPLAR;
    ctx.lineWidth = 0.2;
    ctx.setLineDash([]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    const guide = (ey, colour, dash, lw = 0.25) => {
      const [x0, y] = emToFrame(b, 2, ey), [x1] = emToFrame(b, BOX.w - 2, ey);
      ctx.strokeStyle = colour; ctx.lineWidth = lw; ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    };
    guide(0, GUIDE, [], 0.3);
    guide(-48, GUIDE, [1.2, 0.9]);
    guide(-72, GUIDE, [0.3, 0.7]);
    guide(24, FAINT, [0.3, 0.9]);
    ctx.setLineDash([]);
    // The exemplar: the house glyph, small, in the top left corner.
    ctx.strokeStyle = EXEMPLAR;
    ctx.lineWidth = 0.22;
    for (const s of GLYPHS[b.ch].s) {
      ctx.beginPath();
      for (let i = 0; i < s.length; i += 2) {
        const [x, y] = emToFrame(b, 4 + s[i] * 0.2, -64 + s[i + 1] * 0.2);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
  }

  // The pen row: each cell boxed, its guides faint and dotted.
  for (const c of pg.pen ? SHAPES : []) {
    const [x0, y0] = cellToFrame(c, 0, 0);
    ctx.strokeStyle = EXEMPLAR; ctx.lineWidth = 0.2; ctx.setLineDash([]);
    ctx.strokeRect(x0, y0, c.w, ROW.h * UNIT);
    ctx.strokeStyle = FAINT; ctx.lineWidth = 0.35; ctx.setLineDash([0.4, 1.1]);
    for (const p of c.paths) {
      ctx.beginPath();
      p.forEach(([ex, ey], i) => { const [x, y] = cellToFrame(c, ex, ey); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.restore();
}

// ---------- finding the frame in a photo ----------

// Solves the 3x3 homography (as 8 numbers, h[8] = 1) taking the four src points onto the four dst points.
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  return (x, y) => { const d = h[6] * x + h[7] * y + 1; return [(h[0] * x + h[1] * y + h[2]) / d, (h[3] * x + h[4] * y + h[5]) / d]; };
}

function solve(A, b) {                         // Gaussian elimination with partial pivoting
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) throw new Error('hand sheet: the corner marks are in a line; photograph the whole sheet');
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

// A luminance plane averaged down by an integer factor.
function shrink({ data, w, h }, f) {
  const sw = Math.floor(w / f), sh = Math.floor(h / f), out = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let s = 0;
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += data[(y * f + j) * w + x * f + i];
    out[y * sw + x] = s / (f * f);
  }
  return { data: out, w: sw, h: sh };
}

// The four corner marks in a photo: [[x, y] x 4] in image pixels, clockwise from the sheet's top left.
// Ink is anything much darker than its surroundings (so a dark table round the sheet is not); an L is a
// component that fills a third to a half of its box with one quarter of the box empty; the four chosen are
// the largest that span the biggest quadrilateral; the one with the square key inside it is the top left.
export function findMarks(img) {
  const f = Math.max(1, Math.floor(Math.max(img.w, img.h) / 1400)), s = f > 1 ? shrink(img, f) : img, { w, h, data } = s;
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += data[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; }
  }
  const r = Math.max(8, Math.round(Math.max(w, h) / 24)), ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    const mean = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
    ink[y * w + x] = data[y * w + x] < mean * 0.6 ? 1 : 0;
  }
  const comps = components(ink, w, h).filter((c) => c.area >= 20 && c.box[0] > 0 && c.box[1] > 0 && c.box[2] < w - 1 && c.box[3] < h - 1);
  for (const c of comps) {
    const [x0, y0, x1, y1] = c.box, bw = x1 - x0 + 1, bh = y1 - y0 + 1, q = [0, 0, 0, 0];
    let sx = 0, sy = 0;
    for (const i of c.px) {
      const x = i % w, y = (i - x) / w;
      sx += x; sy += y;
      q[(x - x0 < bw / 2 ? 0 : 1) + (y - y0 < bh / 2 ? 0 : 2)]++;
    }
    Object.assign(c, { bw, bh, fill: c.area / (bw * bh), aspect: bw / bh, c: [sx / c.area, sy / c.area], emptyQuarter: Math.min(...q) < 0.12 * Math.max(...q) });
  }
  const ls = comps.filter((c) => c.fill > 0.25 && c.fill < 0.62 && c.aspect > 0.6 && c.aspect < 1.67 && c.emptyQuarter)
    .sort((a, b) => b.area - a.area).slice(0, 10);
  if (ls.length < 4) throw new Error(`hand sheet: found ${ls.length} of the 4 corner marks; photograph the whole sheet, flat and lit, all four black corners in the picture`);
  let best = null;
  for (let a = 0; a < ls.length; a++) for (let b = a + 1; b < ls.length; b++) for (let c = b + 1; c < ls.length; c++) for (let d = c + 1; d < ls.length; d++) {
    const four = [ls[a], ls[b], ls[c], ls[d]], areas = four.map((m) => m.area);
    if (Math.max(...areas) > 3 * Math.min(...areas)) continue;
    const q = around(four), A = Math.abs(shoelace(q.map((m) => m.c)));
    if (!best || A > best.A) best = { A, q };
  }
  if (!best) throw new Error('hand sheet: no four corner marks of one size; photograph the whole sheet, flat and lit');
  const q = best.q, meanL = q.reduce((t, m) => t + m.area, 0) / 4;
  const key = comps.find((c) => c.fill > 0.7 && c.aspect > 0.6 && c.aspect < 1.67 && c.area > 0.08 * meanL && c.area < 0.6 * meanL
    && q.some((m) => inBox(c.c, m.box, Math.max(m.bw, m.bh) * 0.1)));
  let k = key ? q.findIndex((m) => inBox(key.c, m.box, Math.max(m.bw, m.bh) * 0.1)) : -1;
  if (k < 0) k = q.reduce((bi, m, i) => (m.c[0] + m.c[1] < q[bi].c[0] + q[bi].c[1] ? i : bi), 0);   // no key: assume upright
  const ordered = [...q.slice(k), ...q.slice(0, k)];
  return ordered.map((m) => [(m.c[0] + 0.5) * f - 0.5, (m.c[1] + 0.5) * f - 0.5]);
}

const inBox = ([x, y], [x0, y0, x1, y1], pad) => x >= x0 - pad && x <= x1 + pad && y >= y0 - pad && y <= y1 + pad;
// Components sorted clockwise on screen (y down) round their middle.
function around(ms) {
  const cx = ms.reduce((s, m) => s + m.c[0], 0) / ms.length, cy = ms.reduce((s, m) => s + m.c[1], 0) / ms.length;
  return [...ms].sort((a, b) => Math.atan2(a.c[1] - cy, a.c[0] - cx) - Math.atan2(b.c[1] - cy, b.c[0] - cx));
}
function shoelace(p) {
  let s = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return s / 2;
}

// The page a photo is of, from its code: each square's ink against the paper round it. at: frameMap()'s.
export function readPage(img, at) {
  const S = 4, strip = sample(img, at, (x, y) => [x, y], [CODE.x - 3, CODE.y - 3, CODE.bits * CODE.step + 4, CODE.side + 6], S);
  const paper = Float32Array.from(strip.data).sort()[Math.floor(strip.data.length * 0.9)];
  let index = 0;
  for (let k = 0; k < CODE.bits; k++) {
    const x = CODE.x + k * CODE.step + 1, cell = sample(img, at, (fx, fy) => [fx, fy], [x, CODE.y + 1, CODE.side - 2, CODE.side - 2], S);
    if (cell.data.reduce((t, v) => t + v, 0) / cell.data.length < 0.55 * paper) index |= 1 << k;
  }
  const name = Object.keys(PAGES).find((p) => PAGES[p].index === index);
  if (!name) throw new Error(`hand sheet: the page code reads ${index}, which is no page (${Object.keys(PAGES).join(', ')}); photograph the whole sheet`);
  return name;
}

// The frame (mm) -> photo (px) map from the four marks.
export function frameMap(img) {
  const marks = findMarks(img);
  return { marks, at: homography(markCentroids(), marks) };
}

// A raster of the photo over a rectangle of a box or cell: w x h pixels at ppu pixels per em unit, where
// toFrame(ex, ey) gives frame mm for em coordinates and the raster starts at em (ex0, ey0). Bilinear.
export function sample(img, at, toFrame, [ex0, ey0, ew, eh], ppu = PPU) {
  const w = Math.round(ew * ppu), h = Math.round(eh * ppu), out = new Float32Array(w * h), { data, w: W, h: H } = img;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const [fx, fy] = toFrame(ex0 + (i + 0.5) / ppu, ey0 + (j + 0.5) / ppu), [u, v] = at(fx, fy);
    const x = Math.min(W - 1.001, Math.max(0, u)), y = Math.min(H - 1.001, Math.max(0, v)), x0 = Math.floor(x), y0 = Math.floor(y), dx = x - x0, dy = y - y0, k = y0 * W + x0;
    out[j * w + i] = (data[k] * (1 - dx) + data[k + 1] * dx) * (1 - dy) + (data[k + W] * (1 - dx) + data[k + W + 1] * dx) * dy;
  }
  return { data: out, w, h };
}

// Ink of a sampled raster: darker than `ratio` of its own paper (the 90th percentile), specks dropped.
export function inkOf({ data, w, h }, { ratio = 0.6, speck = 3 * PPU * PPU } = {}) {
  const sorted = Float32Array.from(data).sort(), paper = sorted[Math.floor(sorted.length * 0.9)], thr = paper * ratio;
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i++) ink[i] = data[i] < thr ? 1 : 0;
  for (const c of components(ink, w, h)) if (c.area < speck) for (const i of c.px) ink[i] = 0;
  return ink;
}

const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

// The skeleton of an ink raster with its pen width in pixels (2 x the median distance to paper - 1).
function skeletonOf(ink, w, h) {
  const dt = distanceTransform(ink, w, h), raw = zhangSuen(ink, w, h), ds = [];
  for (let i = 0; i < raw.length; i++) if (raw[i]) ds.push(dt[i]);
  const pen = Math.max(1, 2 * median(ds) - 1);
  return { dt, sk: prune(raw, w, h, Math.max(2, Math.round(pen))), pen };
}

// ---------- glyphs ----------

// One glyph box's raster (sampled over the box's em rectangle) -> { w, s } in the 100-unit em, or null when
// the box is empty. Strokes longest first, each starting at its upper end (then its left); a loop starts at
// its top and closes; dots come back as small circles; the glyph is centred in an advance 6 units wider than
// its ink (16 at least). rect is the em rectangle the raster covers.
export function traceGlyph(raster, rect, { ppu = PPU, ratio } = {}) {
  const { w, h } = raster, ink = inkOf(raster, { ratio });
  let n = 0;
  for (const v of ink) n += v;
  if (n < 12 * ppu * ppu) return null;
  const { dt, sk, pen } = skeletonOf(ink, w, h);
  const em = ([x, y]) => [rect[0] + (x + 0.5) / ppu, rect[1] + (y + 0.5) / ppu];
  // Dots: ink pieces no bigger than a couple of pen widths.
  const dots = [];
  for (const c of components(ink, w, h)) {
    const size = Math.max(c.box[2] - c.box[0], c.box[3] - c.box[1]) + 1;
    if (size > 2.4 * pen + 2) continue;
    let sx = 0, sy = 0;
    for (const i of c.px) { sx += i % w; sy += Math.floor(i / w); sk[i] = 0; }
    dots.push({ c: em([sx / c.area, sy / c.area]), r: Math.max(0.8, (size / ppu - pen / ppu) / 2) });
  }
  const strokes = traceSkeleton(sk, w, h, { dt, minLen: Math.max(3, pen) }).map((s) => {
    let pts = s.pts.map(em);
    if (s.closed) {
      const top = pts.reduce((bi, p, i) => (p[1] < pts[bi][1] ? i : bi), 0);
      pts = [...pts.slice(top), ...pts.slice(0, top)];
      pts.push(pts[0]);
    } else {
      const a = pts[0], b = pts.at(-1);
      if (b[1] + 0.35 * b[0] < a[1] + 0.35 * a[0]) pts.reverse();
    }
    return simplify(pts, 0.5);
  });
  for (const d of dots) {
    const pts = [];
    for (let k = 0; k <= 12; k++) pts.push([d.c[0] + d.r * Math.cos(k * Math.PI / 6), d.c[1] + d.r * Math.sin(k * Math.PI / 6)]);
    strokes.push(pts);
  }
  if (!strokes.length) return null;
  let x0 = Infinity, x1 = -Infinity;
  for (const s of strokes) for (const [x] of s) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
  const adv = Math.max(16, Math.round(x1 - x0 + 6)), dx = (adv - (x1 - x0)) / 2 - x0;
  return { w: adv, s: strokes.map((s) => s.flatMap(([x, y]) => [r1(x + dx), r1(y)])), pen: r1(pen / ppu), dx };
}

// ---------- the pen profile ----------

// Least-squares line y = a + b x through points; perpendicular residuals.
function fitLine(pts) {
  const n = pts.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1), a = (sy - b * sx) / n, k = Math.sqrt(1 + b * b);
  return { a, b, d: ([x, y]) => (y - a - b * x) / k };
}

// Calibration, measured on sheets core/tools.js's own pen drew (letterSheet in cli/hand.mjs, six seeds a value):
// QUANT is the skeleton's own position noise in pixels (lines drawn with no wobble read 0); the reading of wobble
// and of hook comes back 0.85 of the pen's, across 0..4 and 0..1.2 (the pixel skeleton rounds both off).
const QUANT = 0.35, WOBBLE = Math.sqrt(18) / 0.85, HOOK = 1 / 0.85;

// The lines: [{ rms, widths: [at 0.1, 0.5, 0.9], hook, highs }] in pixels, one per line found.
function measureLines(raster, ppu) {
  const { w, h } = raster, ink = inkOf(raster), { dt, sk, pen } = skeletonOf(ink, w, h), out = [];
  for (const ly of LINES_Y) {
    const band = new Uint8Array(w * h), y0 = (ly - 20) * ppu, y1 = (ly + 20) * ppu;
    for (let i = 0; i < sk.length; i++) { const y = Math.floor(i / w); if (sk[i] && y >= y0 && y < y1) band[i] = 1; }
    const s = traceSkeleton(band, w, h, { dt, minLen: 40 * ppu })[0];
    if (!s) continue;
    const pts = [...s.pts].sort((p, q) => p[0] - q[0]), xa = pts[0][0], xb = pts.at(-1)[0], L = xb - xa;
    const mid = pts.filter(([x]) => x >= xa + 0.1 * L && x <= xb - 0.1 * L), fit = fitLine(mid);
    const res = mid.map(fit.d), rms = Math.sqrt(res.reduce((t, v) => t + v * v, 0) / res.length);
    const widthAt = (u) => {
      const ws = pts.filter(([x]) => Math.abs(x - (xa + u * L)) <= 0.05 * L).map(([x, y]) => 2 * dt[y * w + x] - 1);
      return ws.length ? ws.reduce((t, v) => t + v, 0) / ws.length : 0;
    };
    const widths = [widthAt(0.1), widthAt(0.5), widthAt(0.9)];
    // The ink's reach off the line within a pen width of each end, less the half-width there: the hook
    // curls the start (the left end, lines are drawn left to right) past it; the right end is the noise floor.
    const reach = (x0, x1, half) => {
      let m = 0;
      for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, y1); y++) for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(w - 1, x1); x++) {
        if (ink[y * w + x]) m = Math.max(m, Math.abs(fit.d([x, y])));
      }
      return m - half;
    };
    const hook = reach(xa - pen, xa + pen, widths[0] / 2) - reach(xb - pen, xb + pen, widths[2] / 2);
    // The high-frequency residual: each residual less the mean of its neighbours within a pen width either side.
    const k = Math.max(2, Math.round(pen)), highs = [];
    for (let i = k; i < res.length - k; i++) { let m = 0; for (let j = i - k; j <= i + k; j++) m += res[j]; highs.push(res[i] - m / (2 * k + 1)); }
    out.push({ rms, widths, hook, highs });
  }
  return { lines: out, pen };
}

// The square: its four sides fitted, the corners where they meet, how far each corner's ink runs past it
// (overshoot, as a fraction of the side) and how far the skeleton stays off it (rounding).
function measureSquare(raster, ppu) {
  const { w, h } = raster, ink = inkOf(raster), { sk, pen } = skeletonOf(ink, w, h);
  const [qx, qy, S] = SQUARE.map((v) => v * ppu), pts = [];
  for (let i = 0; i < sk.length; i++) if (sk[i]) pts.push([i % w, Math.floor(i / w)]);
  if (pts.length < 40) return null;
  const band = 14 * ppu, sides = [];
  // top, right, bottom, left: horizontal sides fitted as y(x), vertical ones as x(y) (swapped and back).
  for (const [horiz, at] of [[true, qy], [false, qx + S], [true, qy + S], [false, qx]]) {
    const near = pts.filter(([x, y]) => (horiz ? Math.abs(y - at) < band && x > qx + 0.2 * S && x < qx + 0.8 * S : Math.abs(x - at) < band && y > qy + 0.2 * S && y < qy + 0.8 * S));
    if (near.length < 10) return null;
    const f = fitLine(horiz ? near : near.map(([x, y]) => [y, x]));
    sides.push({ horiz, a: f.a, b: f.b });
  }
  // Corner of a horizontal side (y = a + b x) and a vertical one (x = a' + b' y).
  const meet = (H, V) => { const y = (H.a + H.b * V.a) / (1 - H.b * V.b); return [V.a + V.b * y, y]; };
  const corners = [meet(sides[0], sides[3]), meet(sides[0], sides[1]), meet(sides[2], sides[1]), meet(sides[2], sides[3])];
  const side = corners.reduce((t, c, i) => t + Math.hypot(c[0] - corners[(i + 1) % 4][0], c[1] - corners[(i + 1) % 4][1]), 0) / 4;
  const inside = ([x, y], pad) => {                           // inside the fitted square grown by pad
    for (let i = 0; i < 4; i++) {
      const [ax, ay] = corners[i], [bx, by] = corners[(i + 1) % 4], l = Math.hypot(bx - ax, by - ay);
      if (((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / l < -pad) return false;   // clockwise on screen: inside is right of each edge
    }
    return true;
  };
  const nb = degrees(sk, w, h), runs = corners.map(() => []);
  for (let i = 0; i < sk.length; i++) {
    if (!sk[i] || nb[i] !== 1) continue;
    const p = [i % w, Math.floor(i / w)];
    if (inside(p, pen)) continue;
    const d = corners.map((c) => Math.hypot(p[0] - c[0], p[1] - c[1])), k = d.indexOf(Math.min(...d));
    if (d[k] < 0.45 * side) runs[k].push(d[k]);
  }
  const over = corners.map((_, k) => (runs[k].length ? runs[k].reduce((t, v) => t + v, 0) / runs[k].length : 0));
  const off = corners.map((c) => Math.min(...pts.map(([x, y]) => Math.hypot(x - c[0], y - c[1]))));
  return { side, overshoot: median(over) / side, rounding: median(off) / (Math.SQRT2 - 1) / side, pen };
}

// The stroke profile from the pen row's rasters ({ line, square }, each sampled over its cell at ppu):
// { wobble, overshoot, hook, pressure, tremor, rounding } as core/tools.js reads them, plus pen, the pen's
// width in em units, and found, what each value was measured from. wobble is the vertex jitter that would
// leave lines this far off straight (RMS x sqrt 18: uniform jitter, interpolated between vertices); hook the
// curl radius, in 1.5 pen widths, that the ink at a line's start reaches off it beyond its end's.
export function fitProfile(rasters, ppu = PPU) {
  const out = { found: [] }, L = rasters.line ? measureLines(rasters.line, ppu) : { lines: [] };
  if (L.lines.length) {
    const lines = L.lines, n = lines.length;
    const rms = Math.sqrt(lines.reduce((t, l) => t + l.rms * l.rms, 0) / n);
    const wid = [0, 1, 2].map((j) => lines.reduce((t, l) => t + l.widths[j], 0) / n), top = Math.max(...wid);
    const highs = lines.flatMap((l) => l.highs);
    Object.assign(out, {
      wobble: r2(Math.sqrt(Math.max(0, rms * rms - QUANT * QUANT)) / ppu * WOBBLE),
      hook: r2(Math.max(0, median(lines.map((l) => l.hook))) / (1.5 * top) * HOOK),
      pressure: wid.map((v) => r2(v / top)),
      tremor: r2(Math.sqrt(Math.max(0, highs.reduce((t, v) => t + v * v, 0) / (highs.length || 1) - QUANT * QUANT / 2)) / ppu),
      pen: r1(top / ppu),
    });
    out.found.push(`${n} line${n > 1 ? 's' : ''}`);
  }
  const sq = rasters.square ? measureSquare(rasters.square, ppu) : null;
  if (sq) {
    Object.assign(out, { overshoot: r2(sq.overshoot), rounding: r2(sq.rounding) });
    out.found.push('the square');
  }
  return out;
}

// ---------- the whole sheet ----------

// A photo of a hand sheet page -> { page, glyphs, missing, profile, marks, at, traced }. img: { data, w, h }
// luminance 0..1. page: which page it is, read off its code unless given; glyphs: { ch: { w, s } } for every box
// with writing in it; missing: the characters left blank (the house draws them); profile: fitProfile()'s ({ found:
// [] } on a page with no pen row); traced: { ch: strokes in frame mm } for a check image.
export function readSheet(img, { ppu = PPU, ratio, page } = {}) {
  const { marks, at } = frameMap(img), glyphs = {}, missing = [], traced = {};
  page ??= readPage(img, at);
  const rect = [3, -BOX.base + 3, BOX.w - 6, BOX.h - 6];      // the box less a margin round its border
  for (const b of glyphBoxes(page)) {
    const g = traceGlyph(sample(img, at, (ex, ey) => emToFrame(b, ex, ey), rect, ppu), rect, { ppu, ratio });
    if (!g) { missing.push(b.ch); continue; }
    glyphs[b.ch] = { w: g.w, s: g.s };
    traced[b.ch] = g.s.map((s) => { const out = []; for (let i = 0; i < s.length; i += 2) out.push(emToFrame(b, s[i] - g.dx, s[i + 1])); return out; });
  }
  const rasters = {};
  for (const c of PAGES[page].pen ? SHAPES : []) if (c.name === 'line' || c.name === 'square') rasters[c.name] = sample(img, at, (ex, ey) => cellToFrame(c, ex, ey), [0, 0, c.w / UNIT, ROW.h], ppu);
  return { page, glyphs, missing, profile: fitProfile(rasters, ppu), marks, at, traced };
}
