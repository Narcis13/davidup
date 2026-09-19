import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cel, place, shot, seq, par, hold, cut, lookOn, film } from '../core/tree.js';
import { paper, night, fill, stroke, text, fx, lookNode, meta, circle, rect } from '../core/list.js';
import { ramp } from '../core/curves.js';
import { signOff } from '../core/text.js';
import { lint, lintSource, inspect, formatFinding, RULES } from '../core/lint.js';
import mini from '../films/mini.js';

// A clean scratch film: every shot has paper, an anchor cel in frame, one finish; it ends on a sign-off
// that is complete by t = 0.4 of a 2 s shot.
const dot = cel('dot', () => [fill(circle(0, 0, 60), 'fills.0', { finish: true }), stroke(circle(0, 0, 60), 'ink', { w: 2 })], { box: [-62, -62, 124, 124] });
const scene = (name, extra = () => [], o = {}) => shot(name, 1, (c) => [
  paper(), meta('anchor', { cel: 'dot' }), place(o.x ?? c.CX, c.CY, o.place ?? {}, dot()), ...extra(c),
]);
const end = (reveal = 0.4) => shot('end', 2, ({ t, CX, CY }) => [
  paper(), meta('anchor', { name: 'signOff' }),
  signOff('a', 'b', { x: CX, y: CY, size: 80, pA: ramp(0, reveal / 2, t), pB: ramp(reveal / 2, reveal, t) }),
]);
const make = (...nodes) => film({ name: 'scratch', look: 'paperInk', timeline: seq(...nodes, end()) });
const rules = (f, o) => lint(f, o).map((x) => x.rule);
const one = (f, rule) => {
  const got = lint(f);
  assert.deepEqual(got.map((x) => x.rule), [rule], got.map((x) => formatFinding(x)).join('\n'));
  return got[0];
};

test('mini and the scratch film are clean', () => {
  assert.deepEqual(lint(mini, { source: readFileSync(new URL('../films/mini.js', import.meta.url), 'utf8') }), []);
  assert.deepEqual(rules(make(scene('a'), scene('b'))), []);
});

test('role: a role the look lacks, and a raw colour, one finding each', () => {
  const f = one(make(scene('a', () => [stroke(rect(10, 10, 50, 50), 'nope')])), 'role');
  assert.equal(f.shot, 'a');
  assert.equal(f.frame, 0);
  assert.match(one(make(scene('a', () => [fill(rect(10, 10, 50, 50), '#ff0000')])), 'role').detail, /raw colour/);
  // Roles resolve in the look in effect: 'paperBand' is null in risoPop.
  assert.deepEqual(rules(make(lookOn('risoPop', scene('a', () => [fill(rect(10, 10, 50, 50), 'paperBand')])))), ['role']);
});

test('first-op: a shot must start with paper, night or a backdrop image', () => {
  const bad = shot('bare', 1, (c) => [meta('anchor', { cel: 'dot' }), place(c.CX, c.CY, dot())]);
  assert.equal(one(make(bad), 'first-op').shot, 'bare');
  const dark = shot('dark', 1, (c) => [night(), meta('anchor', { cel: 'dot' }), place(c.CX, c.CY, dot())]);
  assert.deepEqual(rules(make(dark)), []);
});

test('one-look: two finishes, or a look op inside the shot', () => {
  assert.match(one(make(scene('a', () => [fill(circle(100, 100, 40), 'fills.1', { finish: 'graphite' })])), 'one-look').detail, /hatch, graphite/);
  assert.match(one(make(scene('a', () => [lookNode('risoPop', [stroke(rect(10, 10, 50, 50), 'ink')])])), 'one-look').detail, /look op/);
});

test('anchor: missing, or naming something the shot does not draw', () => {
  const none = shot('none', 1, (c) => [paper(), place(c.CX, c.CY, dot())]);
  assert.equal(one(make(none), 'anchor').frame, 0);
  const ghost = shot('ghost', 1, (c) => [paper(), meta('anchor', { cel: 'ghost' }), place(c.CX, c.CY, dot())]);
  assert.match(one(make(ghost), 'anchor').detail, /ghost/);
  // Missing on one frame only (frame 12 + 5) is still one finding, at that frame.
  const blink = shot('blink', 1, ({ k, CX, CY }) => [paper(), k !== 5 && meta('anchor', { cel: 'dot' }), place(CX, CY, dot())]);
  assert.equal(one(make(scene('a'), blink), 'anchor').frame, 17);
});

