import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asHand, COMPOSE, fallbacks, GLYPHS, glyph, MARKS } from '../core/glyphs.js';
import { synthHand } from '../cli/hand.mjs';
import { handText, signOff, measure, syllablesOf, speech, VISEMES } from '../core/text.js';
import { reveal, trim } from '../core/tools.js';
import { group, stroke, line, hashList, walk } from '../core/list.js';

const strokes = (node) => { const out = []; walk([node], (op) => { if (op.op === 'stroke') out.push(op); }); return out; };
const total = (node) => strokes(node).reduce((a, s) => a + s.path.sub.reduce((b, sub) => {
  for (let i = 2; i < sub.pts.length; i += 2) b += Math.hypot(sub.pts[i] - sub.pts[i - 2], sub.pts[i + 1] - sub.pts[i - 1]);
  return b;
}, 0), 0);

test('the font covers a-z, A-Z, 0-9 and the punctuation set', () => {
  for (const ch of "abcdefghijklmnopqrstuvwxyz0123456789.,:'-!?& ") assert.ok(GLYPHS[ch], ch);
  assert.equal(glyph('§').s, GLYPHS['?'].s);
  assert.deepEqual(glyph('É').s.slice(0, GLYPHS.E.s.length), GLYPHS.E.s);   // an accent is the base letter and its mark (T2)
});

