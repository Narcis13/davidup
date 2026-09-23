// 4.0 T10: legibility lint and audience profiles. film({ audience }) picks the profile lint checks against
// (general by default, the rules as they were); text-size, text-dwell, text-contrast, caption-overlap and
// cut-floor read it, and words does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FPS, actorOf, captions, dialogue, puppet, stickSource } from '../core/index.js';
import { AUDIENCES, audienceOf } from '../core/audience.js';
import { withLook } from '../core/looks.js';
import { cel, film, hold, par, place, seq, shot } from '../core/tree.js';
import { circle, fill, meta, paper, rect, stroke, text } from '../core/list.js';
import { handText, signOff } from '../core/text.js';
import { lint, formatFinding, plays, RULES } from '../core/lint.js';
import { textUnits } from '../core/legible.js';
import { compare, counting, labelled, titleCard } from '../recipes/shots.js';
import lesson from '../films/lesson.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const hdf = (...args) => { const r = spawnSync(process.execPath, ['cli/hdf.mjs', ...args], { cwd: ROOT, encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };

// A scratch film on paper: an anchor dot, whatever the shot draws, and a sign-off shot that is done in time.
const dot = cel('dot', () => [fill(circle(0, 0, 60), 'fills.0'), stroke(circle(0, 0, 60), 'ink', { w: 2 })], { box: [-62, -62, 124, 124] });
const scene = (name, dur, extra) => shot(name, dur, (c) => [paper(), meta('anchor', { cel: 'dot' }), place(c.CX, 200, {}, dot()), ...extra(c)]);
const end = shot('end', 2, ({ CX, CY }) => [paper(), meta('anchor', { name: 'signOff' }), signOff('a', 'b', { x: CX, y: CY, size: 80 })]);
const make = (nodes, o = {}) => film({ name: 'legible', look: 'whiteboard', timeline: seq(...nodes, end), ...o });
const found = (f, rule, o) => lint(f, o).filter((x) => x.rule === rule);
const show = (xs) => xs.map((x) => formatFinding(x)).join('\n');
const between = (t, a, b) => t >= a - 1e-9 && t < b - 1e-9;

// A caption up from 0.5 s for `dur` seconds, in the middle of a 3 s shot.
const flash = (dur, str = 'moon') => scene('flash', 3, ({ t, CX }) => (between(t, 0.5, 0.5 + dur) ? [text(str, CX, 700, { size: 56, align: 'center' })] : []));

test('the profiles: general is the old allowances, each younger audience asks for more', () => {
  const keys = Object.keys(AUDIENCES);
  assert.deepEqual(keys, ['general', 'beginner', 'kids-9', 'kids-7', 'kids-5']);
  const g = AUDIENCES.general;
  assert.equal(g.words, null, 'general takes the look\'s word allowance');
  assert.equal(g.cutFloor, 0);
  for (const f of ['minX', 'perWord', 'cutFloor']) {
    const v = keys.map((k) => AUDIENCES[k][f]);
    assert.deepEqual([...v].sort((a, b) => a - b), v, `${f} ${v}`);
  }
  for (const k of keys.slice(1)) assert.ok(AUDIENCES[k].contrast >= 4.5, k);
  assert.equal(film({ name: 'x', look: 'paperInk', timeline: [flash(1)] }).audience, 'general');
  assert.throws(() => film({ name: 'x', look: 'paperInk', timeline: [flash(1)], audience: 'toddlers' }), /film x: audience 'toddlers'/);
  assert.equal(lesson.audience, 'kids-9');
});

