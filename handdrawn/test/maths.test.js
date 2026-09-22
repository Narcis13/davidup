// 4.0 T8: numbers (core/maths.js), textRound (core/text.js) and lint measuring turned lettering (core/legible.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fraction, equation, tally, numberAxis, clock, dice, coins, pictograph, countOn, countTimes, textRound, textOnPath, handText,
  houseHand, unknowns, writing,
} from '../core/index.js';
import { bounds, hashList, line, paper, walk } from '../core/list.js';
import { film, seq, shot } from '../core/tree.js';
import { lint } from '../core/lint.js';
import { textUnits } from '../core/legible.js';
import { apple } from '../recipes/teach.js';
import sums from '../films/sums.js';

const strokesOf = (node) => { const out = []; walk([node], (op) => { if (op.op === 'stroke') out.push(op); }); return out; };
const fillsOf = (node) => { const out = []; walk([node], (op) => { if (op.op === 'fill') out.push(op); }); return out; };
const texts = (node) => { const out = []; walk([node], (op) => { if (op.op === 'group' && op.name?.startsWith('text:')) { out.push(op.name.slice(5)); return false; } }); return out; };
const inkLen = (node) => strokesOf(node).reduce((a, op) => a + op.path.sub.reduce((b, s) => {
  let L = 0;
  for (let i = 2; i < s.pts.length; i += 2) L += Math.hypot(s.pts[i] - s.pts[i - 2], s.pts[i + 1] - s.pts[i - 1]);
  return b + L;
}, 0), 0);

const DRAWN = {
  fraction: (p) => fraction(3, 4, { p }),
  equation: (p) => equation('2 + 3 = 7 - 2', { p }),
  tally: (p) => tally(7, { p }),
  numberAxis: (p) => numberAxis(0, 10, { at: 4, p }),
  clock: (p) => clock(3, 30, { p }),
  dice: (p) => dice(5, { p }),
};

test('drawn maths: groups maths:<kind>, drawn on with p in stroke order, the box the whole drawing\'s', () => {
  for (const [kind, make] of Object.entries(DRAWN)) {
    const full = make(1), half = make(0.5), L = inkLen(full);
    assert.equal(full.name, `maths:${kind}`, kind);
    // A clock's box is its face grown a touch (its rim wanders), else what it draws.
    if (kind !== 'clock') assert.deepEqual(full.box, bounds(full.kids), kind);
    assert.deepEqual(half.box, full.box, `${kind}: the box holds while it draws`);
    assert.equal(inkLen(make(0)), 0, kind);
    assert.ok(inkLen(half) > L * 0.3 && inkLen(half) < L * 0.7, `${kind}: ${inkLen(half)} of ${L}`);
    // Strokes are numbered in drawing order, so the whole writes as one piece, not every part at once.
    const orders = strokesOf(full).map((s) => s.order);
    assert.equal(new Set(orders).size, orders.length, `${kind}: every stroke its own order`);
  }
});

test('a fill arrives with the stroke before it: a die\'s pips one by one, a clock\'s pin last', () => {
  const pips = (p) => fillsOf(dice(6, { p })).length;
  assert.equal(pips(1), 6);
  assert.equal(pips(0.1), 0);
  const seen = [0.3, 0.5, 0.7, 0.9, 1].map(pips);
  for (let k = 1; k < seen.length; k++) assert.ok(seen[k] >= seen[k - 1], String(seen));
  assert.ok(seen.some((v) => v > 0 && v < 6), String(seen));
  assert.ok(!fillsOf(clock(3, 0, { p: 0.95 })).some((f) => f.name === 'pin'));
  assert.ok(fillsOf(clock(3, 0)).some((f) => f.name === 'pin'));
});

test('fraction: a over a bar over b, the bar as wide as the wider; a mixed number\'s whole to the left', () => {
  const f = fraction(3, 16, { x: 100, y: 200, size: 60 });
  assert.deepEqual(texts(f), ['3', '16']);
  const [x0, y, x1] = f.bar;
  assert.equal(y, 200);
  assert.ok(Math.abs((x0 + x1) / 2 - 100) < 1e-9);
  const [a, b] = [0, 1].map((k) => bounds([f.kids.filter((g) => g.name?.startsWith('text:'))[k]]));
  assert.ok(a[1] + a[3] < 200 && b[1] > 200, 'numerator above, denominator below');
  assert.ok(x1 - x0 > b[2], 'the bar spans the denominator');
  const m = fraction(1, 2, { whole: 3, x: 0, size: 60 });
  assert.deepEqual(texts(m), ['3', '1', '2']);
  assert.ok(bounds([m.kids[0]])[0] < m.bar[0]);
});

