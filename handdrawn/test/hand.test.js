// S11: the hand asset and look.hand -- glyphs, track, slant and drift from the look's hand; the pen's
// wobble, overshoot, hook and pressure; doodle speed; '~hand:<id>'; the shot's hand reaching cels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCatalogue } from '../core/assets.js';
import { doodle } from '../core/doodle.js';
import { expand } from '../core/finish.js';
import { asHand, fallbacks, glyph, GLYPHS, houseHand, TRACK, withHand } from '../core/glyphs.js';
import { hashList, line, stroke, text, walk } from '../core/list.js';
import { handOf, hashLook, LOOKS, resolveLook, withLook } from '../core/looks.js';
import { register } from '../core/store.js';
import { handText, measure, signOff } from '../core/text.js';
import { drawStroke, hook, overshoot, pressureAt } from '../core/tools.js';
import { cel, film, frame, shot } from '../core/tree.js';
import { rng } from '../core/rand.js';
import { synthHand, SYNTH } from '../cli/hand.mjs';

const TEST = synthHand('test');
register({ test: TEST });
const strokes = (node) => { const out = []; walk([node], (op) => { if (op.op === 'stroke') out.push(op); }); return out; };

test('house: the 2.0 glyphs and tool defaults as a hand record, and naming it changes nothing', () => {
  const h = houseHand();
  assert.equal(h.name, 'house');
  assert.equal(h.kind, 'hand');
  assert.equal(h.glyphs, GLYPHS);
  assert.equal(h.track, TRACK);
  assert.deepEqual([h.slant, h.baselineDrift, h.stroke.wobble, h.stroke.speed, h.stroke.overshoot, h.stroke.hook], [0, 3, 1.8, 1000, 0, 0]);
  assert.equal(asHand(h), h);
  assert.equal(handOf('paperInk'), null);
  assert.equal(handOf('paperInk~hand:house'), null, 'house is no hand to letter in');
  const plain = handText('Hello, mini', 100, 200, { size: 60 });
  assert.equal(hashList([handText('Hello, mini', 100, 200, { size: 60, hand: h })]), hashList([plain]));
  assert.equal(hashList([handText('Hello, mini', 100, 200, { size: 60, look: 'risoPop' })]), hashList([plain]));
  assert.equal(measure('Hello', 60, 'paperInk'), measure('Hello', 60));
});

test('the test hand: deterministic, valid, the one in the store, and not the house', () => {
  assert.deepEqual(synthHand('test'), TEST);
  assert.notDeepEqual(synthHand('other'), TEST);
  assert.deepEqual({ track: TEST.track, slant: TEST.slant, stroke: TEST.stroke }, { track: SYNTH.track, slant: -6, stroke: SYNTH.stroke });
  assert.equal(TEST.stroke.wobble, 2.2);
  assert.equal(TEST.stroke.overshoot, 0.15);
  const st = readCatalogue();
  assert.equal(st.entry('test').kind, 'hand');
  assert.deepEqual(st.json('test'), JSON.parse(JSON.stringify(TEST)), 'regenerate: hdf hand --synth test');
  assert.deepEqual(Object.keys(TEST.glyphs).sort(), Object.keys(GLYPHS).sort());
  assert.notDeepEqual(TEST.glyphs.a.s, GLYPHS.a.s);
});

test("'~hand:<id>' puts the record in the look: same palette, another hash; an unknown hand is named", () => {
  const lk = resolveLook('paperInk~hand:test');
  assert.equal(lk.name, 'paperInk~hand:test');
  assert.equal(lk.hand.name, 'test');
  assert.deepEqual(lk.palette, LOOKS.paperInk.palette);
  assert.notEqual(hashLook(lk), hashLook('paperInk'));
  assert.notEqual(hashLook(lk), hashLook('paperInk~hand:house'));
  assert.equal(handOf(lk).name, 'test');
  assert.equal(handOf({ name: 'risoPop~hand:test' }).name, 'test');
  assert.equal(handOf(withLook('paperInk', { hand: TEST })).stroke.wobble, 2.2, 'a look object may carry a hand record itself');
  assert.throws(() => resolveLook('paperInk~hand:nope'), /no hand 'nope' in the store.*hdf hand --synth nope/);
  // A film's own asset wins over the store.
  const own = { ...TEST, name: 'mine', slant: 12 };
  assert.equal(resolveLook('paperInk~hand:mine', { mine: own }).hand.slant, 12);
});

