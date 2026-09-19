import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Canvas } from 'skia-canvas';
import mini from '../films/mini.js';
import { frame } from '../core/tree.js';
import { expand } from '../core/finish.js';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRenderer, draw, outputSize, renderFrame } from '../core/raster.js';
import { fill, circle, line, stroke, text, paper, walk, group } from '../core/list.js';
import { withLook } from '../core/looks.js';
import { cut, film, place, seq, shot } from '../core/tree.js';
import { frameRenderer, produceFrames } from '../cli/frames.mjs';
import { goldenOf } from '../cli/golden.mjs';
import { skiaCanvas } from '../cli/skia.mjs';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

test('expand turns finishes, stock and text into drawable ops, memoised', () => {
  const { list } = frame(mini, 0);
  const a = expand(list, 'paperInk'), b = expand(list, 'paperInk');
  assert.equal(a[0], b[0]);
  const kinds = new Set();
  walk(a, (op) => { kinds.add(op.op); if (op.op === 'fill') assert.ok(!op.finish); });
  for (const k of ['group', 'fill', 'clip', 'stroke', 'specks']) assert.ok(kinds.has(k), k);
  for (const k of ['paper', 'text']) assert.ok(!kinds.has(k), k);
  const t = expand([text('hi', 0, 0, { seed: 3 })], 'paperInk');
  assert.equal(t[0].op, 'group');
  assert.ok(t[0].kids.every((s) => s.op === 'stroke' && Number.isInteger(s.seed)));
});

test('draw expands paper, text and finishes as it goes, and refuses unknown ops', () => {
  const c = new Canvas(20, 20), ctx = c.getContext('2d');
  draw(ctx, [paper(), fill(circle(10, 10, 6), 'fills.0', { finish: true }), text('a', 2, 18, { size: 10 })], { look: 'paperInk' });
  assert.equal(c.toBufferSync('raw')[3], 255);
  assert.throws(() => draw(ctx, [group([{ op: 'bogus' }])], { look: 'paperInk' }), /unknown op/);
});

test('mini renders deterministically at an even output size, opaque', () => {
  const { outW, outH } = outputSize(mini.format, 240);
  const c = new Canvas(outW, outH), ctx = c.getContext('2d');
  const shot = (i) => { renderFrame(ctx, mini, i, { width: 240 }); return c.toBufferSync('raw'); };
  const a = shot(3), b = shot(3);
  assert.equal(sha(a), sha(b));
  assert.notEqual(sha(shot(4)), sha(a));
  assert.equal(outW, 240);
  const px = (buf, x, y) => [...buf.subarray((y * outW + x) * 4, (y * outW + x) * 4 + 4)];
  assert.equal(px(a, 0, 0)[3], 255);
});

// ---------- P3: layer cache, snapping, dedup ----------

const all = (r, n) => Array.from({ length: n }, (_, i) => r.render(i));
const bufs = (r, n) => { let last; return all(r, n).map((f) => (last = f.dup ? last : Buffer.from(f.buf))); };

test('cached and uncached renders of mini are the same pixels, frame by frame', () => {
  const cached = frameRenderer(mini, { width: 240 }), plain = frameRenderer(mini, { width: 240, cacheMb: 0 });
  const a = bufs(cached, mini.n), b = bufs(plain, mini.n);
  for (let i = 0; i < mini.n; i++) assert.equal(sha(a[i]), sha(b[i]), `frame ${i}`);
  assert.ok(cached.stats.blits > 20, `blits ${cached.stats.blits}`);   // stock and guides come from layers
  assert.ok(cached.stats.layers >= 2 && cached.cache.bytes > 0);
  assert.equal(plain.stats.blits, 0);
  assert.equal(plain.cache.size, 0);
});

test('a starved cache evicts and still draws the same pixels', () => {
  const tiny = frameRenderer(mini, { width: 240, cacheMb: 0.3 }), plain = frameRenderer(mini, { width: 240, cacheMb: 0 });
  const a = bufs(tiny, mini.n), b = bufs(plain, mini.n);
  for (let i = 0; i < mini.n; i++) assert.equal(sha(a[i]), sha(b[i]), `frame ${i}`);
  assert.ok(tiny.cache.evictions > 0);
  assert.ok(tiny.cache.bytes <= 0.3 * 1024 * 1024);
});

test('frame dedup: mini repeats the ball resting before the cut and the held sign-off', () => {
  // v1 counted 6 of 36 by PNG hash; its sign-off revealed in coarser steps. Here every reveal step moves,
  // so the first 36 frames repeat 3; the 1.5 s hold after the sign-off (lint's rule) repeats 17 more.
  const r = frameRenderer(mini, { width: 240 }), frames = all(r, mini.n);
  assert.equal(mini.n, 54);
  assert.deepEqual(frames.flatMap((f, i) => (f.dup ? [i] : [])), [21, 22, 23, ...Array.from({ length: 17 }, (_, j) => 37 + j)]);
  const plain = frameRenderer(mini, { width: 240, cacheMb: 0 });
  const a = bufs(plain, 21), [x20] = a.slice(20);
  plain.forget();
  const again = plain.render(21);
  assert.equal(again.dup, false);
  assert.equal(sha(again.buf), sha(x20));
});

