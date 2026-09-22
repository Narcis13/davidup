// 4.0 E4: the teaching recipes AV to AY (questionCard, quiz, mapRoute, dialogueShot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FPS, actorOf, film, puppet, seq, stickSource } from '../core/index.js';
import { bounds, walk } from '../core/list.js';
import { lint } from '../core/lint.js';
import { frame } from '../core/tree.js';
import { AUDIENCES, apple, dialogueOf, dialogueShot, map, mapRoute, questionCard, quiz, quizTimes, signOffShot } from '../recipes/shots.js';

const SAM = actorOf(puppet(stickSource({ name: 'sam' })));
const KIT = actorOf(puppet(stickSource({ name: 'kit', build: 'kid' })));
const at = (s, t) => frame(film({ name: 'x', look: 'whiteboard', timeline: seq(s) }), Math.min(s.n - 1, Math.round(t * FPS))).list;
const names = (list) => { const out = []; walk(list, (op) => { if (typeof op.name === 'string') out.push(op.name); }); return out; };
const texts = (list) => names(list).filter((n) => n.startsWith('text:')).map((n) => n.slice(5));
const first = (s, test) => { for (let k = 0; k < s.n; k++) if (test(at(s, k / FPS))) return k; return Infinity; };
const onGrid = (d) => Math.abs(d * FPS - Math.round(d * FPS)) < 1e-9;
const box = (list, name) => { let b = null; walk(list, (op) => { if (op.name === name && !b) b = bounds([op]); }); return b; };
// A placed actor's drawn ink in frame units (a puppet's groups are boxed by the rig's reach): its bounds with
// every group's box dropped.
const unboxed = (op) => (op?.op === 'group' ? { ...op, box: undefined, kids: op.kids.map(unboxed) } : op);
const inkOf = (list, name) => { let g = null; walk(list, (op) => { if (op.name === name && !g) g = op; }); return bounds([unboxed(g)]); };
const ALL = [[questionCard, 'AV'], [quiz, 'AW'], [mapRoute, 'AX'], [dialogueShot, 'AY']];

test('AV to AY carry their letters, render every frame with no options, time themselves on the grid', () => {
  for (const [R, L] of ALL) {
    assert.equal(R.recipe, L);
    const s = R();
    assert.equal(s.recipe, L);
    assert.ok(onGrid(s.dur), `${L} ${s.dur}`);
    for (let k = 0; k < s.n; k += 3) at(s, k / FPS);
    const d = Object.keys(AUDIENCES).map((a) => R({ audience: a }).dur);
    assert.deepEqual([...d].sort((a, b) => a - b), d, `${L} slower for younger: ${d}`);
  }
  for (const [R, L] of ALL.slice(0, 3)) assert.ok(names(at(R({ actor: SAM }), R().dur)).includes('presenter'), `${L} takes actor:`);
});

test('questionCard: the mark is drawn before the question, stands above it, and the teacher shrugs', () => {
  const s = questionCard({ text: 'why is the sky blue?', actor: SAM });
  const hook = first(s, (l) => names(l).includes('hook')), word = first(s, (l) => texts(l).length > 0), dot = first(s, (l) => names(l).includes('point'));
  assert.ok(hook < dot && dot < word, `${hook} ${dot} ${word}`);
  const end = at(s, s.dur), h = box(end, 'hook'), w = box(end, 'text:why is the sky blue?');
  assert.ok(h[1] + h[3] < w[1], `the ? above the words ${h} ${w}`);
  assert.deepEqual(texts(end), ['why is the sky blue?'], 'the mark is no word');
  const shrug = SAM.pose('shrug', 1), still = SAM.pose('present', 1);
  assert.notDeepEqual(shrug, still);
});

test('quiz: options in order, a pause, the wrong ones crossed one at a time, the answer ringed at the ding', () => {
  const o = { question: 'which is red?', options: ['a leaf', 'an apple', 'the sky'], answer: 1 };
  const s = quiz(o), T = quizTimes(o);
  const seen = [];
  for (let k = 0; k < s.n; k++) for (const w of texts(at(s, k / FPS))) if (!seen.includes(w)) seen.push(w);
  assert.deepEqual(seen, ['which is red?', 'a leaf', 'an apple', 'the sky']);
  assert.equal(T.ticks.length, 2);
  assert.ok(T.pause[0] < T.pause[1] && T.pause[1] <= T.ticks[0] && T.ticks[0] < T.ticks[1] && T.ticks[1] < T.ding && T.ding < s.dur);
  const crossed = (t) => names(at(s, t)).filter((n) => n === 'crossed').length;
  assert.equal(crossed(T.pause[1] - 0.1), 0);
  assert.equal(crossed(T.ticks[0] + 0.2), 1);
  assert.equal(crossed(T.ding - 0.05), 2);
  assert.ok(!names(at(s, T.ding - 0.1)).includes('answer') && names(at(s, s.dur)).includes('answer'));
  assert.ok(names(at(s, T.pause[0] + 0.8)).includes('wait') && !names(at(s, s.dur)).includes('wait'), 'the pause dots go at the ding');
  assert.equal(quiz({ pause: 4 }).dur - quiz({ pause: 2 }).dur, 2);
  assert.throws(() => quiz({ options: ['one'] }), /two to four/);
  assert.throws(() => quiz({ answer: 3 }), /not an option/);
  assert.equal(names(at(quiz({ options: [{ text: 'red', cel: apple }, 'blue'], answer: 0 }), 20)).filter((n) => n === 'apple').length, 1, 'an option takes a cel');
});