test('handText and measure letter in the hand: its glyphs, track, slant and drift', () => {
  const H = asHand(TEST), house = handText('mini', 0, 0, { size: 100, ink2: null });
  const mine = handText('mini', 0, 0, { size: 100, ink2: null, hand: H });
  assert.notEqual(hashList([mine]), hashList([house]));
  assert.equal(strokes(mine).length, strokes(house).length, 'the same strokes, drawn another way');
  assert.equal(measure('mini', 100, 'paperInk~hand:test'), measure('mini', 100, H));
  const w = (s) => ['m', 'i', 'n', 'i'].reduce((a, c) => a + glyph(c, H).w + H.track, -H.track);
  assert.ok(Math.abs(measure('mini', 100, H) - w()) < 1e-9);
  // Slant: the top of an 'l' leans left of its foot in a backhand, right of it in a forward hand.
  const top = (slant) => {
    const [s] = strokes(handText('l', 0, 0, { size: 100, ink2: null, hand: { ...TEST, glyphs: { l: { w: 20, s: [[8, -72, 8, 0]] } }, slant, baselineDrift: 0 } }));
    const p = s.path.sub[0].pts;
    return p[0] - p[2];
  };
  assert.ok(Math.abs(top(0)) < 4);
  assert.ok(top(-20) < top(0) - 20 && top(20) > top(0) + 20);
  // Drift 0: every glyph sits on its own baseline to within the small turns.
  const flat = handText('iiiiiiii', 0, 0, { size: 100, ink2: null, hand: { ...TEST, baselineDrift: 0 } });
  for (const s of strokes(flat)) assert.ok(Math.max(...s.path.sub[0].pts.filter((_, i) => i % 2)) < 5);
  // The pen wobble of the letters follows the hand's.
  assert.ok(strokes(mine)[0].wobble > strokes(house)[0].wobble);
});

test('a glyph the hand lacks falls back to house, per glyph, and is listed', () => {
  const thin = asHand({ name: 'thin', glyphs: { a: { w: 40, s: [[[0, 0], [30, -40]]] } } });
  assert.deepEqual(thin.glyphs.a.s, [[0, 0, 30, -40]], 'strokes as [[x, y], ...] come in flat');
  assert.equal(glyph('a', thin).own, true);
  assert.equal(glyph('b', thin).own, false);
  assert.equal(glyph('b', thin).s, GLYPHS.b.s);
  // T2: an accent is the hand's letter and a mark, the house's when the hand has none (so not all its own).
  assert.deepEqual(glyph('á', thin).s[0], thin.glyphs.a.s[0], "á is built on the hand's a");
  assert.equal(glyph('á', thin).own, false, 'with the house acute');
  assert.equal(glyph('á', asHand({ ...thin, marks: { acute: { s: [[20, -60, 12, -50]] } } })).own, true, 'its own acute');
  assert.deepEqual(fallbacks('a ba!', thin), ['b', '!']);
  assert.deepEqual(fallbacks('mini film', TEST), []);
  assert.deepEqual(fallbacks('anything at all'), []);
});

test('the pen: overshoot runs corners past, hook flicks entries, pressure swells; seeded and pure', () => {
  const L = [{ pts: [0, 0, 100, 0, 100, 100], closed: false }];
  const o = overshoot(L, 0.15, 10);
  assert.equal(o.length, 2);
  assert.deepEqual(o[0].pts.slice(-2), [115, 0]);
  assert.deepEqual(o[1].pts.slice(0, 4), [100, -15, 100, 0]);
  const smooth = [{ pts: [0, 0, 10, 1, 20, 3, 30, 6], closed: false }];
  assert.equal(overshoot(smooth, 0.15, 10)[0], smooth[0], 'no corner, no change');
  assert.equal(overshoot(L, 0, 10), L);
  // Long segments overshoot at most 24 pen widths' worth.
  assert.deepEqual(overshoot([{ pts: [0, 0, 1000, 0, 1000, 1000], closed: false }], 0.15, 1)[0].pts.slice(-2), [1000 + 0.15 * 24, 0]);

  const hk = hook([{ pts: [0, 0, 100, 0], closed: false }], 0.35, 4, rng(3));
  const p = hk[0].pts, R = 0.35 * 1.5 * 4;
  assert.equal(p.length, 12);
  assert.deepEqual(p.slice(-4), [0, 0, 100, 0]);
  for (let i = 0; i < 8; i += 2) assert.ok(Math.hypot(p[i], p[i + 1]) <= 2 * R + 1e-9);
  assert.ok(p[6] < 0, 'the last step of the flick heads into the line');
  assert.deepEqual(hook([{ pts: [0, 0, 100, 0], closed: false }], 0.35, 4, rng(3)), hk);
  assert.deepEqual(hook([{ pts: [0, 0, 3, 0], closed: false }], 0.35, 4, rng(3))[0].pts, [0, 0, 3, 0], 'too short to carry one');

  assert.deepEqual([0, 0.1, 0.3, 0.5, 0.7, 0.9, 1].map((u) => pressureAt([0.7, 1, 0.85], u)).map((v) => +v.toFixed(3)), [0.7, 0.7, 0.85, 1, 0.925, 0.85, 0.85]);
});

