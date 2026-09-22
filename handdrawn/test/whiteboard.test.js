// 4.0 L1: the whiteboard look (board stock, the bullet marker as its pen, the marker finish) and fx('erase').
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRenderer } from '../core/raster.js';
import { skiaCanvas } from '../cli/skia.mjs';
import { expand } from '../core/finish.js';
import { eraseTrack } from '../core/fx.js';
import { circle, fill, fx, paper, poly, stroke, walk } from '../core/list.js';
import { LOOKS, hashLook, resolveLook, resolveRole } from '../core/looks.js';
import { WORDS, lint } from '../core/lint.js';
import mini from '../films/mini.js';
import { cut, film, seq, shot } from '../core/tree.js';
import { frameRenderer } from '../cli/frames.mjs';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const R = createRenderer({ cacheMb: 0, dedup: false, makeCanvas: skiaCanvas });
const px = (list, look, W = 200, H = 200) => {
  const c = skiaCanvas(W, H);
  R.draw(c.getContext('2d'), list, { look, W, H });
  return c.toBufferSync('raw');
};
// Summed alpha of the pixels, in whole pixels: how much was drawn on a transparent canvas.
const ink = (buf) => { let a = 0; for (let i = 3; i < buf.length; i += 4) a += buf[i]; return Math.round(a / 255); };
const named = (list, look, env) => { const out = []; walk(expand(list, look, env), (op) => { if (op.name) out.push(op); }); return out; };

test('whiteboard: board stock, marker finish, the bullet marker as its pen, inks black blue red green', () => {
  const wb = LOOKS.whiteboard;
  assert.deepEqual([wb.paper, wb.finish, wb.penTool], ['board', 'marker', 'bullet']);
  assert.deepEqual(wb.palette.inks, ['#1d1f24', '#1f5fc9', '#d8342f', '#23924a']);
  assert.deepEqual(Object.keys(LOOKS).filter((n) => LOOKS[n].penTool), ['whiteboard', 'chalkboard', 'crayon', 'notebook']);
  assert.ok(!('penTool' in LOOKS.paperInk), 'the other presets carry no such field, so their hashes hold');
  assert.equal(resolveLook('whiteboard'), wb);
  assert.notEqual(hashLook('whiteboard~hand:test'), hashLook('whiteboard'));
  assert.equal(WORDS.whiteboard, 12);
});

test('the board: glare, ghosts that stay put across shots, a tray along the bottom with a marker in it', () => {
  const a = named([paper({ seed: 3 })], 'whiteboard'), b = named([paper({ seed: 99 })], 'whiteboard');
  const names = new Set(a.map((o) => o.name));
  for (const n of ['stock', 'glare', 'ghost', 'tray', 'tray-lip', 'marker', 'marker-cap']) assert.ok(names.has(n), n);
  const ghosts = (l) => JSON.stringify(l.filter((o) => o.name === 'ghost' || o.name === 'glare'));
  assert.equal(ghosts(a), ghosts(b), 'the ghosts are the board, not the shot');
  const tray = (W, H) => named([paper()], 'whiteboard', { W, H }).find((o) => o.name === 'tray').path.box;
  assert.ok(Math.abs(tray(1080, 1080)[1] - (1080 - 34)) < 1e-9);
  assert.ok(Math.abs(tray(1080, 1920)[1] - (1920 - 34)) < 1e-9, 'a 9:16 board has the same tray');
  // Night stays night: a night op is the dark stock, with no tray.
  assert.ok(!named([{ op: 'night' }], 'whiteboard').some((o) => o.name === 'tray'));
});

test('the marker finish: the flat fill and ruled streaks in a darker tone of the fill, no hatch', () => {
  const f = fill(circle(100, 100, 80), 'fills.1', { finish: true, seed: 4 });
  const out = expand([f], 'whiteboard');
  assert.deepEqual(out.map((o) => o.op), ['fill', 'clip']);
  const s = out[1].kids[0];
  assert.equal(s.name, 'streaks');
  assert.equal(s.wobble, 0);
  assert.deepEqual(s.role, { base: 'fills.1', shade: 0.3 });
  assert.ok(s.path.sub.length > 5);
  assert.equal(resolveRole(s.role, 'whiteboard').length, 7);
  let hatch = false;
  walk(out, (op) => { if (op.name === 'hatch') hatch = true; });
  assert.ok(!hatch);
});

