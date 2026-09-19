// P7: the three engines (found motion, sand, paper in space), hdf clip, the hiss, and the three films.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as H from '../core/index.js';
import { createRenderer } from '../core/raster.js';
import { renderScore } from '../core/synth.js';
import { lint } from '../core/lint.js';
import { frame } from '../core/tree.js';
import { skiaCanvas } from '../cli/skia.mjs';
import { toV2 } from '../cli/clip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const { fill, stroke, rect, circle, image, walk } = H;

function px(list, { look = 'doodlePastel', S = 0.25 } = {}) {
  const c = skiaCanvas(1080 * S, 1080 * S), r = createRenderer({ makeCanvas: skiaCanvas, dedup: false });
  r.draw(c.getContext('2d'), list, { look, S });
  return c.toBufferSync('raw');
}

// ---------- found motion ----------

// A two-pose v1 clip: a box standing on the ground, then hopping 10 units up.
const V1 = {
  n: 2, fps: 12, h: 100, credit: 'test', source: '',
  frames: [0, 10].map((up) => ({
    outer: [[[-20, -up], [20, -up], [20, -100 - up], [-20, -100 - up]]],
    lines: [{ w: 3, p: [[-20, -up], [20, -up]] }, { w: 4, p: [[-20, -100 - up], [-20, -up], [20, -up], [20, -100 - up]] }],
  })),
};

test('registerClip takes v1 and v2 shapes alike, lines longest first; gap and airborne', () => {
  const a = H.registerClip('box-v1', V1), b = H.registerClip('box-v2', toV2(V1));
  assert.deepEqual(b.frames[1].outer.sub, a.frames[1].outer.sub);
  assert.equal(a.frames[0].lines[0].w, 4);   // the long line comes first
  assert.equal(H.gap('box-v1', 0), 0);
  assert.equal(H.gap('box-v1', 1), 10);
  assert.equal(H.airborne('box-v1'), 1);
  assert.equal(H.pose('box-v1', -1), a.frames[1]);   // loops both ways
  assert.throws(() => H.traced('nope', 0), /unknown clip 'nope'/);
});

test('traced: translation in the xf (cacheable), scale in the points, p draws strokes on longest first', () => {
  const g = H.traced('box-v1', 0, { x: 300, y: 800, h: 200, wash: 'fills.0' });
  assert.deepEqual(g.xf, [1, 0, 0, 1, 300, 800]);
  assert.equal(g.name, 'traced:box-v1');
  const strokes = [];
  walk([g], (op) => { if (op.op === 'stroke' && op.tool === 'brush') strokes.push(op); });
  assert.deepEqual(strokes.map((s) => s.w), [8, 6]);   // widths scale with h / clip.h
  const b = H.bounds([g]);   // the 40 x 200 box, feet at (300, 800), plus stroke widths and the wash's offset
  assert.ok(b[0] <= 262 && b[0] + b[2] >= 338 && b[1] <= 602 && b[1] + b[3] >= 798 && b[2] < 110, `${b}`);
  const half = H.traced('box-v1', 0, { p: 0.5 }), n = [];
  walk([half], (op) => { if (op.op === 'stroke') n.push(op.p); });
  assert.deepEqual(n, [1]);
  const flip = H.traced('box-v1', 1, { h: 100, flip: true, fill: null });
  assert.ok(flip.kids.every((op) => op.op === 'stroke'));
  assert.notEqual(sha(px([H.paper(), g])), sha(px([H.paper()])));
});

test('hdf clip converts a roto.py clips.js into a v2 module that registers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-clip-'));
  writeFileSync(join(dir, 'clips.js'), `registerClip("box", ${JSON.stringify(V1)});\n`);
  const r = spawnSync(process.execPath, ['cli/hdf.mjs', 'clip', join(dir, 'clips.js'), '--js', join(dir, 'out.js')], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(readFileSync(join(dir, 'out.js'), 'utf8'), /import .* from/);   // hdf bundle scans for these
  const mod = await import(join(dir, 'out.js'));
  const c = H.registerClip('box-conv', mod.default.box);
  assert.equal(c.n, 2);
  assert.equal(H.gap('box-conv', 1), 10);
});

// ---------- sand ----------

