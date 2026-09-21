import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readCatalogue } from '../core/assets.js';
import { actorOf } from '../core/actor.js';
import { circle, fill, rect, serialise, stroke } from '../core/list.js';
import { lintPuppet } from '../core/lint.js';
import { puppet } from '../core/puppet.js';
import { checkMap, retarget } from '../core/retarget.js';
import { RIGS, fillJoints, rasterise, rigClip, skelOfMask } from '../core/rig.js';
import { registerClip } from '../engines/traced.js';
import { toV2 } from '../cli/clip.mjs';

// A stick figure as a mask: thick segments between named points, ground at y = 0, pixels one unit each.
function sticks(segs, { w = 400, h = 260, r = 7, x0 = -200, y0 = -240 } = {}) {
  const mask = new Uint8Array(w * h);
  for (const [[ax, ay], [bx, by]] of segs) {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay));
    for (let k = 0; k <= n; k++) {
      const cx = ax + (bx - ax) * k / n - x0, cy = ay + (by - ay) * k / n - y0;
      for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (x >= 0 && y >= 0 && x < w && y < h && (x - cx) ** 2 + (y - cy) ** 2 <= r * r) mask[y * w + x] = 1;
      }
    }
  }
  return { mask, w, h, x0, y0, s: 1 };
}
const near = (p, q, tol, what) => assert.ok(p && Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol, `${what}: ${JSON.stringify(p)} is not near ${JSON.stringify(q)}`);

test('rig: a quadruped stick figure is labelled by position: hooves, head, tail tip, hip, shoulder, knees', () => {
  const hip = [-90, -110], sh = [90, -110];
  const R = sticks([[hip, sh], [hip, [-150, -150]], [sh, [150, -200]],
    [hip, [-130, -2]], [hip, [-50, -2]], [sh, [60, -2]], [sh, [130, -2]]]);
  const { joints: J } = skelOfMask(R, 'quadruped', { h: 200 });
  near(J.head, [150, -200], 8, 'head');
  near(J['tail-tip'], [-150, -150], 8, 'tail tip');
  near(J['ankle-h1'], [-50, -2], 8, 'the leading hind hoof');
  near(J['ankle-h2'], [-130, -2], 8, 'the trailing hind hoof');
  near(J['ankle-f1'], [130, -2], 8, 'the leading forehoof');
  near(J['ankle-f2'], [60, -2], 8, 'the trailing forehoof');
  near(J.hip, hip, 14, 'hip');
  near(J.shoulder, sh, 14, 'shoulder');
  near(J['knee-h1'], [-70, -56], 16, 'a knee is half way down its leg');
  // Facing left, the same drawing mirrored labels the same joints mirrored.
  const L = sticks([[[90, -110], [-90, -110]], [[90, -110], [150, -150]], [[-90, -110], [-150, -200]],
    [[90, -110], [130, -2]], [[90, -110], [50, -2]], [[-90, -110], [-60, -2]], [[-90, -110], [-130, -2]]]);
  const { joints: M } = skelOfMask(L, 'quadruped', { h: 200, facing: -1 });
  near(M.head, [-150, -200], 8, 'head facing left');
  near(M['ankle-h1'], [50, -2], 8, 'the leading hind hoof facing left');
});

test('rig: a biped stick figure: feet, head, hip where the legs meet, hands, shoulder', () => {
  const hip = [0, -100], neck = [0, -170];
  const R = sticks([[hip, neck], [neck, [0, -225]], [neck, [-60, -120]], [neck, [70, -130]], [hip, [-40, -2]], [hip, [30, -2]]]);
  const { joints: J } = skelOfMask(R, 'biped', { h: 230 });
  near(J.head, [0, -225], 8, 'head');
  near(J.hip, hip, 14, 'hip (a thick fork thins to a point a little below where the strokes meet)');
  near(J.shoulder, neck, 12, 'shoulder');
  near(J['ankle-1'], [30, -2], 8, 'the leading foot');
  near(J['wrist-1'], [70, -130], 8, 'the leading hand');
  near(J['wrist-2'], [-60, -120], 8, 'the other hand');
  near(J['elbow-1'], [35, -150], 14, 'an elbow is half way along its arm');
});

test('rig: rasterise fills an outline even-odd; fillJoints carries a missing joint across the loop', () => {
  const R = rasterise({ sub: [{ pts: [0, 0, 40, 0, 40, 20, 0, 20] }, { pts: [10, 5, 20, 5, 20, 15, 10, 15] }] }, 1);
  assert.equal(R.mask.reduce((a, b) => a + b, 0), 40 * 20 - 10 * 10, 'the square hole is left out');
  const fr = [{ a: [0, 0] }, {}, {}, { a: [30, 0] }];
  fillJoints(fr, ['a']);
  assert.deepEqual(fr.map((f) => f.a), [[0, 0], [10, 0], [20, 0], [30, 0]]);
  const loop = [{}, { a: [10, 0] }, { a: [20, 0] }, {}];
  fillJoints(loop, ['a']);
  assert.deepEqual([loop[0].a, loop[3].a], [[13.3, 0], [16.7, 0]], 'across the end of the loop');
});

