import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actorOf, EMOTES } from '../core/actor.js';
import { fromStore } from '../core/assets.js';
import { pen } from '../core/doodle.js';
import { circle, fill, hashList, serialise, stroke, walk } from '../core/list.js';
import { bubble } from '../core/marks.js';
import { cel } from '../core/tree.js';
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

// KIT with a turnaround: the head and eyes drawn again from the front; three-quarter left to the side view.
const KIT3 = {
  ...KIT, name: 'kit3', views: ['side', 'front'],
  parts: {
    ...KIT.parts,
    'arm-r': { parent: 'body', pivot: { side: [20, -50], front: [40, -20] }, ops: disc(10, 5) },
    head: { parent: 'body', pivot: [0, -75], ops: { side: disc(0, 18), front: disc(0, 20) } },
  },
};

test('a turnaround actor: look picks the view, the puppet mirrors itself, a hand aims in its own drawing', () => {
  const A = actorOf(puppet(KIT3));
  assert.deepEqual(A.look(1), { dir: 1, head: 0 });
  assert.deepEqual(A.look(-0.8), { dir: -1, head: 0 });
  assert.deepEqual(A.look(0), { dir: 0, head: 0 }, 'it has a front: it turns to us, no chin-up');
  assert.deepEqual(A.look(0.5), { dir: 1, head: 0 }, 'no three-quarter: the side');
  assert.deepEqual(A.look(-0.4), { dir: -1, head: 0 });
  const B = actorOf(puppet({ ...KIT, name: 'kit3b', views: ['side', 'three-quarter'] }));
  assert.deepEqual(B.look(-0.5), { dir: -0.5, head: 0 });
  assert.deepEqual(B.look(0), { dir: 1, head: -6 }, 'no front: facing us is the old chin-up');
  // The stage does not flip what the puppet already mirrors.
  const g = A.place(500, 500, 50, A.look(-1));
  assert.ok(g.xf[0] > 0, 'the stage keeps its scale positive');
  assert.equal(g.kids[0], A({ dir: -1, head: 0 }));
  assert.equal(g.kids[0].kids[0].name, 'mirror');
  // A hand to the left of a fox facing left is in front of it: its right arm reaches, turned in its own frame.
  const reach = A.place(500, 500, 50, { dir: -1, hand: [400, 400] });
  const arm = reach.kids[0].inputs['arm-r'];
  assert.ok(arm < -90 && arm > -180, `arm-r ${arm}`);
  // From the front the right arm turns about the front pivot, lower down, so it reaches higher for the same hand.
  const side = A.place(500, 500, 50, { dir: 1, hand: [600, 400] }).kids[0].inputs['arm-r'];
  const front = A.place(500, 500, 50, { dir: 0, hand: [600, 400] }).kids[0].inputs['arm-r'];
  assert.ok(front < side, `front ${front}, side ${side}`);
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

// ---------- speech (S9) ----------

const texts = (list) => { const out = []; walk(list, (op) => { if (typeof op.name === 'string' && op.name.startsWith('text:')) out.push(op); }); return out; };
const strokesIn = (op) => { let n = 0; walk(op, (o) => { if (o.op === 'stroke') n++; }); return n; };

test('say: the mouth runs 0 -> 2 -> 3 -> 1 per syllable on the grid, as the puppet\'s own variants', () => {
  const a = actorOf(puppet(KIT)), line = a.say('hello there', 0.5);
  const mouths = Array.from({ length: 20 }, (_, i) => line.mouth(i / 12));
  assert.deepEqual(mouths, [null, null, null, null, null, null, 0, 2, 3, 1, 0, 2, 3, 1, 0, 0, 2, 3, 1, null]);
  // KIT has three mouths: viseme 3 is its last.
  assert.deepEqual(line.state(8 / 12), { mouth: 2 });
  assert.deepEqual(line.state(7 / 12), { mouth: 2 });
  assert.deepEqual(line.state(9 / 12), { mouth: 1 });
  assert.deepEqual(line.state(0), {});
  assert.deepEqual(line.syllables.map((s) => s.text), ['he', 'llo', 'there']);
  // The state is a mouth the puppet draws.
  assert.doesNotThrow(() => a.place(0, 0, 60, { ...a.emote('happy'), ...line.state(8 / 12) }));
});

test('say: the words arrive letter by letter in a bubble above the head, and hold', () => {
  const a = actorOf(puppet(KIT)), line = a.say('hello there', 1, { hold: 0.5 });
  assert.equal(line.draw(0.9, 300, 500, 60), null);
  assert.equal(line.draw(line.until, 300, 500, 60), null);
  const early = line.draw(1, 300, 500, 60), late = line.draw(line.end, 300, 500, 60);
  assert.deepEqual(early.kids.map((k) => k.name), ['bubble', 'text:hello there']);
  assert.ok(strokesIn(texts(early)[0]) < strokesIn(texts(late)[0]));
  assert.equal(strokesIn(texts(late)[0]), strokesIn(texts(line.draw(line.until - 1 / 12, 300, 500, 60))[0]));
  // Above the head (feet at y + .86 s, 2 s tall), and kept on the stage at its edge.
  const b = early.kids[0].kids[0].path.box;
  assert.ok(b[1] + b[3] < 500 + (0.86 - 2) * 60);
  const edge = line.draw(1, 10, 500, 60).kids[0].kids[0].path.box;
  assert.ok(edge[0] >= 10);
  assert.ok(line.draw(1, 300, 500, 60, { dir: -1 }).kids[0].kids[0].path.box[0] < b[0], 'faces its way');
  // at: the bubble centre at a stage point; bubble: false drops it.
  const moved = a.say('hello there', 1, { at: [700, 200] }).draw(1, 300, 500, 60);
  assert.equal(moved.kids[1].xf[4], 700);
  assert.deepEqual(a.say('hi', 1, { bubble: false }).draw(1, 0, 0, 60).kids.map((k) => k.name), ['text:hi']);
});

test('say: deterministic per seed; score events on the syllables, placed with the shot', () => {
  const a = actorOf(puppet(KIT));
  const drawAll = (line) => hashList(Array.from({ length: 30 }, (_, i) => line.draw(i / 12, 300, 500, 60)).filter(Boolean));
  assert.equal(drawAll(a.say('hello there', 0.5, { seed: 3 })), drawAll(a.say('hello there', 0.5, { seed: 3 })));
  assert.notEqual(drawAll(a.say('hello there', 0.5, { seed: 3 })), drawAll(a.say('hello there', 0.5, { seed: 4 })));
  const ev = a.say('hello there', 0.5).events(10);
  assert.deepEqual(ev.map((e) => Math.round((e.t - 10.5) * 12)), [0, 4, 9]);
  assert.throws(() => a.say('hi'), /start time/);
});

test('say: an actor with no mouth part gets a three-stroke mouth at spec.mouthAt while it speaks', () => {
  const line = HOG.say('hi', 0);
  const mouth = (t, o) => line.draw(t, 300, 500, 60, o)?.kids.find((k) => k.name === 'mouth');
  const m = mouth(0);
  assert.equal(m.kids.length, 3);
  assert.ok(m.kids.every((k) => k.op === 'stroke'));
  const x = (mm) => mm.kids[0].path.box[0] + mm.kids[0].path.box[2] / 2;
  assert.ok(Math.abs(x(m) - (300 + 1.02 * 60)) < 1e-6);
  assert.ok(Math.abs(x(mouth(0, { dir: -1 })) - (300 - 1.02 * 60)) < 1e-6);
  assert.notEqual(hashList([mouth(0)]), hashList([mouth(1 / 12)]));
  assert.equal(mouth(line.end), undefined, 'the bubble holds, the mouth is gone');
  assert.deepEqual(line.state(0), {});
  // A cel with no mouth and no mouthAt draws only the words.
  const plain = actorOf(cel('blob', () => [fill(circle(0, -50, 40), 'fills.0')], { box: [-40, -90, 80, 80] }));
  assert.deepEqual(plain.say('hi', 0).draw(0, 300, 500, 60).kids.map((k) => k.name), ['bubble', 'text:hi']);
});

test('bubble: a paper rounded rect with its tail out to the point', () => {
  const b = bubble([100, 100, 200, 80], [130, 260], { seed: 2 });
  assert.deepEqual(b.kids.map((k) => [k.op, k.role]), [['fill', 'paper'], ['stroke', 'ink']]);
  const pts = b.kids[0].path.sub[0].pts, tip = [];
  for (let i = 0; i < pts.length; i += 2) if (pts[i] === 130 && pts[i + 1] === 260) tip.push(i);
  assert.equal(tip.length, 1);
  assert.ok(b.kids[0].path.box[1] + b.kids[0].path.box[3] >= 260);
  assert.ok(bubble([0, 0, 100, 50], null).kids[0].path.box[3] < 60);
  assert.equal(hashList([b]), hashList([bubble([100, 100, 200, 80], [130, 260], { seed: 2 })]));
});
