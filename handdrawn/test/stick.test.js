// 4.0 K2: stick puppets -- a stickman that is its own rig.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { actorOf } from '../core/actor.js';
import { validatePayload } from '../core/assets.js';
import { lintPuppet } from '../core/lint.js';
import { hashList } from '../core/list.js';
import { cutoutOf, puppet } from '../core/puppet.js';
import { retarget } from '../core/retarget.js';
import { RIGS } from '../core/rig.js';
import { BUILDS, checkStick, compileStick, stickMap, stickSource } from '../core/stick.js';
import { walker } from './walker.js';

const BIPED = ['head', 'neck', 'body', 'hips', 'arm-l', 'arm-r', 'fore-l', 'fore-r', 'hand-l', 'hand-r', 'leg-l', 'leg-r',
  'shin-l', 'shin-r', 'foot-l', 'foot-r', 'eye', 'pupil', 'brow-l', 'brow-r', 'mouth'];

test('stick: every build and style compiles to a valid puppet in the standard biped names, lint clean', () => {
  for (const build of Object.keys(BUILDS)) for (const style of ['line', 'tube']) for (const hands of ['dots', 'mitts']) {
    const d = compileStick(stickSource({ name: 'sam', build, style, hands }));
    assert.deepEqual(validatePayload('puppet', d), [], `${build} ${style}`);
    assert.deepEqual(lintPuppet(d, 'sam'), [], `${build} ${style} ${hands}`);
    assert.deepEqual([...Object.keys(d.parts)].sort(), [...BIPED].sort());
    assert.deepEqual(d.views, ['side', 'three-quarter', 'front']);
  }
});

test('stick: a bone is a part pivoting at its proximal joint, parented by the bone graph from the hips', () => {
  const src = stickSource({ name: 'sam' }), d = compileStick(src), J = src.joints;
  assert.equal(d.parts.hips.parent, undefined);
  assert.equal(d.parts.body.parent, 'hips');
  assert.equal(d.parts['arm-l'].parent, 'body', 'a shoulder hangs off the chest');
  assert.equal(d.parts['leg-r'].parent, 'hips');
  assert.equal(d.parts['fore-r'].parent, 'arm-r');
  assert.equal(d.parts['hand-r'].parent, 'fore-r');
  assert.equal(d.parts.head.parent, 'neck');
  assert.deepEqual(d.parts['fore-l'].pivot.side, J['elbow-l']);
  assert.deepEqual(d.parts['shin-r'].pivot.side, J['knee-r']);
  // Front: -l on the drawing's left, -r on its right, the middle on the hip.
  assert.ok(d.parts['arm-l'].pivot.front[0] < 0 && d.parts['arm-r'].pivot.front[0] > 0);
  assert.equal(d.parts.body.pivot.front[0], J.hip[0]);
  // Painter order: far limbs, then the trunk and face, then near limbs.
  const keys = Object.keys(d.parts), at = (n) => keys.indexOf(n);
  assert.ok(at('leg-l') < at('body') && at('body') < at('head') && at('mouth') < at('leg-r') && at('arm-l') < at('hips'));
  assert.equal(compileStick(src), d, 'memoised per source');
});

test('stick: puppet(source) is puppet(compiled); the face moves; a slid pupil is a print in the cut-out look', () => {
  const src = stickSource({ name: 'sam-a' }), p = puppet(src);
  assert.equal(hashList([p({})]), hashList([puppet({ ...compileStick(src) })({})]));
  assert.ok(p.moves['pupil.x'] && p.moves['brow-l.y']);
  assert.notEqual(hashList([p({ 'pupil.x': 2 })]), hashList([p({})]));
  assert.notEqual(hashList([p({ mouth: 5 })]), hashList([p({ mouth: 0 })]));
  assert.notEqual(hashList([p({ dir: 0 })]), hashList([p({ dir: 1 })]), 'the front is its own drawing');
  const c = cutoutOf(p({}));
  assert.equal(c.kinds.pupil, 'print');
  assert.equal(c.kinds['arm-l'], 'joint');
  // The actor contract directs it like any biped: emotes, looks, an arm aimed at a point.
  const A = actorOf(p);
  assert.deepEqual(A.emote('happy').eye, 'happy');
  assert.equal(A.emote('happy').mouth, 5, "'top' is the smile");
  assert.equal(A.look(0).dir, 0);
  assert.ok(A.place(540, 540, 100, { hand: [700, 300] }));
});

test('stick: a stick with no face, no hands, and the checks say what is wrong', () => {
  const d = compileStick(stickSource({ name: 'bare', face: false, hands: 'none' }));
  assert.ok(!d.parts.eye && !d.parts['hand-l'] && !d.inputs);
  assert.deepEqual(lintPuppet(d, 'bare'), []);
  const src = stickSource({});
  assert.match(checkStick({ ...src, bones: [...src.bones, ['knee-l', 'chest', 3]] }).join(), /'chest' already ends bone/);
  assert.match(checkStick({ ...src, bones: [['wrist-l', 'toe-l', 3]] }).join(), /'wrist-l' does not hang from the hip/);
  assert.match(checkStick({ ...src, joints: { ...src.joints, head: undefined } }).join(), /joints.head/);
  assert.throws(() => stickSource({ build: 'giant' }), /build 'giant'/);
});

