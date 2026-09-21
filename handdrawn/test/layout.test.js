// T5: copy flows into a box and the box is known.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { houseHand, withHand } from '../core/glyphs.js';
import { layoutWith } from '../core/layout.js';
import { bounds, hashList, text, walk } from '../core/list.js';
import { expand } from '../core/finish.js';
import { bullets, handText, layout, measure, measureBox, textBox } from '../core/text.js';
import { reveal } from '../core/tools.js';
import { synthHand } from '../cli/hand.mjs';

const TEST = synthHand('test');
const SLANT = { ...TEST, name: 'slant', slant: 14, baselineDrift: 6, track: 12 };
const HANDS = [['house', houseHand()], ['test', TEST], ['slant', SLANT]];
const PARA = 'A paragraph wraps into a box in every hand, and the box is known: nothing spills out of it.';
const strokes = (node) => { const out = []; walk([node].flat(), (op) => { if (op.op === 'stroke') out.push(op); }); return out; };
const inside = (b, B, tol = 0.5) => b[0] >= B[0] - tol && b[1] >= B[1] - tol && b[0] + b[2] <= B[0] + B[2] + tol && b[1] + b[3] <= B[1] + B[3] + tol;

test('layout wraps at spaces to the width, from real advances; every word kept, in order', () => {
  for (const [name, hand] of HANDS) for (const w of [180, 320, 700]) {
    const L = layout(PARA, { size: 40, w, hand });
    assert.ok(L.lines.length > 1 || w === 700, `${name} ${w}`);
    for (const l of L.lines) {
      assert.ok(l.w <= w + 1e-6, `${name} ${w}: '${l.str}' is ${l.w}`);
      assert.equal(l.w, measure(l.str, 40, hand));
    }
    assert.equal(L.lines.map((l) => l.str).join('').replace(/ /g, ''), PARA.replace(/ /g, ''), `${name} ${w}`);
    // greedy: the next line's first word would not have fitted on the line before (unless it is a cut word)
    const words = new Set(PARA.split(' '));
    for (let i = 1; i < L.lines.length; i++) {
      const next = L.lines[i].str.split(' ')[0];
      if (!words.has(next) || !words.has(L.lines[i - 1].str.split(' ').at(-1))) continue;
      assert.ok(measure(`${L.lines[i - 1].str} ${next}`, 40, hand) > w, `${name} ${w} line ${i}`);
    }
    L.lines.forEach((l, i) => assert.equal(l.y, i * 50));   // lineH defaults to 1.25 sizes
  }
});

test("layout: '\\n' breaks, a word too long for the width is cut, maxLines ends in '...', char and none", () => {
  const L = layout('one\ntwo three', { size: 50 });
  assert.deepEqual(L.lines.map((l) => l.str), ['one', 'two three']);
  const long = layout('supercalifragilistic', { size: 50, w: 200 });
  assert.ok(long.lines.length > 1 && long.lines.every((l) => l.w <= 200));
  assert.equal(long.lines.map((l) => l.str).join(''), 'supercalifragilistic');
  const cut = layout(PARA, { size: 40, w: 300, maxLines: 2 });
  assert.equal(cut.lines.length, 2);
  assert.ok(cut.truncated && cut.lines[1].str.endsWith('...') && cut.lines[1].w <= 300);
  assert.equal(layout(PARA, { size: 40, w: 300 }).truncated, false);
  const ch = layout('abcdefghijkl mnop', { size: 50, w: 150, wrap: 'char' });
  assert.ok(ch.lines.every((l) => l.w <= 150) && ch.lines.length >= 3);
  assert.equal(layout(PARA, { size: 40, w: 100, wrap: 'none' }).lines.length, 1);
});

test('layout: align about the anchor or in a box, valign by the ink; box is the ink of the glyphs', () => {
  const c = layout('hello\nhi', { size: 60, x: 500, align: 'center' });
  for (const l of c.lines) assert.ok(Math.abs(l.x + l.w / 2 - 500) < 1e-9);
  const r = layout('hello\nhi', { size: 60, x: 500, align: 'right' });
  for (const l of r.lines) assert.ok(Math.abs(l.x + l.w - 500) < 1e-9);
  const B = [100, 200, 400, 300];
  const top = layout('Hello there', { size: 60, box: B });
  assert.ok(Math.abs(top.box[1] - 200) < 1e-9, 'top: the ink starts at the box top');
  const mid = layout('Hello there', { size: 60, box: B, valign: 'middle' });
  assert.ok(Math.abs(mid.box[1] + mid.box[3] / 2 - 350) < 1e-9);
  const bot = layout('Hello there', { size: 60, box: B, valign: 'bottom', align: 'right' });
  assert.ok(Math.abs(bot.box[1] + bot.box[3] - 500) < 1e-9);
  assert.ok(Math.abs(bot.lines[0].x + bot.lines[0].w - 500) < 1e-9);
  const base = layout('Hello there', { size: 60, box: B, valign: 'baseline' });
  assert.ok(Math.abs(base.lines[0].y - (200 + 0.72 * 60)) < 1e-9);
  // ink, not an em estimate: x-height copy is shorter than capitals, a descender reaches below
  const [, yx, , hx] = measureBox('neon', 100), [, yc, , hc] = measureBox('NEON', 100), [, , , hg] = measureBox('gig', 100);
  assert.ok(yx > yc && hx < hc && hg > hx);
  assert.ok(Math.abs(measureBox('mm', 100)[2] - measure('mm', 100)) < 12);
  assert.ok(measureBox('two\nlines', 100)[3] > 125);
});