// A context that records what the pen does.
function recorder() {
  const log = { widths: [], strokes: 0, moves: [] };
  const ctx = {
    save() {}, restore() {}, beginPath() {}, closePath() {}, setLineDash() {},
    moveTo(x, y) { log.moves.push([x, y]); }, lineTo() {},
    stroke() { log.strokes++; log.widths.push(ctx.lineWidth); },
    lineWidth: 1, globalAlpha: 1,
  };
  return { ctx, log };
}

test('drawStroke: a look with a hand draws its pens pressed and hooked; a ruled line and the house stay as they were', () => {
  const op = stroke(line(0, 0, 300, 0), 'ink', { w: 4, seed: 9 });
  const house = recorder(), hand = recorder(), ruled = recorder();
  drawStroke(house.ctx, op, LOOKS.paperInk);
  drawStroke(hand.ctx, op, resolveLook('paperInk~hand:test'));
  drawStroke(ruled.ctx, stroke(line(0, 0, 300, 0), 'ink', { w: 4, seed: 9, wobble: 0 }), resolveLook('paperInk~hand:test'));
  assert.equal(house.log.strokes, 1);
  assert.equal(ruled.log.strokes, 1);
  assert.ok(hand.log.strokes > 1, 'pressure draws a segment at a time');
  assert.ok(Math.min(...hand.log.widths) < 3 && Math.max(...hand.log.widths) <= 4 && Math.max(...hand.log.widths) > 3.9);
  assert.ok(hand.log.moves[0][0] !== 0 || hand.log.moves[0][1] !== 0, 'the flick starts off the line');
  const again = recorder();
  drawStroke(again.ctx, op, resolveLook('paperInk~hand:test'));
  assert.deepEqual(again.log, hand.log);
});

test("doodle reveals at the hand's speed", () => {
  const L = [[0, 0], [1150, 0]];
  const dur = (hand) => withHand(hand, () => doodle().line(L, { smooth: false }).end);
  assert.ok(Math.abs(dur(null) - (1150 / 1000 + 0.03)) < 1e-9);
  assert.ok(Math.abs(dur(TEST) - (1 + 0.03)) < 1e-9);
  assert.equal(withHand(TEST, () => doodle({ speed: 500 }).line(L, { smooth: false }).end), 1150 / 500 + 0.03, 'a given speed wins');
});

test("a shot is drawn in its look's hand: signOff, cels and text ops letter in it; the house is unchanged", () => {
  const word = cel('word', () => [handText('hi', 0, 0, { size: 40, ink2: null })], { box: [-10, -60, 120, 80] });
  const draw = ({ CX, CY }) => [word(), signOff('mini', 'film', { x: CX, y: CY }), text('fox', 10, 10, { size: 30 })];
  const a = film({ name: 'h', look: 'paperInk', timeline: shot('s', 1, draw) });
  const b = film({ name: 'h', look: 'paperInk~hand:test', timeline: shot('s', 1, draw) });
  const fa = frame(a, 0), fb = frame(b, 0);
  assert.notEqual(hashList(fa.list), hashList(fb.list));
  const celOf = (f) => { let g; walk(f.list, (op) => { if (op.cel === 'word') g ??= op; }); return g; };
  assert.notEqual(celOf(fa), celOf(fb), 'a cel is cached apart per hand');
  assert.equal(celOf(frame(b, 1)), celOf(fb), 'and memoised within one');
  assert.equal(celOf(frame(a, 1)), celOf(fa));
  // The text op is lettered when expanded, in the look's hand.
  const textOf = (f) => { let t; walk(expand(f.list, f.look), (op) => { if (op.name === 'text:fox') t ??= op; }); return t; };
  assert.notEqual(hashList([textOf(fa)]), hashList([textOf(fb)]));
  assert.equal(strokes(textOf(fb)).length, strokes(textOf(fa)).length);
});
