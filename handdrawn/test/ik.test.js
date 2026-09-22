// 4.0 K5: reach (two-bone IK), lookAt, stride, walkTo, stand, and lint's foot-slide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FPS, actorOf, dialogue, puppet, stickSource, reach, lookAt, headAt, partAt, feetOf, strideOf, walkTo, stand } from '../core/index.js';
import { fromStore } from '../core/assets.js';
import { lint, formatFinding } from '../core/lint.js';
import { circle, fill, meta, paper, stroke } from '../core/list.js';
import { ramp } from '../core/curves.js';
import { signOff } from '../core/text.js';
import { film, seq, shot } from '../core/tree.js';
import { CAST } from '../recipes/doodle.js';

const SAM = actorOf(puppet(stickSource({ name: 'sam' })));
const AT = [400, 700, 260];
const near = (a, b, d, what) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) <= d, `${what}: ${a} vs ${b}`);

test('reach: the wrist lands on a stage point within reach, quantised on the 2 degree grid', () => {
  for (const [target, dir] of [[[480, 560], 1], [[330, 600], -1], [[470, 520], 0]]) {
    const state = { dir };
    const q = reach(SAM, 'hand-r', target, { at: AT, state });
    assert.deepEqual(Object.keys(q).sort(), ['arm-r', 'fore-r']);
    for (const v of Object.values(q)) assert.equal(Math.abs(v % 2), 0);
    near(partAt(SAM, 'hand-r', AT, { ...state, ...q }), target, 6, `dir ${dir}`);
  }
});

test('reach: the elbow bends the way asked; out of reach the arm straightens towards the point', () => {
  const t = [470, 590], state = { dir: 1 };
  const down = reach(SAM, 'hand-r', t, { at: AT, state }), up = reach(SAM, 'hand-r', t, { at: AT, state, elbow: 'up' });
  const elbow = (q) => partAt(SAM, 'fore-r', AT, { ...state, ...q });
  assert.ok(elbow(down)[1] > elbow(up)[1], 'down is below up');
  near(partAt(SAM, 'hand-r', AT, { ...state, ...up }), t, 6, 'up still lands');
  const far = reach(SAM, 'hand-r', [1000, 300], { at: AT, state });
  assert.ok(Math.abs(far['fore-r']) <= 2, `a straight arm, fore-r ${far['fore-r']}`);
  // A leg reaches with its knee in front, by default.
  const kick = reach(SAM, 'foot-r', [470, 860], { at: AT, state });
  near(partAt(SAM, 'foot-r', AT, { ...state, ...kick }), [470, 860], 6, 'the ankle');
  assert.throws(() => reach(SAM, 'head', [0, 0], { at: AT }), /not a limb/);
  assert.throws(() => reach(SAM, 'hand-r', [0, 0], { at: AT, elbow: 'sideways' }), /elbow 'sideways'/);
});

test('place: reach and hand on a two-bone arm reach the point; a code cel reaches nothing', () => {
  const t = [480, 560];
  const g = SAM.place(...AT, { dir: 1, reach: { 'hand-r': t } });
  assert.deepEqual({ 'arm-r': g.kids[0].inputs['arm-r'], 'fore-r': g.kids[0].inputs['fore-r'] }, reach(SAM, 'hand-r', t, { at: AT, state: { dir: 1 } }));
  const h = SAM.place(...AT, { dir: 1, hand: t });
  assert.equal(h.kids[0].inputs['fore-r'], g.kids[0].inputs['fore-r']);
  assert.deepEqual(reach({ name: 'cel' }, 'hand-r', t), {});
});

test('the fox: a single-segment arm is aimed at the handle, as place hand aims it', () => {
  fromStore(['fox']);
  const FOX = CAST.FOX, at = [760, 668, 130], handle = [683, 637], state = FOX.look(-1);
  const q = reach(FOX, 'hand-r', handle, { at, state });
  assert.deepEqual(Object.keys(q), ['arm-r']);
  const aimed = FOX.place(...at, { ...state, hand: handle }).kids[0].inputs['arm-r'];
  assert.ok(Math.abs(q['arm-r'] - aimed) <= 1, `reach ${q['arm-r']}, hand ${aimed}`);
  // The paw ends near the handle: the arm's tip is along its aim, about an arm's length from the shoulder.
  const shoulder = partAt(FOX, 'arm-r', at, state), paw = FOX.puppet.inkOf('arm-r', { ...FOX.rest, ...state, ...q });
  assert.ok(paw && Math.hypot(handle[0] - shoulder[0], handle[1] - shoulder[1]) < 90);
});

test('lookAt: the head turns towards the point, the pupils take the rest; front on only the pupils move', () => {
  const upR = lookAt(SAM, [700, 200], { at: AT, state: { dir: 1 } });
  assert.ok(upR.head < 0 && upR.dir === undefined, JSON.stringify(upR));
  assert.ok(upR['pupil.y'] <= 0);
  const behind = lookAt(SAM, [100, 600], { at: AT, state: { dir: 1 } });
  assert.equal(behind.dir, -1, 'it turns round');
  assert.equal(lookAt(SAM, [100, 600], { at: AT, state: { dir: 1 }, turn: false }).dir, undefined);
  const front = lookAt(SAM, [900, 300], { at: AT, state: { dir: 0 } });
  assert.equal(front.head, undefined);
  assert.ok(front['pupil.x'] > 0 && front['pupil.y'] < 0, JSON.stringify(front));
  // Another actor: its head is the target.
  const B = actorOf(puppet(stickSource({ name: 'bo', build: 'tall' })));
  const other = [800, 640, 280, { dir: -1 }];
  const at = lookAt(SAM, B, { at: AT, state: { dir: 1 }, other });
  assert.deepEqual(at, lookAt(SAM, headAt(B, ...other), { at: AT, state: { dir: 1 } }));
  assert.throws(() => lookAt(SAM, B, { at: AT }), /needs its place/);
});