test('a pen stroke under the whiteboard is drawn by the bullet marker; other tools keep their own', () => {
  const zig = (o) => [stroke(poly([[20, 150], [100, 40], [180, 150]], false), 'ink', { w: 8, seed: 3, ...o })];
  const pen = px(zig(), 'whiteboard');
  assert.equal(sha(pen), sha(px(zig({ tool: 'pen' }), 'whiteboard')), 'text sets tool: pen explicitly');
  assert.equal(sha(pen), sha(px(zig({ tool: 'bullet' }), 'whiteboard')));
  assert.notEqual(sha(pen), sha(px(zig(), 'paperInk')));
  assert.notEqual(sha(px(zig({ tool: 'marker' }), 'whiteboard')), sha(pen), 'the chisel marker stays itself');
  assert.equal(sha(px(zig({ tool: 'bullet' }), 'paperInk')), sha(px(zig({ tool: 'bullet' }), 'paperInk')), 'deterministic');
  // The look's hand still pens a bullet line: corners overshoot.
  assert.notEqual(sha(px(zig(), 'whiteboard~hand:test')), sha(pen));
});

test('eraseTrack: rows band apart cover the box, left to right then back', () => {
  const { path, len } = eraseTrack([0, 0, 1000, 600], 150, 1);
  assert.equal(path.sub.length, 1);
  const p = path.sub[0].pts, ys = [];
  for (let i = 1; i < p.length; i += 14) ys.push(p[i]);
  assert.equal(ys.length, Math.ceil(600 / (150 * 0.85)));
  assert.ok(p[0] < 0 && p[12] > 1000, 'the first row runs past both edges');
  assert.ok(p[14] > 1000 && p[26] < 0, 'the second comes back');
  assert.ok(Math.abs(ys[0] - 75) < 15 && Math.abs(ys.at(-1) - 525) < 15);
  assert.ok(len > ys.length * 1000);
  assert.deepEqual(eraseTrack([0, 0, 1000, 600], 150, 1), { path, len }, 'seeded');
});

test("fx('erase'): clear wipes the kids away to a ghost, reveal shows them where the eraser has been", () => {
  const kids = [fill(circle(100, 100, 70), 'ink')];
  const at = (p, mode, o = {}) => px([fx('erase', { p, mode, band: 60, eraser: false, ...o }, kids)], 'whiteboard');
  const full = ink(px(kids, 'whiteboard'));
  assert.equal(sha(at(0, 'clear')), sha(px(kids, 'whiteboard')), 'clear at 0: the kids as they were');
  assert.equal(ink(at(0, 'reveal')), 0, 'reveal at 0: nothing yet');
  const ghost = ink(at(1, 'clear'));
  assert.ok(ghost > 0 && ghost < full * 0.1, `a ghost stays (${ghost} of ${full})`);
  assert.equal(ink(at(1, 'clear', { ghost: 0 })), 0);
  assert.ok(Math.abs(ink(at(1, 'reveal')) - full) <= full * 0.01, 'reveal at 1: all of it');
  const half = ink(at(0.5, 'reveal'));
  assert.ok(half > full * 0.2 && half < full * 0.8, `half way (${half} of ${full})`);
  assert.ok(Math.abs(ink(at(0.5, 'clear')) - (full - half)) < full * 0.1, 'clear is reveal turned over');
  assert.notEqual(sha(px([fx('erase', { p: 0.5, band: 60 }, kids)], 'whiteboard')), sha(at(0.5, 'reveal')), 'the eraser is drawn');
  assert.throws(() => at(0.5, 'rub'), /fx erase: unknown mode 'rub'/);
});

test("cut('erase') between two board shots, and the whiteboard lints mini clean", () => {
  const a = shot('a', 0.5, () => [paper(), fill(circle(540, 540, 200), 'fills.0', { finish: true })]);
  const b = shot('b', 0.5, () => [paper(), stroke(circle(540, 540, 200), 'inks.2', { w: 6 })]);
  const f = film({ name: 'erasecut', look: 'whiteboard', timeline: seq(a, cut('erase', 0.5, a, b), b) });
  const r = frameRenderer(f, { width: 120 });
  const first = sha(r.render(5).buf), mid = sha(r.render(8).buf), last = sha(r.render(f.n - 1).buf);
  assert.notEqual(mid, first);
  assert.notEqual(mid, last);
  assert.deepEqual(lint({ ...mini, look: { name: 'whiteboard' } }), []);
});
