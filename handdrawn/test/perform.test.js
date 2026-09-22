// 4.0 K4: a pose timeline (perform) and additive layers (layer); recipes that take perform:.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FPS, actorOf, cel, circle, ease, fill, perform, layer, puppet, stickSource } from '../core/index.js';
import { hashList } from '../core/list.js';
import { frame } from '../core/tree.js';
import pointing, { act } from '../films/pointing.js';
import { darkSection, establishing, followTravel } from '../recipes/shots.js';

const SAM = actorOf(puppet(stickSource({ name: 'sam' })));
const at = (P, i) => P.state(i / FPS);

test('the first entry holds from the start; a pose blends in over dur and holds on the twos', () => {
  const P = perform(SAM, [[0, 'idle'], [1, 'point-r', { dur: 0.5, ease: ease.linear }]]);
  const idle = SAM.pose('idle'), point = SAM.pose('point-r');
  assert.equal(at(P, 0)['arm-r'], idle['arm-r']);
  assert.equal(at(P, 11)['arm-r'], idle['arm-r']);
  assert.equal(at(P, 12)['arm-r'], idle['arm-r']);            // the blend starts from where it is
  const mid = at(P, 15)['arm-r'];                             // 3 frames in: on the twos, 2 of 6
  assert.equal(mid, idle['arm-r'] + (point['arm-r'] - idle['arm-r']) * (2 / 6));
  assert.deepEqual(at(P, 14), at(P, 15));                     // one drawing on two frames
  for (const i of [18, 24, 40]) assert.equal(at(P, i)['arm-r'], point['arm-r']);
  // A key the pose drops goes back to rest; the first pose's other keys are replaced by the second's.
  assert.equal(at(P, 30).head, point.head);
});

test('a state is quantised on its input step and pure in t', () => {
  const P = perform(SAM, [[0, 'stand'], [0.3, { 'arm-r': -45, 'pupil.x': 1.3 }, { dur: 0.7, ease: 'io' }]]);
  for (let i = 0; i < 20; i++) {
    const s = at(P, i);
    assert.ok(!Object.is(s['arm-r'], -0));
    assert.equal(Math.abs(s['arm-r'] % 2), 0);
    assert.equal(Math.abs((s['pupil.x'] ?? 0) % 0.5), 0);
    assert.deepEqual(s, at(P, i));
  }
});

test('anticipation winds a tenth of the change the other way; overshoot passes and settles', () => {
  const P = perform(SAM, [[0, 'stand'], [1, { 'arm-r': -100 }, { anticipate: 1 / 6, overshoot: 0.1, dur: 1 / 3, ease: ease.linear }]], { on: 1 });
  assert.equal(at(P, 10)['arm-r'], 0);
  assert.ok(at(P, 11)['arm-r'] > 0);                          // winding up the other way
  assert.equal(at(P, 12)['arm-r'], 10);                       // the whole wind-up: a tenth of 100
  assert.equal(at(P, 16)['arm-r'], -110);                     // landed, 10% past
  assert.equal(at(P, 18)['arm-r'], -100);                     // settled over half the blend
  const b = P.beats[1];
  assert.ok(Math.abs(b.from - (1 - 1 / 6)) < 1e-9 && Math.abs(b.land - 4 / 3) < 1e-9 && Math.abs(b.settle - 1.5) < 1e-9);
  assert.equal(P.end, b.settle);
});

test('variants switch half-way; an expression owns the face a later pose leaves alone', () => {
  const P = perform(SAM, [[0, 'stand'], [1, ['cheer', 'happy'], { dur: 0.5 }], [2, 'walk']]);
  assert.equal(at(P, 13).eye, 'open');                        // before half-way: still at rest
  assert.equal(at(P, 16).eye, 'happy');
  assert.equal(at(P, 30).eye, 'happy');                       // the walk replaces the cheer, not the smile
  const w = SAM.cycle('walk', 1);                             // well into the walk it is the cycle
  assert.equal(P.state(3)['leg-l'], w['leg-l']);
});

