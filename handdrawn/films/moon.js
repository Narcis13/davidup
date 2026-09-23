// BRIEF (hdf script films/moon.md: the brief is the source of the timing; edit it and run again)
// Subject: why does the moon change shape?
// Audience: kids-7
// Look: whiteboard
// Format: 1:1
// Cast: sam (the store's puppet), fox (the store's puppet)
// Actor: sam (the teacher: every teaching recipe and chapter card)
// Bed: calm
// Anchor: the moon (a drawn disc that is there in every shot but the title and the talk)
// The acceptance film of hand-drawn film 4.0 (docs/hand-drawn-film-v4-plan.md, section 10). sam is the user's
// kind of character: drawn on the two rig sheets (W1), read by hdf sketch, a face grafted on so he talks. A
// lesson in four chapters on the whiteboard, the second on the chalkboard (L2), the sign-off in the user's hand.
//
// Beat sheet (hdf script films/moon.md, kids-7, 1:1, 107.58 s, 4 chapters)
// t       dur    shot                       look                            recipe  cast     sound                                                                                    what
// chapter 1: why does the moon change shape? (0.00 to 29.00)
// 0.00    8.92   title                      whiteboard                      AN      sam      the marker a word at a time; a step a footfall                                           the title written by a hand while sam walks on (planted feet) and presents it
// 8.92    10.00  look up                    whiteboard                      -       sam      voice moon-look                                                                          sam looks up and asks; the moon drawn thin, then round, as he says so
// 18.92   8.08   moon                       whiteboard                      AO      sam      a pluck a label                                                                          the moon labelled, leader lines, the bright side ringed
// 27.00   2.00   hold                       whiteboard                      -       -        -                                                                                        holds moon
// chapter 2: the sun lights half (29.00 to 55.75)
// 29.00   4.58   card: the sun lights half  chalkboard~ghost:0.08           AN      sam      -                                                                                        title "the sun lights half"; sam presents
// 33.58   10.42  orbit                      chalkboard~ghost:0.08           -       sam      voice moon-sun                                                                           the sun, the earth, the moon going round it lit on the sun's side; what the earth sees, inset
// 44.00   9.75   count                      chalkboard~ghost:0.08           AP      sam      a pop a shape                                                                            the eight shapes counted, a digit and a tally mark each
// 53.75   2.00   hold                       chalkboard~ghost:0.08           -       -        -                                                                                        holds count
// chapter 3: one month (55.75 to 83.83)
// 55.75   2.58   card: one month            whiteboard                      AN      sam      -                                                                                        title "one month"; sam presents
// 58.33   14.50  month                      whiteboard                      AS      sam      -                                                                                        the month as a ring, the names along it, a marker going round
// 72.83   9.00   talk                       whiteboard                      AY      sam fox  the lines                                                                                fox: de ce? / sam: pentru că Soarele o luminează doar pe jumătate!
// 81.83   2.00   hold                       whiteboard                      -       -        -                                                                                        holds talk
// chapter 4: quiz time (83.83 to 105.08)
// 83.83   2.58   card: quiz time            whiteboard                      AN      sam      -                                                                                        title "quiz time"; sam presents
// 86.42   16.67  quiz                       whiteboard                      AW      sam      voice moon-ask; a pop an option, a tick a wrong one, a ding; then "yes! the full moon."  quiz: which moon is big and round?, new, half, full
// 103.08  2.00   hold                       whiteboard                      -       -        -                                                                                        holds quiz
// 105.08  2.50   sign                       whiteboard~hand:hershey-script  S       -        -                                                                                        sign-off: good night
//
// The film is written against the sheet above: every shot keeps its name, length, recipe and look (hdf script
// --check films/moon.js). What each draws beyond its recipe:
//   title    the title written by a drawn hand (T6, AN) while sam walks on from the left with planted feet
//            (K5 walkTo) and presents it (K3), a crescent and three stars doodled after it
//   look up  sam looks up at the moon (K5 lookAt) and asks, his mouth on the recording (V3), captioned (V2);
//            the moon draws on round at "big and round", wanes to a thin smile at "thin smile", a ? at "why"
//   moon     AO on a half-lit moon: craters, bright side, dark side; then the bright side ringed (T7)
//   orbit    the sun, the earth and the moon going round it, always lit on the sun's side, eight ghosts left
//            where it has been; inset, the shape the earth sees; sam tells it, captioned
//   count    AP: the eight shapes counted, digits and a tally (T8)
//   month    AS: the month as a ring, names along the path (T8), a marker going round
//   talk     AY: the fox asks "de ce?", sam answers in Romanian in a bubble, diacritics composed (T9, T2)
//   quiz     AW: which moon is round, over a calm bed; pops, ticks, a ding, "yes! the full moon." (E4, V4)
//   sign     good night, in the user's hand
//
// A fixture since 4.0 RE-10: the brief beside it (films/moon.md), sam's rig sheets and the script that draws
// them (films/moon/), the clip for davidup (films/sam-moon.js, examples/hdf-moon/). Its golden samples 24 of its
// 1291 frames (hdf golden films/moon.js write --sample 24 --workers 1; the wav is whole).
import {
  FPS, actorOf, alignOf, audienceOf, bed, captions, cel, circle, circleAround, cueNotes, ding, dyad, ease, ellipse, fill,
  film, group, handText, line, lookAt, lookOn, meta, note, paper, pentHz, perform, place, plucks, pop, puppet, question,
  ramp, reveal, rng, seq, shot, spline, stand, stroke, tick, translate, voice, walkTo, writerSounds, poly, pulse,
} from '../core/index.js';
import { chapter, counting, countingPlan, cycleDiagram, dialogueOf, dialogueShot, labelled, labelledPlan, quiz, quizTimes, signOffShot, titleCard, titlePlan } from '../recipes/shots.js';
import { fromStore } from '../core/assets.js';

