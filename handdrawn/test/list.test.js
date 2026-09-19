import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash32, hash64, rng, seedOf } from '../core/rand.js';
import {
  circle, rect, line, poly, spline, cubic, arc, roundRect, xf, len, at, inside, resample, union,
  paper, fill, stroke, group, clip, fx, text, meta, hashList, hashOp, bounds, walk, mapPaths, serialise, parse,
  translate, scale,
} from '../core/list.js';
import { curve, ease, ramp, add, delay, repeat, pingpong, onTwos, onThrees, follow, pulse, boil } from '../core/curves.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('hash64 is FNV-1a 64 (checked against BigInt)', () => {
  const bytes = [...new TextEncoder().encode('hand-drawn film'), 0, 255, 7];
  let ref = 0xcbf29ce484222325n;
  for (const b of bytes) ref = ((ref ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
  assert.equal(hash64((f) => bytes.forEach(f.byte)), ref.toString(16).padStart(16, '0'));
});

test('hash32 separates parts and seedOf is a path hash', () => {
  assert.notEqual(hash32('ab', 'c'), hash32('a', 'bc'));
  assert.equal(seedOf(1, 'x'), seedOf(1, 'x'));
  assert.notEqual(seedOf(1, 'x'), seedOf(2, 'x'));
  assert.ok(Number.isInteger(seedOf(7, 'ball')) && seedOf(7, 'ball') >= 0);
});

