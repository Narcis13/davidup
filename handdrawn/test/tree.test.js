import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cel, place, shot, seq, par, hold, cut, lookOn, film, frame, describe, cues, mapLooks, withRootLook } from '../core/tree.js';
import { paper, fill, stroke, group, circle, rect, hashList, walk } from '../core/list.js';
import { hash32, seedOf } from '../core/rand.js';

const dot = cel('dot', ({ r = 10 }) => [fill(circle(0, 0, r), 'fills.0')], { box: [-50, -50, 100, 100], inputs: { r: [0, 50, 5] } });
const still = (name, dur, extra = []) => shot(name, dur, ({ t, CX, CY }) => [paper(), place(CX + t * 100, CY, dot({ r: 10 })), ...extra]);
const seedIn = (list, name) => { let s; walk(list, (op) => { if (op.name === name) s = op.seed; }); return s; };

test('a duration off the 1/12 s grid throws at construction', () => {
  assert.throws(() => shot('x', 0.1, () => []), /grid/);
  assert.throws(() => hold(0.05, still('a', 1)), /grid/);
  assert.throws(() => cut('blot', 0.3, still('a', 1), still('b', 1)), /grid/);
  const bad = { kind: 'shot', name: 'foreign', dur: 0.1, n: 1, draw: () => [] };
  assert.throws(() => seq(still('a', 1), bad), /grid/);
  assert.doesNotThrow(() => shot('ok', 1 / 12, () => []));
  assert.doesNotThrow(() => shot('ok', 0.25, () => []));
});

test('frame of a 3 s film has 36 frames, with hold repeating the last', () => {
  const tail = shot('tail', 0.5, ({ k }) => [paper(), stroke(rect(0, 0, k + 1, 10), 'ink')]);
  const f = film({ name: 't', look: 'paperInk', timeline: seq(still('a', 2), hold(1, tail)) });
  assert.equal(f.n, 36);
  assert.throws(() => frame(f, 36), RangeError);
  assert.throws(() => frame(f, -1), RangeError);
  const held = frame(f, 24);
  assert.equal(held.shot, 'tail');
  assert.equal(held.k, 5);
  assert.equal(held.t, 5 / 12);
  const h = hashList(held.list);
  for (let i = 25; i < 36; i++) assert.equal(hashList(frame(f, i).list), h);
  assert.notEqual(hashList(frame(f, 23).list), h);
  // The held frame is exactly the child's last frame when it plays on its own.
  const alone = film({ name: 't', look: 'paperInk', timeline: seq(still('a', 2), tail) });
  assert.equal(hashList(frame(alone, 29).list), h);
});

test('frames are pure: same i, same list hash, and cels are memoised per quantised input', () => {
  const f = film({ name: 'p', look: 'paperInk', timeline: still('a', 1) });
  assert.equal(hashList(frame(f, 7).list), hashList(frame(f, 7).list));
  assert.equal(dot({ r: 11 }), dot({ r: 10 }));   // 11 quantises to 10
  assert.equal(dot({ r: 99 }).inputs.r, 50);       // clamped to the declared range
  assert.notEqual(dot({ r: 13 }), dot({ r: 10 }));
  assert.equal(dot().cel, 'dot');
  assert.deepEqual(dot.cel.box, [-50, -50, 100, 100]);
});

test('seeds: film from its name, shots from the film, ops from their parent; siblings are independent', () => {
  const draw = (names) => () => names.map((n) => group(n, [fill(circle(0, 0, 5))]));
  const f1 = film({ name: 's', look: 'paperInk', timeline: shot('one', 1, draw(['a', 'b'])) });
  const f2 = film({ name: 's', look: 'paperInk', timeline: shot('one', 1, draw(['a', 'new', 'b'])) });
  const l1 = frame(f1, 0).list, l2 = frame(f2, 0).list;
  assert.equal(f1.seed, hash32('s'));
  assert.equal(seedIn(l1, 'a'), seedOf(seedOf(f1.seed, 'one'), 'a'));
  assert.equal(seedIn(l1, 'b'), seedIn(l2, 'b'));
  assert.notEqual(seedIn(l1, 'a'), seedIn(l1, 'b'));
  // A new shot in the timeline does not re-seed the others.
  const g1 = film({ name: 's', look: 'paperInk', timeline: seq(still('x', 1), still('y', 1)) });
  const g2 = film({ name: 's', look: 'paperInk', timeline: seq(still('x', 1), still('added', 1), still('y', 1)) });
  assert.equal(hashList(frame(g1, 12).list), hashList(frame(g2, 24).list));
  // Explicit seeds win and flow down.
  const f3 = film({ name: 's', look: 'paperInk', timeline: shot('one', 1, () => [group({ name: 'g', seed: 42 }, [fill(circle(0, 0, 1))])]) });
  const g = frame(f3, 0).list[0];
  assert.equal(g.seed, 42);
  assert.equal(g.kids[0].seed, seedOf(42, '#0'));
  // Every op carries a seed.
  walk(frame(f1, 0).list, (op) => assert.ok(Number.isInteger(op.seed), op.op));
});

