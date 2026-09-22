// 4.0 K6: secondary motion: follow parts (a spring on the parent's world angle), chains, settle, frameOf,
// actor.place / actor.follow with a state function, the SVG attributes and a stick's extra parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FPS, actorOf, perform, puppet, stickSource, stand } from '../core/index.js';
import { fromStore } from '../core/assets.js';
import { expandChains, FOLLOW } from '../core/follow.js';
import { hashList } from '../core/list.js';
import { svgPuppet } from '../core/svg.js';

const FOXJSON = JSON.parse(readFileSync(new URL('../assets/src/fox.puppet.json', import.meta.url), 'utf8'));
const scarfSrc = (follow = { lag: 2, damp: 0.5, limit: 45 }) => ({
  ...stickSource({ name: 'sam-scarf' }),
  parts: { scarf: { parent: 'neck', pivot: 'neck', chain: { n: 4, len: 18, w: 9, angle: 60, role: 'inks.2', taper: 0.3 }, follow, before: 'head' } },
});
const LINKS = ['scarf', 'scarf-2', 'scarf-3', 'scarf-4'];

test('the fox tail follows; a still state settles to exactly what it says', () => {
  const fox = puppet(FOXJSON);
  assert.deepEqual(fox.follows, ['tail']);
  assert.deepEqual(fox.followOf('tail'), { ...FOLLOW, lag: 2, damp: 0.7 });
  assert.deepEqual(fox.settle(() => ({ tail: 7 }), 3), { tail: 7 });
  assert.deepEqual(fox.settle(() => ({ body: 12 }), 1.5), { tail: 0 });
  // A plain state draws as before: the part is where the state says.
  assert.equal(hashList([fox({ tail: 10 })]), hashList([puppet({ ...FOXJSON, parts: { ...FOXJSON.parts, tail: { ...FOXJSON.parts.tail, follow: undefined } } })({ tail: 10 })]));
});

test('a turn of the parent reaches the tail late, on the joint grid, and it catches up', () => {
  const fox = puppet(FOXJSON), st = (t) => ({ body: t < 1 - 1e-9 ? 0 : 20 });
  const row = Array.from({ length: 10 }, (_, k) => fox.settle(st, (10 + k) / FPS).tail);
  assert.deepEqual(row.slice(0, 2), [0, 0], 'before the turn');
  assert.ok(row[2] < -8, `the tail stays behind as the body turns: ${row}`);
  assert.ok(row.every((v) => v % 2 === 0), 'on the 2 degree grid');
  assert.deepEqual(row.slice(6), [0, 0, 0, 0], 'caught up');
  // Pure in t: the same answer however it is asked for.
  assert.equal(fox.settle(st, 13 / FPS).tail, row[3]);
});

test('frameOf settles a cycle on its own loop: the tail lags the walk by about a frame', () => {
  const fox = puppet(FOXJSON), raw = FOXJSON.cycles.walk.frames.map((f) => f.tail);
  const got = raw.map((_, j) => fox.frameOf('walk', j / FPS).tail);
  assert.deepEqual(raw, [6, 2, -2, -6, -6, -2, 2, 6]);
  assert.notDeepEqual(got, raw);
  // Delayed: each frame is closer to the raw frame before it than to its own.
  const err = (shift) => got.reduce((s, v, j) => s + Math.abs(v - raw[(j - shift + 8) % 8]), 0);
  assert.ok(err(1) < err(0), `lagging: ${got}`);
  assert.equal(hashList([fox.cycle('walk', 3 / FPS)]), hashList([fox(fox.frameOf('walk', 3 / FPS))]), 'cycle() draws the settled frame');
});