test('done when: a caption that flashes for 0.3 s fails text-dwell under kids-7 and passes under general', () => {
  const f = make([flash(0.3)]);
  assert.deepEqual(lint(f), [], show(lint(f)));
  const [x, ...rest] = found(f, 'text-dwell', { audience: 'kids-7' });
  assert.equal(rest.length, 0);
  assert.equal(x.shot, 'flash');
  assert.equal(x.frame, 6, 'the first frame it shows on');
  assert.match(x.detail, /"moon" is on screen 0\.33 s from 0\.50 s \(audience kids-7: 1 word need 0\.50 s\)/);
  // The film's own profile is the default; the option overrides it.
  assert.equal(found(make([flash(0.3)], { audience: 'kids-7' }), 'text-dwell').length, 1);
  assert.equal(found(make([flash(0.3)], { audience: 'kids-7' }), 'text-dwell', { audience: 'general' }).length, 0);
  // Held long enough for its words, it passes; more words need longer.
  assert.equal(found(make([flash(0.5)]), 'text-dwell', { audience: 'kids-7' }).length, 0);
  assert.equal(found(make([flash(0.5, 'the moon')]), 'text-dwell', { audience: 'kids-7' }).length, 1);
  assert.equal(found(make([flash(0.1, 'the moon has no light')]), 'text-dwell').length, 1, 'too quick for anyone');
});

test('text-dwell counts every frame the text is up: across shots, through a hold and a par', () => {
  const up = (name, dur) => scene(name, dur, ({ CX }) => [text('moon', CX, 700, { size: 56 })]);
  // 0.25 s + 0.25 s in two shots in a row is one run of 0.5 s.
  assert.equal(found(make([up('a', 0.25), up('b', 0.25)]), 'text-dwell', { audience: 'kids-7' }).length, 0);
  // Twice 0.25 s with a shot between is two short runs.
  assert.deepEqual(found(make([up('a', 0.25), scene('gap', 1, () => []), up('b', 0.25)]), 'text-dwell', { audience: 'kids-7' }).map((x) => x.shot), ['a', 'b']);
  // A 1-frame shot held for a second.
  assert.equal(found(make([hold(1, up('a', 1 / FPS))]), 'text-dwell', { audience: 'kids-7' }).length, 0);
  // A short shot in a par stays up on its last frame until the par ends.
  assert.equal(found(make([par(scene('long', 1, () => []), up('short', 0.25))]), 'text-dwell', { audience: 'kids-7' }).length, 0);
  const p = plays(make([hold(1, up('a', 1 / FPS))]))[0];
  assert.equal(p.shown(0).length, 12);
});

test('text-dwell leaves a recording\'s captions and the sign-off to their own clocks; copy captions are read', () => {
  const quick = captions({ text: 'moon', words: [{ text: 'moon', t0: 0.5, t1: 0.6 }] }, { hold: 0 });
  assert.equal(found(make([scene('voiced', 2, ({ t, W, H }) => [quick.draw(t, { W, H })])]), 'text-dwell', { audience: 'kids-5' }).length, 0);
  const read = captions(['the moon has no light of its own'], { audience: 'general' });
  const f = make([scene('read', Math.ceil(read.until * FPS) / FPS, ({ t, W, H }) => [read.draw(t, { W, H })])]);
  assert.equal(found(f, 'text-dwell').length, 0, 'copy read at its own pace');
  assert.equal(found(f, 'text-dwell', { audience: 'kids-5' }).length, 1, 'too quick for a five-year-old');
});

test('text-size: an x-height under the audience\'s minX at 240 px; a lettered group measures as its op', () => {
  const small = (size) => make([scene('small', 1, ({ CX }) => [text('label', CX, 700, { size })])]);
  // x-height 0.48 of the size, at 240 / 1080: size 30 is 3.2 px, size 50 is 5.3 px.
  assert.equal(found(small(30), 'text-size').length, 0);
  const [x] = found(small(30), 'text-size', { audience: 'kids-5' });
  assert.match(x.detail, /"label" has an x-height of 3\.2 px at 240 px on the short side \(audience kids-5: at least 5\)/);
  assert.equal(found(small(50), 'text-size', { audience: 'kids-5' }).length, 0);
  assert.equal(found(small(20), 'text-size').length, 1, 'too small for anyone');
  for (const str of ['moon', 'the moon has no light', 'ABC 123']) {
    const [op] = textUnits([paper(), text(str, 100, 500, { size: 60 })], 'whiteboard');
    const [g] = textUnits([paper(), handText(str, 100, 500, { size: 60, look: 'whiteboard' })], 'whiteboard');
    assert.equal(g.str, str);
    assert.ok(Math.abs(g.x - op.x) / op.x < 0.1, `${str}: lettered ${g.x}, op ${op.x}`);
  }
  // Written on, the letters grow: the size is the largest it reaches.
  const writing = make([scene('writing', 2, ({ t, CX }) => [text('moon rise', CX, 700, { size: 56, p: Math.min(1, t) })])]);
  assert.equal(found(writing, 'text-size', { audience: 'kids-5' }).length, 0);
});