test('stick: retargeting needs no map -- the stick joints are the biped rig, and the rest pose is the clip pose', () => {
  const src = stickSource({ name: 'sam' }), d = compileStick(src), map = stickMap(d);
  assert.equal(map.rig, 'biped');
  for (const m of Object.values(map.parts)) for (const j of m.chain) assert.ok(RIGS.biped.joints.includes(j), j);
  assert.deepEqual(map.parts['leg-l'].chain, ['hip', 'knee-1']);
  assert.deepEqual(map.parts['fore-r'].chain, ['elbow-2', 'wrist-2']);
  // A clip standing exactly as the stick stands retargets to all zeros.
  const J = src.joints, still = {
    head: J.head, shoulder: J.chest, hip: J.hip, 'elbow-1': J['elbow-l'], 'wrist-1': J['wrist-l'], 'elbow-2': J['elbow-r'], 'wrist-2': J['wrist-r'],
    'knee-1': J['knee-l'], 'ankle-1': J['ankle-l'], 'knee-2': J['knee-r'], 'ankle-2': J['ankle-r'],
  };
  const frame = (joints) => ({ outer: { sub: [{ pts: [-60, 0, 60, 0, 60, -300, -60, -300], closed: true }] }, lines: [], skel: { joints, chains: RIGS.biped.chains.map((c) => [...c]) } });
  const { cycle } = retarget({ n: 1, fps: 12, h: 300, rig: 'biped', facing: 1, frames: [frame(still)] }, d, map);
  for (const [k, v] of Object.entries(cycle.frames[0])) if (k !== 'lift') assert.equal(v, 0, k);
  // The synthetic walk: legs swing opposite, and the result passes lint in the payload.
  const walk = Array.from({ length: 12 }, (_, k) => {
    const { P } = walker(k / 12);
    return frame({ head: P.head, shoulder: P.shoulder, hip: P.hip, 'elbow-1': P.elbowL, 'wrist-1': P.wristL, 'elbow-2': P.elbowR, 'wrist-2': P.wristR,
      'knee-1': P.kneeL, 'ankle-1': P.ankleL, 'knee-2': P.kneeR, 'ankle-2': P.ankleR });
  });
  const got = retarget({ n: 12, fps: 12, h: 200, rig: 'biped', facing: 1, frames: walk }, d, map).cycle;
  assert.ok(got.frames.some((f) => f['leg-l'] > 10 && f['leg-r'] < -10));
  assert.deepEqual(lintPuppet({ ...d, cycles: { walk: got } }, 'sam'), []);
});

test('hdf stick writes the source, imports it compiled, and hdf retarget walks it from a phone clip with no map', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-stick-'));
  const hdf = (...a) => { const r = spawnSync(process.execPath, ['cli/hdf.mjs', ...a], { encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };
  try {
    const root = join(dir, 'store');
    const { poseJSON } = await import('./walker.js');
    writeFileSync(join(dir, 'pose-me.json'), JSON.stringify(poseJSON()));
    assert.equal(hdf('clip', '--kind', 'pose', join(dir, 'pose-me.json'), '--name', 'me', '--root', root, '--out', dir).code, 0);
    const made = hdf('stick', '--name', 'sam', '--build', 'kid', '--style', 'tube', '--root', root, '--no-sheet');
    assert.equal(made.code, 0, made.out);
    assert.match(made.out, /^sam {2}puppet {2}[0-9a-f]{40}\.json {2}own {2}\(new\)$/m);
    assert.ok(existsSync(join(root, 'src', 'sam.stick.json')));
    assert.equal(hdf('stick', '--name', 'x', '--build', 'giant', '--root', root).code, 2);
    const walk = hdf('retarget', '--clip', 'me', '--to', 'sam', '--name', 'walk', '--root', root);
    assert.equal(walk.code, 0, walk.out);
    assert.match(walk.out, /^me -> sam\.walk: 12 frames at 12 fps, .*leg-l.*, map from the stick$/m);
    const cat = JSON.parse(readFileSync(join(root, 'catalogue.json'), 'utf8'));
    const sam = JSON.parse(readFileSync(join(root, 'blobs', `${cat.sam.sha}.json`), 'utf8'));
    assert.equal(sam.kind, 'puppet');
    assert.equal(sam.stick.build, 'kid');
    assert.equal(sam.cycles.walk.from.map, 'stick');
    // Regenerating the stick keeps the retargeted walk; a plain puppet still needs a map.
    const again = hdf('stick', '--name', 'sam', '--build', 'kid', '--style', 'tube', '--root', root, '--no-sheet');
    assert.match(again.out, /keeps cycle walk \(retargeted from me\)/);
    const sheet = hdf('sheet', 'store', 'sam', '--cycle', 'walk', '--root', root);
    assert.equal(sheet.code, 0, sheet.out);
    assert.match(sheet.out, /\+ 12 frames of walk/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
