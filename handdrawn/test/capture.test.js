// 4.0 K7: capture -- a pose clip's stride, a face track, a hands track, and the stick's fingers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { FACE_KEYS, actorOf, cel, circle, compileStick, curlsOf, faceClip, feetOf, handsClip, nearestHand, poseClip, puppet, retarget,
  stickMap, stickSource, strideOf, walkTo } from '../core/index.js';
import { fromStore, validatePayload } from '../core/assets.js';
import { lint, formatFinding, lintPuppet } from '../core/lint.js';
import { fill, meta, paper, stroke } from '../core/list.js';
import { ramp } from '../core/curves.js';
import { signOff } from '../core/text.js';
import { film, seq, shot } from '../core/tree.js';
import { registerClip } from '../engines/traced.js';
import { STRIDE, landmarks } from './walker.js';
import { faceJSON, handLandmarks, handsJSON } from './capture.js';

const walkerClip = (o = {}) => poseClip({ fps: 30, w: 800, h: 600, frames: Array.from({ length: 75 }, (_, i) => landmarks(i / 30).lm) }, o);
const hdf = (...argv) => { const r = spawnSync(process.execPath, ['cli/hdf.mjs', ...argv], { encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };

test('stride: a pose clip keeps how far it travels a frame, from the planted foot, a still camera or a panning one', () => {
  const clip = walkerClip();
  assert.equal(clip.advance.length, clip.n);
  assert.ok(Math.abs(clip.pose.stride - STRIDE / clip.h) < 0.01, `stride ${clip.pose.stride} for ${(STRIDE / clip.h).toFixed(3)}`);
  assert.ok(Math.abs(clip.pose.travel - clip.pose.stride) < 0.01, 'a still camera: the hips cross the picture as far');
  assert.ok(clip.advance.every((a) => a >= 0), 'never backwards');
  // The camera follows the walker (its hips stay put in the picture): the stride is the same, the travel none.
  const panned = poseClip({ fps: 30, w: 800, h: 600, frames: Array.from({ length: 75 }, (_, i) => landmarks(i / 30).lm.map(([x, y, z, v]) => [x - STRIDE * (i / 30) / 800, y, z, v])) });
  assert.ok(Math.abs(panned.pose.stride - clip.pose.stride) < 0.005, `panned ${panned.pose.stride}`);
  assert.ok(Math.abs(panned.pose.travel) < 0.01);
});

test('stride: retarget carries it onto sam by leg length; the walk plants its feet and matches the clip\'s', () => {
  const clip = walkerClip();
  for (const build of ['adult', 'kid', 'round']) {
    const d = compileStick(stickSource({ name: 'sam', build }));
    const { cycle, report } = retarget(clip, d, stickMap(d));
    assert.equal(cycle.advance.length, cycle.n);
    assert.deepEqual(lintPuppet({ ...d, cycles: { walk: cycle } }, 'sam'), []);
    // The clip's stride on sam: its figure heights through the legs' ratio (hip to ankle, 100 px on the walker).
    const legs = Math.hypot(...[0, 1].map((i) => d.stick.joints['ankle-l'][i] - d.stick.joints['hip-l'][i]));
    const want = STRIDE / 100 * legs / d.box[3];
    assert.ok(Math.abs(report.stride - want) / want < 0.02, `${build}: ${report.stride} for ${want.toFixed(3)}`);
    const SAM = actorOf(puppet({ ...d, cycles: { walk: cycle } })), g = strideOf(SAM, 'walk');
    assert.ok(Math.abs(g.captured / d.box[3] - report.stride) < 1e-3);
    assert.ok(Math.abs(g.stride / g.captured - 1) < 0.05, `${build}: the feet make ${g.stride}, the clip ${g.captured}`);
    // Walked across at its own pace: no planted foot slides.
    const w = walkTo(SAM, 100, 800, 0, null, { s: 260 });
    const f = film({ name: 'scratch', look: 'paperInk', timeline: seq(shot('walk', 4, ({ t }) => [paper(), meta('anchor', { cel: 'sam' }), meta('intent', 'crop'),
      fill(circle(-50, -50, 5), 'ink'), stroke(circle(-50, -50, 5), 'ink'), SAM.place(w.x(t), 700, 260, w.state(t))]),
    shot('end', 2, ({ t, CX, CY }) => [paper(), meta('anchor', { name: 'signOff' }), signOff('a', 'b', { x: CX, y: CY, size: 80, pA: ramp(0, 0.2, t), pB: ramp(0.2, 0.4, t) })])) });
    assert.deepEqual(lint(f).map((x) => formatFinding(x)), []);
  }
});

test('stride: a captured advance fills the frames off the ground and a puppet with no two feet', () => {
  const d = compileStick(stickSource({ name: 'sam' }));
  const { cycle } = retarget(walkerClip(), d, stickMap(d));
  const U = d.box[3];
  // Frames 3 and 4 in the air: a lift of 20 units (a run's flight). From 2 to 5 the clip's advance counts.
  const air = { ...cycle, frames: cycle.frames.map((f, k) => (k === 3 || k === 4 ? { ...f, lift: 20 } : f)) };
  const g = strideOf(actorOf(puppet({ ...d, cycles: { walk: air } })), 'walk');
  for (const j of [2, 3, 4]) assert.ok(Math.abs(g.advance[j] - cycle.advance[j] * U) < 1e-9, `frame ${j}`);
  const ground = strideOf(actorOf(puppet({ ...d, cycles: { walk: cycle } })), 'walk');
  for (const j of [0, 6, 9]) assert.equal(g.advance[j], ground.advance[j]);
  // No legs at all: the captured stride is all there is; without it, an error.
  const legless = { units: 100, box: [-50, -100, 100, 100], parts: { body: { pivot: [0, -50], ops: [] } }, cycles: { walk: { fps: 12, n: 2, frames: [{ body: 2 }, { body: 0 }], advance: [0.1, 0.1] } } };
  assert.equal(strideOf(actorOf(puppet(legless)), 'walk').stride, 20);
  const { advance: _a, ...plain } = legless.cycles.walk;
  assert.throws(() => strideOf(actorOf(puppet({ ...legless, cycles: { walk: plain } })), 'walk'), /no two feet/);
  // Lint: an advance must be a number a frame.
  assert.match(lintPuppet({ ...legless, cycles: { walk: { ...legless.cycles.walk, advance: [1] } } }, 'x').map((f) => f.detail).join(), /advance that is not a number a frame/);
  assert.ok(feetOf(actorOf(puppet(d))));
});

test('face: blendshapes become a 12 fps track less the take\'s resting level, a blink kept, a lost frame mended', () => {
  const tr = faceClip(faceJSON());
  assert.equal(tr.track, 'face');
  assert.deepEqual(tr.keys, [...FACE_KEYS]);
  assert.equal(tr.n, 60);
  assert.equal(tr.face.found, 149);
  assert.equal(tr.face.baseline['down-l'], 0.08);
  const at = (t, c) => tr.frames[Math.floor(t * 12)][FACE_KEYS.indexOf(c)];
  assert.equal(at(3.6, 'down-l'), 0, 'at rest the brows read 0');
  assert.ok(Math.max(...tr.frames.slice(0, 24).map((f) => f[0])) >= 0.5, 'the jaw opens');
  assert.ok(at(1.0, 'blink-l') >= 0.8 && at(1.0, 'blink-r') >= 0.8, 'a tenth of a second blink survives');
  assert.ok(at(4.6, 'blink-r') >= 0.8 && at(4.6, 'blink-l') === 0, 'their left eye is the picture\'s right');
  assert.ok(at(4.1, 'look-x') > 0.5, 'eyes to their left: the picture\'s right');
  assert.deepEqual(validatePayload('clip', tr), []);
  assert.match(validatePayload('clip', { ...tr, frames: tr.frames.slice(1) }).join(), /frames: n/);
  assert.throws(() => registerClip('me-face', tr), /a face track, numbers not drawings/);
  assert.throws(() => faceClip({ fps: 30, frames: [null, null] }), /nothing found in any of the 2 frames/);
});

test('face: the track drives sam\'s mouth, eyes, brows and pupils; the fox takes what it has; outside it nothing', () => {
  const tr = faceClip(faceJSON()), SAM = actorOf(puppet(stickSource({ name: 'sam' })));
  const mouths = Array.from({ length: 24 }, (_, k) => SAM.face(tr, k / 12).mouth);
  assert.ok(mouths.includes(0) && mouths.some((m) => m >= 2), `talking: ${mouths}`);
  assert.equal(SAM.face(tr, 1.0).eye, 'sleep', 'a blink shuts both eyes');
  assert.equal(SAM.face(tr, 4.6).eye, 'wink');
  assert.equal(SAM.face(tr, 0.5).eye, 'open');
  const up = SAM.face(tr, 2.6), down = SAM.face(tr, 3.1);
  assert.ok(up['brow-l.y'] < 0 && up['brow-r.y'] < 0 && up['brow-l'] < 0 && up['brow-r'] > 0, `brows up and worried: ${JSON.stringify(up)}`);
  assert.ok(down['brow-l'] > 0 && down['brow-r'] < 0, `a frown: ${JSON.stringify(down)}`);
  for (const q of [up, down]) for (const k of ['brow-l', 'brow-r']) assert.equal(Math.abs(q[k] % 2), 0, 'on the 2 degree grid');
  assert.equal(SAM.face(tr, 3.6).mouth, SAM.emote('happy').mouth, 'a smile is the happy mouth');
  assert.ok(SAM.face(tr, 4.1)['pupil.x'] > 0);
  assert.ok(SAM.face(tr, 4.1, 0, { mirror: true })['pupil.x'] < 0, 'a mirrored picture looks the other way');
  assert.equal(SAM.face(tr, 4.6, 0, { mirror: true }).eye, 'wink');
  assert.deepEqual(SAM.face(tr, 5.5), {});
  assert.deepEqual(SAM.face(tr, 0.5, 1), {}, 'before its start');
  assert.deepEqual(SAM.face(tr, 1.5, 0.5), SAM.face(tr, 1.0), 'started at t0');
  // The fox has brows, a pupil, eyes and a mouth: each driven on its own grid; a code cel nothing.
  fromStore(['fox']);
  const FOX = actorOf(puppet('fox')), fox = FOX.face(tr, 2.6);
  assert.ok(fox['brow-l.y'] < 0, JSON.stringify(fox));
  for (const [k, v] of Object.entries(fox)) if (Array.isArray(FOX.inputs[k]) && typeof v === 'number' && typeof FOX.inputs[k][0] === 'number') assert.ok(v >= FOX.inputs[k][0] && v <= FOX.inputs[k][1], `${k} ${v}`);
  const dot = actorOf(cel('dot', () => [fill(circle(0, 0, 5), 'ink')], { box: [-5, -5, 10, 10] }));
  assert.deepEqual(dot.face(tr, 1), {});
  assert.throws(() => SAM.face({ track: 'hands', n: 1, frames: [] }, 0), /not a face track/);
});

test('hands: finger curls make a track; a stick with fingers takes the nearest shape, others nothing', () => {
  for (const s of ['open', 'fist', 'point', 'thumb']) assert.equal(nearestHand(curlsOf(handLandmarks(s, 0.5, 0.5))), s);
  assert.equal(nearestHand([1, 0, 0, 0, 0], ['open', 'fist']), 'fist', 'the nearest the puppet has');
  const tr = handsClip(handsJSON());
  assert.equal(tr.n, 24);
  assert.deepEqual(validatePayload('clip', tr), []);
  assert.ok(tr.frames.every((f) => f.l && f.r), 'a hand lost for a few frames is held');
  const SAM = actorOf(puppet(stickSource({ name: 'sam', hands: 'fingers' })));
  assert.deepEqual(SAM.hands(tr, 0.2), { 'hand-l': 'point', 'hand-r': 'open' });
  assert.deepEqual(SAM.hands(tr, 1.5), { 'hand-l': 'thumb', 'hand-r': 'fist' });
  assert.deepEqual(SAM.hands(tr, 1.5, 0, { mirror: true }), { 'hand-l': 'fist', 'hand-r': 'thumb' });
  assert.deepEqual(actorOf(puppet(stickSource({ name: 'sam' }))).hands(tr, 0.2), {}, 'dots have no shapes');
});

test('fingers: a stick draws four hand shapes in every build and style; a stick without them is as it was', () => {
  for (const style of ['line', 'tube']) for (const build of ['adult', 'kid', 'tall', 'round']) {
    const d = compileStick(stickSource({ name: 's', hands: 'fingers', style, build }));
    assert.deepEqual(lintPuppet(d, 's'), [], `${style} ${build}`);
    assert.deepEqual(Object.keys(d.parts['hand-r'].variants), ['open', 'fist', 'point', 'thumb']);
    assert.equal(d.poses.rest['hand-l'], 'open');
  }
  const plain = compileStick(stickSource({ name: 'sam' }));
  assert.deepEqual(plain.inputs, { eye: ['open', 'happy', 'sleep', 'wide', 'half', 'wink'], mouth: [0, 5, 1] });
  assert.deepEqual(plain.poses, { rest: { eye: 'open', mouth: 0 } });
  assert.ok(plain.parts['hand-r'].ops && !plain.parts['hand-r'].variants);
});

test('hdf clip --kind face | hands: explains itself without MediaPipe, makes tracks from landmarks; pose and retarget report the stride', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-capture-'));
  try {
    const root = join(dir, 'store');
    for (const kind of ['face', 'hands']) {
      const r = spawnSync(process.execPath, ['cli/hdf.mjs', 'clip', '--kind', kind, dir, '--name', 'me', '--root', root],
        { encoding: 'utf8', env: { ...process.env, HDF_PYTHON: join(dir, 'no-python') } });
      assert.equal(r.status, 1);
      assert.match(r.stderr, new RegExp(`clip --kind ${kind}: needs MediaPipe[\\s\\S]*hdf clip --kind ${kind} out/${kind}-<name>\\.json --name <id>`));
    }
    writeFileSync(join(dir, 'face.json'), JSON.stringify(faceJSON()));
    const face = hdf('clip', '--kind', 'face', join(dir, 'face.json'), '--name', 'me-face', '--root', root);
    assert.equal(face.code, 0, face.out);
    assert.match(face.out, /^me-face {2}150 frames at 30 fps \(a face in 149\) -> a face track of 60 at 12 fps; frames at 0\.3 or more: jaw \d+, .*blink-l \d+/m);
    writeFileSync(join(dir, 'hands.json'), JSON.stringify(handsJSON()));
    const hands = hdf('clip', '--kind', 'hands', join(dir, 'hands.json'), '--name', 'me-hands', '--root', root);
    assert.equal(hands.code, 0, hands.out);
    assert.match(hands.out, /^me-hands {2}60 frames at 30 fps -> a hands track of 24 at 12 fps; l: point 12 thumb 12; r: open 12 fist 12$/m);
    const cat = JSON.parse(readFileSync(join(root, 'catalogue.json'), 'utf8'));
    assert.equal(cat['me-face'].track, 'face');
    assert.equal(cat['me-hands'].track, 'hands');
    assert.match(hdf('find', 'me', '--root', root).out, /a face track, 60 frames @ 12 fps/);

    // The walker's landmarks: the stride on the way in, and on sam by leg length on the way out.
    writeFileSync(join(dir, 'pose.json'), JSON.stringify({ fps: 30, w: 800, h: 600, frames: Array.from({ length: 75 }, (_, i) => landmarks(i / 30).lm) }));
    const pose = hdf('clip', '--kind', 'pose', join(dir, 'pose.json'), '--name', 'me', '--root', root, '--out', dir);
    assert.equal(pose.code, 0, pose.out);
    assert.match(pose.out, /^ {2}stride 0\.8\d+ h from the planted foot \(the hips cross the picture 0\.8\d+ h\)$/m);
    assert.equal(hdf('stick', '--name', 'sam', '--root', root, '--no-sheet').code, 0);
    const walk = hdf('retarget', '--clip', 'me', '--to', 'sam', '--name', 'walk', '--root', root);
    assert.equal(walk.code, 0, walk.out);
    assert.match(walk.out, /^stride 0\.\d+ box heights a cycle, from the clip; its feet make 0\.\d+ \(-?\d+(\.\d)?%, the 2 degree grid\)$/m);
    const cat2 = JSON.parse(readFileSync(join(root, 'catalogue.json'), 'utf8'));
    const sam = JSON.parse(readFileSync(join(root, 'blobs', `${cat2.sam.sha}.json`), 'utf8'));
    assert.equal(sam.cycles.walk.advance.length, 12);
    assert.ok(existsSync(join(root, 'src', 'sam.stick.json')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
