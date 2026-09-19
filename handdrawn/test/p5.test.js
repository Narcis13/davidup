// P5: finishes, coverage, plates, tools, fx, images, marks, camera, recipes and the two ported films.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as H from '../core/index.js';
import { createRenderer } from '../core/raster.js';
import { expand } from '../core/finish.js';
import { skiaCanvas } from '../cli/skia.mjs';
import { lint } from '../core/lint.js';
import { frame } from '../core/tree.js';
import * as R from '../recipes/shots.js';
import fourLooks from '../films/four-looks.js';
import flyStyle from '../films/fly-style.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const { paper, fill, stroke, fx, circle, rect, ellipse, group, walk } = H;

// Draws a list at 1/4 scale on a fresh CPU canvas; returns the raw pixels.
function px(list, { look = 'paperInk', images, W = 1080, H: Hh = 1080 } = {}) {
  const c = skiaCanvas(W / 4, Hh / 4), r = createRenderer({ makeCanvas: skiaCanvas, dedup: false, images });
  r.draw(c.getContext('2d'), list, { look, S: 0.25, W, H: Hh });
  return c.toBufferSync('raw');
}
const at = (buf, w, x, y) => [...buf.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];

test('every finish expands to drawable ops; wash replaces the flat fill; unknown finishes fail', () => {
  const E = ellipse(540, 540, 200, 150);
  for (const kind of ['hatch', 'halftone', 'dots', 'graphite', 'wash', 'flat']) {
    const out = expand([fill(E, 'fills.0', { finish: kind, seed: 3 })], 'paperInk');
    walk(out, (op) => { assert.ok(!(op.op === 'fill' && op.finish), kind); });
    const flat = out.some((op) => op.op === 'fill' && !op.name);
    assert.equal(flat, kind !== 'wash', kind);
    assert.ok(px([paper(), ...out]).length);
  }
  assert.throws(() => expand([fill(E, 'fills.0', { finish: 'nope' })], 'paperInk'), /finish 'nope'/);
});

test('cov: numbers, radial, linear and painter-ordered plates with knockouts', () => {
  assert.equal(H.covAt(0.4, 0, 0), 0.4);
  const rad = H.radial(0, 0, 10, 110, 1, 0);
  assert.equal(H.covAt(rad, 5, 0), 1);
  assert.ok(Math.abs(H.covAt(rad, 60, 0) - 0.5) < 1e-9);
  assert.equal(H.covAt(H.linear(0, 0, 100, 0, 0, 1), 25, 99), 0.25);
  const p = H.plate('inks.0', [fill(rect(0, 0, 100, 100), 'ink', { cov: 0.8 }), H.knockout(circle(50, 50, 20)), stroke(H.line(0, 90, 100, 90), 'ink', { w: 6, cov: 0.3 })]);
  assert.equal(p.op, 'dots');
  assert.equal(p.blend, 'multiply');
  assert.equal(H.covAt(p.cov, 10, 10), 0.8);
  assert.equal(H.covAt(p.cov, 50, 50), 0);
  assert.equal(H.covAt(p.cov, 50, 91), 0.3);
  assert.equal(H.covAt(p.cov, 200, 200), 0);
  // plate order: lightest ink first, the darkest last
  const order = H.plateOrder('risoPop');
  assert.equal(order.at(-1), 3);   // risoPop inks[3] is the navy
});

test('a flat fill with a radial cov is a gradient; plates multiply onto the paper', () => {
  const buf = px([paper(), fill(rect(0, 0, 1080, 1080), 'ink', { cov: H.radial(540, 540, 0, 500, 1, 0) })]);
  const centre = at(buf, 270, 135, 135), edge = at(buf, 270, 5, 5);
  assert.ok(centre[0] < 60 && edge[0] > 200, `${centre} ${edge}`);
  const p = px([paper(), H.plate('inks.1', [fill(rect(0, 0, 1080, 1080), 'ink', { cov: 0.7 })], { cell: 12 })]);
  assert.notEqual(sha(p), sha(px([paper()])));
});

