import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GLYPHS, glyph } from '../core/glyphs.js';
import { handText, signOff, measure } from '../core/text.js';
import { reveal, trim } from '../core/tools.js';
import { group, stroke, line, hashList, walk } from '../core/list.js';

const strokes = (node) => { const out = []; walk([node], (op) => { if (op.op === 'stroke') out.push(op); }); return out; };
const total = (node) => strokes(node).reduce((a, s) => a + s.path.sub.reduce((b, sub) => {
  for (let i = 2; i < sub.pts.length; i += 2) b += Math.hypot(sub.pts[i] - sub.pts[i - 2], sub.pts[i + 1] - sub.pts[i - 1]);
  return b;
}, 0), 0);

test('the font covers a-z, 0-9 and the punctuation set; capitals map to lowercase', () => {
  for (const ch of "abcdefghijklmnopqrstuvwxyz0123456789.,:'-!?& ") assert.ok(GLYPHS[ch], ch);
  assert.equal(glyph('A').k, 1.25);
  assert.equal(glyph('~').s, GLYPHS['?'].s);
});

test('handText is data: same words, same hash; alignment moves it', () => {
  const a = handText('hello', 100, 200, { size: 60 }), b = handText('hello', 100, 200, { size: 60 });
  assert.equal(hashList([a]), hashList([b]));
  assert.notEqual(hashList([a]), hashList([handText('hellp', 100, 200, { size: 60 })]));
  assert.equal(strokes(a).length, 2 * strokes(handText('hello', 0, 0, { ink2: null })).length);
  const c = handText('hi', 500, 0, { size: 100, align: 'center', ink2: null });
  const xs = strokes(c).flatMap((s) => s.path.sub[0].pts.filter((_, i) => i % 2 === 0));
  assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 500) < 12);
  assert.ok(measure('mm', 100) > measure('ii', 100));
});

test('reveal draws strokes in order up to p of their length', () => {
  const g = group('g', [stroke(line(0, 0, 100, 0), 'ink', { order: 1 }), stroke(line(0, 10, 100, 10), 'ink', { order: 0 })]);
  assert.equal(reveal(1, g), g);
  assert.equal(strokes(reveal(0, g)).length, 0);
  const half = strokes(reveal(0.5, g));
  assert.equal(half.length, 1);
  assert.equal(half[0].path.sub[0].pts[1], 10);   // order 0 goes first
  const quarter = strokes(reveal(0.75, g));
  assert.equal(quarter.length, 2);
  assert.ok(Math.abs(quarter[0].path.sub[0].pts[2] - 50) < 1e-9);
  const t = handText('mini', 0, 0, { size: 60 });
  assert.ok(Math.abs(total(reveal(0.3, t)) / total(t) - 0.3) < 1e-6);
  assert.deepEqual(trim(line(0, 0, 10, 0), 4).sub[0].pts, [0, 0, 4, 0]);
});

test('signOff carries its progress for lint and grows with pA, pB', () => {
  const at = (pA, pB) => strokes(signOff('mini', 'film', { pA, pB })).length;
  assert.ok(at(0, 0) === 0 && at(0.5, 0) > 0 && at(1, 0) < at(1, 1));
  let m;
  walk([signOff('a', 'b', { pA: 0.4, pB: 0 })], (op) => { if (op.op === 'meta') m = op; });
  assert.deepEqual(m.data, { a: 'a', b: 'b', pA: 0.4, pB: 0 });
});