// T2: accented letters composed from a base and a mark, in any hand.
const inkOf = (strokes) => {
  const xs = strokes.flatMap((p) => p.filter((_, i) => i % 2 === 0)), ys = strokes.flatMap((p) => p.filter((_, i) => i % 2));
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
test('composed glyphs: every letter of Latin-1 and Latin Extended-A (and ș ț) letters as its base and its marks', () => {
  const letters = [];
  for (let c = 0xc0; c <= 0x17f; c++) letters.push(String.fromCharCode(c));
  for (const ch of [...letters, ...'șțȘȚ']) {
    if (ch === '×' || ch === '÷') continue;
    const g = glyph(ch);
    assert.ok(GLYPHS[ch] || COMPOSE[ch], `${ch} is drawn or composed`);
    assert.notEqual(g.s, GLYPHS['?'].s, ch);
    assert.equal(g.own, true, `${ch}: the house draws all of it`);
  }
  // a base, then its mark; the advance is the base's.
  for (const [ch, base, n] of [['ă', 'a', 1], ['ș', 's', 1], ['ł', 'l', 1], ['ü', 'u', 2], ['ő', 'o', 2], ['ǻ', 'a', 2]]) {
    const g = glyph(ch);
    assert.equal(g.w, GLYPHS[base].w, ch);
    assert.deepEqual(g.s.slice(0, GLYPHS[base].s.length), GLYPHS[base].s, `${ch} starts with its ${base}`);
    assert.equal(g.s.length - GLYPHS[base].s.length, n, `${ch}: marks`);
  }
  // Above marks clear the base's ink top, x-height or cap height as measured; below ones sit under the baseline.
  const top = (c) => inkOf(GLYPHS[c].s)[1], markInk = (ch, base) => inkOf(glyph(ch).s.slice(GLYPHS[base].s.length));
  assert.ok(markInk('é', 'e')[3] <= top('e') - 8, 'é: its acute over the x-height');
  assert.ok(markInk('É', 'E')[3] <= top('E') - 6, 'É: its acute over the cap height');
  assert.ok(markInk('É', 'E')[1] > markInk('é', 'e')[1] - 30, 'on a capital the mark is lower-set (squashed)');
  assert.ok(markInk('ǻ', 'a')[1] < markInk('å', 'a')[1] - 8, 'a second above mark stacks over the first');
  assert.ok(markInk('ș', 's')[1] >= 8, 'ș: the comma under the baseline');
  assert.ok(markInk('ç', 'c')[1] >= -2 && markInk('ç', 'c')[1] <= 2, 'ç: the cedilla hangs from the ink');
  const ms = (ch, base) => inkOf(glyph(ch).s.slice(GLYPHS[base].s.length));
  assert.ok(ms('ł', 'l')[1] > -60 && ms('ł', 'l')[3] < -12, 'ł: the stroke through the middle');
  assert.ok(ms('ø', 'o')[3] - ms('ø', 'o')[1] > 55, 'ø: the stroke runs past the bowl');
  // i and j lose their dot under an above mark; ı is the dotless i itself; į keeps it.
  assert.equal(glyph('î').s.length, 2);
  assert.equal(glyph('ı').s.length, 1);
  assert.equal(glyph('į').s.length, 3);
  // Written as others: quotes, dashes, the ellipsis, ligatures, the inverted marks.
  assert.deepEqual(glyph('’').s, GLYPHS["'"].s);
  assert.equal(glyph('…').s.length, 3);
  assert.equal(glyph('æ').s.length, GLYPHS.a.s.length + GLYPHS.e.s.length);
  assert.ok(inkOf(glyph('¿').s)[3] > 15, '¿ hangs under the baseline, turned');
  // Beyond the table: Unicode's decomposition (pinyin's ǎ); an unknown mark is dropped; no base, '?'.
  assert.equal(glyph('ǎ').s.length, GLYPHS.a.s.length + 1);
  assert.equal(glyph('ạ').s.length, GLYPHS.a.s.length);
  assert.equal(glyph('ж').s, GLYPHS['?'].s);
  assert.equal(glyph('ă'), glyph('ă'), 'memoised: one glyph, one strokes array for layout to measure');
  assert.equal(Object.keys(MARKS).length, 14);
});

test('a Romanian sign-off letters in the house hand and in the test hand, each with its own marks', () => {
  const n = (node) => strokes(node).length;
  assert.equal(n(handText('mulțumesc', 0, 0, { ink2: null })), n(handText('multumesc', 0, 0, { ink2: null })) + 1);
  assert.equal(measure('mulțumesc', 40), measure('multumesc', 40), 'a mark takes no room');
  const T = asHand(synthHand('test'));
  assert.deepEqual(fallbacks('mulțumesc pa', T), []);
  assert.equal(n(handText('mulțumesc', 0, 0, { hand: T, ink2: null })), n(handText('multumesc', 0, 0, { hand: T, ink2: null })) + 1);
  const comma = (H) => glyph('ț', H).s.at(-1);
  assert.notDeepEqual(comma(T), comma(), "the test hand's comma, not the house's");
  // A hand with letters and no marks composes with the house's marks, and says so.
  const bare = asHand({ name: 'bare', glyphs: T.glyphs });
  assert.deepEqual(fallbacks('mulțumesc pa', bare), ['ț']);
  assert.equal(glyph('t', bare).own, true);
});

// T1: the house hand can write a sentence.
test("punctuation and signs: every character of \"it's 3 + 4 = 7 (yes!)\" is lettered in its own glyph", () => {
  const SIGNS = `'":;()[]/+=%°×÷→←↑↓~*_#@$€`;
  for (const ch of SIGNS) {
    const G = GLYPHS[ch];
    assert.ok(G, ch);
    assert.notEqual(glyph(ch).s, GLYPHS['?'].s, ch);
    assert.ok(G.w >= 12 && G.w <= 70 && G.s.length >= 1 && G.s.length <= 4, `${ch}: advance ${G.w}, ${G.s.length} strokes`);
    for (const pts of G.s) for (let i = 0; i < pts.length; i += 2) {
      assert.ok(pts[i] >= -2 && pts[i] <= G.w + 2, `${ch} x ${pts[i]}`);
      assert.ok(pts[i + 1] >= -80 && pts[i + 1] <= 26, `${ch} y ${pts[i + 1]}`);
    }
  }
  const str = "it's 3 + 4 = 7 (yes!)", node = handText(str, 0, 100, { size: 60, ink2: null });
  const want = [...str].reduce((n, ch) => n + GLYPHS[ch].s.length, 0);
  assert.equal(strokes(node).length, want, 'one stroke per glyph stroke, no ? standing in');
  assert.ok(measure(str, 60) > measure("it's 3 4 7 yes", 60));
  assert.equal(glyph('×').s === GLYPHS.x.s, false, '× is not x');
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

test('reveal reaches text ops: none at 0, a share as p between, the op itself at 1', async () => {
  const { text } = await import('../core/list.js');
  const { expandOp } = await import('../core/finish.js');
  const t = text('hello', 0, 0, { size: 60, seed: 7 });
  assert.deepEqual(reveal(0, [t]), []);
  assert.equal(reveal(1, t), t);
  const half = reveal(0.5, [stroke(line(0, 0, 100, 0), 'ink'), t])[1];
  assert.ok(half.p > 0 && half.p < 1);
  const full = expandOp(t, 'paperInk')[0], part = expandOp(half, 'paperInk')[0];
  assert.ok(total(part) > 0 && total(part) < total(full));
  assert.equal(strokes(full)[0].seed, strokes(part)[0].seed);   // same wobble as the finished word
});

test('syllablesOf: vowel groups, a silent final e joins the one before', () => {
  const FIXTURE = {
    hello: ['he', 'llo'], there: ['there'], tea: ['tea'], teapot: ['tea', 'pot'], banana: ['ba', 'na', 'na'],
    little: ['li', 'ttle'], apple: ['a', 'pple'], cake: ['cake'], the: ['the'], hmm: ['hmm'], fox: ['fox'], Hello: ['He', 'llo'],
  };
  for (const [w, want] of Object.entries(FIXTURE)) assert.deepEqual(syllablesOf(w), want, w);
});

test('speech: one viseme cycle per syllable on the 1/12 s grid, rests for spaces and stops', () => {
  const s = speech('hello there', 0.5);
  assert.deepEqual(VISEMES, [0, 2, 3, 1]);
  assert.deepEqual(s.syllables.map((x) => x.text), ['he', 'llo', 'there']);
  assert.equal(s.steps.join(''), '0231' + '0231' + '0' + '0231');
  assert.equal(s.dur * 12, 13);
  for (const x of s.syllables) assert.ok(Math.abs(x.t * 12 - Math.round(x.t * 12)) < 1e-9, `${x.text} starts on the grid`);
  assert.deepEqual(s.syllables.map((x) => Math.round((x.t - 0.5) * 12)), [0, 4, 9]);
  // The letters of a syllable arrive over its steps, in order.
  assert.ok(s.letters.every((t, j) => j === 0 || t >= s.letters[j - 1]));
  assert.equal(s.letters[0], 0.5);
  assert.equal(speech('hi, fox.').steps.join(''), '0231' + '00' + '0' + '0231' + '00');
});
