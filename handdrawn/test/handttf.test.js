// 4.0 D3: a hand as a font. hdf hand --export-ttf sweeps a hand's centre lines by its pen into TrueType outlines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { FontLibrary } from 'skia-canvas';
import { readCatalogue } from '../core/assets.js';
import { MARKS, asHand, glyph, houseHand } from '../core/glyphs.js';
import { TTF_PEN, handChars, handFont, handTtf, strokeContours, sweep } from '../core/handttf.js';
import { hash32, rng } from '../core/rand.js';
import { hook, overshoot, pressureAt } from '../core/tools.js';
import { ttfBytes, ttfContours, ttfGlyphId, ttfTables } from '../core/ttf.js';
import { skiaCanvas } from '../cli/skia.mjs';

const hdf = (...argv) => {
  const r = spawnSync(process.execPath, ['cli/hdf.mjs', ...argv], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
};
const TEST = (() => { const st = readCatalogue(); return { ...st.json('test'), name: 'test' }; })();
const area = (c) => { let s = 0; for (let i = 0; i < c.length; i++) { const [x0, y0] = c[i], [x1, y1] = c[(i + 1) % c.length]; s += x0 * y1 - x1 * y0; } return s / 2; };

test('compose: a base and marks moved into place are the parts the glyph is drawn from', () => {
  for (const ch of ['ă', 'Ș', 'ñ', 'í', 'Å']) {
    const g = glyph(ch, houseHand()), base = glyph(g.parts[0].ch, houseHand());
    // The base's strokes, then each mark's strokes at kx x + x, ky y + y: the glyph's strokes exactly.
    const rebuilt = [...base.s];
    for (const m of g.parts.slice(1)) for (const pts of MARKS[m.mark].s) rebuilt.push(pts.map((v, i) => (i % 2 ? m.ky * v + m.y : m.kx * v + m.x)));
    assert.equal(rebuilt.length, g.s.length, ch);
    rebuilt.forEach((pts, i) => pts.forEach((v, j) => assert.ok(Math.abs(v - g.s[i][j]) < 1e-9, `${ch} stroke ${i}`)));
  }
  assert.equal(glyph('í', houseHand()).parts[0].ch, 'ı');       // an i under an acute loses its dot
  assert.equal(glyph('æ', houseHand()).parts, undefined);        // two bases side by side: outlines
  assert.equal(glyph('a', houseHand()).parts, undefined);
});

test('sweep: every piece wound clockwise (y up), caps at the ends, a round join only where the line turns', () => {
  const straight = sweep([[0, 0], [100, 0], [200, 2]], () => 20);
  assert.ok(straight.every((c) => area(c) < 0));
  const onCurve = (c) => c.filter((p) => p[2]).length;
  assert.equal(straight.filter((c) => c.length === 16).length, 2);           // two round caps, the bend a wedge
  const corner = sweep([[0, 0], [100, 0], [100, 100]], () => 20);
  assert.equal(corner.filter((c) => c.length === 16).length, 3);             // the corner is round
  assert.ok(corner.every((c) => area(c) < 0 && onCurve(c) >= 3));
  assert.equal(sweep([[5, 5]], () => 10).length, 1);                          // a dot
  // A pen that swells: each step as wide as the pressure at its middle (u 0.25 and 0.75), a join as the wider.
  const swell = sweep([[0, 0], [100, 0], [100, 100]], (u) => 10 + 20 * u), [along, up] = swell.filter((c) => c.length === 4);
  assert.ok(along.every((q) => Math.abs(Math.abs(q[1]) - 15) < 1e-9));
  assert.ok(up.every((q) => Math.abs(Math.abs(q[0] - 100) - 25) < 1e-9));
  const corner2 = swell.filter((c) => c.length === 16).find((c) => c.some((q) => q[2] && Math.abs(q[0] - 125) < 1e-9 && Math.abs(q[1]) < 1e-9));
  assert.ok(corner2);
});

test('the font: tables and checksums hold, cmap finds each character, composed glyphs are composites', () => {
  const buf = handTtf(TEST), { tables, ok } = ttfTables(buf);
  assert.ok(ok);
  assert.deepEqual(Object.keys(tables), ['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name', 'post']);
  assert.ok(ttfContours(buf, ttfGlyphId(buf, 0x61)) > 2);            // a: two strokes, swept into many pieces
  assert.equal(ttfContours(buf, ttfGlyphId(buf, 0x103)), -1);         // ă: a and its breve
  assert.equal(ttfContours(buf, ttfGlyphId(buf, 0x20)), 0);           // the space is an advance
  assert.equal(ttfGlyphId(buf, 0x416), 0);                            // Ж: the hand has none (it letters as ?)
  assert.equal(buf.readUInt16BE(tables.head.off + 18), 1000);         // unitsPerEm
  // A function of the hand: the same bytes twice; another hand, other bytes.
  assert.ok(buf.equals(handTtf(TEST)));
  assert.ok(!buf.equals(handTtf(houseHand())));
  const flat = handFont(TEST, { composites: false });
  assert.equal(flat.composites, 0);
  assert.equal(flat.marks, 0);
  const fb = ttfBytes(flat.font);
  assert.ok(ttfContours(fb, ttfGlyphId(fb, 0x103)) > 0);
  // Every character the hand letters, and no others.
  const H = asHand(TEST), chars = handChars(H);
  assert.ok(chars.includes('a') && chars.includes('ș') && chars.includes('€') === !glyph('€', H).none);
  assert.ok(chars.every((c) => !glyph(c, H).none));
});

// The ink of a line set in the font by skia against the same line penned the way handText's pen would (slanted,
// overshot, hooked, round caps and joins, the pen's width), with no wobble: the same shapes, pixel for pixel
// but for the simplification and the rounding to font units.
function overlap(rec, text, { size = 300, composites = true } = {}) {
  const buf = handTtf(rec, { composites }), H = asHand(rec), file = join(mkdtempSync(join(tmpdir(), 'hdf-ttf-')), 'h.ttf');
  writeFileSync(file, buf);
  const alias = `hdf-ttf-test-${hash32(rec.name ?? 'house', size, composites ? 1 : 0)}`;
  FontLibrary.use(alias, [file]);
  const W = Math.ceil(text.length * size), Hh = Math.ceil(size * 1.6), base = size * 1.1, k = size / 100;
  const a = skiaCanvas(W, Hh), ga = a.getContext('2d');
  ga.fillStyle = '#fff'; ga.fillRect(0, 0, W, Hh); ga.fillStyle = '#000'; ga.font = `${size}px "${alias}"`; ga.fillText(text, 10, base);
  const b = skiaCanvas(W, Hh), gb = b.getContext('2d');
  gb.fillStyle = '#fff'; gb.fillRect(0, 0, W, Hh); gb.strokeStyle = '#000'; gb.lineCap = 'round'; gb.lineJoin = 'round'; gb.lineWidth = TTF_PEN * k;
  const sl = H.slant ? Math.tan(H.slant * Math.PI / 180) : 0;
  let x = 10;
  for (const ch of text) {
    const g = glyph(ch, H);
    g.s.forEach((flat, si) => {
      const pts = [];
      for (let i = 0; i < flat.length; i += 2) pts.push(flat[i] - flat[i + 1] * sl, flat[i + 1]);
      for (const s of hook(overshoot([{ pts, closed: false }], H.stroke.overshoot, TTF_PEN), H.stroke.hook, TTF_PEN, rng(hash32('ttf', H.name, ch, si)))) {
        // a segment at a time, as wide as the pressure at its middle (tools.js pressed)
        const p = s.pts, n = p.length / 2, seg = (i) => Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]);
        let L = 0, at = 0;
        for (let i = 1; i < n; i++) L += seg(i);
        if (n < 2 || !L) { gb.lineWidth = TTF_PEN * k; gb.beginPath(); gb.moveTo(x + p[0] * k, base + p[1] * k); gb.lineTo(x + p[0] * k + 0.01, base + p[1] * k); gb.stroke(); continue; }
        for (let i = 1; i < n; i++) {
          const d = seg(i);
          gb.lineWidth = TTF_PEN * k * pressureAt(H.stroke.pressure, (at + d / 2) / L);
          gb.beginPath(); gb.moveTo(x + p[2 * i - 2] * k, base + p[2 * i - 1] * k); gb.lineTo(x + p[2 * i] * k, base + p[2 * i + 1] * k); gb.stroke();
          at += d;
        }
      }
    });
    x += Math.round((g.w * g.k + H.track) * 10) / 10 * k;
  }
  const da = ga.getImageData(0, 0, W, Hh).data, db = gb.getImageData(0, 0, W, Hh).data;
  if (process.env.HDF_TTF_DEBUG) { a.toFileSync?.(`out/iou-${rec.name ?? 'house'}-font.png`); b.toFileSync?.(`out/iou-${rec.name ?? 'house'}-pen.png`); }
  let both = 0, either = 0;
  for (let i = 0; i < da.length; i += 4) { const p = da[i] < 128, q = db[i] < 128; if (p && q) both++; if (p || q) either++; }
  return both / either;
}

