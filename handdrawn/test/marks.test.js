// 4.0 T7: emphasis marks, the teacher's pen (core/marks.js underline ... question) and wordBox (core/text.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPHASIS, underline, circleAround, arrowTo, highlight, strike, bracket, starburst, callout, tickMark, crossMark, question,
  textBox, wordBox, handText, writeOn,
} from '../core/index.js';
import { bounds, circle, fill, hashList, paper, stroke, meta, walk } from '../core/list.js';
import { cel, film, frame, place, seq, shot } from '../core/tree.js';
import { ramp } from '../core/curves.js';
import { signOff } from '../core/text.js';
import { lint, formatFinding } from '../core/lint.js';
import marked from '../films/marked.js';

const BOX = [100, 200, 300, 60];
const strokesOf = (node) => { const out = []; walk([node], (op) => { if (op.op === 'stroke') out.push(op); }); return out; };
const inkLen = (node) => strokesOf(node).reduce((a, op) => a + op.path.sub.reduce((b, s) => {
  let L = 0;
  for (let i = 2; i < s.pts.length; i += 2) L += Math.hypot(s.pts[i] - s.pts[i - 2], s.pts[i + 1] - s.pts[i - 1]);
  return b + L;
}, 0), 0);

const ALL = {
  underline: (p, o) => underline(BOX, p, o),
  circleAround: (p, o) => circleAround(BOX, p, o),
  arrowTo: (p, o) => arrowTo([0, 0], BOX, { ...o, p }),
  highlight: (p, o) => highlight(BOX, p, o),
  strike: (p, o) => strike(BOX, p, o),
  bracket: (p, o) => bracket(BOX, 'left', p, o),
  starburst: (p, o) => starburst([500, 500], p, o),
  callout: (p, o) => callout('look', BOX, { ...o, p }),
  tickMark: (p, o) => tickMark([50, 50], p, o),
  crossMark: (p, o) => crossMark([50, 50], p, o),
  question: (p, o) => question([540, 540], 160, p, o),
};

test('every emphasis mark is a group mark:<kind> of pen strokes, its box what it draws', () => {
  assert.deepEqual([...EMPHASIS].sort(), Object.keys(ALL).sort());
  for (const [kind, make] of Object.entries(ALL)) {
    const m = make(1, {});
    assert.equal(m.name, `mark:${kind}`, kind);
    assert.ok(strokesOf(m).length > 0, kind);
    assert.deepEqual(m.box, bounds(m.kids), kind);
    for (const op of strokesOf(m)) assert.notEqual(op.wobble, 0, `${kind}: a wobble-0 stroke is ruled and escapes the hand`);
  }
});

test('marks draw on with p: nothing at 0, part way at 0.5, the whole at 1; fills only at the end', () => {
  for (const [kind, make] of Object.entries(ALL)) {
    const full = inkLen(make(1, {})), half = inkLen(make(0.5, {}));
    assert.equal(inkLen(make(0, {})), 0, kind);
    assert.ok(half > full * 0.3 && half < full * 0.7, `${kind}: ${half} of ${full}`);
    assert.deepEqual(make(0.5, {}).box, make(1, {}).box, `${kind}: the box is the whole mark's while it draws`);
  }
  // The p may also come in the options.
  assert.equal(hashList([underline(BOX, { p: 0.5 })]), hashList([underline(BOX, 0.5)]));
  const closed = arrowTo([0, 0], [300, 0], { head: 'closed' });
  assert.ok(closed.kids.some((k) => k.op === 'fill'));
  assert.ok(!arrowTo([0, 0], [300, 0], { head: 'closed', p: 0.9 }).kids.some((k) => k.op === 'fill'));
  const dot = callout('x', [500, 500], { leader: 'dot' });
  assert.ok(dot.kids.some((k) => k.op === 'fill' && k.name === 'dot'));
});