const bed = H.sim('test-bed', {
  N: 120, world: 1080, every: 6,
  gestures: [
    H.G.sprinkle(0.1, 0.6, [[100, 300], [900, 320]], { r: 200 }),
    H.G.pour(0.7, 1.2, [[540, 900], [540, 500]], { r: 12 }),
    H.G.palm(1.3, 1.8, [[0, 150], [1080, 160]], { r: 120, keep: 0.4 }),
    H.G.wind(1.8, 2.2, { strength: 0.2 }),
    H.G.fly(1.5, 2.0, [[100, 100], [600, 400]], { light: true }),
    H.G.dab(2.1, 540, 540),
  ],
});
const snapshot = (K) => { const s = bed.stateAt(K); return { h: sha(Buffer.from(s.h.buffer)), seed: s.seed }; };

test('sim: any path to step K gives the same bed (forwards, backwards through checkpoints, from zero)', () => {
  const K = bed.stepOf(2.25), forward = [];
  for (let k = 0; k <= K; k += 7) forward.push(snapshot(k));
  const end = snapshot(K);
  assert.deepEqual(snapshot(K), end);            // live state, no stepping
  assert.deepEqual(snapshot(14), forward[2]);    // back to a checkpoint, then forwards
  assert.deepEqual(snapshot(K), end);
  assert.deepEqual(snapshot(0).seed, 1);
  assert.deepEqual(snapshot(K), end);            // from zero again
  assert.ok(bed.checkpoints.size > 3);
});

test('sim: the bed is an image op whose src names state, camera and lamp; air and hand are ops', () => {
  const op = bed(1.0, { view: { x: 540, y: 540, w: 700 }, tint: [1, 0.9, 0.8] });
  assert.equal(op.op, 'image');
  assert.equal(op.src, `sim:test-bed?K=48&v=540,540,700&t=1,0.9,0.8`);
  assert.ok(op.backdrop);
  assert.equal(bed.air(0.2), null);
  assert.equal(bed.air(1.7).op, 'group');
  const hand = bed.hand(0.9);
  assert.equal(hand.kids.length, 2);
  assert.ok(hand.kids.every((k) => k.blend === 'multiply' && k.src.startsWith('sim-hand:test-bed?')));
  assert.equal(bed.hand(5), null);   // out of shot long after the last gesture
  const a = px(bed.frame(1.0)), b = px(bed.frame(1.0));
  assert.equal(sha(a), sha(b));
  assert.notEqual(sha(px([bed(0)])), sha(px([bed(1.0)])));
  const hiss = bed.hiss();
  assert.equal(hiss.length, 6);
  assert.ok(hiss.every((e) => e.type === 'hiss' && e.hz > 0));
});

test('synth: hiss is band-passed seeded noise, silent outside its span', () => {
  const ev = [{ t: 0.1, dur: 0.2, type: 'hiss', hz: 3600, gain: 0.2 }];
  const a = renderScore(ev, 1), b = renderScore(ev, 1);
  assert.deepEqual(a, b);
  assert.equal(a[Math.round(0.05 * 44100)], 0);
  assert.ok(Math.max(...a.subarray(4410 + 2000, 4410 + 8000).map(Math.abs)) > 0.01);
  assert.equal(a[Math.round(0.5 * 44100)], 0);
});

// ---------- paper in space ----------

const cam = H.camera3({ eye: [0, 800, 1200], target: [0, 0, 0], f: 1500 });
const card = H.card3(200, 100, [fill(rect(0, 0, 200, 100), 'paper'), stroke(rect(10, 10, 180, 80), 'ink', { w: 4 }), H.text('hi', 20, 70, { size: 40 })]);
const flat = [[-100, 0, -50], [100, 0, -50], [100, 0, 50], [-100, 0, 50]];

test('stage3d: projection lands the target at the centre; sheets become screen-space ops, shaded by role', () => {
  const [x, y] = H.proj3(cam, [0, 0, 0]);
  assert.ok(Math.abs(x - 540) < 1e-9 && Math.abs(y - 540) < 1e-9);
  const g = H.project(cam, card, flat, { dark: 0.3, look: 'doodlePastel' });
  const ops = [];
  walk([g], (op) => { if (op.op !== 'group') ops.push(op); });
  assert.ok(ops.some((o) => o.op === 'stroke' && o.tool === 'pen'));   // the text, expanded before projection
  assert.ok(ops.every((o) => !o.role || o.role.shade === 0.3 || typeof o.role === 'object'));
  const b = H.bounds([g]);
  assert.ok(b[0] > 300 && b[0] + b[2] < 780, `${b}`);
  assert.deepEqual(H.shadeRole({ base: 'ink', shade: 0.5 }, 0.5), { base: 'ink', shade: 0.75 });
  // strokes are thinner where the sheet is further away
  const near = H.project(cam, H.card3(200, 100, [stroke(rect(0, 0, 200, 100), 'ink', { w: 4 })]), flat.map(([a, b2, c]) => [a, b2, c + 600]));
  const far = H.project(cam, H.card3(200, 100, [stroke(rect(0, 0, 200, 100), 'ink', { w: 4 })]), flat.map(([a, b2, c]) => [a, b2, c - 600]));
  assert.ok(near.kids[0].w > far.kids[0].w);
});