// The hand the sign-off is lettered in: the user's, once their sheet is photographed (hdf hand <photos> --name
// narcis); until then the Hershey script hand stands in. One line to change.
export const HAND = 'hershey-script';
fromStore(['sam', 'fox', 'moon-look', 'moon-sun', 'moon-ask', 'moon-yes', HAND]);

const audience = 'kids-7';
const AUD = audienceOf(audience);
const LEAD = 0.5;                                   // a voice starts this far into its shot
const up = (s) => Math.ceil(s * FPS - 1e-6) / FPS;  // a length worked out, up to the next drawn frame
const said = (id) => alignOf(id).words.at(-1).t1;   // when a recording's last word ends
// When the nth word of a recording that reads `w` starts (and ends), in recording seconds.
const word = (id, w, nth = 0) => {
  const hits = alignOf(id).words.filter((x) => x.text.toLowerCase().replace(/[^a-z]/g, '') === w);
  if (!hits[nth]) throw new Error(`moon: no word '${w}' (#${nth}) in ${id}`);
  return hits[nth];
};
const twos = (t) => Math.floor(t * 6 + 1e-9) / 6;   // motion on the twos

// ---------- cast ----------

const sam = actorOf(puppet('sam'));
const fox = actorOf(puppet('fox'));
export const cast = { sam, fox };

// ---------- the moon, drawn ----------