test('marks are seeded by name: same name, same wobble anywhere; another name, another mark', () => {
  const a = underline(BOX), moved = underline([BOX[0] + 50, ...BOX.slice(1)]);
  assert.deepEqual(a.kids[0].path.sub[0].pts.map((v, i) => (i % 2 ? v : v - BOX[0])).map(Math.round),
    moved.kids[0].path.sub[0].pts.map((v, i) => (i % 2 ? v : v - BOX[0] - 50)).map(Math.round));
  assert.notEqual(hashList([underline(BOX, { name: 'x' })]), hashList([underline(BOX, { name: 'y' })]));
  assert.equal(hashList([circleAround(BOX, { name: 'x' })]), hashList([circleAround(BOX, { name: 'x' })]));
  assert.notEqual(hashList([circleAround(BOX, { seed: 1 })]), hashList([circleAround(BOX, { seed: 2 })]));
});

test('marks come after lettering in a reveal: order 1e6 by default, stroke after stroke inside', () => {
  const words = handText('hi there', 100, 300, { size: 60, ink2: null });
  const u = underline(words), card = [words, u];
  for (const op of strokesOf(u)) assert.ok(op.order >= 1e6);
  // Half-way through the card the words are written and the underline is not begun... or is only begun.
  const at = writeOn(card, { t: 0.4 + 2 / 2 - 0.01, per: 'word', wps: 2 });
  const shown = strokesOf(at).filter((op) => op.name === 'underline');
  assert.equal(shown.length, 0);
  assert.deepEqual(strokesOf(strike(BOX, { double: true, order: 5 })).map((op) => op.order), [5, 6]);
});

test('geometry: an underline under the box, a loop round it, a strike through it, a brace beside it', () => {
  const [x, y, w, h] = BOX;
  const ub = underline(BOX).box;
  assert.ok(ub[1] > y + h && ub[0] < x + 10 && ub[0] + ub[2] > x + w);
  const cb = circleAround(BOX).box;
  assert.ok(cb[0] < x && cb[1] < y && cb[0] + cb[2] > x + w && cb[1] + cb[3] > y + h);
  const sb = strike(BOX).box;
  assert.ok(sb[1] > y && sb[1] + sb[3] < y + h);
  for (const side of ['left', 'right', 'top', 'bottom']) {
    const b = bracket(BOX, side), bb = b.box;
    if (side === 'left') assert.ok(bb[0] + bb[2] <= x && b.tip[0] < bb[0] + 3);
    if (side === 'right') assert.ok(bb[0] >= x + w && b.tip[0] > bb[0] + bb[2] - 3);
    if (side === 'top') assert.ok(bb[1] + bb[3] <= y);
    if (side === 'bottom') assert.ok(bb[1] >= y + h);
  }
  for (const kind of ['square', 'round']) assert.ok(bracket(BOX, 'right', { kind }).box[0] >= x + w);
  // An arrow between boxes stops short of both, its head at the end.
  const A = [0, 0, 100, 40], B = [400, 300, 100, 40], arr = arrowTo(A, B, { curve: 0 });
  assert.ok(arr.from[0] >= 100 || arr.from[1] >= 40);
  assert.ok(arr.to[0] <= 400 || arr.to[1] <= 300);
  assert.deepEqual(arr.kids.map((k) => k.name), ['shaft', 'head']);
  assert.deepEqual(arrowTo(A, B, { head: 'none' }).kids.map((k) => k.name), ['shaft']);
  const hl = highlight(BOX).kids[0];
  assert.equal(hl.tool, 'marker');
  assert.equal(hl.blend, 'multiply');
  const q = question([540, 540], 200).box;
  assert.ok(Math.abs(q[3] - 200) <= 8 && Math.abs(q[1] + q[3] / 2 - 540) < 1, 'the ? is 200 tall (and a pen)');
});

test('bad kinds, sides and heads are errors that name the choices', () => {
  assert.throws(() => bracket(BOX, 'middle'), /left, right, top, bottom/);
  assert.throws(() => bracket(BOX, 'left', { kind: 'angle' }), /curly, square, round/);
  assert.throws(() => arrowTo([0, 0], [1, 1], { head: 'fish' }), /open, closed, none/);
  assert.throws(() => callout('x', [0, 0], { leader: 'rope' }), /dot, arrow, line, none/);
  assert.throws(() => underline('nope'), /target must be/);
});

