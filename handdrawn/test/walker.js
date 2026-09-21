// A synthetic biped walk for the pose tests (3.0 S15): a skeleton generated from known angles, and the 33
// MediaPipe landmarks that skeleton would give, so the phone path can be tested without MediaPipe.
import { LM } from '../core/pose.js';

const RAD = Math.PI / 180, TAU = 2 * Math.PI;
const add = (p, L, a) => [p[0] - L * Math.sin(a * RAD), p[1] + L * Math.cos(a * RAD)];   // a limb hanging at a degrees from down

// A biped walk generated from known angles at time t (a stride a second): the spine leans phi from upright,
// the head theta, each leg psi from straight down (positive swings the foot back, as the puppet turns), each
// arm alpha, against its own leg.
export function walker(t) {
  const w = TAU * t;
  const g = { phi: 3 * Math.sin(w + 1), theta: 8 * Math.sin(2 * w), psiL: 25 * Math.sin(w + 0.5), psiR: -25 * Math.sin(w + 0.5) };
  g.alphaL = -0.7 * g.psiL; g.alphaR = -0.7 * g.psiR;
  const hip = [0, -100 + 4 * Math.cos(2 * w)], sh = [hip[0] + 70 * Math.sin(g.phi * RAD), hip[1] - 70 * Math.cos(g.phi * RAD)];
  const head = [sh[0] + 25 * Math.sin(g.theta * RAD), sh[1] - 25 * Math.cos(g.theta * RAD)];
  const P = { hip, shoulder: sh, head };
  for (const s of ['L', 'R']) {
    P[`ankle${s}`] = add(hip, 100, g[`psi${s}`]); P[`knee${s}`] = add(hip, 50, g[`psi${s}`]);
    P[`wrist${s}`] = add(sh, 60, g[`alpha${s}`]); P[`elbow${s}`] = add(sh, 30, g[`alpha${s}`]);
  }
  return { g, P };
}

// 33 landmarks for the walker, in a 800 x 600 frame it crosses left to right, as MediaPipe gives them.
export function landmarks(t) {
  const { g, P } = walker(t), x0 = 300 + 60 * t, y0 = 450, lm = Array.from({ length: 33 }, () => P.head);
  const set = (i, p) => { lm[i] = p; };
  set(LM.nose, [P.head[0] + 9, P.head[1] + 2]); set(LM.earL, [P.head[0] - 1, P.head[1]]); set(LM.earR, [P.head[0] + 1, P.head[1]]);
  for (const [s, dx] of [['L', -2], ['R', 2]]) {
    set(LM[`shoulder${s}`], [P.shoulder[0] + dx, P.shoulder[1]]); set(LM[`hip${s}`], [P.hip[0] + dx, P.hip[1]]);
    for (const j of ['elbow', 'wrist', 'knee', 'ankle']) set(LM[`${j}${s}`], P[`${j}${s}`]);
    set(LM[`heel${s}`], [P[`ankle${s}`][0] - 5, P[`ankle${s}`][1] + 3]); set(LM[`toe${s}`], [P[`ankle${s}`][0] + 12, P[`ankle${s}`][1] + 4]);
  }
  for (const i of [17, 19, 21]) lm[i] = P.wristL;
  for (const i of [18, 20, 22]) lm[i] = P.wristR;
  return { g, lm: lm.map(([x, y]) => [(x0 + x) / 800, (y0 + y) / 600, 0, 0.99]) };
}


// What cli/pose.py would write for n frames at fps, frame `lost` not found.
export const poseJSON = (n = 75, fps = 30, lost = 20) => ({
  fps, w: 800, h: 600, frames: Array.from({ length: n }, (_, i) => (i === lost ? null : landmarks(i / fps).lm)),
});
