// Author-facing surface of handdrawn. Films import from here and nowhere else.
export {
  circle, ellipse, rect, roundRect, poly, line, cubic, spline, arc, xf, box, len, at, inside, resample, union,
  paper, night, fill, stroke, dots, text, image, group, clip, fx, lookNode, meta,
  hashList, bounds, walk, mapPaths, serialise, parse,
} from './list.js';
export {
  FPS, curve, ease, ramp, add, mul, delay, repeat, pingpong, clampC, onTwos, onThrees, follow, pulse, flicker, boil,
} from './curves.js';
export { cel, place, shot, seq, par, hold, cut, lookOn, film, frame, describe, cues } from './tree.js';
export { FORMATS, format } from './fit.js';
export { rng } from './rand.js';
export { LOOKS, PASTELS, derive, duotone, pastel, withLook } from './looks.js';
export { handText, signOff, squiggleText, measure } from './text.js';
export { reveal } from './tools.js';
export { pentHz, renderScore, toWav16 } from './synth.js';
export { note, burst, plucks, swell, cueNotes, travel, sparse, impact, dyad } from '../recipes/score.js';
