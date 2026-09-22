// 4.0 E3: the teaching recipes AR to AU (process, cycleDiagram, numberLine, growth), and textOnPath.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FPS, actorOf, arc, film, line, puppet, seq, stickSource, textOnPath, handText } from '../core/index.js';
import { bounds, walk } from '../core/list.js';
import { lint } from '../core/lint.js';
import { frame } from '../core/tree.js';
import { AUDIENCES, apple, cycleDiagram, growth, hopTimes, numberLine, process, signOffShot } from '../recipes/shots.js';

const SAM = actorOf(puppet(stickSource({ name: 'sam' })));
const at = (s, t) => frame(film({ name: 'x', look: 'whiteboard', timeline: seq(s) }), Math.min(s.n - 1, Math.round(t * FPS))).list;
const names = (list) => { const out = []; walk(list, (op) => { if (typeof op.name === 'string') out.push(op.name); }); return out; };
const texts = (list) => names(list).filter((n) => n.startsWith('text:')).map((n) => n.slice(5));
const first = (s, test) => { for (let k = 0; k < s.n; k++) if (test(at(s, k / FPS))) return k; return Infinity; };
const onGrid = (d) => Math.abs(d * FPS - Math.round(d * FPS)) < 1e-9;
const ALL = [[process, 'AR'], [cycleDiagram, 'AS'], [numberLine, 'AT'], [growth, 'AU']];

test('AR to AU carry their letters, render every frame with no options, time themselves on the grid', () => {
  for (const [R, L] of ALL) {
    assert.equal(R.recipe, L);
    const s = R();
    assert.equal(s.recipe, L);
    assert.ok(onGrid(s.dur), `${L} ${s.dur}`);
    for (let k = 0; k < s.n; k += 3) at(s, k / FPS);
    const d = Object.keys(AUDIENCES).map((a) => R({ audience: a }).dur);
    assert.deepEqual([...d].sort((a, b) => a - b), d, `${L} slower for younger: ${d}`);
    assert.ok(names(at(R({ actor: SAM }), s.dur)).includes('presenter'), `${L} takes actor:`);
  }
});

test('textOnPath: the glyphs follow the path, named as lettering, standing on its left', () => {
  const flat = handText('rim', 0, 0, { size: 50 });
  const onLine = textOnPath('rim', line(0, 100, 400, 100), { size: 50, align: 'start' });
  assert.equal(onLine.name, 'text:rim');
  assert.equal(onLine.kids.length, flat.kids.length);
  const b = bounds(onLine.kids);
  assert.ok(b[1] + b[3] <= 105 && b[1] < 100, 'upright above a path run left to right');
  const under = textOnPath('rim', line(400, 100, 0, 100), { size: 50 });
  assert.ok(bounds(under.kids)[1] >= 95, `turned over under a path run right to left ${bounds(under.kids)}`);
  const top = textOnPath('ring', arc(0, 0, 200, -Math.PI, 0), { size: 40 }), tb = bounds(top.kids);
  assert.ok(tb[1] < -200 && Math.abs(tb[0] + tb[2] / 2) < 20, `centred on the top of the ring ${tb}`);
});

test('process: a card a beat, the text written, an arrow to the next, not after the last', () => {
  const s = process({ steps: ['one', 'two', 'three'], arrows: 'straight' });
  const cards = (t) => names(at(s, t)).filter((n) => /^step\d$/.test(n)).length;
  assert.equal(cards(0), 0);
  assert.equal(cards(s.dur), 3);
  assert.deepEqual(texts(at(s, s.dur)), ['one', 'two', 'three']);
  assert.equal(names(at(s, s.dur)).filter((n) => n === 'arrow').length, 2);
  assert.ok(first(s, (l) => names(l).includes('step1')) > first(s, (l) => names(l).includes('arrow')));
  assert.throws(() => process({ arrows: 'zigzag' }), /arrows 'zigzag'/);
  assert.equal(names(at(process({ steps: ['a', 'b', 'c', 'd', 'e', 'f'] }), 30)).filter((n) => n === 'card').length, 6, 'rows past four');
});

