import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cel, place, shot, seq, par, hold, cut, lookOn, film } from '../core/tree.js';
import { paper, night, fill, stroke, text, fx, lookNode, meta, circle, rect } from '../core/list.js';
import { ramp } from '../core/curves.js';
import { signOff } from '../core/text.js';
import { lint, lintList, lintSource, lintPuppet, inspect, formatFinding, warnAssets, RULES, WARNINGS } from '../core/lint.js';
import { actorOf } from '../core/actor.js';
import { puppet } from '../core/puppet.js';
import { register } from '../core/store.js';
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
  // Spoken words count: a line from actor.say is words in the shot.
  const talker = actorOf(cel('talker', () => [fill(circle(0, -50, 40), 'fills.0')], { box: [-40, -90, 80, 80] }));
  const says = (line, extra = []) => make(lookOn('doodlePastel', scene('a', (c) => [line.draw(c.t, 540, 540, 60), ...extra])));
  assert.deepEqual(rules(says(talker.say('hello there', 0), [text('world', 100, 100)])), []);
  assert.match(one(says(talker.say('hello there', 0), [text('big world', 100, 100)]), 'words').detail, /hello there/);
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

test('inline-asset: a data URL in the film warns, and never fails it', () => {
  const inline = { src: 'data:image/png;base64,' + 'A'.repeat(2048), w: 8, h: 8 };
  const f = film({ name: 'scratch', look: 'paperInk', timeline: seq(scene('a'), end()), assets: { thing: inline, path: { src: 'thing.png' } } });
  assert.deepEqual(lint(f), [], 'a warning is not a finding: hdf lint still exits 0');
  const w = warnAssets(f);
  assert.deepEqual(w.map((x) => x.rule), ['inline-asset'], 'only the data URL, not the asset named by path');
  assert.match(w[0].detail, /^'thing': 2 KB of data URL/);
  assert.equal(formatFinding(w[0], 'x.js').split('  ')[1], 'warn inline-asset');
  assert.deepEqual(warnAssets(film({ name: 'ids', look: 'paperInk', timeline: seq(scene('a'), end()), assets: ['teapot'] })), [],
    'a film that names store ids has nothing to warn about');
  assert.ok(Object.keys(WARNINGS).includes('inline-asset'));
});