test('every tool draws, deterministically, and brush reveals by p', () => {
  const path = H.spline([[100, 500], [400, 300], [700, 700], [1000, 500]]);
  for (const tool of ['pen', 'chalk', 'brush', 'pencil', 'crayon', 'marker', 'gouache']) {
    const a = px([paper(), stroke(path, 'ink', { tool, w: 8, seed: 4 })]), b = px([paper(), stroke(path, 'ink', { tool, w: 8, seed: 4 })]);
    assert.equal(sha(a), sha(b), tool);
    assert.notEqual(sha(a), sha(px([paper()])), tool);
  }
  const half = H.reveal(0.5, stroke(path, 'ink', { tool: 'brush', w: 8 }));
  assert.equal(half.p, 0.5);
  assert.equal(half.path, path);
  assert.notEqual(sha(px([paper(), half])), sha(px([paper(), stroke(path, 'ink', { tool: 'brush', w: 8 })])));
});

test('every fx renders deterministically; transitions reveal b by p', () => {
  const kids = [fill(rect(100, 100, 880, 880), 'fills.1'), fill(circle(540, 540, 200), 'fills.0'), stroke(circle(540, 540, 200), 'ink', { w: 4 })];
  const args = {
    dissolve: { p: 0.5 }, wipe: { p: 0.5 }, blot: { p: 0.2 }, iris: { p: 0.4, ring: 'ink' }, mosaic: { s: 30 }, flash: { k: 0.5 },
    flicker: { i: 0 }, nightShot: { lights: [{ x: 400, y: 400, r: 300 }] }, bleed: { amt: 3 }, glow: { r: 200 }, scribble: { amp: 8 },
    photoMask: { sil: circle(540, 540, 150) }, soft: { q: 10, alpha: 0.5 },
  };
  assert.deepEqual(Object.keys(args).sort(), Object.keys(H.FX).sort());
  const base = sha(px([paper(), ...kids]));
  for (const [kind, a] of Object.entries(args)) {
    const one = px([paper(), fx(kind, a, kids, { seed: 9 })]), two = px([paper(), fx(kind, a, kids, { seed: 9 })]);
    assert.equal(sha(one), sha(two), kind);
    if (kind !== 'flicker') assert.notEqual(sha(one), base, kind);
  }
  assert.equal(sha(px([paper(), fx('flicker', { i: 0 }, kids)])), base);
  assert.equal(sha(px([paper(), fx('flicker', { i: 2 }, kids)])), sha(px([paper()])));
});

test('groups that blend with what is under them draw direct (a transparent layer is no backdrop)', () => {
  const g = group('washy', [H.wash(circle(540, 540, 200), 'fills.0', { al: 0.8 })]);
  const cached = createRenderer({ makeCanvas: skiaCanvas });
  const c = skiaCanvas(270, 270);
  for (let n = 0; n < 3; n++) cached.draw(c.getContext('2d'), [paper(), g], { look: 'paperInk', S: 0.25 });
  assert.equal(cached.stats.layers + cached.stats.scratch, 2);   // only the paper stock: scratch, then its layer
});

test('image ops draw a registered asset; photo helpers place, rim and mask it', async () => {
  const src = skiaCanvas(200, 100), g = src.getContext('2d');
  g.fillStyle = '#c03030'; g.beginPath(); g.ellipse(100, 50, 100, 50, 0, 0, Math.PI * 2); g.fill();
  const ph = { name: 'egg', w: 200, h: 100, src: await src.toDataURL('png'), sil: ellipse(100, 50, 100, 50, 48) };
  const img = await (await import('skia-canvas')).loadImage(ph.src), images = new Map([['egg', img]]);
  const pl = H.pin(ph, { x: 540, y: 540, h: 400 });
  assert.deepEqual(H.on(pl, 0.5, 0.5), [540, 540]);
  const top = H.rim(pl, 'top', 0.5);
  assert.ok(Math.abs(top[0] - 540) < 1 && Math.abs(top[1] - 340) < 6, String(top));
  const buf = px([...H.backdrop(), H.photo(pl)], { images, look: 'doodlePastel' });
  assert.ok(at(buf, 270, 135, 135)[0] > 150 && at(buf, 270, 135, 135)[1] < 80);
  assert.throws(() => px([H.photo(pl)]), /image 'egg' is not loaded/);
  const sil = H.silhouette(pl);
  assert.ok(H.inside(sil, 540, 540) && !H.inside(sil, 540, 300));
  assert.equal(H.mask(pl, []).kind, 'photoMask');
});