test('cycleDiagram: steps in order on a ring, the loop closed, a marker going round', () => {
  const s = cycleDiagram({ steps: ['new', 'half', 'full'], centre: 'the moon' });
  const seen = [];
  for (let k = 0; k < s.n; k++) for (const w of texts(at(s, k / FPS))) if (!seen.includes(w)) seen.push(w);
  assert.deepEqual(seen, ['the moon', 'new', 'half', 'full']);
  assert.equal(names(at(s, s.dur)).filter((n) => n === 'link').length, 3, 'the last link closes the loop');
  assert.ok(first(s, (l) => names(l).includes('traveller')) < s.n);
  assert.ok(!names(at(s, s.dur)).includes('traveller'), 'gone after its lap');
  const still = cycleDiagram({ travel: false });
  assert.ok(first(still, (l) => names(l).includes('traveller')) === Infinity && still.dur < cycleDiagram().dur);
  assert.throws(() => cycleDiagram({ steps: ['one'] }), /two steps/);
});

test('numberLine: a hop a unit, the leg written, the landing ringed; hopTimes gives the score its beats', () => {
  const s = numberLine({ from: 0, to: 10, start: 2, jumpTo: [5, 4] });
  const end = at(s, s.dur);
  assert.equal(names(end).filter((n) => n === 'hop').length, 4);
  assert.deepEqual(texts(end).filter((w) => /^[+-]/.test(w)), ['+3', '-1']);
  assert.ok(names(end).includes('ring'));
  const T = hopTimes({ from: 0, to: 10, start: 2, jumpTo: [5, 4] });
  assert.equal(T.length, 4);
  assert.ok(T.every((t, j) => j === 0 || t > T[j - 1]));
  assert.equal(names(at(numberLine({ hops: 'one' }), 20)).filter((n) => n === 'hop').length, 1);
  assert.throws(() => numberLine({ jumpTo: 12 }), /not on the line/);
  assert.deepEqual(texts(at(numberLine({ audience: 'kids-5' }), 30)), ['0', '3', '7', '10', '+4'], 'a small allowance numbers the ends, start and landing');
});

test('growth: a bar rises and its number counts on; a pictograph stacks a picture a unit', () => {
  const s = growth({ from: 0, to: 5, label: 'cm' });
  const seen = [];
  for (let k = 0; k < s.n; k++) for (const w of texts(at(s, k / FPS))) if (!seen.includes(w)) seen.push(w);
  assert.deepEqual(seen, ['cm', '0', '1', '2', '3', '4', '5']);
  const bar = (t) => { let h = 0; walk(at(s, t), (op) => { if (op.name === 'barFill') h = op.path.box[3]; }); return h; };
  assert.ok(bar(s.dur) > bar(s.dur / 2) && bar(s.dur / 2) > 0);
  assert.equal(growth({ to: 40 }).dur < growth({ to: 40, by: 1 }).dur, true, 'a long count steps by more');
  const p = growth({ cel: apple, to: 4, count: false });
  assert.equal(names(at(p, p.dur)).filter((n) => n === 'apple').length, 4);
  assert.deepEqual(texts(at(p, p.dur)), []);
  assert.throws(() => growth({ from: 3, to: 3 }), /does not grow/);
});

test('a lesson of the four with sam lints clean at kids-9 and kids-5', () => {
  for (const audience of ['kids-9', 'kids-5']) {
    const f = film({
      name: 'x', look: 'whiteboard', audience, timeline: seq(
        process({ actor: SAM, audience }), cycleDiagram({ actor: SAM, audience }),
        numberLine({ actor: SAM, audience }), growth({ actor: SAM, audience, cel: apple, to: 6 }), signOffShot(),
      ),
    });
    assert.deepEqual(lint(f), [], audience);
  }
});
