// 4.0 E2: the teaching recipes AN to AQ (titleCard, labelled, counting, compare), timed by their copy and
// audience, with the actor as the teacher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FPS, actorOf, film, puppet, seq, stickSource } from '../core/index.js';
import { walk } from '../core/list.js';
import { lint } from '../core/lint.js';
import { frame } from '../core/tree.js';
import { AUDIENCES, audienceOf, compare, counting, labelled, titleCard, signOffShot } from '../recipes/shots.js';

const SAM = actorOf(puppet(stickSource({ name: 'sam' })));
const at = (s, t) => frame(film({ name: 'x', look: 'whiteboard', timeline: seq(s) }), Math.min(s.n - 1, Math.round(t * FPS))).list;
const names = (list) => { const out = []; walk(list, (op) => { if (typeof op.name === 'string') out.push(op.name); }); return out; };
const texts = (list) => names(list).filter((n) => n.startsWith('text:')).map((n) => n.slice(5));
const onGrid = (d) => Math.abs(d * FPS - Math.round(d * FPS)) < 1e-9;

test('AN to AQ carry their letters, render with no options and put their durations on the grid', () => {
  for (const [R, L] of [[titleCard, 'AN'], [labelled, 'AO'], [counting, 'AP'], [compare, 'AQ']]) {
    assert.equal(R.recipe, L);
    const s = R();
    assert.equal(s.recipe, L);
    assert.ok(onGrid(s.dur), `${L} ${s.dur}`);
    for (let k = 0; k < s.n; k += 5) at(s, k / FPS);
  }
});

test('the audience slows a lesson down and letters it bigger; an unknown audience throws', () => {
  for (const R of [titleCard, labelled, counting, compare]) {
    const d = Object.keys(AUDIENCES).map((a) => R({ audience: a }).dur);
    assert.deepEqual([...d].sort((a, b) => a - b), d, `${R.recipe} ${d}`);
    assert.ok(d[d.length - 1] > d[0]);
  }
  assert.ok(audienceOf('kids-5').text > audienceOf('general').text);
  assert.throws(() => titleCard({ audience: 'toddlers' }), /audience 'toddlers'/);
  assert.equal(titleCard({ dur: 3 }).dur, 3, 'a dur given is kept');
  assert.ok(titleCard({ title: 'a much longer title than the default one, to read' }).dur > titleCard().dur, 'longer copy, longer shot');
});

test('titleCard: the title writes on, then the sub; the anchor is there before a letter is', () => {
  const s = titleCard({ title: 'the moon', sub: 'a lesson' });
  assert.deepEqual(texts(at(s, 0)), []);
  assert.ok(names(at(s, 0)).includes('title'));
  assert.deepEqual(lint(film({ name: 'x', look: 'whiteboard', timeline: seq(s, signOffShot()) })).filter((f) => f.rule === 'anchor'), []);
  const end = texts(at(s, s.dur));
  assert.deepEqual(end, ['the moon', 'a lesson']);
});

test('labelled: the labels arrive in order, each with a dot and a leader', () => {
  const s = labelled();
  const seen = [];
  for (let k = 0; k < s.n; k++) {
    const got = texts(at(s, k / FPS));
    for (const w of got) if (!seen.includes(w)) seen.push(w);
  }
  assert.deepEqual(seen, ['petal', 'stem', 'leaf', 'roots']);
  const end = names(at(s, s.dur));
  assert.equal(end.filter((n) => n === 'leader').length, 4);
  assert.equal(end.filter((n) => n === 'dot').length, 4);
  const custom = labelled({ labels: [{ text: 'here', at: [500, 500], from: [300, 300] }], per: 1 });
  assert.ok(Math.abs(custom.dur - Math.ceil((0.4 + 1 + AUDIENCES.general.dwell) * FPS - 1e-6) / FPS) < 1e-9, 'per fixes the seconds a label');
});

test('counting: one object a beat, each with its number, a tally, and the total when labelled', () => {
  const s = counting({ n: 7, per: 0.5, label: 'apples' });
  const items = (t) => names(at(s, t)).filter((n) => /^item\d+$/.test(n)).length;
  assert.equal(items(0.3), 0);
  assert.equal(items(0.4), 1);
  assert.equal(items(0.4 + 2 * 0.5), 3);
  assert.equal(items(s.dur), 7);
  const end = texts(at(s, s.dur));
  assert.deepEqual(end, ['1', '2', '3', '4', '5', '6', '7', '7 apples']);
  assert.ok(names(at(s, s.dur)).includes('tally'));
  assert.ok(!names(at(counting({ tally: false }), 3)).includes('tally'));
});

test('compare: the divider, the left, the right, and the sign drawn last', () => {
  const s = compare({ sign: '>', labels: ['big', 'small'] });
  const has = (t, n) => names(at(s, t)).includes(n);
  const first = (n) => { for (let k = 0; k < s.n; k++) if (has(k / FPS, n)) return k; return Infinity; };
  const [d, l, r, g] = ['divider', 'left', 'right', 'sign'].map(first);
  assert.ok(d < l && l < r && r < g && g < s.n, `${d} ${l} ${r} ${g}`);
  assert.ok(has(s.dur, 'signMark'));
  assert.deepEqual(texts(at(compare({ sign: 'vs', labels: null }), 10)), ['vs']);
  assert.throws(() => compare({ sign: '~' }), /sign '~'/);
});

test('actor: the teacher presents, points, cheers and thinks through the vocabulary', () => {
  const posed = (s, t) => at(s, t).length && names(at(s, t)).includes('presenter');
  for (const R of [titleCard, labelled, counting, compare]) {
    const s = R({ actor: SAM });
    assert.ok(posed(s, s.dur - 0.1), R.recipe);
    assert.ok(!names(at(R(), 1)).includes('presenter'), `${R.recipe} has no teacher by default`);
  }
});

test('a lesson of the four on the whiteboard lints clean, with sam and for kids', () => {
  const f = film({
    name: 'lesson', look: 'whiteboard', timeline: seq(
      titleCard({ actor: SAM, audience: 'kids-9', title: 'parts of a flower' }), labelled({ actor: SAM, audience: 'kids-9' }),
      counting({ actor: SAM, n: 8, cols: 4, label: 'phases' }), compare({ actor: SAM }), signOffShot(),
    ),
  });
  assert.deepEqual(lint(f), []);
});

test('the objects that pop in draw direct, so a cached frame and an uncached one are the same pixels', () => {
  // Every group of the popped subject (the first kid of the named group; the label beside it is its own).
  const groups = (list, name) => { const out = []; walk(list, (op) => { if (op.name === name) walk([op.kids[0]], (q) => { if (q.op === 'group') out.push(q); }); }); return out; };
  const left = groups(at(compare(), 3), 'left');
  assert.ok(left.length > 3);
  assert.ok(left.every((g) => g.cache === 'never'));
  assert.ok(groups(at(counting(), 3), 'item0').every((g) => g.cache === 'never'));
});
