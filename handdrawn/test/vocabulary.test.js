// 4.0 K3: the pose vocabulary -- every biped knows how to point, shrug and cheer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { actorOf, EMOTES, VOCABULARY } from '../core/actor.js';
import { fromStore } from '../core/assets.js';
import { hashList, paper } from '../core/list.js';
import { celOverflow, lintList } from '../core/lint.js';
import { LOOKS } from '../core/looks.js';
import { VIEW_DIRS, puppet } from '../core/puppet.js';
import { BUILDS, stickSource } from '../core/stick.js';
import { HOG } from '../recipes/doodle.js';

fromStore(['fox', 'octopus']);
const SAM = () => actorOf(puppet(stickSource({ name: 'sam' })));

test('vocabulary: the plan\'s poses, cycles and expressions, on the 2 degree grid, in the standard biped names', () => {
  const raw = JSON.parse(readFileSync(new URL('../packs/poses/biped.json', import.meta.url), 'utf8'));
  assert.deepEqual(VOCABULARY, raw);
  assert.ok(Object.isFrozen(VOCABULARY.poses.cheer), 'frozen through');
  assert.deepEqual(Object.keys(VOCABULARY.poses), ['idle', 'stand', 'point-l', 'point-r', 'wave', 'think', 'shrug', 'cheer', 'facepalm',
    'bow', 'sit', 'kneel', 'fall', 'sleep', 'look-up', 'carry', 'push', 'write', 'present', 'hands-on-hips', 'arms-crossed']);
  assert.deepEqual(Object.fromEntries(Object.entries(VOCABULARY.cycles).map(([n, c]) => [n, c.frames.length])),
    { walk: 8, run: 6, jump: 6, breathe: 4, 'talk-hands': 6 });
  assert.deepEqual(Object.keys(VOCABULARY.expressions), ['happy', 'sleep', 'wide', 'sad', 'worried', 'surprised', 'angry', 'confused',
    'thinking', 'laughing', 'wink', 'bored']);
  const names = new Set(VOCABULARY.names);
  const states = [...Object.values(VOCABULARY.poses), ...Object.values(VOCABULARY.expressions), ...Object.values(VOCABULARY.cycles).flatMap((c) => c.frames)];
  for (const q of states) {
    for (const [k, v] of Object.entries(q)) {
      if (k === 'lift') continue;
      const part = k.replace(/\.(x|y|sx|sy)$/, '');
      assert.ok(names.has(part), `${k} is a standard biped name`);
      if (typeof v === 'number' && part === k && k !== 'mouth') assert.equal(Math.abs(v) % 2, 0, `${k} ${v} on the 2 degree grid`);
    }
  }
  for (const n of [...Object.keys(VOCABULARY.needs), ...Object.keys(VOCABULARY.views)]) assert.ok(VOCABULARY.poses[n] || VOCABULARY.cycles[n], n);
});

test('EMOTES moved into the file: the four emotes of 3.0 and K1 keep their numbers', () => {
  assert.equal(EMOTES, VOCABULARY.expressions);
  assert.deepEqual(EMOTES.happy, { eye: 'happy', mouth: 'top', tail: 12, head: -4, 'brow-l.y': -2, 'brow-r.y': -2 });
  assert.deepEqual(EMOTES.sad, { eye: 'sleep', mouth: 0, head: 10, tail: -24, 'brow-l': -14, 'brow-r': 14, 'brow-l.y': -1, 'brow-r.y': -1 });
  assert.deepEqual(EMOTES.worried, { eye: 'open', mouth: 0, head: 6, 'brow-l': -12, 'brow-r': 12, 'brow-l.y': -2, 'brow-r.y': -2, 'pupil.y': 1 });
});