// The dark part of a moon of radius R at phase ph (0 new, PI full, 2 PI new again), lit on the right while it
// grows: the limb on the dark side and the terminator, an ellipse R cos(ph) wide (films/narrated.js).
function darkOf(cx, cy, R, ph) {
  const n = 28, pts = [], side = ph <= Math.PI ? -1 : 1, k = Math.cos(ph);
  for (let j = 0; j <= n; j++) { const a = (j / n) * Math.PI; pts.push([cx + side * R * Math.sin(a), cy - R * Math.cos(a)]); }
  for (let j = n; j >= 0; j--) { const a = (j / n) * Math.PI; pts.push([cx - side * R * k * Math.sin(a), cy - R * Math.cos(a)]); }
  return poly(pts, true);
}
const CRATERS = [[-0.34, -0.3, 0.17], [0.3, 0.2, 0.13], [-0.12, 0.44, 0.1], [0.42, -0.36, 0.08], [0.05, -0.05, 0.07]];
// A moon at (cx, cy), radius R, phase ph: the disc in the lit colour, craters, the dark part over them, the rim.
function moonOps(cx, cy, R, ph, { seed = 1, lit = 'fills.3', dark = 'shade', alpha = 0.78, name = 'moon', craters = true } = {}) {
  const disc = circle(cx, cy, R, 56), full = Math.abs(ph - Math.PI) < 0.02, none = ph < 0.02 || ph > 2 * Math.PI - 0.02;
  return group(name, [
    fill(disc, lit, { finish: true, name: 'lit' }),
    craters && stroke({ sub: CRATERS.map(([u, v, r]) => ({ pts: circlePts(cx + u * R, cy + v * R, r * R), closed: true })), box: [cx - R, cy - R, 2 * R, 2 * R] }, 'shade', { w: Math.max(1.6, R * 0.02), wobble: 0.8, seed: seed + 1, name: 'craters' }),
    !full && fill(none ? disc : darkOf(cx, cy, R, ph), dark, { alpha, name: 'dark' }),
    stroke(disc, 'ink', { w: Math.max(2.6, R * 0.03), wobble: 1.2, seed, name: 'rim' }),
  ]);
}
function circlePts(x, y, r, n = 14) { const out = []; for (let j = 0; j < n; j++) { const a = (j / n) * Math.PI * 2; out.push(x + r * Math.cos(a), y + r * Math.sin(a)); } return out; }

// The eight shapes as cels, 0 new, 2 first half, 4 full, 6 last half (AP counts them, AS and AW show four).
const R0 = 60;
const phaseCel = (k, chalk = false) => cel(`phase${k}${chalk ? '-chalk' : ''}`, () => [moonOps(0, 0, R0, (k / 8) * 2 * Math.PI, chalk ? { seed: 40 + k, lit: 'light', dark: 'night', alpha: 0.9 } : { seed: 40 + k })],
  { box: [-66, -66, 132, 132], desc: `the moon, shape ${k} of 8 (0 new, 2 first half, 4 full, 6 last half)${chalk ? ', in white chalk on the slate' : ''}` });
export const PHASES = Array.from({ length: 8 }, (_, k) => phaseCel(k));
export const CHALK_PHASES = Array.from({ length: 8 }, (_, k) => phaseCel(k, true));
const [phase0, , phase2, , phase4, , phase6] = PHASES;
// The big half-lit moon AO labels, 190 units across its radius.
export const moonFace = cel('moonFace', () => [moonOps(0, 0, 190, Math.PI / 2, { seed: 7, alpha: 0.7 })],
  { box: [-196, -196, 392, 392], desc: 'the moon half lit, lit on the right, with craters' });

// A star: four points, pulsing on the twos.
const star = (x, y, r, role = 'accents.3', seed = 0) => stroke({ sub: [{ pts: [x - r, y, x + r, y], closed: false }, { pts: [x, y - r, x, y + r], closed: false }, { pts: [x - r * 0.5, y - r * 0.5, x + r * 0.5, y + r * 0.5], closed: false }, { pts: [x - r * 0.5, y + r * 0.5, x + r * 0.5, y - r * 0.5], closed: false }], box: [x - r, y - r, 2 * r, 2 * r] }, role, { w: 3, wobble: 0.6, seed, name: 'star' });
const popIn = (u, x, y, node) => (u <= 0 ? null : place(x, y, { scale: u >= 1 ? 1 : 0.6 + 0.4 * ease.out(u) }, place(-x, -y, node)));