test('equation: a teacher\'s spacing, the minus drawn wide, digits over digits stacked', () => {
  assert.equal(equation('2+3=?').str, '2 + 3 = ?');
  assert.equal(equation('-3+(4*2)=x').str, '−3 + (4 × 2) = x');
  assert.equal(equation('10 - 2x = 4').str, '10 − 2x = 4');
  assert.deepEqual(unknowns('−', houseHand()), []);
  const e = equation('1/2 + 1/4 = 3/4', { size: 100 });
  assert.equal(e.kids.filter((k) => k.name === 'maths:fraction').length, 3);
  assert.deepEqual(texts(equation('1/2 = 2/4', { fractions: false })), ['1 / 2 = 2 / 4']);
  assert.throws(() => equation('2 + 3 = ?', { answer: [5, 6] }), /2 answer/);
  assert.throws(() => equation('2 # 3'), /cannot read/);
});

test('equation: the ? is a drawn mark, not a word, and gives way to the answer as p passes 0.5', () => {
  const at = (p) => equation('2 + 3 = ?', { answer: 5, p, size: 120 });
  const q = (e) => e.kids.some((k) => k.name === 'mark:question');
  assert.deepEqual(texts(at(0.5)), ['2 + 3 =']);
  assert.ok(q(at(0.5)) && !at(0.5).resolved);
  assert.ok(!q(at(0.51)) && at(0.51).resolved);
  assert.deepEqual(texts(at(1)), ['2 + 3 =', '5']);
  assert.equal(at(1).str, '2 + 3 = 5');
  // Nothing moves when it resolves: the box and the slot are the same either side, the answer inside the slot.
  assert.deepEqual(at(0.2).box, at(1).box);
  assert.deepEqual(at(0.2).slots, at(1).slots);
  const [sx, , sw] = at(1).slots[0], five = bounds([at(1).kids.find((k) => k.name === 'text:5')]);
  assert.ok(five[0] >= sx - 8 && five[0] + five[2] <= sx + sw + 8);
  // Before 0.5 the equation writes on; after, the answer does, stroke by stroke.
  assert.ok(inkLen(at(0.25)) < inkLen(at(0.5)));
  assert.ok(inkLen(at(0.6)) < inkLen(at(0.9)));
  // Without an answer p writes it all and the ? stays.
  assert.ok(q(equation('2 + ? = 5')) && !equation('2 + ? = 5').resolved);
  // The equation writes in order under writeOn's schedule: the words, then the ?.
  const plan = writing(at(0.5), { per: 'word', wps: 2 });
  assert.ok(plan.units.length >= 5, String(plan.units.length));
});

test('tally: gates of five, a fractional count draws its last mark part way', () => {
  assert.equal(strokesOf(tally(7)).length, 7);
  assert.equal(tally(7).count, 7);
  const five = strokesOf(tally(5)), gate = five[4].path.box;
  assert.ok(gate[2] > five[0].path.box[2] * 5, 'the fifth strikes across');
  const h = tally(2.5);
  assert.equal(h.count, 2);
  assert.equal(strokesOf(h).length, 3);
  assert.ok(inkLen(h) > inkLen(tally(2)) && inkLen(h) < inkLen(tally(3)));
  assert.deepEqual(tally(2.5).box, tally(3).box);
  assert.deepEqual(tally(0).kids, []);
  assert.throws(() => tally(-1), /count/);
});

test('numberAxis: ticks every step, numbers under them (the ends past 11), dots at `at`', () => {
  const a = numberAxis(0, 10, { x: 540, y: 500, width: 800, at: [3, 7] });
  assert.equal(a.xs.length, 11);
  assert.deepEqual(a.ends, [140, 940]);
  assert.equal(a.xs[5][1], 540);
  assert.equal(texts(a).length, 11);
  assert.equal(fillsOf(a).length, 2);
  assert.deepEqual(texts(numberAxis(0, 20)), ['0', '20']);
  assert.deepEqual(texts(numberAxis(0, 20, { marks: 5 })), ['0', '5', '10', '15', '20']);
  assert.throws(() => numberAxis(0, 10, { at: 12 }), /not on the line/);
  assert.throws(() => numberAxis(5, 5), /not a line/);
});

test('clock: hands at the time (the hour hand moved on by the minutes), four numbers by default', () => {
  const c = clock(3, 0, { x: 0, y: 0, r: 100 }), [hour, minute] = c.hands;
  assert.ok(hour[0] > 49 && Math.abs(hour[1]) < 1e-6, 'three o\'clock: the hour hand to the right');
  assert.ok(Math.abs(minute[0]) < 1e-6 && minute[1] < -77, 'the minute hand up');
  const half = clock(3, 30, { r: 100 }).hands[0];
  assert.ok(Math.abs(Math.atan2(half[1], half[0]) - Math.PI / 12) < 1e-9, 'half past: half way to 4');
  assert.deepEqual(texts(c), ['12', '3', '6', '9']);
  assert.equal(texts(clock(1, 0, { numbers: 'all' })).length, 12);
  assert.equal(texts(clock(1, 0, { numbers: 'none' })).length, 0);
  assert.equal(strokesOf(clock(1, 0, { minutes: true, numbers: 'none' })).length, 1 + 60 + 2);
});