test('done when: sam, the fox and the octopus each draw cheer and confused with what they have', () => {
  for (const A of [SAM(), actorOf(puppet('fox')), actorOf(puppet('octopus'))]) {
    const cheer = A.pose('cheer'), confused = A.emote('confused'), rest = A({});
    assert.ok(A.vocabulary.poses.includes('cheer') && A.vocabulary.expressions.includes('confused'), A.name);
    assert.ok(cheer['arm-l'] > 0 && cheer['arm-r'] < 0, `${A.name}: both arms up and out`);
    assert.notEqual(hashList([A(cheer)]), hashList([rest]), `${A.name} cheers`);
    assert.notEqual(hashList([A(confused)]), hashList([rest]), `${A.name} is confused`);
    for (const k of Object.keys({ ...cheer, ...confused })) assert.ok(k in A.inputs, `${A.name}: ${k} is its own input`);
  }
  const sam = SAM(), fox = actorOf(puppet('fox')), oct = actorOf(puppet('octopus'));
  assert.ok(sam.pose('cheer')['fore-l'] !== undefined && fox.pose('cheer')['fore-l'] === undefined, 'the fox has no forearms');
  assert.ok(fox.emote('confused')['brow-l'] && oct.emote('confused')['brow-l'] === undefined, 'the octopus has no brows');
  assert.deepEqual(oct.emote('confused'), { eye: 'open', mouth: 1 });
});

test('the hedgehog (a builder) is unchanged: no vocabulary, its emote and cycle as before', () => {
  assert.deepEqual(HOG.vocabulary, { poses: [], cycles: [], expressions: [] });
  assert.deepEqual(HOG.pose('cheer'), {});
  assert.deepEqual(HOG.emote('confused'), { eye: 'confused' });
  assert.deepEqual(HOG.cycle('run', 1), { run: 15 });
  assert.equal(HOG.cycle('jump', 0).fallback, 'jump', 'a cycle it lacks still bobs');
});