test('text-contrast: text on what it is drawn over, as the look resolves both; a fade on its way out has had its read', () => {
  const on = (role, under, o = {}) => make([scene('c', 2, ({ t, CX }) => [...under(t), text('read me', CX, 700, { size: 56, role, ...o })])]);
  assert.equal(found(on('ink', () => []), 'text-contrast', { audience: 'kids-5' }).length, 0, 'ink on the board');
  // orange marker on the board is 1.9:1; ink on the dark shade fill is 1.6:1
  const [x] = found(on('accents.3', () => []), 'text-contrast');
  assert.match(x.detail, /"read me" stands at 1\.9:1 on what it is drawn over, and at 3:1 for only 0\.00 s of the 0\.30 s it needs \(audience general\)/);
  assert.equal(found(on('ink', () => [fill(rect(0, 600, 1080, 200), 'shade')]), 'text-contrast').length, 1);
  // light on the shade fill is fine; the fill's box must hold the text's centre, and its path too
  assert.equal(found(on('light', () => [fill(rect(0, 600, 1080, 200), 'shade')]), 'text-contrast').length, 0);
  assert.equal(found(on('ink', () => [fill(rect(0, 0, 1080, 200), 'shade')]), 'text-contrast').length, 0);
  assert.equal(found(on('ink', () => [fill(circle(540, 680, 400), 'shade', { alpha: 0.2 })]), 'text-contrast').length, 0, 'a faint fill barely tints');
  // a dark wash comes in over the last half second: it had its read before
  const dusk = (t) => (t > 1.5 ? [fill(rect(0, 0, 1080, 1080), 'shade', { alpha: Math.min(1, (t - 1.5) * 4) })] : []);
  assert.equal(found(on('ink', dusk), 'text-contrast', { audience: 'kids-5' }).length, 0);
  // a picture under it has no colour to measure
  const [u] = textUnits([paper(), { op: 'image', src: 'x', x: 0, y: 0, w: 1080, h: 1080 }, text('photo', 100, 500)], 'whiteboard');
  assert.equal(u.bg, null);
  assert.equal(u.on, 'image');
});

test('caption-overlap: two pieces of text whose ink crosses in one frame', () => {
  const two = (y2) => make([scene('two', 1, () => [text('the moon', 300, 700, { size: 56 }), text('the sun', 330, y2, { size: 56 })])]);
  const [x, ...rest] = found(two(710), 'caption-overlap');
  assert.equal(rest.length, 0);
  assert.match(x.detail, /"the moon" \[.*\] and "the sun" \[.*\] cross/);
  assert.equal(found(two(800), 'caption-overlap').length, 0);
  // a double print of one line is not an overlap
  assert.equal(found(make([scene('twice', 1, () => [text('moon', 300, 700), text('moon', 303, 702)])]), 'caption-overlap').length, 0);
});

test('cut-floor: a shot shorter than the audience\'s floor', () => {
  const f = make([scene('quick', 1, () => []), scene('slow', 3, () => [])]);
  assert.equal(found(f, 'cut-floor').length, 0);
  const got = found(f, 'cut-floor', { audience: 'kids-7' });
  assert.deepEqual(got.map((x) => x.shot), ['quick'], 'the 2 s sign-off is at the floor');
  assert.match(got[0].detail, /'quick' lasts 1\.00 s \(audience kids-7: at least 2 s\)/);
});

