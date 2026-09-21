// S12: your hand from a photographed sheet -- the template, the skeleton, reading a sheet back, the pen profile.
// The sheet is filled in by the package itself (letterSheet: every box lettered in the test hand, the pen row
// drawn with its pen), then "photographed": warped in perspective onto a dark table, lit unevenly, grained.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asHand, glyph } from '../core/glyphs.js';
import {
  BOX, CHARS, FRAME, UNIT, emToFrame, findMarks, fitProfile, frameOrigin, glyphBoxes, homography, markCentroids, PAPERS, readSheet, sample,
  SHAPES, cellToFrame, ROW,
} from '../core/handsheet.js';
import { components, distanceTransform, prune, traceSkeleton, zhangSuen } from '../core/skeleton.js';
import { walk } from '../core/list.js';
import { handOf, resolveLook } from '../core/looks.js';
import { register } from '../core/store.js';
import { rng } from '../core/rand.js';
import { handText } from '../core/text.js';
import { handFromSheet, letterSheet, lumOf, synthHand, templatePdf } from '../cli/hand.mjs';
import { skiaCanvas } from '../cli/skia.mjs';

const TEST = synthHand('test');

// A mask from a canvas drawing: ink where the drawing is dark.
function maskOf(w, h, draw) {
  const c = skiaCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.strokeStyle = '#000'; g.fillStyle = '#000';
  draw(g);
  const d = g.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = d[4 * i] < 128 ? 1 : 0;
  return m;
}

test('skeleton: a thick line thins to one pixel along its middle; an x traces as its two bars; a ring as a loop', () => {
  const w = 120, h = 80;
  const bar = maskOf(w, h, (g) => { g.lineWidth = 9; g.beginPath(); g.moveTo(10, 40); g.lineTo(110, 40); g.stroke(); });
  const sk = zhangSuen(bar, w, h), dt = distanceTransform(bar, w, h);
  let n = 0;
  for (let x = 20; x < 100; x++) { let col = 0; for (let y = 0; y < h; y++) if (sk[y * w + x]) { col++; assert.ok(Math.abs(y - 39.5) <= 1, `x ${x}: y ${y}`); } n += col; assert.equal(col, 1); }
  const [s] = traceSkeleton(sk, w, h, { dt });
  assert.ok(Math.abs(s.w - 9) <= 1, `pen width ${s.w}`);
  assert.ok(s.len > 85, `length ${s.len}`);
  assert.equal(dt[40 * w + 60] >= 4.5 && dt[40 * w + 60] <= 5.5, true);

  const x = maskOf(w, h, (g) => { g.lineWidth = 5; g.beginPath(); g.moveTo(20, 10); g.lineTo(100, 70); g.moveTo(100, 10); g.lineTo(20, 70); g.stroke(); });
  const xs = prune(zhangSuen(x, w, h), w, h, 5), bars = traceSkeleton(xs, w, h, { minLen: 10 });
  assert.equal(bars.length, 2, 'the crossing is joined straight through');
  for (const b of bars) assert.ok(b.len > 85, `bar ${b.len}`);

  const ring = maskOf(w, h, (g) => { g.lineWidth = 4; g.beginPath(); g.arc(60, 40, 25, 0, Math.PI * 2); g.stroke(); });
  const [loop] = traceSkeleton(zhangSuen(ring, w, h), w, h);
  assert.equal(loop.closed, true);
  assert.ok(Math.abs(loop.len - 2 * Math.PI * 25) < 12, `circumference ${loop.len}`);
  assert.equal(components(ring, w, h).length, 1);
});

test('template: a PDF for A4 and letter; 62 boxes in em units, four marks, the pen row inside the frame', async () => {
  for (const paper of Object.keys(PAPERS)) {
    const pdf = await templatePdf(paper);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    const [ox, oy] = frameOrigin(paper);
    assert.ok(ox >= 14 && oy >= 14, `${paper}: margins ${ox}, ${oy}`);
  }
  const boxes = glyphBoxes();
  assert.equal(boxes.length, 62);
  assert.deepEqual(boxes.map((b) => b.ch), CHARS);
  for (const b of boxes) {
    assert.ok(b.x >= 0 && b.x + b.w <= FRAME[0] && b.y > MARKS_BOTTOM && b.y + b.h < ROW.y, b.ch);
    assert.equal(glyph(b.ch).own, true);
  }
  assert.deepEqual(emToFrame(boxes[0], 0, 0), [0, 18 + BOX.base * UNIT]);
  for (const c of SHAPES) assert.ok(c.x >= 0 && c.x + c.w <= FRAME[0] && ROW.y + ROW.h * UNIT < FRAME[1] - 12, c.name);
  assert.equal(markCentroids().length, 4);
});
const MARKS_BOTTOM = 12;