test('rig: the horse in the store carries a quadruped skeleton in every frame, and rigging it again changes nothing', () => {
  const st = readCatalogue(), horse = st.json('horse');
  assert.equal(horse.rig, 'quadruped');
  for (const [k, f] of horse.frames.entries()) {
    assert.deepEqual(Object.keys(f.skel.joints).sort(), [...RIGS.quadruped.joints].sort(), `frame ${k}`);
    assert.equal(f.skel.chains.length, 5, `frame ${k}`);
    // The hooves are the lowest joints, the head the front-most.
    const J = f.skel.joints;
    assert.ok(Math.min(...['ankle-h1', 'ankle-h2', 'ankle-f1', 'ankle-f2'].map((j) => J[j][1])) > J.hip[1], `frame ${k}: hooves under the hip`);
    assert.ok(J.head[0] > J.shoulder[0] && J.shoulder[0] > J.hip[0] && J.hip[0] > J['tail-tip'][0], `frame ${k}: tail, hip, shoulder, head from the back`);
  }
  assert.deepEqual(rigClip(horse, 'quadruped').frames.map((f) => f.skel), horse.frames.map((f) => f.skel), 'kept');
  // hdf clip and the engine keep it.
  const v2 = toV2(horse);
  assert.deepEqual([v2.rig, v2.facing, v2.frames[5].skel], ['quadruped', 1, horse.frames[5].skel]);
  const reg = registerClip('horse-skel', horse);
  assert.deepEqual([reg.rig, reg.frames[5].skel], ['quadruped', horse.frames[5].skel]);
  const again = rigClip(horse, 'quadruped', { force: true });
  assert.deepEqual(again.frames.map((f) => f.skel), horse.frames.map((f) => f.skel), 'the labelling is deterministic');
});

// ---------- retarget ----------

const ops = (list) => JSON.parse(serialise(list));
// A stick puppet: a body on its hips, a leg hanging down from them, 100 units tall.
const STICK = {
  name: 'stick', units: 100, box: [-120, -170, 240, 190],
  parts: {
    leg: { parent: 'body', pivot: [0, -40], ops: ops([fill(rect(-4, 0, 8, 40), 'fills.0'), stroke(rect(-4, 0, 8, 40), 'ink')]) },
    body: { pivot: [0, -40], ops: ops([fill(rect(-10, -60, 20, 60), 'fills.1'), fill(circle(0, -70, 10), 'fills.1')]) },
  },
};
const RAD = Math.PI / 180;
// A clip whose skeleton is generated from known angles: the spine pitches by phi, the leg's world direction
// is psi from straight down; a frame k in the air sits `gap` above the ground.
function synth(n = 12) {
  const frames = [];
  for (let k = 0; k < n; k++) {
    const phi = 10 * Math.sin(2 * Math.PI * k / n), psi = 35 * Math.cos(2 * Math.PI * k / n), gap = k === 3 ? 20 : 0;
    const hip = [0, -80 - gap], sh = [100 * Math.cos(phi * RAD), -80 - gap + 100 * Math.sin(phi * RAD)];
    const foot = [hip[0] - 80 * Math.sin(psi * RAD), hip[1] + 80 * Math.cos(psi * RAD)];
    frames.push({
      outer: { sub: [{ pts: [-20, foot[1], 120, foot[1], 120, -140, -20, -140], closed: true }] },
      skel: { joints: { hip, shoulder: sh, 'ankle-h1': foot }, chains: [['hip', 'shoulder'], ['hip', 'ankle-h1']] },
      phi, psi,
    });
  }
  return { n, fps: 12, h: 140, rig: 'quadruped', facing: 1, frames };
}
const MAP = { rig: 'quadruped', parts: { body: { chain: ['hip', 'shoulder'], zero: 'mean' }, leg: { chain: ['hip', 'ankle-h1'], zero: [0, 1] } }, ground: ['leg'] };

