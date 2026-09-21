// Motion from your phone (3.0 S15): a pose landmarker's 33 points a frame -> a biped clip whose frames carry
// only a skeleton (`skel`, core/rig.js's biped joints) and an `outer`, the landmarks' rounded hull, so
// `hdf retarget` can put the fox through the walk you filmed. cli/pose.py runs MediaPipe over a folder of
// frames and writes the landmarks; everything after that lives here, in JS, and needs nothing installed.
//
//   raw = { fps, w, h, frames: [ [[x, y, z, visibility] x 33] | null ] }   x, y as fractions of the image
//   poseClip(raw, { loop: true })   => { n, fps: 12, h, rig: 'biped', facing, frames: [{ outer, lines: [], skel }], pose }
//
// On the way:
//   - a frame with no pose takes its landmarks from the frames either side (ends hold);
//   - MediaPipe sometimes swaps left and right in a side view for a frame: a limb pair whose swap lands much
//     nearer where the limbs were heading is swapped back (legs and arms apart);
//   - the frames are resampled to 12 fps on the grid (linear between source frames);
//   - joints: head is the ears' middle, shoulder and hip the middles of the pairs, elbows, wrists, knees and
//     ankles by side. Unlike a traced clip, which numbers a pair by position each frame, a pose clip knows
//     left from right, so a limb keeps its number: side 1 is the side whose foot leads in the first frame,
//     for legs and arms alike (so a map pairs leg-l with ankle-1 and arm-l with wrist-1, one side of the body);
//   - facing: +1 when the nose is ahead of the ears to the right, most frames;
//   - coordinates are source pixels, x from each frame's hip (the walk stays in place, like a cycle), y from
//     the ground (the median of each frame's lowest foot point), up negative; h the median figure height;
//   - loop: a clip long enough is cut to its best loop, the period p (6 to 30 frames) and start s whose frame
//     s + p is nearest frame s, so the cycle has no seam. It is cut only when that seam is small (within 3% of
//     the figure's height): a clip of one stride has no repeat to find and is kept whole. pose.loop =
//     { start, n, err, cut } says what was found (err in figure heights); pose also records the source
//     frames, their fps, the swaps undone and which side is 1.
import { FPS } from './curves.js';
import { RIGS } from './rig.js';

// The MediaPipe pose landmarks this reads, by index.
export const LM = Object.freeze({
  nose: 0, earL: 7, earR: 8, shoulderL: 11, shoulderR: 12, elbowL: 13, elbowR: 14, wristL: 15, wristR: 16,
  hipL: 23, hipR: 24, kneeL: 25, kneeR: 26, ankleL: 27, ankleR: 28, heelL: 29, heelR: 30, toeL: 31, toeR: 32,
});
// Left / right index pairs swapped together: the leg (hip down) and the arm (shoulder down, hand points too).
const LEG = [[23, 24], [25, 26], [27, 28], [29, 30], [31, 32]];
const ARM = [[11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22]];
const FEET = [27, 28, 29, 30, 31, 32];