test('it reads as the same hand: the font\'s ink is the pen line\'s (intersection over union)', () => {
  // The house pen is even and unhooked: the outlines are the pen line to the pixel, composites and all. The test
  // hand presses (the font's width runs vertex to vertex, the pen's steps segment by segment) and hooks each entry
  // to a seeded side (a composite's mark is seeded once for every letter it sits on, so its accents are checked
  // as outlines, seeded per letter as the pen line here is).
  const cases = [[houseHand(), 'The quick brown fox', 0.98], [houseHand(), 'ăîșț ÑØ Åé', 0.98, true],
    [TEST, 'Hamburgefonstiv 0123', 0.9], [TEST, 'ăîșț ÑØ Åé', 0.9, false]];
  for (const [rec, text, min, composites = true] of cases) {
    const iou = overlap(rec, text, { composites });
    assert.ok(iou > min, `${rec.name}: '${text}' overlaps ${iou.toFixed(3)}`);
  }
});

test('hdf hand --export-ttf: the font and its proof, by hand id; an unknown hand is a usage error', () => {
  const out = mkdtempSync(join(tmpdir(), 'hdf-ttf-cli-'));
  try {
    const r = hdf('hand', '--export-ttf', 'test', '--out', out, '--family', 'Test Hand');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /test\.ttf {2}Test Hand: \d+ characters \(\d+ outlines, \d+ composites of 14 marks\), \d+ KB/);
    assert.ok(ttfTables(readFileSync(join(out, 'test.ttf'))).ok);
    assert.ok(existsSync(join(out, 'test-ttf.png')));
    const bad = hdf('hand', '--export-ttf', 'nobody', '--out', out);
    assert.equal(bad.code, 2);
    assert.match(bad.out, /no hand 'nobody' in the store/);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('strokeContours: a slanted hand leans its outlines', () => {
  const upright = strokeContours([[0, 0, 0, -72]], asHand({ ...TEST, slant: 0 })).flat();
  const leaning = strokeContours([[0, 0, 0, -72]], asHand({ ...TEST, name: 'lean', slant: 10 })).flat();
  const top = (cs) => Math.max(...cs.filter((p) => p[1] > 600).map((p) => p[0]));
  assert.ok(top(leaning) - top(upright) > 100);   // 720 units up, tan 10 degrees: about 127 units right
});