test('cut produces [group(a at its last frame), fx(kind, { p }, [b at its first frame])]', () => {
  const a = still('a', 1), b = still('b', 1);
  const f = film({ name: 'c', look: 'paperInk', timeline: seq(a, cut('blot', 0.5, a, b), b) });
  assert.equal(f.n, 30);
  const { list, shot: name, k } = frame(f, 12);
  assert.equal(name, 'blot:a>b');
  assert.equal(k, 0);
  assert.equal(list.length, 2);
  const [g, e] = list;
  assert.equal(g.op, 'group');
  assert.equal(hashList(g.kids), hashList(frame(f, 11).list));
  assert.equal(e.op, 'fx');
  assert.equal(e.kind, 'blot');
  assert.ok(e.args.p > 0 && e.args.p < 1);
  assert.equal(hashList(e.kids), hashList(frame(f, 18).list));
  assert.ok(frame(f, 17).list[1].args.p > e.args.p);
  assert.deepEqual(cues(f), {
    shots: [{ name: 'a', t0: 0, dur: 1 }, { name: 'blot:a>b', t0: 1, dur: 0.5, cut: 'blot' }, { name: 'b', t0: 1.5, dur: 1 }],
    cuts: [1, 1.5], chapters: [], end: 2.5,
  });
});

test('place sets xf; rotation or scale makes the group uncacheable, flip does not', () => {
  const p = place(100, 50, dot());
  assert.deepEqual(p.xf, [1, 0, 0, 1, 100, 50]);
  assert.equal(p.cache, undefined);
  assert.equal(p.name, 'dot');
  assert.equal(place(0, 0, { flip: true }, dot()).xf[0], -1);
  assert.equal(place(0, 0, { flip: true }, dot()).cache, undefined);
  assert.equal(place(0, 0, { rot: 0.3 }, dot()).cache, 'never');
  assert.equal(place(0, 0, { scale: 2 }, dot()).cache, 'never');
});

test('par stacks, lookOn wraps shots in the innermost look', () => {
  const bg = shot('bg', 1, () => [paper()]);
  const fg = shot('fg', 0.5, ({ k }) => [fill(rect(0, 0, k + 1, 1))], { look: { name: 'inner' } });
  const f = film({ name: 'l', look: 'paperInk', timeline: lookOn('blueprintNight', par(bg, fg)) });
  assert.equal(f.n, 12);
  const { list, look } = frame(f, 10);
  assert.equal(look.name, 'blueprintNight');
  assert.deepEqual(list.map((o) => [o.op, o.look.name]), [['look', 'blueprintNight'], ['look', 'inner']]);
  assert.equal(hashList(list[1].kids), hashList(frame(f, 5).list[1].kids), 'fg holds its last frame');
  assert.equal(frame(film({ name: 'l', look: 'paperInk', timeline: bg }), 0).list[0].op, 'paper', 'no look op without a look node');
});

test('withRootLook leaves pinned looks alone; mapLooks reaches every one of them', () => {
  const bg = shot('bg', 1, () => [paper()]);
  const fg = shot('fg', 1, () => [paper()], { look: { name: 'risoPop' } });
  const f = film({ name: 'm', look: 'paperInk', timeline: seq(bg, lookOn('screenSea', hold(1, fg))) });
  assert.equal(withRootLook(f, 'blueprintNight').timeline.kids[1].look.name, 'screenSea', 'pinned looks keep their own');

  const seen = [];
  const g = mapLooks(f, (l) => { seen.push(l.name); return { ...l, name: `${l.name}+` }; });
  assert.deepEqual(seen, ['paperInk', 'screenSea', 'risoPop']);
  assert.equal(g.look.name, 'paperInk+');
  assert.equal(g.timeline.kids[1].look.name, 'screenSea+');
  assert.equal(g.timeline.kids[1].child.child.look.name, 'risoPop+');
  assert.equal(g.timeline.kids[0].look, undefined, 'a shot with no look of its own gains none');
  assert.equal(g.n, f.n);
  assert.equal(hashList(frame(g, 0).list), hashList(frame(f, 0).list), 'only the looks moved');
  assert.deepEqual(f.timeline.kids[1].look, { name: 'screenSea' }, 'the original is untouched');
});

test('fit: anchor redraws around the target centre, reframe scales, letterbox pads', () => {
  let seen;
  const probe = (fit) => shot('p', 1, (env) => { seen = env; return [paper()]; }, { fit });
  frame(film({ name: 'f', look: 'x', timeline: probe('anchor') }), 0, { ar: '16:9' });
  assert.deepEqual([seen.W, seen.H, seen.CX, seen.CY], [1920, 1080, 960, 540]);
  const r = frame(film({ name: 'f', look: 'x', timeline: probe('reframe') }), 0, { ar: '9:16' }).list;
  assert.deepEqual([seen.W, seen.H], [1080, 1080]);
  assert.equal(r[0].op, 'group');
  assert.deepEqual(r[0].xf, [16 / 9, 0, 0, 16 / 9, (1080 - 1920) / 2, 0]);
  const lb = frame(film({ name: 'f', look: 'x', timeline: probe('letterbox') }), 0, { ar: '16:9' }).list;
  assert.deepEqual(lb.map((o) => o.op), ['paper', 'clip']);
  assert.deepEqual(lb[1].kids[0].xf, [1, 0, 0, 1, 420, 0]);
  assert.throws(() => shot('bad', 1, () => [], { fit: 'stretch' }), /unknown fit/);
});

test('describe prints the tree, spans, cels and cues', () => {
  const a = still('a', 1), b = still('b', 1);
  const f = film({ name: 'd', look: 'paperInk', timeline: seq(a, cut('iris', 0.5, a, b), hold(1, b)) });
  const text = describe(f);
  assert.match(text, /^film d {2}2\.50s {2}30 frames/);
  assert.match(text, /shot  a {2}1\.00s {2}12f {2}\[0\.00-1\.00\] {2}cels: dot/);
  assert.match(text, /cut {3}iris {2}0\.50s .* a \(last\) -> b \(first\)/);
  assert.match(text, /hold  1\.00s .* last frame of:\n {6}shot  b/);
  assert.match(text, /cuts {2}1\.00 {2}1\.50/);
  assert.match(text, /end {3}2\.50$/);
});
