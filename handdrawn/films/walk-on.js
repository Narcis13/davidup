// WALK ON (4.0 K5): inverse kinematics where it earns its place. sam walks on from the left without sliding
// its feet (walkTo: the body follows the planted foot frame by frame, and stand keeps that foot on the
// ground line), looks up at a balloon (lookAt: the head turns, the pupils do the rest) and reaches for its
// string (reach: two-bone IK on shoulder, elbow and wrist), then holds it. The fox, whose arms are one
// segment each, looks at the teapot's handle and reaches it (the single-segment aim).
//
// Anchor: sam, then the fox. Format 1:1, 12 fps, whiteboard; the teapot scene on rose paper.
// t      dur   shot    what changes
// 0.00   5.50  walk    sam walks on (0.25 to 2.75), looks up (3.0), reaches for the string (3.5), holds it
// 5.50   4.00  handle  the fox looks at the handle (0.5) and reaches it (1.0), happy (2.2)
// 9.50   2.50  sign    the sign-off (12 s in all)
import { film, seq, shot, paper, stroke, fill, circle, line, spline, group, meta, ease, ramp, pin, on, photo, puppet, actorOf, stickSource, perform, walkTo, stand, lookAt, reach, partAt, note, pentHz, dyad, LOOKS, pastel } from '../core/index.js';
import { fromStore } from '../core/assets.js';
import { CAST } from '../recipes/doodle.js';
import { signOffShot } from '../recipes/shots.js';

const IDS = ['teapot', 'fox'];
const PHOTOS = fromStore(IDS);
const FOX = CAST.FOX;
const SAM = actorOf(puppet(stickSource({ name: 'sam' })));

// ---------- walk: sam walks on, looks up, takes the balloon's string ----------
const FEET = 960, S = 260, Y = FEET - 0.86 * S, X = 430;   // sam's feet line, size, place and where it stops
const walk = walkTo(SAM, -150, X, 0.25, 2.75, { s: S });
const BALLOON = [650, 330], KNOT = [BALLOON[0] - 6, BALLOON[1] + 92], END = [532, 668];   // the string's free end
const GRAB = [3.5, 4.1];
// After the walk: facing right, feet on the ground; the look blends in as a performance.
const still = stand(SAM, { ...SAM.look(1) });
const gaze = lookAt(SAM, BALLOON, { at: [X, Y, S], state: still });
const act = perform(SAM, [[0, still], [3.0, gaze, { dur: 0.25 }], [4.3, 'happy', { dur: 0.25 }]]);
// The hand's way to the string: from where it hangs to the string's end, eased, on the twos.
const HANG = partAt(SAM, 'hand-r', [X, Y, S], still);
const twos = (t) => Math.floor(t * 6 + 1e-9) / 6;
const handTo = (t) => {
  const k = ease.io(ramp(GRAB[0], GRAB[1], twos(t)));
  return [HANG[0] + (END[0] - HANG[0]) * k, HANG[1] + (END[1] - HANG[1]) * k];
};

const balloon = (end, t) => {
  const sway = Math.round(Math.sin(twos(t) * 2.2) * 3);
  const c = [BALLOON[0] + sway, BALLOON[1]], knot = [KNOT[0] + sway, KNOT[1]];
  return group('balloon', [
    fill(circle(c[0], c[1], 78, 32), 'inks.2', { alpha: 0.18, name: 'body' }),
    stroke(circle(c[0], c[1], 78, 32), 'inks.2', { w: 6, wobble: 1, seed: 5, name: 'outline' }),
    stroke(spline([[c[0] - 40, c[1] - 30], [c[0] - 30, c[1] - 48], [c[0] - 12, c[1] - 56]], { n: 4 }), 'inks.2', { w: 4, wobble: 0.5, seed: 6, name: 'shine' }),
    stroke(line(knot[0] - 8, knot[1] - 12, knot[0] + 8, knot[1] - 12), 'inks.2', { w: 5, wobble: 0, name: 'knot' }),
    stroke(spline([knot, [knot[0] - 30, (knot[1] + end[1]) / 2], end], { n: 6 }), 'ink', { w: 3, wobble: 0.5, seed: 7, name: 'string' }),
  ]);
};

export const walkShot = shot('walk', 5.5, ({ t }) => {
  const walking = t < walk.end + 0.25;
  const x = walking ? walk.x(t) : X;
  let state = walking ? walk.state(t) : act.state(t);
  if (t >= GRAB[0]) state = { ...state, ...reach(SAM, 'hand-r', handTo(t), { at: [X, Y, S], state }) };
  const end = t >= GRAB[1] ? partAt(SAM, 'hand-r', [X, Y, S], state) : END;
  return [
    paper(),
    meta('anchor', { cel: 'sam' }), meta('intent', 'crop'),
    stroke(line(0, FEET + 6, 1080, FEET + 6), 'ink', { w: 4, wobble: 1, seed: 2, name: 'floor' }),
    balloon(end, t),
    SAM.place(x, Y, S, state),
  ];
}, { recipe: 'walk' });

// ---------- handle: the fox reaches the teapot's handle ----------
const GROUND = 780, FS = 130;
const pl = pin(PHOTOS.teapot, { x: 400, y: GROUND, h: 260, pivot: [0.4, 1] });
const HANDLE = on(pl, 0.985, 0.45);
const FX = HANDLE[0] + 74, FY = GROUND - 0.86 * FS;
const face = FOX.look(-1);
const peek = lookAt(FOX, HANDLE, { at: [FX, FY, FS], state: face });
const fox = perform(FOX, [[0, face], [0.5, peek, { dur: 0.25 }], [2.2, 'happy', { dur: 0.25 }]]);
const SHOULDER = partAt(FOX, 'arm-r', [FX, FY, FS], face);
const armTo = (t) => {
  const k = ease.io(ramp(1.0, 1.5, twos(t)));
  return [SHOULDER[0] + (HANDLE[0] - SHOULDER[0]) * k, SHOULDER[1] + 80 * (1 - k) + (HANDLE[1] - SHOULDER[1]) * k];
};

export const handleShot = shot('handle', 4, ({ t }) => {
  let state = fox.state(t);
  if (t >= 1.0) state = { ...state, ...reach(FOX, 'hand-r', armTo(t), { at: [FX, FY, FS], state }) };
  return [
    paper(),
    stroke(line(60, GROUND + 4, 1020, GROUND + 4), 'ink', { w: 3, wobble: 1.5, seed: 11, name: 'ground' }),
    photo(pl, { ground: GROUND }),
    meta('anchor', { cel: 'fox' }),
    FOX.place(FX, FY, FS, { tail: FOX.idle(t).tail, ...state }),   // the tail breathes; the body holds still for the reach
  ];
}, { recipe: 'handle', look: pastel(LOOKS.doodlePastel, 'rose') });

const sign = signOffShot({ name: 'sign', a: 'sam', b: 'reaches', rings: null });

// A soft tap for each step, a pluck as each hand arrives, a dyad under the sign-off.
const score = ({ shots: [w, h, s] }) => ({
  master: 0.45,
  events: [
    ...walk.steps.map((t, j) => note(w.t0 + t, pentHz(0, j % 2 ? 2 : 0), 0.12, 'triangle', 0.08)),
    note(w.t0 + GRAB[1], pentHz(1, 2), 0.35, 'triangle', 0.12),
    note(h.t0 + 1.5, pentHz(1, 4), 0.35, 'triangle', 0.12),
    ...dyad(s.t0, s.dur),
  ],
});

export default film({ name: 'walk-on', look: 'whiteboard', timeline: seq(walkShot, handleShot, sign), score, assets: IDS });