test('retarget: chain directions come back as joint angles within 2 degrees, relative to the parent', () => {
  const clip = synth(), { cycle, report } = retarget(clip, STICK, MAP);
  assert.equal(cycle.n, 12);
  assert.deepEqual(report.parts, ['body', 'leg']);
  for (const [k, f] of cycle.frames.entries()) {
    const { phi, psi } = clip.frames[k];
    assert.ok(Math.abs(f.body - phi) <= 1 + 1e-9, `frame ${k}: body ${f.body} for a spine at ${phi.toFixed(2)} (its mean is 0)`);
    // psi is measured from down, clockwise positive, as the puppet turns; the leg is relative to the body.
    assert.ok(Math.abs(f.leg - (psi - phi)) <= 2, `frame ${k}: leg ${f.leg} for ${(psi - phi).toFixed(2)}`);
    assert.equal(Math.abs(f.body % 2), 0);
    assert.equal(Math.abs(f.leg % 2), 0);
  }
  // The frame in the air rides higher than its neighbours, scaled by leg (40) over clip leg (80).
  const lift = (k) => cycle.frames[k].lift ?? 0;
  assert.ok(lift(3) - Math.max(lift(2), lift(4)) >= 8, `lift ${[2, 3, 4].map(lift)}`);
  assert.equal(report.scale, 0.5);
  // Mirrored: a clip facing the other way reads its directions mirrored, and the angles come out the same.
  const left = { ...clip, facing: -1, frames: clip.frames.map((f) => ({ ...f, skel: { ...f.skel, joints: Object.fromEntries(Object.entries(f.skel.joints).map(([j, [x, y]]) => [j, [-x, y]])) } })) };
  assert.deepEqual(retarget(left, STICK, MAP).cycle.frames, cycle.frames);
  assert.equal(retarget(left, STICK, MAP).report.flip, true);
  // The payload with the cycle still passes the rules an import runs.
  assert.deepEqual(lintPuppet({ ...STICK, cycles: { gallop: cycle } }), []);
});

test('retarget: a map that does not fit says why; a clip without a skeleton names the command', () => {
  const clip = synth();
  assert.deepEqual(checkMap({ parts: { tail: { chain: ['hip', 'tail-tip'] }, leg: { chain: ['hip'] }, body: { chain: ['hip', 'shoulder'], zero: 'up' } } }, clip, STICK), [
    "parts.tail: the puppet has no part 'tail' (has leg, body)",
    'parts.leg.chain: [from, to], two joint names',
    'parts.body.zero: "mean" or a direction [dx, dy]',
  ]);
  assert.match(checkMap({ rig: 'biped', parts: {} }, clip, STICK)[0], /made for a biped rig, the clip is quadruped/);
  assert.throws(() => retarget({ ...clip, frames: clip.frames.map(({ skel, ...f }) => f) }, STICK, MAP), /hdf clip --store <id> --rig quadruped/);
});

test('a lift: frameOf and cycle draw without it, liftOf reads it, the actor stage rises by it, lint checks it', () => {
  const d = { ...STICK, cycles: { hop: { fps: 12, n: 2, frames: [{ leg: 10 }, { leg: -10, lift: 12 }] } } };
  const p = puppet(d);
  assert.deepEqual(p.frameOf('hop', 1 / 12), { ...p.rest, leg: -10 });
  assert.equal(p.liftOf('hop', 1 / 12), 12);
  assert.equal(p.liftOf('hop', 0), 0);
  assert.equal(p.liftOf('none', 0), 0);
  assert.equal(p.cycle('hop', 1 / 12), p({ ...p.rest, leg: -10 }));
  const A = actorOf(p);
  assert.deepEqual(A.cycle('hop', 1 / 12), { leg: -10, lift: 12 / (0.04 * 190) }, 'stage lift: 4% of the actor a unit');
  const up = A.place(500, 500, 100, A.cycle('hop', 1 / 12)).xf[5], down = A.place(500, 500, 100, A.cycle('hop', 0)).xf[5];
  assert.ok(Math.abs(down - up - 12 * (2 * 100 / 190)) < 1e-9, 'the stage rises by the lift at its scale');
  const bad = lintPuppet({ ...d, cycles: { hop: { frames: [{ leg: 10, lift: 'high' }] } } });
  assert.deepEqual(bad.map((f) => f.rule), ['puppet-joint']);
  assert.match(bad[0].detail, /lifts by "high"/);
});

test('the fox gallops: its gallop is the horse retargeted through assets/src/horse-fox.json', () => {
  const st = readCatalogue(), fox = st.json('fox'), map = JSON.parse(readFileSync('assets/src/horse-fox.json', 'utf8'));
  const g = fox.cycles.gallop;
  assert.deepEqual(g.from, { clip: 'horse', sha: st.entry('horse').sha, map: 'horse-fox.json' });
  const { cycle } = retarget(st.json('horse'), { ...fox, cycles: undefined }, map);
  assert.deepEqual({ ...g, from: undefined }, { ...cycle, from: undefined }, 'regenerating it gives the same cycle');
  assert.equal(g.n, 12);
  // The legs swing through a stride: each goes both ways of its mean by 20 degrees or more.
  for (const part of ['leg-l', 'leg-r', 'arm-l', 'arm-r']) {
    const v = g.frames.map((f) => f[part]);
    assert.ok(Math.max(...v) - Math.min(...v) >= 40, `${part}: ${v}`);
  }
  assert.ok(g.frames.some((f) => f.lift >= 10), 'a moment in the air');
});