test('words reads the profile: an audience\'s allowance over the look\'s, a look\'s own words over both', () => {
  const nine = 'one two three four five six seven eight nine';
  const f = (look) => film({ name: 'w', look, timeline: seq(scene('w', 1, () => [text(nine, 80, 700, { size: 40 })]), end) });
  assert.equal(found(f('paperInk'), 'words').length, 1, 'paperInk allows none');
  assert.equal(found(f('paperInk'), 'words', { audience: 'beginner' }).length, 0);
  assert.equal(found(f('whiteboard'), 'words').length, 0, 'the board allows 12');
  const [x] = found(f('whiteboard'), 'words', { audience: 'kids-5' });
  assert.match(x.detail, /9 words .*; audience kids-5 allows 8 outside the sign-off/);
  assert.equal(found(f(withLook('whiteboard', { words: 9 })), 'words', { audience: 'kids-5' }).length, 0);
});

test('the teaching recipes, copy captions and dialogue made for an audience lint clean at it', () => {
  const SAM = actorOf(puppet(stickSource({ name: 'sam' }))), ANN = actorOf(puppet(stickSource({ name: 'ann' })));
  for (const audience of Object.keys(AUDIENCES)) {
    const read = captions(['the moon has no light of its own', 'the sun lights it'], { audience });
    const talk = dialogue([[SAM, 'where is the moon?'], [ANN, 'behind the cloud.'], [SAM, 'oh!']], { audience, where: { [SAM.name]: [300, 900], [ANN.name]: [780, 900] } });
    const long = (name, fr) => scene(name, Math.max(3, Math.ceil(fr.until * FPS) / FPS), ({ t, W, H }) => [fr.draw(t, { W, H })]);
    const timeline = seq(
      titleCard({ name: 'title', title: 'parts of a flower', sub: 'a first lesson', actor: SAM, audience }),
      labelled({ name: 'parts', actor: SAM, audience }),
      counting({ name: 'count', n: 5, actor: SAM, audience }),
      compare({ name: 'more', actor: SAM, audience }),
      long('read', read),
      scene('talk', Math.max(3, Math.ceil((talk.until + 0.25) * FPS) / FPS), ({ t }) => [
        SAM.place(300, 900, SAM.idle(t)), ANN.place(780, 900, ANN.idle(t)), talk.draw(t),
      ]),
      shot('end', audienceOf(audience).cutFloor + 2, ({ CX, CY }) => [paper(), meta('anchor', { name: 'signOff' }), signOff('sam', 'says hi', { x: CX, y: CY, size: 80 })]),
    );
    const got = lint(film({ name: 'lesson', look: 'whiteboard', audience, timeline })).filter((x) => x.rule in LEGIBLE);
    assert.deepEqual(got, [], `${audience}\n${show(got)}`);
  }
});
const LEGIBLE = Object.fromEntries(['text-size', 'text-dwell', 'text-contrast', 'caption-overlap', 'cut-floor', 'words'].map((r) => [r, RULES[r]]));

test('hdf lint --audience checks a film against another profile; an unknown one is a usage error', () => {
  const own = hdf('lint', 'films/lesson.js');
  assert.equal(own.code, 0, own.out);
  assert.match(own.out, /lesson: lint clean for kids-9/);
  const kids = hdf('lint', 'films/held-once.js', '--audience', 'kids-7');
  assert.equal(kids.code, 1);
  assert.match(kids.out, /held-once\.js:tea:\d+ {2}text-dwell {2}"for two" is on screen/);
  const bad = hdf('lint', 'films/mini.js', '--audience', 'toddlers');
  assert.equal(bad.code, 2);
  assert.match(bad.out, /--audience takes general, beginner, kids-9, kids-7, kids-5/);
});