test('pose(): its own first, the vocabulary after, rest -> pose by k, and a name in neither is an error', () => {
  const fox = actorOf(puppet('fox'));
  assert.deepEqual(fox.pose('wave'), { 'arm-l': 112, head: -6, tail: 18, eye: 'happy', mouth: 3 }, 'the fox\'s own wave wins');
  assert.equal(fox.pose('point-r')['arm-r'], -90);
  const half = fox.pose('cheer', 0.5), full = fox.pose('cheer');
  assert.equal(half['arm-l'], full['arm-l'] / 2);
  assert.equal(half.eye, 'happy', 'variants switch at half-way');
  assert.equal(fox.pose('cheer', 0.25).eye, undefined);
  assert.throws(() => fox.pose('moonwalk'), /no pose 'moonwalk' \(has wave, asleep, idle/);
  // A pose whose needs the puppet lacks does not apply: {} rather than arms waving where legs should be.
  const oct = actorOf(puppet('octopus'));
  assert.deepEqual(oct.pose('sit'), {});
  assert.ok(!oct.vocabulary.poses.includes('sit') && !fox.vocabulary.poses.includes('arms-crossed'));
});

test('known(): a variant list picks the first the puppet has; a root body does not take the vocabulary\'s turns', () => {
  assert.equal(SAM().emote('wink').eye, 'wink');
  assert.equal(actorOf(puppet('fox')).emote('wink').eye, 'happy');
  assert.equal(SAM().emote('bored').eye, 'half');
  assert.equal(SAM().emote('surprised').mouth, 4, 'the stick has an oo');
  assert.equal(actorOf(puppet('fox')).emote('surprised').mouth, 2, 'the fox its middle mouth');
  assert.equal(SAM().pose('bow').body, 40, 'the stick\'s body is a trunk on the hips');
  assert.equal(actorOf(puppet('fox')).pose('bow').body, undefined, 'the fox\'s body is its root: bowing nods instead');
  assert.equal(actorOf(puppet('fox')).cycle('jump', 0).body, undefined);
});

test('cycles: its own, else the vocabulary\'s (lift on the stage\'s scale), else a bob that says so', () => {
  const fox = actorOf(puppet('fox')), oct = actorOf(puppet('octopus')), sam = SAM();
  assert.deepEqual(fox.cycle('walk', 0), { 'leg-l': 18, 'leg-r': -18, 'arm-l': -12, 'arm-r': 12, tail: 6, head: 0 }, 'its own walk');
  const air = sam.cycle('jump', 2 / 6);
  assert.equal(air.lift, 6);
  assert.equal(air.fallback, undefined);
  assert.equal(fox.cycle('jump', 2 / 6).lift, 6);
  assert.equal(fox.fallbacks.size, 0);
  assert.equal(oct.cycle('jump', 0).fallback, 'jump', 'no legs, no jump: the bob');
  assert.ok(oct.fallbacks.has('jump'));
  assert.deepEqual(sam.vocabulary.cycles, ['walk', 'run', 'jump', 'breathe', 'talk-hands']);
  assert.deepEqual(sam.cycle('walk', 0), sam.cycle('walk', 8 / 12), 'wraps');
});

test('tempering: whatever applies stays in the box, for the fox, the octopus and every stick build', () => {
  const check = (P) => {
    const A = actorOf(P), dirs = A.inputs.dir ? [1, 0.5, 0, -1] : [undefined];
    // The vocabulary's entries only: a puppet's own poses are its own business (lint's puppet-joint and cel-box).
    const states = [...A.vocabulary.poses.filter((n) => VOCABULARY.poses[n] && !P.poses.includes(n)).map((n) => [n, A.pose(n)]),
      ...A.vocabulary.expressions.map((n) => [n, A.emote(n)]),
      ...A.vocabulary.cycles.filter((n) => VOCABULARY.cycles[n] && !P.cycles.includes(n)).flatMap((n) => VOCABULARY.cycles[n].frames.map((_, j) => [`${n} ${j}`, A.cycle(n, j / VOCABULARY.cycles[n].fps)]))];
    for (const dir of dirs) {
      if (celOverflow(A({ ...(dir === undefined ? {} : { dir }) }))) continue;   // a view whose rest overflows (the octopus's front)
      for (const [n, { lift: _l, fallback: _f, ...q }] of states) {
        assert.equal(celOverflow(A({ ...q, ...(dir === undefined ? {} : { dir }) })), null, `${A.name} ${n} at dir ${dir}`);
      }
    }
  };
  check(puppet('fox'));
  check(puppet('octopus'));
  for (const build of Object.keys(BUILDS)) for (const style of ['line', 'tube']) check(puppet(stickSource({ name: 'sam', build, style, hands: 'mitts' })));
  const oct = actorOf(puppet('octopus'));
  assert.ok(Math.abs(oct.pose('cheer')['arm-l']) < 150, 'the octopus cheers as high as its box lets it');
  assert.equal(SAM().pose('cheer')['arm-l'], 150, 'sam as the file says');
});

test('hdf sheet store <id> --vocabulary: a page of what applies, one list that hashes the same, lint clean', async () => {
  const { modelSheet } = await import('../cli/sheet.mjs');
  const look = LOOKS.doodlePastel;
  const run = () => modelSheet(puppet(stickSource({ name: 'sam' })), { entry: { name: 'sam' }, look, vocabulary: true });
  const a = run(), b = run();
  assert.equal(hashList(a.list), hashList(b.list));
  assert.deepEqual(a.rows, ['title', 'poses', 'expressions', 'cycle walk', 'cycle run', 'cycle jump', 'cycle breathe', 'cycle talk-hands', 'credits']);
  assert.deepEqual(a.labels.poses, ['rest', ...Object.keys(VOCABULARY.poses)]);
  assert.deepEqual(lintList(a.list, look), []);
  for (const id of ['fox', 'octopus']) {
    const page = modelSheet(puppet(id), { entry: { name: id }, look, vocabulary: true });
    assert.deepEqual(lintList([paper(), ...page.list], look), [], id);
    assert.ok(page.labels.poses.includes('cheer') && page.labels.expressions.includes('confused'), id);
  }
  // Side poses are drawn in profile: sam sits side on.
  assert.equal(VIEW_DIRS[VOCABULARY.views.sit], 1);
});