// A recipe's shot with more drawn after it: the same name, length, recipe and look (the sheet stays true).
function plus(node, extra) {
  return shot(node.name, node.dur, (ctx) => [node.draw(ctx), extra(ctx)], { recipe: node.recipe, look: node.look, camera: node.camera });
}
const card = (title, o = {}) => titleCard({ name: `card: ${title}`, title, actor: sam, audience, ...o });

// ---------- 1. why does the moon change shape? ----------

// title: the recipe's card with nobody at its side, written by its hand; sam walks on under it and presents.
const TITLE_O = { name: 'title', title: 'why does the moon change shape?', hand: true, audience, x: 450, y: 600, size: 92, width: 820 };
const titleBase = titleCard(TITLE_O);
// The lettering the recipe writes and its hand's schedule, for the marker's sounds (RE-8).
const TP = titlePlan(TITLE_O);
const FEET = 1000, S = 300, SY = FEET - 0.86 * S, WX = 900;
const walk = walkTo(sam, -160, WX, 0.35, null, { s: S });
const THERE = walk.end + 0.1, WRITTEN = TP.t1;
const facing = stand(sam, { ...sam.look(-1) });
const presents = perform(sam, [[0, facing], [Math.max(THERE, WRITTEN - 0.2), ['present', 'happy'], { dur: 0.35, anticipate: 0.12, overshoot: 0.1 }], [7.4, 'wave', { dur: 0.3 }]]);
const DOODLE = 5.2;
const title = shot('title', titleBase.dur, (ctx) => {
  const t = ctx.t, walking = t < THERE;
  const state = walking ? walk.state(t) : presents.state(t);
  const [cx, cy] = [900, 150];
  return [
    paper(),
    meta('anchor', { name: 'title' }),
    [titleBase.draw(ctx)].flat(Infinity).filter((op) => op && op.op !== 'paper' && op.op !== 'meta'),
    // A crescent and three stars doodled in the corner once the title is up.
    t >= DOODLE && reveal(ramp(DOODLE, DOODLE + 0.6, t), moonOps(cx, cy, 66, 2 * Math.PI - 1.05, { seed: 3, craters: false, alpha: 0.9, name: 'doodle' })),
    ...[[760, 90, 20], [1010, 290, 15], [770, 250, 11]].map(([x, y, r], j) => popIn(ramp(DOODLE + 0.7 + j * 0.3, DOODLE + 0.95 + j * 0.3, t), x, y, star(x, y, r * (1 + 0.12 * pulse(t, 2 + j)), 'accents.3', 20 + j))),
    stroke(line(0, FEET + 6, ctx.W, FEET + 6), 'shade', { w: 3, wobble: 1.2, seed: 5, alpha: 0.4, name: 'floor' }),
    sam.place(walking ? walk.x(t) : WX, SY, S, state),
  ];
}, { recipe: 'AN' });

