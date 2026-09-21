import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actorOf, EMOTES } from '../core/actor.js';
import { fromStore } from '../core/assets.js';
import { pen } from '../core/doodle.js';
import { circle, fill, hashList, serialise, stroke, walk } from '../core/list.js';
import { puppet } from '../core/puppet.js';
import { CAST, HOG, hog } from '../recipes/doodle.js';
import { hedgehog } from '../packs/creatures.js';

const ops = (list) => JSON.parse(serialise(list));
const disc = (y, r, role = 'fills.0') => ops([fill(circle(0, y, r), role, { finish: true }), stroke(circle(0, y, r), 'ink')]);

// A small fox-shaped fixture: the conventional parts, eye and mouth variants, a pose named like an emote.
const KIT = {
  name: 'kit', units: 100, box: [-60, -110, 120, 120],
  parts: {
    tail: { parent: 'body', pivot: [-20, -40], ops: disc(-10, 8) },
    body: { pivot: [0, -40], ops: disc(0, 30) },
    'arm-l': { parent: 'body', pivot: [-20, -50], ops: disc(10, 5) },
    'arm-r': { parent: 'body', pivot: [20, -50], ops: disc(10, 5) },
    head: { parent: 'body', pivot: [0, -75], ops: disc(0, 18) },
    eye: { parent: 'head', variants: { open: disc(-80, 3, 'ink'), happy: disc(-80, 2, 'ink'), sleep: disc(-80, 1, 'ink') } },
    mouth: { parent: 'head', variants: { 0: disc(-70, 2, 'ink'), 1: disc(-70, 3, 'ink'), 2: disc(-70, 4, 'ink') } },
  },
  inputs: { eye: ['open', 'happy', 'sleep'], mouth: [0, 2, 1] },
  poses: { rest: { eye: 'open', mouth: 0 }, sad: { head: 20, eye: 'sleep' } },
  cycles: { walk: { fps: 12, n: 2, frames: [{ 'arm-l': 10, 'arm-r': -10 }, { 'arm-l': -10, 'arm-r': 10 }] } },
};

test('HOG draws exactly what hog drew: the states are its old options', () => {
  const via = (o) => hashList([pen(9, 0, 0, 3, (d) => HOG.put(d, 300, 400, 70, o), { still: true })]);
  const old = (o) => hashList([pen(9, 0, 0, 3, (d) => hog(d, 300, 400, 70, o), { still: true })]);
  assert.equal(via({ ...HOG.look(-1), ...HOG.emote('happy'), ...HOG.cycle('run', 1.25), rot: 0.1 }), old({ dir: -1, eye: 'happy', run: 1.25 * 15, rot: 0.1 }));
  assert.equal(via({ ...HOG.idle(2), ...HOG.emote('dot'), hand: [380, 420] }), old({ eye: 'dot', hand: [380, 420] }));
  assert.deepEqual(HOG.cycle('walk', 1), {}, 'a v1 walk is the recipe\'s own bob');
  // Its cel is the pack's hedgehog, drawn the same way.
  assert.equal(hashList([HOG({ dir: -1, eye: 'wide' })]), hashList([hedgehog({ dir: -1, eye: 'wide' })]));
  assert.equal(HOG.name, 'hedgehog');
});

test('a puppet actor: emotes, poses named like an emote, look, cycles and idle on the twos', () => {
  const A = actorOf(puppet(KIT));
  assert.equal(A.name, 'kit');
  assert.deepEqual(A.emote('happy'), { eye: 'happy', mouth: 2, tail: 12, head: -4 }, "'top' is its last mouth, as a number");
  assert.deepEqual(A.emote('wide'), { mouth: 1, 'arm-l': 24, 'arm-r': -24, tail: 20 }, 'no wide eye: dropped');
  assert.deepEqual(A.emote('sad'), { head: 20, eye: 'sleep' }, 'its own pose wins over the table');
  assert.deepEqual(A.emote('dot'), {}, 'no emote: the rest (and a blink) show through');
  assert.deepEqual(A.look(-1), { dir: -1, head: 0 });
  assert.deepEqual(A.cycle('walk', 1 / 12), { 'arm-l': -10, 'arm-r': 10 });
  assert.equal(A.fallbacks.size, 0);
  assert.deepEqual(A.idle(0.5), A.idle(0.5 + 1 / 13), 'one state per drawn two');
  const blinks = Array.from({ length: 40 }, (_, j) => A.idle(j / 6).eye).filter(Boolean);
  assert.ok(blinks.length && blinks.every((e) => e === 'sleep'));
  assert.ok(Object.keys(EMOTES).length >= 4);
});