test('mapRoute: the map drawn, the marker travels the route, the X, the ends and the label written', () => {
  const s = mapRoute();
  const seen = [];
  for (let k = 0; k < s.n; k++) for (const w of texts(at(s, k / FPS))) if (!seen.includes(w)) seen.push(w);
  assert.deepEqual(seen, ['home', 'school', 'the way to school']);
  const pinAt = (t) => { let p = null; walk(at(s, t), (op) => { if (op.name === 'pin' && !p) p = op; }); return p; };
  assert.ok(pinAt(3) && pinAt(4), 'the marker is up while it travels');
  assert.ok(!pinAt(s.dur) && names(at(s, s.dur)).includes('spot'), 'gone once it arrives, an X where it did');
  const trail = (t) => { let L = 0; walk(at(s, t), (op) => { if (op.name === 'trail') L = op.path.sub.reduce((a, q) => a + q.pts.length, 0); }); return L; };
  assert.ok(trail(3) < trail(s.dur), 'the trail grows behind it');
  assert.ok(mapRoute({ speed: 160 }).dur > s.dur && mapRoute({ travel: 6 }).dur > s.dur);
  assert.deepEqual(texts(at(mapRoute({ label: null, ends: null, map, path: [[-100, 0], [100, 0]] }), 20)), []);
  assert.throws(() => mapRoute({ path: [[0, 0]] }), /two \[x, y\] points/);
  const cut = { name: 'map-photo', w: 400, h: 300, src: 'x.png', sil: { sub: [{ pts: [0, 0, 400, 0, 400, 300, 0, 300], closed: true }], box: [0, 0, 400, 300] } };
  const onPhoto = mapRoute({ map: cut, path: [[0.1, 0.8], [0.5, 0.5], [0.9, 0.2]], label: null, ends: null });
  let image = false;
  walk(at(onPhoto, 5), (op) => { if (op.op === 'image') image = true; });
  assert.ok(image, 'a cutout photo is the map');
});

test('dialogueShot: two actors on a ground, a line a turn, feet on the line; dialogueOf gives the score its events', () => {
  const lines = [[0, 'hello!'], [1, 'hi, sam.', { kind: 'shout' }], ['left', 'look up.']];
  const s = dialogueShot({ actor: SAM, other: KIT, lines });
  const d = dialogueOf({ actor: SAM, other: KIT, lines });
  assert.deepEqual(d.turns.map((x) => x.actor), ['sam', 'kit', 'sam']);
  assert.ok(s.dur >= d.until);
  const end = at(s, d.turns[2].t0 + 0.5);
  assert.ok(names(end).includes('actor:sam') && names(end).includes('actor:kit') && names(end).includes('ground'));
  assert.ok(d.events(10).length > 0 && d.events(10).every((e) => e.t >= 10));
  // Feet on the ground line (y 900): each figure's lowest ink within a few units of it.
  for (const who of ['actor:sam', 'actor:kit']) {
    const b = inkOf(at(s, 0), who);
    assert.ok(Math.abs(b[1] + b[3] - 900) < 12, `${who} stands on the ground ${b}`);
  }
  const [sb, kb] = ['actor:sam', 'actor:kit'].map((n) => inkOf(at(s, 0), n));
  assert.ok(kb[3] < sb[3], 'the child is the shorter by default');
  assert.equal(dialogueShot().dur, dialogueShot({}).dur, 'the default pair');
  assert.throws(() => dialogueShot({ actor: SAM, other: SAM }), /both called sam/);
  assert.throws(() => dialogueShot({ lines: [[2, 'who?']] }), /speaker is 0 or 1/);
});

test('a lesson of the four with sam lints clean at kids-9 and kids-5', () => {
  for (const audience of ['kids-9', 'kids-5']) {
    const f = film({
      name: 'x', look: 'whiteboard', audience, timeline: seq(
        questionCard({ actor: SAM, audience }), quiz({ actor: SAM, audience }), mapRoute({ actor: SAM, audience }),
        dialogueShot({ actor: SAM, other: KIT, audience }), signOffShot(),
      ),
    });
    assert.deepEqual(lint(f), [], audience);
  }
});
