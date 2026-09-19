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

test('the font covers a-z, A-Z, 0-9 and the punctuation set', () => {
  for (const ch of "abcdefghijklmnopqrstuvwxyz0123456789.,:'-!?& ") assert.ok(GLYPHS[ch], ch);
  assert.equal(glyph('~').s, GLYPHS['?'].s);
  assert.equal(glyph('É').s, GLYPHS.E.s);          // accents fall back to the base letter
});

test('capitals are true capitals: own strokes at k = 1, inside the cap box', () => {
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const G = GLYPHS[ch], g = glyph(ch);
    assert.ok(G, ch);
    assert.equal(g.k, 1, ch);
    assert.equal(g.s, G.s, ch);
    assert.notEqual(G.s, GLYPHS[ch.toLowerCase()].s, ch);
    assert.ok(G.w >= 18 && G.w <= 72, `${ch} advance ${G.w}`);
    assert.ok(G.s.length >= 1 && G.s.length <= 3, ch);
    let top = 0;
    for (const pts of G.s) {
      assert.ok(pts.length >= 4 && pts.length % 2 === 0, ch);
      for (let i = 0; i < pts.length; i += 2) {
        assert.ok(pts[i] >= -5 && pts[i] <= G.w + 5, `${ch} x ${pts[i]}`);
        assert.ok(pts[i + 1] >= -80 && pts[i + 1] <= 30, `${ch} y ${pts[i + 1]}`);
        top = Math.min(top, pts[i + 1]);
      }
    }
    assert.ok(top < -66, `${ch} reaches cap height`);  // taller than the x-height (-48)
  }
  assert.ok(measure('HELLO', 100) > measure('hello', 100));
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
