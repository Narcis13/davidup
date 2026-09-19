// Motion as values. A curve is t => value, evaluated by the caller on the frame grid (t = k / FPS).
// Nothing here touches Date or global state.
import { at, len } from './list.js';

export const FPS = 12;   // drawn frames per second (output is 24: every drawn frame shows twice)

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, u) => (Array.isArray(a) ? a.map((v, j) => v + (b[j] - v) * u) : a + (b - a) * u);
// The frame index of t. Rounding keeps onTwos/onThrees exact when t arrives as k / 12 in floating point.
const kOf = (t) => Math.round(t * FPS);

// io, out and in are v1's easeIO, easeOut and easeIn, so ported timings feel the same.
export const ease = {
  linear: (t) => t,
  in: (t) => t * t * t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  io: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  back: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  bounce: (t) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};

const easeFn = (e) => (typeof e === 'function' ? e : ease[e] ?? (() => { throw new Error(`unknown ease '${e}'`); })());

// keys: [[t, value, ease?], ...] in time order; value is a number or an array of numbers.
// The ease on a key shapes the segment that ends at it; `e` is the default. Held flat outside the keys.
export function curve(keys, e = ease.linear) {
  if (!keys.length) throw new Error('curve: no keys');
  for (let j = 1; j < keys.length; j++) if (keys[j][0] < keys[j - 1][0]) throw new Error('curve: keys out of time order');
  const def = easeFn(e);
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let j = 1; j < keys.length; j++) {
      const [t1, v1, e1] = keys[j];
      if (t < t1) {
        const [t0, v0] = keys[j - 1];
        return lerp(v0, v1, (e1 ? easeFn(e1) : def)((t - t0) / (t1 - t0)));
      }
    }
    return keys[keys.length - 1][1];
  };
}

// 0..1 between times a and b (v1 `sm`).
export const ramp = (a, b, t, e = ease.io) => easeFn(e)(clamp01((t - a) / (b - a)));

const asCurve = (c) => (typeof c === 'function' ? c : () => c);
export const add = (...cs) => { const f = cs.map(asCurve); return (t) => f.reduce((s, c) => s + c(t), 0); };   // curves or constants summed
export const mul = (...cs) => { const f = cs.map(asCurve); return (t) => f.reduce((s, c) => s * c(t), 1); };   // multiplied
export const delay = (d, c) => (t) => c(t - d);   // c starting d seconds later
const mod = (a, n) => ((a % n) + n) % n;
export const repeat = (period, c) => (t) => c(mod(t, period));   // c looped every period
export const pingpong = (period, c) => (t) => { const u = mod(t, 2 * period); return c(u < period ? u : 2 * period - u); };   // c forward then back
export const clampC = (c, lo, hi) => (t) => Math.min(hi, Math.max(lo, c(t)));   // c held inside lo..hi
// Sample and hold: the value changes every second (third) drawn frame.
export const onTwos = (c) => (t) => c(Math.floor(kOf(t) / 2) * 2 / FPS);
export const onThrees = (c) => (t) => c(Math.floor(kOf(t) / 3) * 3 / FPS);   // held for three drawn frames

// Position and heading along a path. `p` maps t to progress 0..1 (identity by default).
export function follow(path, p = (t) => t) {
  const L = len(path), prog = asCurve(p);
  return (t) => at(path, clamp01(prog(t)) * L);
}

// Frame-index helpers (i is the global drawn frame).
export const pulse = (i, every, hold = 1) => i % every < hold;           // true for `hold` drawn frames every `every`
export const flicker = (i, period = 2) => Math.floor(i / period) % 2 === 0;   // alternate two renders
export const boil = (i, every = 4) => Math.floor(i / every);             // integer phase, passed to a cel as an input