// The sheet filled in by a hand and photographed: warped onto a W x H picture (the page's corners at quad,
// clockwise from its top left), a table round it, light falling off to one side, grain.
function photograph(sheet, quad, { W = 2200, H = 3000, seed = 7 } = {}) {
  const { data, w, h } = sheet, back = homography(quad, [[0, 0], [w, 0], [w, h], [0, h]]), r = rng(seed), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [u, v] = back(x + 0.5, y + 0.5), light = 0.72 + 0.26 * x / W - 0.08 * y / H, noise = (r() - 0.5) * 0.04;
    if (u < 0 || v < 0 || u >= w - 1 || v >= h - 1) { out[y * W + x] = 0.22 + 0.1 * y / H + noise; continue; }
    const x0 = Math.floor(u), y0 = Math.floor(v), dx = u - x0, dy = v - y0, k = y0 * w + x0;
    const s = (data[k] * (1 - dx) + data[k + 1] * dx) * (1 - dy) + (data[k + w] * (1 - dx) + data[k + w + 1] * dx) * dy;
    out[y * W + x] = Math.min(1, Math.max(0, s * light + noise));
  }
  return { data: out, w: W, h: H };
}

let lettered;
const sheetOf = () => {
  if (!lettered) { const c = letterSheet(TEST); lettered = lumOf(c.getContext('2d').getImageData(0, 0, c.width, c.height).data, c.width, c.height); }
  return lettered;
};
// Keystoned and turned about 3 degrees; and the same page photographed sideways (its top at the right).
const UPRIGHT = [[260, 210], [1930, 300], [2010, 2760], [170, 2830]];
const SIDEWAYS = [[1990, 170], [2100, 2830], [150, 2770], [260, 240]].map(([x, y]) => [x * 1.36, y * 0.73]);

test('marks: found in a keystoned photo on a dark table, and in one taken sideways, top left first', () => {
  const sheet = sheetOf(), [ox, oy] = frameOrigin('a4'), k = sheet.w / PAPERS.a4[0];
  for (const [quad, size] of [[UPRIGHT, {}], [SIDEWAYS, { W: 3000, H: 2200 }]]) {
    const photo = photograph(sheet, quad, size), marks = findMarks(photo);
    const page = homography([[0, 0], [sheet.w, 0], [sheet.w, sheet.h], [0, sheet.h]], quad);
    markCentroids().forEach(([fx, fy], i) => {
      const [x, y] = page((ox + fx) * k, (oy + fy) * k);
      assert.ok(Math.hypot(marks[i][0] - x, marks[i][1] - y) < 3, `mark ${i}: found ${marks[i].map(Math.round)}, is at ${[x, y].map(Math.round)}`);
    });
  }
  assert.throws(() => findMarks({ data: new Float32Array(400 * 400).fill(0.9), w: 400, h: 400 }), /found 0 of the 4 corner marks/);
});

// Every glyph's trace against the strokes handText drew it with: mean distance each way, in em units.
function fidelity(read) {
  const [ox, oy] = frameOrigin('a4'), out = {};
  const near = (p, polys) => {
    let best = Infinity;
    for (const q of polys) for (let i = 1; i < q.length; i++) {
      const [ax, ay] = q[i - 1], [bx, by] = q[i], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L));
      best = Math.min(best, Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy));
    }
    return best;
  };
  const mean = (pts, polys) => pts.reduce((s, p) => s + near(p, polys), 0) / pts.length;
  for (const b of glyphBoxes()) {
    const [x, y] = emToFrame(b, 12, 0), src = [];
    walk([handText(b.ch, ox + x, oy + y, { size: 100 * UNIT, hand: asHand(TEST), ink2: null })], (op) => {
      if (op.op !== 'stroke') return;
      const p = op.path.sub[0].pts, q = [];
      for (let i = 0; i < p.length; i += 2) q.push([p[i] - ox, p[i + 1] - oy]);
      src.push(q);
    });
    const got = read.traced[b.ch];
    if (!got) continue;
    const pts = (polys) => polys.flatMap((q) => q.flatMap((b, i) => {       // every 1 em unit along each stroke
      if (!i) return [b];
      const a = q[i - 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / UNIT));
      return Array.from({ length: n }, (_, k) => [a[0] + (b[0] - a[0]) * (k + 1) / n, a[1] + (b[1] - a[1]) * (k + 1) / n]);
    }));
    out[b.ch] = { there: mean(pts(got), src) / UNIT, back: mean(pts(src), got) / UNIT };
  }
  return out;
}