test('cacheable groups snap to whole output pixels; rotated ones do not', () => {
  const r = createRenderer({ makeCanvas: skiaCanvas });
  const one = (x, o) => {
    const c = skiaCanvas(64, 64), ctx = c.getContext('2d');
    r.draw(ctx, [place(x, 20, o, group('dot', [fill(circle(0, 0, 6), 'ink')]))], { look: 'paperInk' });
    return sha(c.toBufferSync('raw'));
  };
  assert.equal(one(20.3, {}), one(20, {}));
  assert.equal(one(19.6, {}), one(20, {}));
  assert.notEqual(one(20.3, { rot: 0.5 }), one(20, { rot: 0.5 }));
});

test('workers split the film and deliver the same frames in order', async () => {
  const run = async (workers) => {
    const out = [];
    await produceFrames('films/mini.js', mini, { width: 240, workers, chunk: 5 }, (i, buf, dup) => { out.push([i, sha(buf), dup]); });
    return out;
  };
  const one = await run(1), three = await run(3);
  assert.deepEqual(three.map(([i]) => i), [...Array(mini.n).keys()]);
  assert.deepEqual(three.map(([, h]) => h), one.map(([, h]) => h));
});

test('mini matches its golden', { skip: process.platform !== 'darwin' && 'goldens are written on darwin-arm64' }, async () => {
  const want = JSON.parse(readFileSync(new URL('../films/goldens/mini.json', import.meta.url), 'utf8'));
  assert.deepEqual(await goldenOf('films/mini.js', mini, { workers: 2 }), want);
});

test('a disk-cached second run reads layers back and draws the same frames', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-cache-'));
  try {
    const hashes = async (diskCache) => {
      const out = [];
      await produceFrames('films/mini.js', mini, { width: 240, workers: 1, diskCache }, (i, buf) => { out.push(sha(buf)); });
      return out;
    };
    const plain = await hashes(undefined), first = await hashes(dir);
    const [salt, ...others] = readdirSync(dir);   // one engine-<salt> folder: the hash of core/ and engines/
    assert.ok(/^engine-[0-9a-f]{12}$/.test(salt) && !others.length);
    assert.ok(readdirSync(join(dir, salt)).length >= 2);
    mkdirSync(join(dir, 'engine-000000000000'));   // a stale engine's folder goes on the next open
    const r = frameRenderer(mini, { width: 240, diskCache: dir });
    for (let i = 0; i < mini.n; i++) r.render(i);
    assert.ok(r.stats.disk > 0);
    assert.deepEqual(first, plain);
    assert.deepEqual(await hashes(dir), plain);   // stock is opaque, so PNG round trips are exact here
    assert.deepEqual(readdirSync(dir), [salt]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fx ops dispatch to fx.js: a dissolve cut renders, unknown kinds fail loudly', () => {
  const a = shot('a', 0.5, () => [paper(), fill(circle(540, 540, 200), 'fills.0')]);
  const b = shot('b', 0.5, () => [paper(), fill(circle(540, 540, 200), 'fills.1')]);
  const f = film({ name: 'cutfx', look: 'paperInk', timeline: seq(a, cut('dissolve', 0.5, a, b), b) });
  const r = frameRenderer(f, { width: 120 });
  const mid = r.render(8), end = r.render(f.n - 1);
  assert.notEqual(sha(mid.buf), sha(end.buf));
  const g = film({ name: 'badfx', look: 'paperInk', timeline: seq(a, cut('nope', 0.5, a, b)) });
  assert.throws(() => frameRenderer(g, { width: 120 }).render(7), /fx 'nope' is unknown/);
});

test('a stroke without w takes its width from the look; an explicit w wins', () => {
  const inked = (look, o) => {
    const c = new Canvas(60, 20), ctx = c.getContext('2d');
    draw(ctx, [stroke(line(5, 10, 55, 10), 'ink', { wobble: 0, seed: 1, ...o })], { look });
    const px = c.toBufferSync('raw');
    let ink = 0;   // coverage down one column, in pixels
    for (let y = 0; y < 20; y++) ink += px[(y * 60 + 30) * 4 + 3] / 255;
    return Math.round(ink * 10) / 10;
  };
  assert.ok(inked('pencilMinimal') < inked('paperInk'), 'pencil pen (1.6) thinner than the default pen (2.6)');
  assert.ok(inked('doodlePastel') > inked('paperInk'), 'doodle pen (4) thicker than the default pen (2.6)');
  assert.equal(inked('pencilMinimal', { w: 4 }), inked('doodlePastel', { w: 4 }));
});

test('another edition of the look prints other pixels; edition 0 is the preset', () => {
  const sheet = (look) => film({ name: 'ed', look, timeline: [shot('s', 1, () => [paper(), fill(circle(40, 40, 30), 'fills.0', { finish: true }), text('ab', 10, 70, { size: 20 })])] });
  const px = (f) => { const c = new Canvas(80, 80); draw(c.getContext('2d'), frame(f, 0).list, { look: f.look }); return sha(c.toBufferSync('raw')); };
  const base = px(sheet('paperInk'));
  assert.equal(px(sheet(withLook('paperInk', { edition: 0 }))), base);
  assert.notEqual(px(sheet(withLook('paperInk', { edition: 7 }))), base);
});