// look up: sam asks, his mouth on the recording; the moon answers the words.
const lookUpCaps = captions('moon-look', { t0: LEAD, audience, box: [330, 800, 700, 220] });
const W_MOON = word('moon-look', 'moon').t0 + LEAD, W_ROUND = word('moon-look', 'round').t1 + LEAD;
const W_THIN = word('moon-look', 'thin').t0 + LEAD, W_SMILE = word('moon-look', 'smile').t1 + LEAD;
const W_WHY = word('moon-look', 'why').t0 + LEAD;
const LX = 180, LS = 320, LY = FEET - 0.86 * LS, MOON = [680, 300];
const asks = perform(sam, [
  [0, stand(sam, sam.look(0.5))],
  [0.4, 'look-up', { dur: 0.35, anticipate: 0.1 }],
  [W_MOON, 'point-r', { dur: 0.3, overshoot: 0.1 }],
  [W_WHY, ['shrug', 'confused'], { dur: 0.3, anticipate: 0.12 }],
]);
// The moon's phase and turn: full as it is said, then waning to a thin crescent turned to smile.
const lookPhase = (t) => Math.PI + (Math.PI - 0.55) * ease.io(ramp(W_THIN, W_SMILE, twos(t)));
const lookTurn = (t) => -Math.PI / 2 * ease.io(ramp(W_THIN, W_SMILE, twos(t)));
const STARS = (() => { const r = rng(91), out = []; for (let j = 0; j < 9; j++) out.push([330 + r() * 700, 60 + r() * 560, 10 + r() * 12]); return out.filter(([x, y]) => Math.hypot(x - MOON[0], y - MOON[1]) > 200 && Math.hypot(x - 950, y - 360) > 110); })();
const lookUp = shot('look up', up(lookUpCaps.until), (ctx) => {
  const t = ctx.t, drawn = ramp(W_MOON, W_ROUND, t, ease.out);
  const state = { ...lookAt(sam, MOON, { at: [LX, LY, LS], state: asks.state(t) }), ...sam.mouth('moon-look', t, LEAD) };
  return [
    paper(),
    meta('anchor', { name: 'moon' }), meta('anchor', { cel: 'sam' }), meta('intent', 'crop'),
    ...STARS.map(([x, y, r], j) => popIn(ramp(0.3 + j * 0.18, 0.55 + j * 0.18, t), x, y, star(x, y, r * (1 + 0.15 * pulse(t, 1.5 + j * 0.3)), j % 2 ? 'accents.3' : 'accents.1', 60 + j))),
    drawn > 0 && place(MOON[0], MOON[1], { rot: lookTurn(t) }, reveal(drawn, moonOps(0, 0, 150, lookPhase(t), { seed: 12, alpha: 0.85 }))),
    t >= W_WHY && question([950, 360], 160, ramp(W_WHY, W_WHY + 0.6, t), { role: 'accents.0', seed: 14 }),
    stroke(line(0, FEET + 6, ctx.W, FEET + 6), 'shade', { w: 3, wobble: 1.2, seed: 5, alpha: 0.4, name: 'floor' }),
    sam.place(LX, LY, LS, state),
    lookUpCaps.draw(t, ctx),
  ];
});

// moon: AO, the teacher at the right, then the bright side's label ringed.
const MOON_O = {
  name: 'moon', actor: sam, audience, subject: () => moonFace({}), x: 470, scale: 1, side: 'right', nudge: 0,
  labels: [{ text: 'craters', at: [530, 440] }, { text: 'bright side', at: [600, 580] }, { text: 'dark side', at: [370, 560], from: [300, 760] }],
};
const moonBase = labelled(MOON_O);
// The labels' times and words as AO works them out, for the plucks and the ring round "bright side" (RE-8).
const LP = labelledPlan(MOON_O), BRIGHT = LP.labels[1];
const RING = LP.labels[2].t0 + 1.2;
const moon = plus(moonBase, (ctx) => ctx.t >= RING && circleAround(group({ name: 'brightWord', box: BRIGHT.box }, [BRIGHT.word]), ramp(RING, RING + 0.6, ctx.t), { role: 'accents.0', pad: 16, seed: 31, name: 'ring' }));

const chapter1 = chapter({ title: 'why does the moon change shape?', actor: sam, audience, card: false }, title, lookUp, moon);

// ---------- 2. the sun lights half ----------