test('a puppet actor on the stage: mirrored, turned, reaching, and a missing cycle bobs and says so', () => {
  const A = actorOf(puppet(KIT));
  const g = A.place(500, 500, 50, { ...A.look(-1), rot: 0.2 });
  assert.equal(g.name, 'actor:kit');
  assert.ok(g.xf[0] < 0 || g.xf[1] < 0, 'dir -1 mirrors');
  assert.equal(g.kids[0], A({ head: 0 }), 'the cel inside is the memoised puppet group');
  // Feet land at y + .86 s, and the box is 2 s tall.
  const up = A.place(500, 500, 50, {});
  assert.deepEqual([up.xf[4], up.xf[5], up.xf[3]], [500, 543, 100 / 120]);
  // A hand up and to the right turns the right arm up that way (arms hang down at 0 degrees).
  const reach = A.place(500, 500, 50, { hand: [600, 400] });
  const arm = reach.kids[0].inputs['arm-r'];
  assert.ok(arm < -90 && arm > -180, `arm-r ${arm}`);
  const hop = A.cycle('hop', 0.3);
  assert.equal(hop.fallback, 'hop');
  assert.ok(A.fallbacks.has('hop'));
  const bobbed = A.place(0, 0, 50, hop), metas = [];
  walk([bobbed], (op) => { if (op.op === 'meta') metas.push(op); });
  assert.deepEqual(metas.map((m) => [m.tag, m.data]), [['actor-cycle', { actor: 'kit', cycle: 'hop' }]]);
  assert.notEqual(A.cycle('hop', 0).lift, A.cycle('hop', 0.25).lift, 'two poses');
});

test('a code cel as an actor: the film supplies the methods', () => {
  const ball = puppet({ ...KIT, name: 'ball' });   // any cel will do; this one has a box and inputs
  const plain = Object.assign((q) => ball(q), { cel: ball.cel });
  const A = actorOf(plain, { emote: (n) => (n === 'happy' ? { eye: 'happy' } : {}) });
  assert.deepEqual(A.emote('happy'), { eye: 'happy' });
  assert.equal(A.cycle('walk', 0).fallback, 'walk', 'a cel has no cycles of its own');
  assert.equal(A.place(0, 0, 50, { eye: 'happy', dir: -1 }).kids[0], ball({ eye: 'happy' }));
});

test('CAST.FOX is there once the film has read the fox, and it runs', () => {
  assert.equal(CAST.FOX, undefined);
  fromStore(['fox']);
  const FOX = CAST.FOX;
  assert.equal(FOX, CAST.FOX, 'built once');
  assert.equal(FOX.name, 'fox');
  assert.deepEqual(Object.keys(FOX.cycle('run', 0)).sort(), ['arm-l', 'arm-r', 'body', 'head', 'leg-l', 'leg-r', 'tail']);
  assert.equal(FOX.fallbacks.size, 0);
});

test('recipes A to Z with a subject or a figure take actor: it stands where the boat stood', async () => {
  const { establishing, followTravel, enso, coda } = await import('../recipes/shots.js');
  const { film, frame } = await import('../core/tree.js');
  const A = actorOf(puppet(KIT));
  const cels = (shot) => {
    const f = film({ name: 's', look: 'paperInk', timeline: shot }), found = [];
    walk(frame(f, 3).list, (op) => { if (op.cel) found.push(op.cel); });
    return found;
  };
  for (const R of [establishing, followTravel, enso, coda]) {
    assert.deepEqual(cels(R({ actor: A })), ['kit'], R.recipe);
    assert.ok(cels(R({})).includes('boat'), `${R.recipe} still draws its boat by default`);
  }
});