test('marks and the camera return plain ops', () => {
  const list = [
    H.seedDot(540, 540), H.ripples(540, 540, [50, 100], 'accents.0', 1), H.dashedRing(540, 540, 90, 'ink', 2),
    H.dottedArc(540, 540, 80, 'ink', 3), H.plant(540, 900, 80, 3, 4), H.section(700, 'fills.0', 5), H.stickyNote(100, 100, 80, 6),
    H.thread(300, 7), H.hexLattice([0, 0, 300, 300], 20), H.aster(540, 540, 8, 12, 'accents.1', 8), H.dotBurst(540, 540, 90, 10, 'accents.2', 9),
    H.speedLines(540, 540, 0, 10), H.loops(540, 540, 0, 11), H.construction(540, 540, 100, 12),
  ];
  assert.doesNotThrow(() => H.hashList(list));
  assert.doesNotThrow(() => H.parse(H.serialise(list)));
  const c = H.cam({ x: 100, y: 100, zoom: 2 }, list);
  assert.equal(c.cache, 'never');
  assert.deepEqual(H.cam({ x: 100, y: 200 }, []).xf, [1, 0, 0, 1, 440, 340]);
  assert.equal(H.whip(1, 2), 0);
  assert.ok(H.whip(0, 2) < 0 && H.whip(1.99, 2) > 0);
});

test('every A-Z recipe builds a shot that lints clean next to a sign-off', () => {
  const names = ['establishing', 'blotToBlueprint', 'sparkConstruct', 'doubling', 'bands', 'macroInsert', 'followTravel', 'povMosaic',
    'network', 'impact', 'vibration', 'timePassing', 'coda', 'seedRipples', 'badgeGallery', 'starfield', 'landscapeDayNight', 'origami',
    'tornPage', 'darkSection', 'patternSampler', 'enso'];
  const card = () => R.risoCard([[fill(circle(540, 540, 300), 'ink', { cov: 0.6 })]]);
  const extra = { badgeGallery: { cards: [card, card, card] }, tornPage: { label: null } };
  for (const n of names) {
    const s = R[n]({ ...extra[n] });
    assert.equal(s.kind, 'shot', n);
    const f = H.film({ name: `r-${n}`, look: 'paperInk', timeline: H.seq(s, R.signOffShot()) });
    for (const i of [0, Math.floor(s.n / 2), s.n - 1]) assert.doesNotThrow(() => frame(f, i), n);
    assert.deepEqual(lint(f).map((x) => `${x.rule}: ${x.detail}`), [], n);
  }
  const m = R.montage({ cards: [card, card] });
  assert.equal(m.dur, 0.5);
  assert.equal(R.duotoneBeat({ cards: [card] }).look.finish, 'halftone');
});

// Their goldens are checked with every other film's in films.test.js.
test('four-looks and fly-style lint clean in every preset look', () => {
  for (const f of [fourLooks, flyStyle]) for (const look of Object.keys(H.LOOKS)) {
    assert.deepEqual(lint({ ...f, look: { name: look } }), [], `${f.name} ${look}`);
  }
});

test('the card recipes render with no arguments, on the sample CARDS', () => {
  assert.equal(R.CARDS.length, 3);
  for (const n of ['montage', 'duotoneBeat', 'badgeGallery']) {
    const s = R[n]();
    const f = H.film({ name: `r-${n}`, look: 'risoPop', timeline: H.seq(s, R.signOffShot()) });
    for (const i of [0, s.n - 1]) assert.doesNotThrow(() => frame(f, i), n);
  }
  assert.equal(R.montage().dur, 0.75);
});