test('puppet-joint, roles-raw and cel-box: what `hdf import --kind puppet` runs over a payload', () => {
  const ops = [{ op: 'fill', path: { $p: [[1, 0, 0, 10, 0, 10, 10]] }, role: 'fills.0', finish: true }];
  const good = {
    name: 'p', units: 10, box: [-20, -20, 40, 40], parts: { body: { pivot: [0, 0], ops } },
    poses: { rest: {}, tip: { body: 30 } }, cycles: { bob: { n: 2, frames: [{ body: 0 }, { body: 10 }] } },
  };
  assert.deepEqual(lintPuppet(good), []);
  const said = (d) => lintPuppet(d).map((f) => `${f.rule}  ${f.detail}`);
  assert.match(said({ ...good, poses: { rest: {}, tip: { body: 31 } } })[0], /^puppet-joint .* off the 2 degree grid/);
  assert.match(said({ ...good, poses: { rest: {}, tip: { body: 200 } } })[0], /^puppet-joint .* outside -180\.\.180/);
  assert.match(said({ ...good, poses: { rest: {}, tip: { nose: 4 } } })[0], /^puppet-joint .* not a part or a declared input/);
  assert.match(said({ ...good, cycles: { bob: { n: 3, frames: [{ body: 0 }, { body: 10 }] } } })[0], /^puppet-joint .* n 3 and carries 2 frames/);
  assert.match(said({ ...good, cycles: { bob: { n: 2, frames: [{ body: 0 }, { body: 5 }] } } })[0], /^puppet-joint  cycle 'bob' frame 1/);
  assert.match(said({ ...good, parts: { body: { pivot: [0, 0], ops: [{ ...ops[0], role: '#ff0000' }] } } })[0], /^roles-raw .* paints #ff0000/);
  assert.match(said({ ...good, parts: { body: { variants: { on: [{ ...ops[0], role: { base: 'rgb(1,2,3)' } }] } } } })[0], /^roles-raw  part 'body' variant 'on'/);
  // The declared box has to hold every pose, every variant and every frame of every cycle.
  assert.match(said({ ...good, box: [-2, -2, 4, 4] })[0], /^cel-box .* outside the declared box \[-2, -2, 4, 4\]/);
  assert.match(said({ ...good, parts: { body: { pivot: [0, 0], ops: 'nope' } } })[0], /^draw /);
  assert.ok(['puppet-joint', 'roles-raw', 'actor-cycle'].every((r) => r in RULES));
});

test('actor-cycle: a fallback bob on screen over 1 s in one shot', () => {
  const blob = [fill(circle(0, -50, 40), 'fills.0', { finish: true }), stroke(circle(0, -50, 40), 'ink', { w: 2 })];
  const A = actorOf(puppet({ name: 'blob', units: 100, box: [-50, -100, 100, 100], parts: { body: { ops: JSON.parse(JSON.stringify(blob)) } } }));
  const hopping = (dur) => shot('hop', dur, ({ t, CX, CY }) => [
    paper(), meta('anchor', { name: 'actor:blob' }), A.place(CX, CY, 100, A.cycle('hop', t)),
  ]);
  assert.deepEqual(rules(make(hopping(1))), [], 'a second of bob is allowed');
  const f = one(make(hopping(1.5)), 'actor-cycle');
  assert.match(f.detail, /actor 'blob' has no cycle 'hop'; its fallback bob is on screen 1\.50 s/);
  assert.equal(f.shot, 'hop');
  assert.ok(A.fallbacks.has('hop'));
});

test('hand-missing: a look names a hand no store has, or the sign-off falls back to house for a glyph', () => {
  const gone = lint(film({ name: 'scratch', look: 'paperInk~hand:gone', timeline: seq(scene('a'), end()) }));
  const f = gone.find((x) => x.rule === 'hand-missing');
  assert.ok(f, gone.map((x) => formatFinding(x)).join('\n'));
  assert.match(f.detail, /no hand 'gone' in the store/);
  // A hand with an 'a' and no 'b': the sign-off ('a', 'b') letters its 'b' in the house hand.
  register({ half: { name: 'half', glyphs: { a: { w: 44, s: [[4, -40, 40, 0]] } } } });
  const g = one(film({ name: 'scratch', look: 'paperInk~hand:half', timeline: seq(scene('a'), end()) }), 'hand-missing');
  assert.match(g.detail, /the sign-off letters 'b' in the house hand: hand 'half' has no glyph for it/);
  assert.equal(g.shot, 'end');
  register({ whole: { name: 'whole', glyphs: { a: { w: 44, s: [[4, -40, 40, 0]] }, b: { w: 44, s: [[4, -72, 4, 0]] } } } });
  assert.deepEqual(rules(film({ name: 'scratch', look: 'paperInk~hand:whole', timeline: seq(scene('a'), end()) })), []);
});

test('inspect summarises shots for the board; hold and par plays are covered', () => {
  const a = scene('a'), b = scene('b');
  const f = film({ name: 'scratch', look: 'paperInk', timeline: seq(par(a, lookOn('risoPop', b)), hold(0.5, a), end()) });
  const { findings, shots } = inspect(f);
  assert.deepEqual(findings, []);
  assert.deepEqual(shots.map((s) => [s.name, s.f0, s.n, s.look, s.anchor]), [
    ['a', 0, 12, 'paperInk', true], ['b', 0, 12, 'risoPop', true], ['a', 12, 1, 'paperInk', true], ['end', 18, 24, 'paperInk', true],
  ]);
  assert.ok(Object.keys(RULES).length >= 16);
});

test('lintList: role and cel-box over a list that is not a shot (a model sheet)', () => {
  const big = cel('big', () => [fill(circle(0, 0, 90), 'fills.0')], { box: [-10, -10, 20, 20] });
  assert.deepEqual(lintList([paper(), place(100, 100, dot())], 'paperInk'), []);
  const f = lintList([paper(), place(100, 100, big()), fill(circle(0, 0, 5), '#ff0000')], 'paperInk', 'page');
  assert.deepEqual(f.map((x) => x.rule).sort(), ['cel-box', 'role']);
  assert.equal(f[0].shot, 'page');
});
