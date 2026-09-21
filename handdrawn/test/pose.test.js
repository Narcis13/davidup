import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readCatalogue } from '../core/assets.js';
import { lintPuppet } from '../core/lint.js';
import { loopOf, poseClip } from '../core/pose.js';
import { retarget } from '../core/retarget.js';
import { RIGS } from '../core/rig.js';
import { landmarks, walker } from './walker.js';

const TAU = 2 * Math.PI;
const MAP = JSON.parse(readFileSync('assets/src/biped-fox.json', 'utf8'));
const fox = () => ({ ...readCatalogue().json('fox'), cycles: undefined });
// The joints a retarget through biped-fox.json should give for generating angles g, side 1 being `one`.
function expected(g, one) {
  const two = one === 'L' ? 'R' : 'L';
  return {
    body: g.phi, head: 0.5 * g.theta - g.phi, tail: 0.33 * g[`psi${one}`] - g.phi,
    'leg-l': g[`psi${one}`] - g.phi, 'leg-r': g[`psi${two}`] - g.phi, 'arm-l': g[`alpha${one}`] - g.phi, 'arm-r': g[`alpha${two}`] - g.phi,
  };
}
const within = (got, want, tol, what) => {
  for (const [j, v] of Object.entries(want)) assert.ok(Math.abs(got[j] - v) <= tol, `${what}: ${j} ${got[j]} for ${v.toFixed(2)}`);
};

test('pose: a synthetic biped walk skeleton round-trips through retarget into joint angles within 2 degrees', () => {
  const frames = Array.from({ length: 12 }, (_, k) => {
    const { g, P } = walker(k / 12);
    const joints = { head: P.head, shoulder: P.shoulder, hip: P.hip, 'elbow-1': P.elbowL, 'wrist-1': P.wristL, 'elbow-2': P.elbowR,
      'wrist-2': P.wristR, 'knee-1': P.kneeL, 'ankle-1': P.ankleL, 'knee-2': P.kneeR, 'ankle-2': P.ankleR };
    const low = Math.max(P.ankleL[1], P.ankleR[1]);
    return { outer: { sub: [{ pts: [-60, low, 60, low, 60, -200, -60, -200], closed: true }] }, lines: [], skel: { joints, chains: RIGS.biped.chains.map((c) => [...c]) }, g };
  });
  const clip = { n: 12, fps: 12, h: 200, rig: 'biped', facing: 1, frames };
  const { cycle, report } = retarget(clip, fox(), MAP);
  assert.equal(cycle.n, 12);
  assert.deepEqual(report.parts, ['body', 'head', 'tail', 'leg-l', 'leg-r', 'arm-l', 'arm-r']);
  cycle.frames.forEach((f, k) => {
    within(f, expected(frames[k].g, 'L'), 2, `frame ${k}`);
    for (const j of report.parts) assert.equal(Math.abs(f[j] % 2), 0, `frame ${k}: ${j} on the 2 degree grid`);
  });
  assert.deepEqual(lintPuppet({ ...fox(), cycles: { walk: cycle } }), [], 'the walk fits the fox');
});

test('pose: landmarks at 30 fps become a 12 fps biped clip cut to one stride, a lost frame and a swapped one mended', () => {
  const src = Array.from({ length: 75 }, (_, i) => landmarks(i / 30).lm);   // two and a half strides
  src[20] = null;
  for (const [l, r] of [[23, 24], [25, 26], [27, 28], [29, 30], [31, 32]]) [src[41][l], src[41][r]] = [src[41][r], src[41][l]];
  const clip = poseClip({ fps: 30, w: 800, h: 600, frames: src });
  assert.equal(clip.rig, 'biped');
  assert.equal(clip.facing, 1);
  assert.equal(clip.fps, 12);
  assert.ok(clip.pose.swaps >= 1, `swaps ${clip.pose.swaps}`);
  assert.deepEqual([clip.pose.loop.n, clip.pose.loop.cut], [12, true], JSON.stringify(clip.pose.loop));
  assert.equal(clip.n, 12);
  assert.ok(clip.h > 185 && clip.h < 215, `h ${clip.h}: head to the ground`);
  for (const f of clip.frames) {
    assert.deepEqual(Object.keys(f.skel.joints).sort(), [...RIGS.biped.joints].sort());
    assert.deepEqual(f.skel.joints.hip[0], 0, 'x from the hip');
    assert.ok(f.outer.sub[0].pts.length >= 8);
  }
  // Side 1 leads at the first frame: at t = 0 the left foot is back (psi > 0), so side 1 is the right.
  assert.equal(clip.pose.side1, 'R');
  const { cycle } = retarget(clip, fox(), MAP);
  cycle.frames.forEach((f, k) => within(f, expected(walker((clip.pose.loop.start + k) / 12).g, 'R'), 2, `frame ${k}`));
  // Too short to repeat (two thirds of a stride): kept whole.
  const part = poseClip({ fps: 30, w: 800, h: 600, frames: src.slice(0, 20) });
  assert.equal(part.pose.loop?.cut ?? false, false, JSON.stringify(part.pose.loop));
  assert.equal(part.n, 8);
  assert.equal(poseClip({ fps: 30, w: 800, h: 600, frames: src }, { loop: false }).n, 30);
  assert.throws(() => poseClip({ fps: 30, w: 800, h: 600, frames: [null, null] }), /no pose found in any of the 2 frames/);
});

test('pose: loopOf finds the period of a repeating run, the shortest of its multiples', () => {
  const J = Array.from({ length: 40 }, (_, k) => ({ hip: [0, 0], head: [10 * Math.sin(TAU * k / 10), -100], 'ankle-1': [20 * Math.cos(TAU * k / 10), 0] }));
  const l = loopOf(J, 100);
  assert.deepEqual([l.n, l.err], [10, 0]);
});