test('dialogue gaze: the speakers look at each other', () => {
  const B = actorOf(puppet(stickSource({ name: 'bo', build: 'tall' })));
  const where = { sam: [300, 700, 200], bo: [800, 640, 260] };
  const talk = dialogue([[SAM, 'hi'], [B, 'hello up there']], { where, gaze: true });
  const s = talk.state(SAM, 0.1);
  assert.equal(s.dir, 1);
  assert.deepEqual({ head: s.head, 'pupil.x': s['pupil.x'] }, (({ head, 'pupil.x': px }) => ({ head, 'pupil.x': px }))(lookAt(SAM, B, { at: where.sam, state: { ...SAM.look(1) }, other: where.bo })));
  const plain = dialogue([[SAM, 'hi'], [B, 'hello up there']], { where });
  assert.equal(plain.state(SAM, 0.1)['pupil.x'], undefined, 'without gaze, as before');
});

test('strideOf: the walk moves its planted foot back; steps land where the planted foot changes', () => {
  const g = strideOf(SAM, 'walk');
  assert.equal(g.n, 8);
  assert.ok(g.advance.every((a) => a > 0), g.advance.join(', '));
  assert.ok(g.stride > 100);
  assert.deepEqual([...g.strikes], [0, 4]);
  assert.throws(() => strideOf(SAM, 'nope'), /no cycle 'nope'/);
});

test('stand: the rest pose stands where it is; a bent pose sinks to the ground line', () => {
  assert.equal(stand(SAM, { dir: 1 }).lift, 0);
  const splay = stand(SAM, { dir: 1, 'leg-l': 30, 'leg-r': -30 });
  assert.ok(splay.lift < 0);
  const [l, r] = feetOf(SAM, { dir: 1 });
  assert.equal(l[1], r[1]);
});

// The stage x of every walking frame's ankles, from the feet metas place draws.
const feetFrames = (A, w, y, s, n) => Array.from({ length: n }, (_, i) => {
  const g = A.place(w.x(i / FPS), y, s, w.state(i / FPS)), m = g.kids.find((k) => k.op === 'meta' && k.tag === 'feet');
  return m?.data ?? null;
});

test('walkTo: the planted ankle holds still frame to frame, both ways, and it arrives', () => {
  for (const [x0, x1] of [[-150, 520], [900, 300]]) {
    const w = walkTo(SAM, x0, x1, 0.5, 3, { s: 260 });
    assert.equal(w.end, 3);
    assert.equal(w.x(0), x0);
    assert.equal(w.x(5), x1);
    assert.ok(w.steps.length >= 3 && w.steps.every((t) => t >= 0.5 && t < 3));
    const f = feetFrames(SAM, w, 700, 260, 40);
    let checked = 0;
    for (let i = 1; i < f.length; i++) {
      if (!f[i] || !f[i - 1]) continue;
      const drift = Math.min(...[0, 1].filter((k) => Math.abs(f[i].at[k][1] - f[i].ground) < 0.03 * f[i].h && Math.abs(f[i - 1].at[k][1] - f[i - 1].ground) < 0.03 * f[i - 1].h)
        .map((k) => Math.abs(f[i].at[k][0] - f[i - 1].at[k][0])));
      assert.ok(drift <= 2, `frame ${i}: ${drift}`);
      checked++;
    }
    assert.ok(checked > 20);
    assert.equal(w.state(4).walking, undefined, 'standing after it arrives');
  }
  assert.throws(() => walkTo(SAM, 0, 100, 0, 1), /stage size/);
});

const endShot = shot('end', 2, ({ t, CX, CY }) => [
  paper(), meta('anchor', { name: 'signOff' }),
  signOff('a', 'b', { x: CX, y: CY, size: 80, pA: ramp(0, 0.2, t), pB: ramp(0.2, 0.4, t) }),
]);
const walkFilm = (x) => film({ name: 'scratch', look: 'paperInk', timeline: seq(shot('walk', 3, ({ t }) => [
  paper(), meta('anchor', { cel: 'sam' }), meta('intent', 'crop'), fill(circle(-50, -50, 5), 'ink'),
  stroke(circle(-50, -50, 5), 'ink'),
  SAM.place(x(t), 700, 200, x.state(t)),
]), endShot) });

test('lint foot-slide: a walk cycle slid across at a steady speed slides; walkTo does not', () => {
  const slid = Object.assign((t) => 100 + 250 * t, { state: (t) => ({ ...SAM.look(1), ...SAM.cycle('walk', t), walking: 'walk' }) });
  const got = lint(walkFilm(slid));
  assert.deepEqual(got.map((f) => f.rule), ['foot-slide'], got.map((f) => formatFinding(f)).join('\n'));
  const w = walkTo(SAM, 100, 800, 0, 3, { s: 200 });
  const planted = Object.assign((t) => w.x(t), { state: w.state });
  assert.deepEqual(lint(walkFilm(planted)).map((f) => formatFinding(f)), []);
});