test('reading a photographed sheet: every glyph traces close to what was written, the profile close to the pen', () => {
  const read = readSheet(photograph(sheetOf(), UPRIGHT));
  assert.deepEqual(read.missing, []);
  assert.deepEqual(Object.keys(read.glyphs).sort(), [...CHARS].sort());
  const fit = fidelity(read);
  if (process.env.HDF_FIDELITY) console.log(Object.entries(fit).map(([c, f]) => `${c} ${f.there.toFixed(2)}/${f.back.toFixed(2)}`).join('  '));
  for (const [ch, { there, back }] of Object.entries(fit)) {
    // mean distance in em units, on a pen 4.5 wide; the most is the test hand's pen overshooting corners (w, L, N)
    assert.ok(there < 2 && back < 1.2, `${ch}: traced ${there.toFixed(2)} off the written strokes, written ${back.toFixed(2)} off the trace`);
  }
  for (const [ch, g] of Object.entries(read.glyphs)) {
    assert.ok(g.w >= 16 && g.w < 90, `${ch}: advance ${g.w}`);
    for (const s of g.s) for (let i = 1; i < s.length; i += 2) assert.ok(s[i] > -90 && s[i] < 36, `${ch}: y ${s[i]}`);
  }
  const p = read.profile, t = TEST.stroke;
  assert.deepEqual(p.found, ['3 lines', 'the square']);
  // Tolerances: wobble within 20%; overshoot within 0.03; pressure within 0.07 at each point; hook within
  // 0.2 -- the pen curls each entry through a random 60 to 120 degrees, so three lines pin it no closer.
  assert.ok(Math.abs(p.wobble - t.wobble) <= 0.2 * t.wobble, `wobble ${p.wobble} (pen ${t.wobble})`);
  assert.ok(Math.abs(p.overshoot - t.overshoot) <= 0.03, `overshoot ${p.overshoot} (pen ${t.overshoot})`);
  assert.ok(Math.abs(p.hook - t.hook) <= 0.2, `hook ${p.hook} (pen ${t.hook})`);
  p.pressure.forEach((v, i) => assert.ok(Math.abs(v - t.pressure[i]) <= 0.07, `pressure ${p.pressure} (pen ${t.pressure})`));
  // The pen draws no rounding and no tremor, so none comes back.
  assert.ok(p.rounding <= 0.03 && p.tremor <= 0.2, `rounding ${p.rounding}, tremor ${p.tremor}`);

  const rec = handFromSheet(read, 'scribe');
  const h = asHand(rec);
  assert.equal(h.stroke.speed, 1000, 'speed is not on a sheet: the house pen');
  assert.equal(h.stroke.wobble, p.wobble);
  assert.deepEqual(Object.keys(rec.stroke).sort(), ['hook', 'overshoot', 'pressure', 'rounding', 'tremor', 'wobble']);

  // The done-when: a look named with the traced hand letters in its glyphs and draws with its pen.
  register({ scribe: rec });
  const look = resolveLook('risoPop~hand:scribe'), H = handOf(look);
  assert.equal(H.name, 'scribe');
  assert.deepEqual(glyph('R', H).s, rec.glyphs.R.s);
  assert.equal(H.stroke.overshoot, p.overshoot);
  const lettered = handText('Riso', 0, 0, { size: 60, look }), strokes = [];
  walk([lettered], (op) => { if (op.op === 'stroke' && !op.name.endsWith('b')) strokes.push(op); });
  assert.equal(strokes.length, ['R', 'i', 's', 'o'].reduce((n, c) => n + rec.glyphs[c].s.length, 0));
});

test('reading: blank boxes are missing (the house stands in); a blank pen row fits nothing', () => {
  const c = letterSheet(TEST, { skip: ['Q', '7', 'g'] }), sheet = lumOf(c.getContext('2d').getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  const read = readSheet(sheet);
  assert.deepEqual(read.missing, ['g', 'Q', '7']);
  const h = asHand(handFromSheet(read, 'gappy'));
  assert.equal(glyph('Q', h).own, false);
  assert.equal(glyph('q', h).own, true);

  const blank = { data: new Float32Array(300 * 300).fill(0.95), w: 300, h: 300 };
  assert.deepEqual(fitProfile({ line: blank, square: blank }), { found: [] });
});

test('the profile: a square with rounded corners reads as rounding, and no overshoot', () => {
  const { at } = { at: (x, y) => [x * 10, y * 10] };   // a flat sheet at 10 px per mm
  const cell = SHAPES.find((c) => c.name === 'square');
  const img = (() => {
    const W = 1900, H = 2600, c = skiaCanvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#000'; g.lineWidth = 9;
    const [x0, y0] = cellToFrame(cell, 35, 30), s = 80 * UNIT * 10;
    g.beginPath(); g.roundRect(x0 * 10, y0 * 10, s, s, 20 * UNIT * 10); g.stroke();
    return lumOf(g.getImageData(0, 0, W, H).data, W, H);
  })();
  const p = fitProfile({ square: sample(img, at, (ex, ey) => cellToFrame(cell, ex, ey), [0, 0, cell.w / UNIT, ROW.h]) });
  assert.equal(p.overshoot, 0);
  assert.ok(Math.abs(p.rounding - 20 / 80) < 0.05, `rounding ${p.rounding} (corner radius 20 on a side of 80)`);
});