// orbit: the sun on the left, the earth, the moon going round it lit on the sun's side; what the earth sees.
const orbitCaps = captions('moon-sun', { t0: LEAD, audience, box: [70, 810, 940, 220] });
const O_SUN = word('moon-sun', 'sun').t0 + LEAD, O_HALF = word('moon-sun', 'half').t1 + LEAD;
const O_AROUND = word('moon-sun', 'goes').t0 + LEAD, O_SEE = word('moon-sun', 'see').t0 + LEAD;
const SUN = [115, 400], EARTH = [560, 400], ORB = 215, MR = 32, INSET = [930, 150], IR = 72;
// The moon starts between the sun and the earth (new) and goes once round, anticlockwise on the board.
const LAP0 = O_AROUND + 0.5, LAP1 = up(said('moon-sun') + LEAD + 0.6);
const angleAt = (t) => Math.PI + 2 * Math.PI * ease.io(ramp(LAP0, LAP1, twos(t)));   // PI: towards the sun
// Seen from the earth: 0 when the moon is towards the sun (new), PI away from it (full).
const seenAt = (a) => (((Math.PI - a) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
// A moon lit on the sun's side (the left half), drawn at (x, y).
const litMoon = (x, y, r, lit, { alpha = 1, name = 'orbiter', seed = 50 } = {}) => {
  const L = [], n = 20;
  for (let j = 0; j <= n; j++) { const a = Math.PI / 2 + (j / n) * Math.PI; L.push([x + r * Math.cos(a), y + r * Math.sin(a)]); }
  return group(name, [
    fill(circle(x, y, r, 32), 'shade', { alpha: 0.85 * alpha, name: 'dark' }),
    lit > 0 && fill(poly(L, true), 'light', { alpha: lit * alpha, name: 'lit' }),
    stroke(circle(x, y, r, 32), 'ink', { w: 2.4, wobble: 1, seed, alpha, name: 'rim' }),
  ]);
};
const label = (s, x, y, p, seed) => p > 0 && reveal(p, handText(s, x, y, { ink2: null, size: 52, align: 'center', role: 'ink', seed }));
const orbit = shot('orbit', up(orbitCaps.until), (ctx) => {
  const t = ctx.t, sunP = ramp(O_SUN - 0.2, O_SUN + 0.5, t, ease.out), litU = ramp(O_SUN + 0.5, O_HALF, t);
  const a = angleAt(t), mx = EARTH[0] + ORB * Math.cos(a), my = EARTH[1] - ORB * Math.sin(a);
  const travelled = t >= LAP0 ? (a - Math.PI) / (Math.PI / 4) : -1;
  const rays = Array.from({ length: 12 }, (_, j) => { const q = (j / 12) * Math.PI * 2, r0 = 108, r1 = j % 2 ? 135 : 152; return { pts: [SUN[0] + r0 * Math.cos(q), SUN[1] + r0 * Math.sin(q), SUN[0] + r1 * Math.cos(q), SUN[1] + r1 * Math.sin(q)], closed: false }; });
  const beams = [-90, 0, 90].map((d) => ({ pts: [SUN[0] + 165, SUN[1] + d * 0.6, EARTH[0] - ORB - 50, SUN[1] + d], closed: false }));
  const insetPh = seenAt(a);
  return [
    paper(),
    meta('anchor', { name: 'earth' }),
    // The sun: drawn on, its rays, three beams of light towards the moon's way.
    sunP > 0 && reveal(sunP, group('sun', [
      fill(circle(...SUN, 92, 48), 'accents.0', { finish: true, name: 'disc' }),
      stroke(circle(...SUN, 92, 48), 'accents.0', { w: 4, wobble: 1.4, seed: 70, name: 'rim' }),
      stroke({ sub: rays, box: [SUN[0] - 152, SUN[1] - 152, 304, 304] }, 'accents.0', { w: 4, wobble: 1, seed: 71, name: 'rays' }),
    ])),
    litU > 0 && reveal(litU, stroke({ sub: beams, box: [SUN[0] + 165, SUN[1] - 90, EARTH[0] - ORB - 215 - SUN[0], 180] }, 'accents.0', { w: 3, wobble: 1, dash: [18, 14], seed: 72, alpha: 0.6, name: 'beams' })),
    label('sun', SUN[0] + 20, SUN[1] + 215, ramp(O_SUN + 0.3, O_SUN + 0.9, t), 73),
    // The earth, and the moon's way round it.
    group({ name: 'earth', box: [EARTH[0] - ORB - MR, EARTH[1] - ORB - MR, 2 * (ORB + MR), 2 * (ORB + MR)] }, [
      t >= O_AROUND && reveal(ramp(O_AROUND, O_AROUND + 0.7, t), stroke(circle(...EARTH, ORB, 72), 'chalkDim', { w: 2.6, wobble: 1, dash: [14, 12], seed: 74, name: 'path' })),
      popIn(ramp(0.2, 0.5, t), ...EARTH, group('globe', [
        fill(circle(...EARTH, 50, 40), 'accents.2', { finish: true, name: 'sea' }),
        fill(poly([[EARTH[0] - 24, EARTH[1] - 29], [EARTH[0] + 6, EARTH[1] - 35], [EARTH[0] + 16, EARTH[1] - 8], [EARTH[0] - 5, EARTH[1] + 14], [EARTH[0] - 29, EARTH[1] + 2]], true), 'accents.3', { name: 'land' }),
        fill(poly([[EARTH[0] + 18, EARTH[1] + 16], [EARTH[0] + 37, EARTH[1] + 11], [EARTH[0] + 32, EARTH[1] + 32], [EARTH[0] + 14, EARTH[1] + 35]], true), 'accents.3', { name: 'land' }),
        stroke(circle(...EARTH, 50, 40), 'ink', { w: 3, wobble: 1.2, seed: 75, name: 'rim' }),
      ])),
      label('earth', EARTH[0], EARTH[1] + 105, ramp(0.5, 1.1, t), 76),
      // Where the moon has been: a ghost every eighth of the way, lit on the sun's side.
      ...Array.from({ length: 8 }, (_, k) => k > 0 && travelled >= k && litMoon(EARTH[0] + ORB * Math.cos(Math.PI + (k * Math.PI) / 4), EARTH[1] - ORB * Math.sin(Math.PI + (k * Math.PI) / 4), MR * 0.8, 1, { alpha: 0.4, name: `ghost${k}`, seed: 80 + k })),
      t >= 0.3 && popIn(ramp(0.3, 0.6, t), mx, my, litMoon(mx, my, MR, litU)),
    ]),
    label('moon', EARTH[0] - ORB, EARTH[1] - 60, ramp(0.8, 1.4, t) * (t < LAP0 ? 1 : 0), 77),
    // What the earth sees: the same moon from here, in a window, with a line of sight to it.
    t >= O_SEE - 0.3 && group('inset', [
      reveal(ramp(O_SEE - 0.3, O_SEE + 0.2, t), stroke(line(EARTH[0] + 40, EARTH[1] - 32, INSET[0] - IR - 26, INSET[1] + 34), 'chalkDim', { w: 2.4, dash: [10, 10], seed: 78, name: 'sight' })),
      popIn(ramp(O_SEE - 0.1, O_SEE + 0.25, t), ...INSET, group('seen', [
        fill(circle(...INSET, IR + 16, 48), 'night', { alpha: 0.5, name: 'window' }),
        stroke(circle(...INSET, IR + 16, 48), 'ink', { w: 3, wobble: 1.4, seed: 79, name: 'frame' }),
        moonOps(INSET[0], INSET[1], IR, insetPh, { seed: 81, lit: 'light', alpha: 0.9 }),
      ])),
      label('from earth', INSET[0] - 20, INSET[1] + IR + 75, ramp(O_SEE + 0.3, O_SEE + 1.0, t), 82),
    ]),
    orbitCaps.draw(t, ctx),
  ];
});
// count: the eight shapes counted (AP), the teacher on the left.
const COUNT_O = { name: 'count', actor: sam, audience, items: (ctx, j) => CHALK_PHASES[j]({}), n: 8, cols: 4, gap: 190, scale: 1, label: 'shapes' };
const count = counting(COUNT_O);

const LOOK2 = 'chalkboard~ghost:0.08';
const chapter2 = lookOn(LOOK2, chapter({ title: 'the sun lights half', actor: sam, audience, card: card('the sun lights half') }, orbit, count));

// ---------- 3. one month ----------

const month = cycleDiagram({ name: 'month', actor: sam, audience, steps: [{ text: 'new', cel: phase0 }, { text: 'growing', cel: phase2 }, { text: 'full', cel: phase4 }, { text: 'shrinking', cel: phase6 }], r: 300 });
const talkO = {
  name: 'talk', actor: sam, other: fox, audience,
  lines: [
    [1, 'de ce?', { emote: 'confused' }],
    [0, 'pentru că Soarele o luminează doar pe jumătate!', { emote: 'happy' }],
  ],
};
const talk = dialogueShot(talkO);

const chapter3 = chapter({ title: 'one month', actor: sam, audience, card: card('one month') }, month, talk);

// ---------- 4. quiz time ----------

const quizShotO = { name: 'quiz', actor: sam, audience, question: 'which moon is big and round?', options: [{ text: 'new', cel: phase0 }, { text: 'half', cel: phase2 }, { text: 'full', cel: phase4 }], answer: 2 };
const quizT = quizTimes(quizShotO);
const quizShot = (quiz({ ...quizShotO, dur: up(Math.max(quiz(quizShotO).dur, LEAD + said('moon-ask') + AUD.dwell)) }));

const chapter4 = chapter({ title: 'quiz time', actor: sam, audience, card: card('quiz time') }, quizShot);

// sign: good night, in the hand, under a sleeping crescent.
const signBase = signOffShot({ name: 'sign', a: 'good', b: 'night', look: `whiteboard~hand:${HAND}`, rings: null, y: 560 });
const sign = plus(signBase, (ctx) => [
  popIn(ramp(0, 0.3, ctx.t), 540, 250, group('sleepy', [moonOps(540, 250, 110, 2 * Math.PI - 1.15, { seed: 95, craters: false, alpha: 0.9 })])),
  ...[[300, 200, 18], [790, 170, 22], [860, 330, 13], [230, 360, 12]].map(([x, y, r], j) => popIn(ramp(0.2 + j * 0.15, 0.45 + j * 0.15, ctx.t), x, y, star(x, y, r, 'accents.3', 96 + j))),
]);

// ---------- score ----------

const score = ({ shots, chapters, end }) => {
  const at = (name) => shots.find((s) => s.name === name && !s.hold && !s.cut).t0;
  const music = bed({ mood: 'calm', to: end });
  const T = at('title'), Q = at('quiz');
  return {
    master: 0.5,
    events: [
      music, music.stop(at('sign')), music.sting(at('sign')),
      cueNotes(chapters.slice(1).map((c) => c.t0 + 0.15)),
      // title: the marker a word at a time, a soft step a footfall, a pluck as sam presents.
      writerSounds(TP.title, { ...TP.write, t0: T, tool: 'marker' }),
      walk.steps.map((t, j) => note(T + t, pentHz(0, j % 2 ? 2 : 0), 0.12, 'triangle', 0.06)),
      pop(T + DOODLE + 0.7), pop(T + DOODLE + 1.0), pop(T + DOODLE + 1.3),
      voice('moon-look', at('look up') + LEAD),
      LP.labels.map((l, j) => note(at('moon') + l.lead, pentHz(1, 2 + j), 0.3, 'triangle', 0.1)),
      voice('moon-sun', at('orbit') + LEAD),
      countingPlan(COUNT_O).items.map((it) => pop(at('count') + it.t0)),
      plucks(at('month'), 6, { every: 0.75 }),
      dialogueOf(talkO).events(at('talk')),
      voice('moon-ask', Q + LEAD),
      quizT.options.map((t) => pop(Q + t)),
      quizT.ticks.map((t) => tick(Q + t)),
      ding(Q + quizT.ding),
      voice('moon-yes', Q + quizT.ding + 0.7),
      dyad(at('sign'), 2.5, { gain: 0.3 }),
    ],
  };
};

export default film({ name: 'moon', look: 'whiteboard', audience, timeline: seq(chapter1, chapter2, chapter3, chapter4, sign), score, assets: ['sam', 'fox', 'moon-look', 'moon-sun', 'moon-ask', 'moon-yes', HAND] });