const r1 = (v) => Math.round(v * 10) / 10;
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const median = (v) => { const a = [...v].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

// Every frame's landmarks as [x, y] source pixels, a frame with none filled from its neighbours.
function filled(raw) {
  const W = raw.w || 1, H = raw.h || 1;
  const px = raw.frames.map((f) => (Array.isArray(f) && f.length >= 33 ? f.map((p) => [p[0] * W, p[1] * H]) : null));
  const have = px.map((f, k) => (f ? k : -1)).filter((k) => k >= 0);
  if (!have.length) throw new Error(`pose: no pose found in any of the ${raw.frames.length} frames (is a whole person in the picture?)`);
  return px.map((f, k) => {
    if (f) return f.map((q) => [...q]);
    const a = [...have].reverse().find((j) => j < k), b = have.find((j) => j > k);
    if (a === undefined || b === undefined) return px[a ?? b].map((q) => [...q]);
    return px[a].map((p, i) => lerp(p, px[b][i], (k - a) / (b - a)));
  });
}

// A limb pair whose left/right swap lands much nearer where it was heading is swapped back, frame by frame.
// "Where it was heading" is the frame before carried on at its speed (the two before it), so legs passing
// each other mid-stride are not taken for a swap. Returns the number of swaps made.
function unswap(frames) {
  let swaps = 0;
  for (let k = 1; k < frames.length; k++) {
    const f = frames[k], a = frames[k - 1], b = frames[k - 2] ?? a;
    const guess = (i) => [2 * a[i][0] - b[i][0], 2 * a[i][1] - b[i][1]];
    for (const pairs of [LEG, ARM]) {
      const probe = pairs.slice(1, 3);   // knee and ankle, elbow and wrist
      const straight = probe.reduce((s, [l, r]) => s + dist(f[l], guess(l)) + dist(f[r], guess(r)), 0);
      const crossed = probe.reduce((s, [l, r]) => s + dist(f[r], guess(l)) + dist(f[l], guess(r)), 0);
      if (crossed < 0.5 * straight) {
        for (const [l, r] of pairs) [f[l], f[r]] = [f[r], f[l]];
        swaps++;
      }
    }
  }
  return swaps;
}

// Source frames at fpsIn resampled onto the 1/12 s grid.
function resample(frames, fpsIn) {
  if (!(fpsIn > 0) || fpsIn === FPS) return frames;
  const n = Math.max(1, Math.floor(frames.length * FPS / fpsIn));
  return Array.from({ length: n }, (_, k) => {
    const u = Math.min(frames.length - 1, k * fpsIn / FPS), a = Math.floor(u), b = Math.min(frames.length - 1, a + 1), t = u - a;
    return t ? frames[a].map((p, i) => lerp(p, frames[b][i], t)) : frames[a];
  });
}

// The convex hull of points (monotone chain), counter-clockwise.
function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

// The rounded hull of a frame's landmarks: every point as a small octagon of radius r, hulled.
function outerOf(pts, r) {
  const ring = pts.flatMap(([x, y]) => Array.from({ length: 8 }, (_, i) => [x + r * Math.cos(i * Math.PI / 4), y + r * Math.sin(i * Math.PI / 4)]));
  return { sub: [{ pts: hull(ring).flat().map(r1), closed: true }] };
}

// The biped joints of one frame's landmarks (already in clip coordinates), side 1 = `one` ('L' or 'R').
function jointsOf(f, one) {
  const two = one === 'L' ? 'R' : 'L', at = (name) => f[LM[name]];
  const J = {
    head: mid(at('earL'), at('earR')), shoulder: mid(at('shoulderL'), at('shoulderR')), hip: mid(at('hipL'), at('hipR')),
    'elbow-1': at(`elbow${one}`), 'wrist-1': at(`wrist${one}`), 'elbow-2': at(`elbow${two}`), 'wrist-2': at(`wrist${two}`),
    'knee-1': at(`knee${one}`), 'ankle-1': at(`ankle${one}`), 'knee-2': at(`knee${two}`), 'ankle-2': at(`ankle${two}`),
  };
  return Object.fromEntries(RIGS.biped.joints.map((j) => [j, J[j].map(r1)]));
}

// How far apart two frames' poses are: the mean distance of their joints, each taken from its own hip.
function poseDist(a, b) {
  const names = Object.keys(a).filter((j) => j !== 'hip');
  return names.reduce((s, j) => s + dist([a[j][0] - a.hip[0], a[j][1] - a.hip[1]], [b[j][0] - b.hip[0], b[j][1] - b.hip[1]]), 0) / names.length;
}

// The best loop in a run of joint frames: { start, n, err } (err in units of h), or null when it is too short.
export function loopOf(joints, h, { min = 6, max = 30 } = {}) {
  const N = joints.length, found = [];
  for (let p = min; p <= Math.min(max, N - 1); p++) {
    let best = null;
    for (let s = 0; s + p < N; s++) {
      const e = poseDist(joints[s], joints[s + p]) / h;
      if (!best || e < best.err) best = { start: s, n: p, err: e };
    }
    if (best) found.push(best);
  }
  if (!found.length) return null;
  // Two strides match as well as one: the shortest period that is nearly as good as the best.
  const low = Math.min(...found.map((f) => f.err));
  const pick = found.find((f) => f.err <= low * 1.25 + 0.005);
  return { ...pick, err: Math.round(pick.err * 1000) / 1000 };
}

// A pose landmarker's output as a biped clip (see the top of this file).
export function poseClip(raw, { loop = true, seam = 0.03, credit = '', source = '' } = {}) {
  if (!raw || !Array.isArray(raw.frames) || !raw.frames.length) throw new Error('pose: expected { fps, w, h, frames: [landmarks | null] }');
  const src = filled(raw), swaps = unswap(src);
  let frames = resample(src, raw.fps ?? FPS);

  const facing = Math.sign(frames.reduce((s, f) => s + Math.sign(f[LM.nose][0] - mid(f[LM.earL], f[LM.earR])[0]), 0)) || 1;
  const ground = median(frames.map((f) => Math.max(...FEET.map((i) => f[i][1]))));
  const h = Math.round(median(frames.map((f) => ground - Math.min(...f.map((p) => p[1])))));
  // Clip coordinates: x from the frame's hip, y from the ground.
  frames = frames.map((f) => { const hx = mid(f[LM.hipL], f[LM.hipR])[0]; return f.map(([x, y]) => [x - hx, y - ground]); });
  const one = (frames[0][LM.ankleL][0] - frames[0][LM.ankleR][0]) * facing >= 0 ? 'L' : 'R';

  let joints = frames.map((f) => jointsOf(f, one)), cut = null;
  if (loop && frames.length >= 12) {
    cut = loopOf(joints, h);
    if (cut) cut.cut = cut.err <= seam;
    if (cut?.cut) { frames = frames.slice(cut.start, cut.start + cut.n); joints = joints.slice(cut.start, cut.start + cut.n); }
  }
  const chains = RIGS.biped.chains.map((c) => [...c]), r = Math.max(2, h * 0.03);
  return {
    n: frames.length, fps: FPS, h, credit, source, rig: 'biped', facing,
    frames: frames.map((f, k) => ({ outer: outerOf(f, r), lines: [], skel: { joints: joints[k], chains } })),
    pose: { from: raw.frames.length, fps: raw.fps ?? FPS, swaps, side1: one, ...(cut ? { loop: cut } : {}) },
  };
}