test('a chain expands into links that hang from each other and all follow', () => {
  const d = expandChains({ name: 'c', parts: { body: { ops: [] }, rope: { parent: 'body', pivot: [0, 0], chain: { n: 3, len: 10, w: 2 } } } });
  assert.deepEqual(Object.keys(d.parts), ['body', 'rope', 'rope-2', 'rope-3']);
  assert.deepEqual([d.parts['rope-2'].parent, d.parts['rope-3'].parent], ['rope', 'rope-2']);
  assert.deepEqual([d.parts['rope-2'].pivot, d.parts['rope-3'].pivot], [[0, 10], [0, 20]]);
  assert.equal(expandChains(d), d, 'nothing left to expand');
  assert.deepEqual(puppet(d).follows, ['rope', 'rope-2', 'rope-3']);
  const bad = [
    [{ parts: { a: { ops: [] }, b: { parent: 'a', pivot: [0, 0], chain: { n: 3 } } } }, /chain.len/],
    [{ parts: { b: { pivot: [0, 0], chain: { n: 3, len: 4 } } } }, /no parent/],
    [{ parts: { a: { ops: [] }, b: { parent: 'a', pivot: [0, 0], chain: { n: 3, len: 4, kink: 1 } } } }, /chain has 'kink'/],
    [{ parts: { a: { ops: [] }, b: { parent: 'a', ops: [], follow: { lag: 0 } } } }, /follow.lag/],
    [{ parts: { a: { ops: [] }, b: { parent: 'a', ops: [], follow: { damp: 2 } } } }, /follow.damp/],
    [{ parts: { a: { ops: [], follow: {} } } }, /no parent to follow/],
  ];
  for (const [p, re] of bad) assert.throws(() => puppet(p), re);
});

test('a scarf of four links swings after a jump, then settles back to rest', () => {
  const SAM = actorOf(puppet(scarfSrc()));
  const act = perform(SAM, [[0, 'stand'], [0.75, 'jump', { dur: 0.1 }], [1.75, 'stand', { dur: 0.25 }]]);
  const fn = (u) => stand(SAM, act.state(u));
  const at = (t) => LINKS.map((k) => SAM.follow(fn, t)[k]);
  assert.deepEqual(at(0.5), [0, 0, 0, 0], 'still before the jump');
  // After the landing the body is still, and the scarf is not.
  const after = [2, 2.25, 2.5].map(at);
  assert.equal(fn(2).body, fn(2.5).body);
  assert.ok(after.some((a) => a.some((v) => Math.abs(v) >= 10)), `swinging after the landing: ${JSON.stringify(after)}`);
  assert.ok(after.some((a) => a.some((v) => v > 0)) && after.some((a) => a.some((v) => v < 0)), 'both ways');
  assert.deepEqual(at(5), [0, 0, 0, 0], 'settled');
  // The drawing through place is the same as place with the settled state.
  const g1 = SAM.place(540, 600, 300, fn, 2.25), g2 = SAM.place(540, 600, 300, SAM.follow(fn, 2.25));
  assert.equal(hashList([g1]), hashList([g2]));
  assert.throws(() => SAM.place(540, 600, 300, fn), /needs the time/);
});

test('a stick takes extra parts: a joint names the pivot in every view, before sets the painter order', () => {
  const p = puppet(scarfSrc());
  assert.ok(p.parts.indexOf('scarf-4') < p.parts.indexOf('head'));
  assert.ok(p.parts.indexOf('scarf') > p.parts.indexOf('neck'));
  const neck = stickSource({ name: 'x' }).joints.neck;
  assert.deepEqual(p.pivotAt('scarf', 'side'), neck);
  assert.throws(() => puppet({ ...stickSource({ name: 'y' }), parts: { hat: { parent: 'head', pivot: 'crown', ops: [] } } }), /joint 'crown'/);
});

test('the SVG says follow and chain; the store fox follows', () => {
  const svg = (g) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g id="a"><rect width="5" height="5"/></g>${g}</svg>`;
  const { payload } = svgPuppet(svg('<g id="b" data-parent="a" data-follow="lag:3,damp:0.5" data-chain="n:3,len:10,w:2,role:inks.1"><circle id="pivot" cx="2" cy="2" r="1"/></g>'));
  assert.deepEqual(payload.parts.b.follow, { lag: 3, damp: 0.5 });
  assert.deepEqual(payload.parts.b.chain, { n: 3, len: 10, w: 2, role: 'inks.1' });
  assert.deepEqual(puppet(payload).follows, ['b', 'b-2', 'b-3']);
  fromStore(['fox']);
  assert.deepEqual(puppet('fox').follows, ['tail']);
});