test('a paragraph wraps into a box in every hand: its strokes stay inside the box they were given', () => {
  const B = [60, 80, 420, 400];
  for (const [name, hand] of HANDS) {
    const g = textBox(PARA, B, { size: 36, hand, ink2: null });
    assert.ok(g.lines.length >= 3, name);
    for (const [, x, , w] of g.lines) assert.ok(x >= B[0] && x + w <= B[0] + B[2] + 1e-6, name);
    const drawn = bounds(strokes(g));
    assert.deepEqual(g.box, drawn, `${name}: .box is what it draws`);
    // the wander and the slant stay within the pen's reach of the box
    assert.ok(inside(drawn, [B[0] - 12, B[1] - 12, B[2] + 24, B[3] + 24]), `${name}: ${drawn} in ${B}`);
    assert.equal(g.name, `text:${g.lines.map((l) => l[0]).join('\n')}`);
  }
  const c = textBox('centred in the box', [0, 0, 600, 200], { size: 50, align: 'center', valign: 'middle', ink2: null });
  const [x, y, w, h] = c.box;
  assert.ok(Math.abs(x + w / 2 - 300) < 8 && Math.abs(y + h / 2 - 100) < 8, `${c.box}`);
  assert.equal(hashList([textBox(PARA, B, { size: 36 })]), hashList([textBox(PARA, B, { size: 36 })]));
});

test('bullets number themselves; every item starts on the same x and they stack down the box', () => {
  const items = ['mix the flour', 'add two eggs and a cup of milk, then whisk until smooth', 'bake'];
  const g = bullets(items, [100, 100, 420, 600], { marker: 'number', size: 32 });
  assert.equal(g.kids.length, 3);
  const labels = g.kids.map((k) => k.kids[0].name), bodies = g.kids.map((k) => k.kids[1]);
  assert.deepEqual(labels, ['text:1.', 'text:2.', 'text:3.']);
  assert.equal(new Set(bodies.map((b) => b.lines[0][1])).size, 1, 'one indent for all');
  assert.ok(bodies[1].lines.length > 1, 'the long item wraps');
  for (let i = 1; i < 3; i++) assert.ok(bodies[i].lines[0][2] > bodies[i - 1].lines.at(-1)[2] + 40, 'items stack');
  assert.deepEqual(g.box, bounds(g.kids));
  const ten = bullets(Array.from({ length: 10 }, (_, i) => `item ${i}`), [0, 0, 400, 2000], { marker: 'number', start: 1, size: 24 });
  assert.equal(ten.kids[9].kids[0].name, 'text:10.');
  for (const marker of ['dot', 'dash', 'check']) {
    const b = bullets(items, [100, 100, 420, 600], { marker, size: 32 });
    assert.equal(b.kids[0].kids[0].name, 'marker', marker);
    assert.ok(b.kids[0].kids[0].op === 'fill' || b.kids[0].kids[0].op === 'stroke');
  }
  assert.throws(() => bullets(items, [0, 0, 100, 100], { marker: 'star' }), /no marker/);
});

test('the text op: width wraps and \\n breaks through layout; one line letters exactly as before', () => {
  const one = text('hello there', 100, 200, { size: 60 });
  assert.equal(hashList([handText(one)]), hashList([handText('hello there', 100, 200, { size: 60 })]));
  const op = text(PARA, 100, 200, { size: 40, width: 400, ink2: null });
  const g = handText(op), L = layout(PARA, { size: 40, w: 400, x: 100, y: 200 });
  const ys = new Set(strokes(g).map((s) => Math.round((s.path.box[1] + s.path.box[3] - 200) / 50)));
  assert.ok(ys.size >= L.lines.length, `strokes on ${L.lines.length} baselines`);
  assert.ok(bounds(strokes(g))[2] <= 400 + 10);
  // expand (what the raster does) and reveal agree with handText
  const [ex] = expand([op], 'paperInk');
  assert.equal(strokes(ex).length, strokes(g).length);
  const half = reveal(0.5, op);
  assert.ok(half.p > 0.49 && half.p < 0.51);
});

test("bounds of a text op contain what it draws, in the shot's hand, and fit it closely", () => {
  const cases = [['hello', {}], ['Big Caps!', { size: 90 }], ['gjpqy', { align: 'center' }], ['right', { align: 'right' }],
    [PARA, { width: 300, size: 30 }], ['two\nlines', { size: 70, ink2: null }], ['wide', { size: 40, w: 8 }]];
  for (const [name, hand] of HANDS) for (const [str, o] of cases) {
    const op = text(str, 300, 400, { size: 48, ...o });
    const b = withHand(hand, () => bounds([op])), drawn = bounds(strokes(handText(op, { hand })));
    assert.ok(inside(drawn, b), `${name} '${str}': drawn ${drawn} outside ${b}`);
    assert.ok(b[2] * b[3] < drawn[2] * drawn[3] * 1.8, `${name} '${str}': ${b} is loose around ${drawn}`);
  }
  // the old estimate was 0.55 em a character; "mmmm" is wider than that and "iiii" narrower
  const m = bounds([text('mmmm', 0, 0, { size: 100 })]), i = bounds([text('iiii', 0, 0, { size: 100 })]);
  assert.ok(m[2] > 220 && i[2] < 120, `${m} ${i}`);
});

test('layoutWith is pure data in the hand it is given', () => {
  const a = layoutWith(PARA, { size: 40, w: 300 }, TEST), b = layoutWith(PARA, { size: 40, w: 300 }, houseHand());
  assert.deepEqual(a, layoutWith(PARA, { size: 40, w: 300 }, TEST));
  assert.notDeepEqual(a.lines.map((l) => l.w), b.lines.map((l) => l.w));
});