test('scribble: more than two per frame', () => {
  const s = (n) => () => Array.from({ length: n }, (_, j) => fx('scribble', {}, [stroke(rect(j * 20, 0, 10, 10), 'ink')]));
  assert.deepEqual(rules(make(scene('a', s(2)))), []);
  one(make(scene('a', s(3))), 'scribble');
});

test('cel-box: a cel drawing outside its declared box', () => {
  const big = cel('big', () => [fill(circle(0, 0, 80), 'fills.0')], { box: [-40, -40, 80, 80] });
  const f = one(make(scene('a', (c) => [place(100, 100, big())])), 'cel-box');
  assert.match(f.detail, /cel 'big'/);
});

test('words: text outside the sign-off, against the look allowance', () => {
  one(make(scene('a', () => [text('hello world', 100, 100)])), 'words');
  // The doodle look allows three words a shot.
  const doodle = (str) => make(lookOn('doodlePastel', scene('a', () => [text(str, 100, 100)])));
  assert.deepEqual(rules(doodle('hello there world')), []);
  one(doodle('hello there big world'), 'words');
});

test('cuts: longer than 1 s, and two in a row', () => {
  const a = scene('a'), b = scene('b'), c = scene('c');
  assert.deepEqual(rules(make(a, cut('dissolve', 0.5, a, b), b)), []);
  assert.equal(one(make(a, cut('dissolve', 1.5, a, b), b), 'cut-long').shot, 'dissolve:a>b');
  one(make(a, cut('dissolve', 0.5, a, b), cut('wipe', 0.5, b, c), c), 'cut-adjacent');
});

test('sign-off: missing, or still being written 1.5 s before the end', () => {
  const noSign = film({ name: 'scratch', look: 'paperInk', timeline: seq(scene('a')) });
  assert.match(one(noSign, 'sign-off').detail, /no signOff/);
  const late = film({ name: 'scratch', look: 'paperInk', timeline: seq(scene('a'), end(1)) });
  const f = one(late, 'sign-off');
  assert.equal(f.frame, 18);   // 3 s film: 36 - 18
  assert.match(f.detail, /pA 1.00, pB 0.00/);
  // A held sign-off counts too.
  const held = film({ name: 'scratch', look: 'paperInk', timeline: seq(scene('a'), end(1), hold(1.5, end(1))) });
  assert.deepEqual(rules(held), []);
});

test('subject: under the 240 px floor, or cut by the edge without intent', () => {
  assert.match(one(make(scene('a', undefined, { place: { scale: 0.1 } })), 'subject-size').detail, /cel 'dot'/);
  one(make(scene('a', undefined, { x: 20 })), 'subject-crop');
  assert.deepEqual(rules(make(scene('a', () => [meta('intent', 'crop')], { x: 20 }))), []);
});

test('draw errors are findings, not crashes', () => {
  const boom = shot('boom', 1, ({ k }) => { if (k === 3) throw new Error('kaboom'); return [paper(), meta('anchor', { cel: 'dot' }), place(540, 540, dot())]; });
  const f = one(make(boom), 'draw');
  assert.equal(f.frame, 3);
  assert.match(f.detail, /kaboom/);
});

test('source: banned calls outside comments, with line numbers', () => {
  const src = "// Math.random is fine in a comment\nconst r = Math.random();\n/* new Date() */\nctx.filter = 'blur(2px)';\nconst x = a.filter((v) => v);\nctx.shadowBlur = 4;\nctx.createLinearGradient(0, 0, 1, 1);\nDate.now();\n";
  assert.deepEqual(lintSource(src).map((f) => f.line), [2, 4, 6, 7, 8]);
  assert.equal(formatFinding(lintSource(src)[0], 'x.js'), 'x.js:-:L2  source  Math.random: use rng(seed) so frames are pure');
});

test('inspect summarises shots for the board; hold and par plays are covered', () => {
  const a = scene('a'), b = scene('b');
  const f = film({ name: 'scratch', look: 'paperInk', timeline: seq(par(a, lookOn('risoPop', b)), hold(0.5, a), end()) });
  const { findings, shots } = inspect(f);
  assert.deepEqual(findings, []);
  assert.deepEqual(shots.map((s) => [s.name, s.f0, s.n, s.look, s.anchor]), [
    ['a', 0, 12, 'paperInk', true], ['b', 0, 12, 'risoPop', true], ['a', 12, 1, 'paperInk', true], ['end', 18, 24, 'paperInk', true],
  ]);
  assert.ok(Object.keys(RULES).length >= 14);
});