test('callout: the copy is lettered (text:), then the leader; the leader reaches the target', () => {
  const c = callout('a star', [600, 600], { leader: 'arrow', dir: Math.PI / 2, reach: 150 });
  const copy = c.kids.find((k) => k.name === 'text:a star');
  assert.ok(copy);
  assert.ok(c.copy[1] > 600, 'below the point');
  const shaft = c.kids.find((k) => k.name === 'shaft'), pts = shaft.path.sub[0].pts;
  assert.ok(Math.hypot(pts[pts.length - 2] - 600, pts[pts.length - 1] - 600) < 2);
  for (const op of strokesOf(copy)) assert.ok(op.order < shaft.order);
  const inBox = callout('here', [0, 0], { box: [300, 300, 200, 80] });
  assert.ok(inBox.copy[0] >= 300 && inBox.copy[0] + inBox.copy[2] <= 500);
});

test('wordBox: a word of lettering by index or by itself, punctuation and case aside', () => {
  const g = textBox('The sun, the SUN and the moon', [0, 0, 400, 400], { size: 50 });
  const byIndex = wordBox(g, 1), byWord = wordBox(g, 'sun'), second = wordBox(g, 'sun', { nth: 1 });
  assert.deepEqual(byIndex, byWord);
  assert.notDeepEqual(byWord, second);
  const whole = g.box;
  for (const b of [byWord, second]) assert.ok(b[0] >= whole[0] - 1 && b[0] + b[2] <= whole[0] + whole[2] + 1 && b[2] > 0 && b[2] < whole[2] / 2);
  assert.deepEqual(wordBox({ op: 'group', kids: [g] }, 'moon'), wordBox(g, 6));
  assert.throws(() => wordBox(g, 'star'), /no 'star'/);
  assert.throws(() => wordBox(g, 9), /no word 9/);
  assert.throws(() => wordBox(circleAround(BOX), 0), /no lettering/);
});

// A scratch film (as test/lint.test.js): an anchor cel, then the marks; a sign-off.
const dot = cel('dot', () => [fill(circle(0, 0, 60), 'fills.0', { finish: true }), stroke(circle(0, 0, 60), 'ink', { w: 2 })], { box: [-62, -62, 124, 124] });
const scene = (extra) => shot('marks', 1, (c) => [paper(), meta('anchor', { cel: 'dot' }), place(c.CX, c.CY, {}, dot()), ...extra()]);
const end = shot('end', 2, ({ t, CX, CY }) => [
  paper(), meta('anchor', { name: 'signOff' }), signOff('a', 'b', { x: CX, y: CY, size: 80, pA: ramp(0, 0.2, t), pB: ramp(0.2, 0.4, t) }),
]);
const make = (extra) => film({ name: 'scratch', look: 'paperInk', timeline: seq(scene(extra), end) });

test('lint: emphasis marks are not words; a callout\'s copy is', () => {
  const marksOnly = make(() => Object.entries(ALL).filter(([k]) => k !== 'callout').map(([, m]) => m(1, {})));
  assert.deepEqual(lint(marksOnly).map(formatFinding), []);
  const got = lint(make(() => [callout('look here', [540, 700])]));
  assert.deepEqual(got.map((f) => f.rule), ['words']);
  assert.match(got[0].detail, /"look here"/);
});

test('films/marked: the sentence, then an underline, a circle and a labelled arrow, each drawing on in turn', () => {
  assert.deepEqual(lint(marked).map(formatFinding), []);
  // The first frame each mark's strokes show in, and the frame it is whole in.
  // Told apart by the order the film gives each mark: 1e6, 2e6, 3e6 (the label's copy, its leader 5e5 on).
  const which = (o) => (o < 1e6 ? null : o < 2e6 ? 'underline' : o < 3e6 ? 'circle' : o < 3.5e6 ? 'label' : 'arrow');
  const first = {}, done = {};
  for (let k = 0; k < 108; k++) {
    const seen = new Set();
    walk(frame(marked, k).list, (op) => { if (op.op === 'stroke' && which(op.order ?? 0)) seen.add(which(op.order)); });
    for (const n of seen) { first[n] ??= k; done[n] = k; }
  }
  const order = ['underline', 'circle', 'label', 'arrow'];
  for (const n of order) assert.ok(first[n] !== undefined, `${n} never drawn`);
  for (let i = 1; i < order.length; i++) assert.ok(first[order[i]] > first[order[i - 1]], `${order[i]} starts after ${order[i - 1]}`);
  assert.equal(done.arrow, 107, 'the marks hold to the end of the shot');
});