test('dice, coins, pictograph: faces 1 to 6; objects appear one at a time and pop', () => {
  for (let n = 1; n <= 6; n++) assert.equal(fillsOf(dice(n)).length, n);
  assert.equal(fillsOf(dice([2, 3])).length, 5);
  assert.throws(() => dice(7), /face/);
  const c = (p) => coins(5, { value: 10, p }).kids.length;
  assert.deepEqual([0, 0.1, 0.39, 0.41, 1].map(c), [0, 1, 2, 3, 5]);
  assert.deepEqual(texts(coins(3, { value: 10 })), ['10', '10', '10']);
  assert.deepEqual(coins(5, { p: 0.2 }).box, coins(5).box);
  assert.equal(coins(4, { layout: 'stack' }).kids.length, 4);
  const pg = pictograph(2.5, apple, { cell: 100 });
  assert.equal(pg.kids.length, 3);
  let clipped = 0;
  walk([pg], (op) => { if (op.op === 'clip') clipped++; });
  assert.equal(clipped, 1, 'the half apple is cut down');
  assert.deepEqual(pictograph(3, apple, { p: 0.5 }).box, pictograph(3, apple).box);
  // A popping object is scaled; a whole one sits at scale 1.
  const scaleOf = (g) => Math.hypot(g.xf[0], g.xf[1]);
  assert.ok(scaleOf(pictograph(1, apple, { p: 0.2 }).kids[0]) < 0.99);
  assert.equal(scaleOf(pictograph(1, apple, { p: 1 }).kids[0]), 1);
});

test('countOn: each number written as its object arrives, at the object or as a running count', () => {
  assert.deepEqual(countTimes(3, { t0: 1, per: 0.5 }), [1, 1.5, 2]);
  const at = [[0, 0], [100, 0], [200, 0]];
  assert.equal(countOn(3, 0.9, { t0: 1, per: 0.5, at }).count, 0);
  assert.deepEqual(texts(countOn(3, 1.6, { t0: 1, per: 0.5, at })), ['1', '2']);
  assert.ok(inkLen(countOn(3, 1.55, { t0: 1, per: 0.5, at })) < inkLen(countOn(3, 1.9, { t0: 1, per: 0.5, at })), 'the newest writes on');
  assert.deepEqual(texts(countOn(3, 5, { t0: 1, per: 0.5, at: [50, 50] })), ['3'], 'a point: the running count');
  assert.deepEqual(texts(countOn(3, 5, { at: (j) => [j * 10, 0], from: 10 })), ['10', '11', '12']);
});

test('textRound: upright all the way round, outside or inside the circle', () => {
  const mid = (g) => { const b = bounds(g.kids); return [b[0] + b[2] / 2, b[1] + b[3] / 2]; };
  const top = textRound('may', { r: 300, at: -Math.PI / 2, size: 40 }), bottom = textRound('may', { r: 300, at: Math.PI / 2, size: 40 });
  assert.equal(top.name, 'text:may');
  assert.ok(mid(top)[1] < -300 && mid(bottom)[1] > 300, 'outside the ring at the top and the bottom');
  assert.ok(Math.hypot(...mid(textRound('may', { r: 300, at: Math.PI / 2, side: 'in', size: 40 }))) < 300);
  // Upright: the first letter is on the left at the top and at the bottom alike.
  const first = (g) => bounds([strokesOf(g).find((s) => s.name.startsWith('g0.'))]);
  assert.ok(first(top)[0] < mid(top)[0] && first(bottom)[0] < mid(bottom)[0]);
  assert.throws(() => textRound('x', { side: 'over' }), /side/);
});

test('lint measures lettering turned along a path across its own line, and level lettering as before', () => {
  const look = 'whiteboard';
  const x = (node) => textUnits([paper(), node], look)[0].x;
  const level = handText('october', 100, 100, { size: 40, ink2: null });
  const standing = textRound('october', { r: 360, at: 0, size: 40, ink2: null });
  assert.ok(Math.abs(x(standing) - x(level)) < 0.15 * x(level), `${x(standing)} vs ${x(level)}`);
  const pair = textRound('april', { r: 360, at: Math.PI, size: 40, ink2: null });
  assert.ok(Math.abs(x(pair) - x(handText('april', 0, 0, { size: 40, ink2: null }))) < 0.15 * x(level), 'two x-height letters, steeply off level');
  // Straight along a level path: nothing changes.
  assert.equal(x(textOnPath('level line', line(0, 100, 800, 100), { size: 40, ink2: null })), x(textOnPath('level line', line(0, 100, 800, 100), { size: 40, ink2: null })));
  const f = film({ name: 'ring', look, audience: 'kids-9', timeline: seq(shot('s', 2, () => [paper(), standing]), shot('sign', 2, () => [paper()])) });
  assert.ok(!lint(f).some((l) => l.rule === 'text-size'), 'a label standing up the side of a ring is its real size');
});

test('films/sums: lint clean at kids-9; the sum resolves as the fifth apple lands, the months written in turn', () => {
  assert.equal(sums.audience, 'kids-9');
  assert.deepEqual(lint(sums).filter((l) => l.level !== 'warning'), []);
  assert.ok(hashList([equation('2 + 3 = ?', { answer: 5, p: 0.5 })]) !== hashList([equation('2 + 3 = ?', { answer: 5, p: 1 })]));
});