test('stage3d: the near plane cuts geometry; images become meshes; shadows are one soft layer', () => {
  const low = H.camera3({ eye: [0, 50, 300], target: [0, 50, 0], f: 1500 });
  const floor = [[-2000, 0, -2000], [2000, 0, -2000], [2000, 0, 2000], [-2000, 0, 2000]];
  const g = H.project(low, H.card3(400, 400, [fill(rect(0, 0, 400, 400), 'paper')]), floor);
  const p = g.kids[0].path;
  assert.ok(p.sub[0].pts.every((v) => Number.isFinite(v) && Math.abs(v) < 1e6));
  const pic = H.project(cam, H.card3(200, 100, [image('sim:test-bed?K=0&v=-&t=-', 0, 0, 200, 100)]), flat, { n: 4 });
  assert.equal(pic.kids[0].op, 'mesh');
  assert.equal(pic.kids[0].grid.length, 2 * 25);
  const sh = H.shadows(cam, [{ card, P: flat.map(([a, b2, c]) => [a, b2 + 80, c]) }], { look: 'doodlePastel' });
  assert.equal(sh.kids[0].op, 'fx');
  assert.equal(sh.kids[0].kind, 'soft');
  assert.equal(sh.kids[0].kids[0].rule, 'nonzero');
  const out = px([H.paper(), H.stage3d({ cam, look: 'doodlePastel' }, H.sheet3(card, [[-100, 150, 0], [100, 150, 0], [100, 50, 0], [-100, 50, 0]]), pic)]);
  assert.notEqual(sha(out), sha(px([H.paper()])));
});

test('book3: shut, opening, open, turning and open again all draw', () => {
  const page = H.card3(460, 620, [fill(rect(0, 0, 460, 620), 'paper')]);
  const piece = H.card3(100, 200, [fill(rect(0, 0, 100, 200), 'fills.0')]);
  const book = H.book3({ cover: page, spreads: [
    { left: page, right: page, pieces: [{ base: [[-200, 0], [200, 0]], h: 300, card: piece }, { base: [[-300, 100], [-100, 100]], h: 200, card: piece }] },
    { left: page, right: page, pieces: [{ base: [[100, 0], [300, 0]], h: 200, card: piece, lean: 70 }] },
  ] });
  const c = H.camera3({ eye: [0, 1000, 1300], target: [0, 100, 0] });
  let last = null;
  for (const turn of [0, 0.3, 0.7, 1, 1.5, 2]) {
    const g = book.draw({ turn, cam: c, look: 'doodlePastel' });
    assert.equal(g.name, 'book');
    const h = sha(px([H.paper(), g]));
    assert.notEqual(h, last, `turn ${turn}`);
    last = h;
  }
});

// ---------- the films ----------

test('a frame does not depend on what the renderer drew before it (scratch canvases are sized exactly)', async () => {
  const { loadFilm } = await import('../cli/load.mjs');
  const { frameRenderer } = await import('../cli/frames.mjs');
  const f = await loadFilm(join(ROOT, 'films/moon-book.js'));
  const fresh = frameRenderer(f, { width: 240 }).render(156).buf;
  const warm = frameRenderer(f, { width: 240 });
  warm.render(49);
  warm.forget();
  assert.equal(sha(warm.render(156).buf), sha(fresh));
});

// Their goldens (written with 1 worker) are checked with 4 workers in films.test.js.
test('gallop, one-year and moon-book lint clean', async () => {
  for (const name of ['gallop', 'one-year', 'moon-book']) {
    const f = (await import(`../films/${name}.js`)).default;
    for (const i of [0, Math.floor(f.n / 2), f.n - 1]) assert.doesNotThrow(() => frame(f, i), name);
    assert.deepEqual(lint(f).map((x) => `${x.shot}: ${x.rule}: ${x.detail}`), [], name);
  }
});