test('names resolve through the vocabulary, with a prefix for the ambiguous; errors are named', () => {
  assert.equal(perform(SAM, [[0, 'pose:sleep']]).beats[0].names[0], 'sleep');
  assert.equal(perform(SAM, [[0, 'emote:sleep']]).state(0).eye, 'sleep');
  assert.throws(() => perform(SAM, [[0, 'moonwalk']]), /no pose 'moonwalk'/);
  assert.throws(() => perform(SAM, [[1, 'idle'], [0, 'cheer']]), /before the one before it/);
  assert.throws(() => perform(SAM, [[0, 'idle']], { on: 1.5 }), /whole number/);
  // A code cel has no vocabulary: an object still works, a vocabulary pose is nothing.
  const DOT = actorOf(cel('dot', ({ r = 5 }) => [fill(circle(0, 0, r), 'ink')], { box: [-10, -10, 20, 20], inputs: { r: [1, 20, 1] } }));
  const D = perform(DOT, [[0, 'cheer'], [1, { r: 9 }]]);
  assert.deepEqual(D.state(0), {});
  assert.equal(D.state(2).r, 9);
});

test('events: a pluck as each named entry lands, none for the start or a patch', () => {
  const P = perform(SAM, [[0, 'idle'], [1, 'wave'], [2, { head: 4 }], [3, 'cheer', { sound: false }], [4, 'shrug']]);
  assert.deepEqual(P.events(10).map((e) => e.t), [11.25, 14.25]);
});

test('layer adds a wave to a walk on the named parts, relative to rest', () => {
  const walk = perform(SAM, [[0, 'walk']]), wave = SAM.pose('wave');
  const both = layer(walk, wave, { parts: ['arm-r', 'fore-r'] });
  for (const t of [0.1, 0.4]) {
    const w = walk.state(t), s = both(t);
    assert.equal(s['arm-r'], w['arm-r'] + wave['arm-r']);
    assert.equal(s['leg-l'], w['leg-l']);
    assert.equal(s['arm-l'], w['arm-l']);                     // not a named part
    assert.equal(s.eye, w.eye);                               // not a named part either
  }
  assert.equal(layer({}, wave, { parts: ['eye'] }).eye, wave.eye);   // a variant: extra wins at full weight
  const half = layer({ head: 10 }, { head: 20, eye: 'wide' }, { weight: 0.25, rest: { head: 4 } });
  assert.deepEqual(half, { head: 14 });
});

test('recipes take perform: in place of the idle state', () => {
  const P = perform(SAM, [[0, 'stand'], [0.5, 'cheer']]);
  const ctx = (t) => ({ t, k: Math.round(t * FPS), i: 0, T: 1.5, seed: 0, W: 1080, H: 1080, CX: 540, CY: 540 });
  const a = hashList(darkSection.layer(ctx(1), { actor: SAM, perform: P }));
  const b = hashList(darkSection.layer(ctx(1), { actor: SAM, perform: [[0, 'stand'], [0.5, 'cheer']] }));
  const c = hashList(darkSection.layer(ctx(1), { actor: SAM }));
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.ok(establishing({ actor: SAM, perform: P }));
  assert.ok(followTravel.layer(ctx(0.5), { actor: SAM, perform: P }));
  assert.throws(() => darkSection.layer(ctx(1), { perform: P }), /needs an actor/);
  const FOX2 = actorOf(puppet(stickSource({ name: 'kim' })));
  assert.throws(() => darkSection.layer(ctx(1), { actor: FOX2, perform: P }), /sam's, the actor is kim/);
});

test('pointing: sam points at three labels in turn, winding up first, and the held frames dedup', () => {
  assert.equal(act.beats.length, 5);
  act.beats.slice(1, 4).forEach((b) => assert.ok(b.from < b.t, 'each point is anticipated'));
  const n = Math.round(7.25 * FPS), hashes = Array.from({ length: n }, (_, i) => hashList(frame(pointing, i).list));
  // Once a label is written and the arm settled, nothing moves until the next wind-up: one list.
  for (let j = 1; j < 4; j++) {
    const done = Math.ceil((act.beats[j].land + 0.6) * FPS), next = Math.floor(act.beats[j + 1].from * FPS);
    assert.ok(next - done >= 4, `hold ${j} is ${next - done} frames`);
    for (let i = done + 1; i < next; i++) assert.equal(hashes[i], hashes[done], `frame ${i} repeats frame ${done}`);
  }
  // And while sam moves the arm, the drawings change on the twos.
  const b = act.beats[2], i0 = Math.round(b.t * FPS);
  assert.notEqual(hashes[i0], hashes[i0 + 2]);
});