test('rng is the v1 generator', () => {
  function v1(seed) { let a = (seed * 1000003) >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  for (const seed of [0, 1, 3, 9, 123456]) {
    const a = rng(seed), b = v1(seed);
    for (let j = 0; j < 20; j++) assert.equal(a(), b());
  }
});

const sample = () => [
  paper(),
  fill(circle(0, 0, 90), 'fills.0', { finish: true }),
  group('ball', [stroke(circle(0, 0, 90), 'ink', { w: 2.6, wobble: 1.8 })], { xf: translate(540, 540) }),
  text('mini', 10, 20, { size: 40 }),
];

test('hashList is stable across runs and constructions', () => {
  // A literal: if this moves, every golden and disk cache key moves with it.
  assert.equal(hashList(sample()), hashList(sample()));
  assert.equal(hashList(sample()), '14e80e447720f32b');
});

test('hashing ignores key order and sub-1/1024 noise, and sees real changes', () => {
  const a = fill(rect(0, 0, 10, 10), 'ink', { alpha: 0.5, seed: 3 });
  const b = fill(rect(0, 0, 10, 10), 'ink', { seed: 3, alpha: 0.5 + 1e-5 });
  assert.equal(hashOp(a), hashOp(b));
  assert.notEqual(hashOp(a), hashOp(fill(rect(0, 0, 10, 10), 'ink', { alpha: 0.51, seed: 3 })));
  assert.notEqual(hashList([a, paper()]), hashList([paper(), a]));
});

test('a function in an op is rejected when hashed', () => {
  assert.throws(() => hashList([fill(circle(0, 0, 1), 'ink', { alpha: (t) => t })]), /function/);
});

test('serialise/parse round-trips with the same hash and flat path arrays', () => {
  const l = sample(), json = serialise(l);
  assert.match(json, /"\$p":\[\[1,90,0,/);
  const back = parse(json);
  assert.equal(hashList(back), hashList(l));
  assert.ok(Object.isFrozen(back[1]));
  assert.deepEqual(back[1].path.box, l[1].path.box);
});

test('path constructors, measure and sampling', () => {
  close(len(rect(0, 0, 10, 20)), 60);
  close(len(line(0, 0, 3, 4)), 5);
  assert.deepEqual(circle(10, 20, 5).box.map(Math.round), [5, 15, 10, 10]);
  const p = at(line(0, 0, 10, 0), 4);
  close(p.x, 4); close(p.y, 0); close(p.heading, 0);
  assert.deepEqual(at(line(0, 0, 10, 0), 99), { x: 10, y: 0, heading: 0 });
  assert.ok(inside(rect(0, 0, 10, 10), 5, 5));
  assert.ok(!inside(rect(0, 0, 10, 10), 15, 5));
  assert.ok(!inside(union(rect(0, 0, 10, 10), rect(2, 2, 6, 6)), 5, 5), 'even-odd hole');
  const r = resample(line(0, 0, 10, 0), 2.5);
  assert.deepEqual(r.sub[0].pts, [0, 0, 2.5, 0, 5, 0, 7.5, 0, 10, 0]);
  assert.equal(resample(rect(0, 0, 10, 10), 5).sub[0].pts.length / 2, 8);
  assert.deepEqual(poly([[0, 0], [1, 1]], false).sub[0], { pts: [0, 0, 1, 1], closed: false });
  const s = spline([[0, 0], [10, 10], [20, 0]], { n: 4 });
  assert.deepEqual(s.sub[0].pts.slice(0, 2), [0, 0]);
  assert.deepEqual(s.sub[0].pts.slice(-2), [20, 0]);
  assert.deepEqual(cubic([0, 0], [0, 10], [10, 10], [10, 0], 2).sub[0].pts, [0, 0, 5, 7.5, 10, 0]);
  close(arc(0, 0, 1, 0, Math.PI).sub[0].pts.at(-2), -1);
  close(len(roundRect(0, 0, 10, 10, 0)), 40);
  assert.deepEqual(xf(rect(0, 0, 2, 2), [2, 0, 0, 2, 1, 1]).box, [1, 1, 4, 4]);
});

test('bounds unions boxes through group xf, clips and strokes', () => {
  assert.equal(bounds([paper(), meta('anchor')]), null);
  assert.deepEqual(bounds([group({ xf: translate(100, 0) }, [fill(rect(0, 0, 10, 10))])]), [100, 0, 10, 10]);
  assert.deepEqual(bounds([group({ xf: scale(2) }, [fill(rect(0, 0, 10, 10))]), fill(rect(-5, 0, 1, 1))]), [-5, 0, 25, 20]);
  assert.deepEqual(bounds([stroke(rect(0, 0, 10, 10), 'ink', { w: 4 })]), [-2, -2, 14, 14]);
  assert.deepEqual(bounds([clip(rect(0, 0, 5, 5), [fill(rect(2, 2, 10, 10))])]), [2, 2, 3, 3]);
  assert.deepEqual(bounds([group({ box: [-1, -1, 2, 2], xf: translate(10, 10) }, [fill(rect(0, 0, 50, 50))])]), [9, 9, 2, 2]);
});

test('walk visits depth first with parent matrices; mapPaths rewrites every path', () => {
  const l = [group({ name: 'g', xf: translate(5, 0) }, [fill(rect(0, 0, 1, 1)), fx('blot', { p: 0.5 }, [stroke(line(0, 0, 1, 0))])])];
  const seen = [];
  walk(l, (op, m, d) => { seen.push(`${op.op}@${m[4]}:${d}`); });
  assert.deepEqual(seen, ['group@0:0', 'fill@5:1', 'fx@5:1', 'stroke@5:2']);
  const moved = mapPaths(l, (p) => xf(p, translate(0, 7)));
  assert.equal(moved[0].kids[1].kids[0].path.box[1], 7);
  assert.equal(l[0].kids[1].kids[0].path.box[1], 0, 'original untouched');
});

test('group and kids flatten nested arrays and drop falsy entries', () => {
  const g = group('g', [paper(), [fill(rect(0, 0, 1, 1)), null], false]);
  assert.equal(g.kids.length, 2);
  assert.throws(() => group([{ nope: 1 }]), /not an op/);
  assert.throws(() => fill([0, 0, 1, 1]), /expected a path/);
});

test('curves: keys, eases, combinators, grid holds', () => {
  const c = curve([[0, 0], [1, 10], [2, 10, 'in']]);
  assert.equal(c(-1), 0); assert.equal(c(0.5), 5); assert.equal(c(5), 10);
  assert.deepEqual(curve([[0, [0, 0]], [1, [10, 20]]])(0.5), [5, 10]);
  close(curve([[0, 0], [1, 1]], ease.out)(0.5), 0.875);
  close(ramp(0, 1, 0.5), 0.5); assert.equal(ramp(1, 2, 0), 0); assert.equal(ramp(1, 2, 3), 1);
  for (const e of Object.values(ease)) { close(e(0), 0); close(e(1), 1); }
  assert.equal(add((t) => t, 2)(3), 5);
  assert.equal(delay(1, (t) => t)(3), 2);
  close(repeat(0.5, (t) => t)(1.25), 0.25);
  close(pingpong(1, (t) => t)(1.25), 0.75);
  const lin = (t) => t;
  assert.deepEqual([0, 1, 2, 3, 4].map((k) => onTwos(lin)(k / 12) * 12), [0, 0, 2, 2, 4]);
  assert.deepEqual([0, 1, 2, 3, 4].map((k) => onThrees(lin)(k / 12) * 12), [0, 0, 0, 3, 3]);
  const f = follow(line(0, 0, 100, 0))(0.25);
  close(f.x, 25); close(f.heading, 0);
  assert.deepEqual([0, 1, 5, 6, 7].map((i) => pulse(i, 6)), [true, false, false, true, false]);
  assert.deepEqual([0, 3, 4, 9].map((i) => boil(i, 4)), [0, 0, 1, 2]);
});
