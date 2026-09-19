// ONE YEAR. Sand on a light table (engines/sim.js). One take, no cuts: a bed of sand is poured, swept, combed
// and drawn in, and a tree goes through its year. Nothing is redrawn; every picture is made out of the one
// before it. Port of v1 examples/one-year.html; v1's author card is a sign-off card here.
// 12 fps on twos; the sand itself steps at 48 Hz.
// t      what the hand does                                         what it becomes
// 0.2    sprinkles sand over the whole table, more at the bottom    earth and a dull sky
// 4.2    sweeps the sky with the palm                               spring light, a ridge for the horizon
// 7.0    pours a trunk, branches, twigs; a sun                      the tree
// 11.0   sprinkles a crown, flicks birds                            summer
// 14.6   thins the crown with fingertips, drops leaves              autumn
// 18.6   sprinkles the sky dark, wipes a moon and its bite, dabs    winter night, snow on the branches and the ground
//        snow, clears the ground, draws snow along the branches
// 25.0   sweeps the whole table clean                               nothing
// 27.0   pours a ground line, a sprout, and two words               one year
// 31.0   lays a card on the glass                                   the sign-off
import {
  film, shot, fill, group, meta, poly, ramp, ease, withLook, pen, signOff, translate, rotate, mmul,
  sim, G, circlePts, spiralPts, pathOf, note, pentHz,
} from '../core/index.js';

const TAU = Math.PI * 2;
const sm = (a, b, t, e = ease.io) => ramp(a, b, t, e);

// A running clock for gestures: go(dur, make) places a gesture at T and moves T on; at(t) jumps.
let T = 0;
const go = (dur, make, gap = 0.08) => { const g = make(T, T + dur); T += dur + gap; return g; };
const at = (t) => { T = t; return []; };
const row = (y, dir, wob = 36) => Array.from({ length: 10 }, (_, k) => [dir > 0 ? -80 + k * 140 : 1160 - k * 140, y + Math.sin(k * 1.1 + y) * wob]);
const hillY = (x) => 800 - 46 * Math.exp(-Math.pow((x - 440) / 300, 2));
const horizon = (dy, dir = 1) => { const p = Array.from({ length: 13 }, (_, k) => [-100 + k * 107, hillY(-100 + k * 107) + dy]); return dir > 0 ? p : p.reverse(); };
const TRUNK = [[434, 806], [440, 710], [430, 620], [442, 528]];
const BR = [[[436, 650], [384, 570], [332, 486]], [[440, 606], [512, 524], [574, 452]], [[438, 548], [402, 474], [388, 402]], [[442, 528], [472, 446], [502, 384]]];
const TW = [[[332, 486], [290, 452]], [[574, 452], [624, 430]], [[388, 402], [362, 350]], [[502, 384], [524, 334]], [[384, 570], [340, 560]], [[512, 524], [560, 520]]];
const CROWN = [[332, 470, 66], [392, 386, 66], [450, 350, 70], [512, 372, 66], [578, 440, 62], [450, 452, 70], [380, 506, 56], [524, 486, 56], [300, 520, 44], [610, 500, 44]];
// A single-stroke alphabet for pouring words: points in a unit box, x advance last.
const LETTERS = {
  o: [[[0.62, 0.66], [0.5, 0.42], [0.3, 0.38], [0.12, 0.52], [0.1, 0.76], [0.26, 0.95], [0.48, 0.92], [0.62, 0.72], [0.6, 0.5]], 0.78],
  n: [[[0.08, 0.4], [0.08, 0.95]], [[0.08, 0.58], [0.3, 0.4], [0.5, 0.48], [0.54, 0.95]], 0.74],
  e: [[[0.12, 0.68], [0.56, 0.62], [0.5, 0.44], [0.3, 0.38], [0.13, 0.54], [0.12, 0.8], [0.3, 0.95], [0.56, 0.84]], 0.74],
  y: [[[0.06, 0.4], [0.3, 0.9]], [[0.56, 0.4], [0.3, 0.9], [0.14, 1.34]], 0.72],
  a: [[[0.56, 0.52], [0.36, 0.38], [0.13, 0.54], [0.12, 0.8], [0.3, 0.95], [0.56, 0.8]], [[0.57, 0.4], [0.58, 0.95]], 0.78],
  r: [[[0.08, 0.4], [0.08, 0.95]], [[0.08, 0.6], [0.28, 0.42], [0.5, 0.46]], 0.6],
  ' ': [0.5],
};
function word(str, x, y, size, dur) {
  const strokes = [];
  let px = x;
  for (const ch of str) { const L = LETTERS[ch]; for (const st of L.slice(0, -1)) strokes.push(st.map(([u, v]) => [px + u * size, y + v * size])); px += L[L.length - 1] * size; }
  const total = strokes.reduce((a, s) => a + pathOf(s).len, 0);
  return strokes.map((s) => go(dur * pathOf(s).len / total, (a, b) => G.pour(a, b, s, { r: 5.5, amount: 2.6 }), 0.04));
}
const snowOn = (p) => p.map(([x, y]) => [x - 7, y - 10]), disc = (cx, cy, r) => circlePts(cx, cy, r, 20);

const GESTURES = [
  at(0.2), [110, 330, 550, 770, 990].map((y, k) => go(0.46, (a, b) => G.sprinkle(a, b, row(y, k % 2 ? -1 : 1), { r: 240, amount: 1.5 }), 0.03)),
  go(0.66, (a, b) => G.sprinkle(a, b, row(935, 1, 14), { r: 170, amount: 2.6 }), 0.1),
  // spring: light in the sky; the last sweep leaves its ridge on the horizon
  go(0.85, (a, b) => G.palm(a, b, row(205, 1, 26), { r: 195, strength: 0.84, streaks: 0.5, keep: 0.3 })),
  go(0.95, (a, b) => G.palm(a, b, horizon(-198, -1), { r: 190, strength: 0.84, streaks: 0.5, keep: 0.55 }), 0.15),
  // the tree, then the sun
  go(0.7, (a, b) => G.pour(a, b, TRUNK, { r: 15, amount: 2.6 })),
  BR.map((p, k) => go(0.36, (a, b) => G.pour(a, b, p, { r: k < 2 ? 9.5 : 7.5, amount: 2.4 }))),
  TW.map((p) => go(0.13, (a, b) => G.pour(a, b, p, { r: 5, amount: 2.2 }), 0.03)),
  go(0.55, (a, b) => G.pour(a, b, circlePts(830, 225, 50, 22, -1.2), { r: 4.6, amount: 2.4 }), 0.04),
  Array.from({ length: 8 }, (_, k) => { const a0 = k / 8 * TAU + 0.2; return go(0.07, (a, b) => G.pour(a, b, [[830 + Math.cos(a0) * 72, 225 + Math.sin(a0) * 72], [830 + Math.cos(a0) * 104, 225 + Math.sin(a0) * 104]], { r: 3.6, amount: 2.4 }), 0.02); }),
  at(T + 0.2),
  // summer: a crown, three birds
  CROWN.map(([x, y, r]) => go(0.17, (a, b) => G.sprinkle(a, b, [[x - 8, y], [x + 8, y + 4]], { r, amount: 6 }), 0.03)), at(T + 0.1),
  [[700, 480], [790, 420], [880, 500]].map(([x, y]) => [
    go(0.09, (a, b) => G.pour(a, b, [[x - 30, y - 18], [x - 12, y - 14], [x, y]], { r: 3.2, amount: 2.4 }), 0.02),
    go(0.09, (a, b) => G.pour(a, b, [[x, y], [x + 14, y - 16], [x + 32, y - 20]], { r: 3.2, amount: 2.4 }), 0.06),
  ]), at(T + 0.45),
  // autumn: the crown thins under the fingertips, leaves come down and pile up at the foot of the tree
  [[340, 470], [400, 392], [462, 348], [520, 380], [580, 448], [452, 456], [386, 512], [530, 492], [310, 520], [606, 498], [430, 400], [492, 430], [360, 430], [556, 410], [420, 490], [476, 376]]
    .map(([x, y], k) => go(0.07, (a, b) => G.dab(a, 450 + (x - 450) * 1.22 + (k % 3 - 1) * 8, 432 + (y - 432) * 1.2 + (k % 2) * 10, { r: 13 + (k % 3) * 4 }), 0.03)),
  [[650, 560], [300, 620], [720, 650], [250, 700], [610, 700], [330, 760], [690, 760], [560, 640], [210, 600], [760, 720], [380, 690], [520, 770]]
    .map(([x, y]) => go(0.07, (a, b) => G.pour(a, b, [[x, y], [x + 9, y + 7]], { r: 5.5, amount: 2.6 }), 0.03)),
  go(0.5, (a, b) => G.sprinkle(a, b, [[380, 800], [500, 804]], { r: 70, amount: 5 }), 0.4),
  go(0.7, (a, b) => G.palm(a, b, [[760, 120], [850, 230], [960, 330], [1200, 420]], { r: 95, strength: 0.97, streaks: 0.2, keep: 0.15 }), 0.1),
  // winter: a dark sky, a moon with a bite out of it, snow in the air, on the ground and along the branches
  [130, 340, 545, 240, 450].map((y, k) => go(0.5, (a, b) => G.sprinkle(a, b, row(y, k % 2 ? -1 : 1, 20), { r: 235, amount: 5.5 }), 0.03)),
  go(0.75, (a, b) => G.finger(a, b, spiralPts(232, 214, 58, 3.2, 20).reverse(), { r: 16 })),
  go(0.55, (a, b) => G.fill(a, b, disc(282, 184, 40), { r: 9, amount: 3 })),
  [[480, 120], [640, 90], [760, 200], [900, 110], [980, 260], [690, 330], [560, 250], [860, 380], [120, 420], [210, 560], [990, 480], [90, 120], [400, 60], [780, 520], [940, 640], [150, 700], [640, 470], [300, 330]]
    .map(([x, y], k) => go(0.06, (a, b) => G.dab(a, x, y, { r: k % 3 ? 4.2 : 6.5 }), 0.025)),
  go(0.95, (a, b) => G.palm(a, b, [[-100, 948], [300, 934], [700, 952], [1180, 934]], { r: 108, strength: 0.96, streaks: 0.25, keep: 0.45 })),
  BR.map((p) => go(0.26, (a, b) => G.finger(a, b, snowOn(p), { r: 3.6 }), 0.04)), at(T + 0.7),
  // the table is swept clean
  [150, 420, 690, 960].map((y, k) => go(0.66, (a, b) => G.palm(a, b, row(y, k % 2 ? -1 : 1, 30), { r: 215, strength: 0.985, streaks: 0.3, keep: 0.05 }), 0.04)), at(T + 0.15),
  // and it starts again
  go(0.6, (a, b) => G.pour(a, b, [[330, 842], [450, 832], [600, 846], [760, 836]], { r: 6, amount: 2.4 })),
  go(0.4, (a, b) => G.pour(a, b, [[540, 838], [547, 770], [538, 708]], { r: 6, amount: 2.4 })),
  go(0.2, (a, b) => G.pour(a, b, [[532, 724], [508, 706], [488, 708]], { r: 12, amount: 2.4 })),
  go(0.2, (a, b) => G.pour(a, b, [[548, 712], [574, 690], [598, 688]], { r: 12, amount: 2.4 }), 0.2),
  word('one year', 318, 884, 88, 2.5), at(T + 0.3),
];
const CARD_T = T;
GESTURES.push(
  G.move(CARD_T - 0.1, CARD_T + 0.9, [[1200, 700], [930, 330], [800, 250]], { hand: 'palm' }),
  G.move(CARD_T + 0.95, CARD_T + 1.7, [[800, 250], [1000, 500], [1300, 900]], { hand: 'palm' }),
);
const bed = sim('one-year', { gestures: GESTURES });
const END = CARD_T + 3.6;

// The card the hand leaves on the glass: paper on a light table is not white, it glows.
const LOOK = withLook('doodlePastel', { name: 'one-year', palette: { ink: '#2a1a0c', accents: ['#a8341f', '#2f6db0', '#e0a526', '#4c9a6a'], card: '#e7d3ae' } });
function cardOnGlass(t, i) {
  const t0 = CARD_T + 0.85;
  if (t < t0) return null;
  const drop = ease.out(sm(t0, t0 + 0.25, t, (u) => u)), m = mmul(translate(800, 250 + (1 - drop) * 30), rotate(-0.05 + (1 - drop) * 0.08));
  const crd = [[-222, -80], [222, -80], [222, 80], [-222, 80]];
  return group({ name: 'card', xf: m, cache: 'never' }, [
    fill(poly([[-214, -70], [232, -70], [232, 92], [-214, 92]]), { base: 'ink', shade: 0.4, alpha: 0.35 * drop }, { name: 'shadow' }),
    fill(poly(crd), 'card', { alpha: drop, name: 'sheet' }),
    pen(t, i, t0 + 0.25, 61, (d) => d.line(crd, { close: true, w: 3, smooth: false, speed: 2600 }), { still: true }),
    signOff('one year', 'in sand, one take', { x: 0, y: -30, size: 58, pA: sm(t0 + 0.5, t0 + 1.1, t, (u) => u), pB: sm(t0 + 1.2, t0 + 1.8, t, (u) => u) }),
  ]);
}

const sand = shot('sand', Math.ceil((END + 1) * 2) / 2, ({ t, i }) => [
  ...bed.frame(t, { over: cardOnGlass(t, i) }),
  meta('anchor', { name: 'sand:one-year' }),
]);

// A slow piano over the year, and the sand itself: every gesture hisses for as long as it lasts.
const score = () => {
  const ev = [], hz = (o, s) => pentHz(o, s, 174.6);
  const key = (t, f, g = 0.16, d = 2.2) => ev.push(note(t, f, d, 'sine', g), note(t, f * 2, d * 0.6, 'triangle', g * 0.16), note(t, f * 3, d * 0.3, 'sine', g * 0.05));
  const S = [[0.4, 0, 0], [1.6, 0, 2], [2.8, 0, 4], [4.0, 1, 0], [5.2, 0, 4], [6.2, 1, 1], [7.0, 1, 0], [7.8, 1, 2], [8.6, 1, 4], [9.4, 2, 0], [10.2, 1, 4], [11.0, 2, 1], [11.8, 2, 2], [12.6, 2, 0], [13.4, 1, 4], [14.2, 2, 2], [15.0, 2, 4],
    [16.0, 1, 3], [17.0, 1, 1], [18.0, 1, 0], [19.0, 0, 3], [20.0, 0, 4], [21.2, 0, 1], [22.4, 2, 3], [23.4, 2, 1], [24.4, 3, 0], [25.4, 2, 3], [26.4, 2, 1], [27.6, 1, 0], [28.6, 0, 0]];
  S.forEach(([t, o, s]) => key(t, hz(o, s)));
  [[0.4, -1, 0], [4.0, -1, 0], [7.0, -1, 2], [10.2, -1, 0], [13.4, -1, 4], [16.0, -1, 3], [19.0, -1, 1], [22.4, -1, 3], [25.4, -1, 1]].forEach(([t, o, s]) => key(t, hz(o, s), 0.12, 4));
  const tail = CARD_T - 7;
  [[0, 0, 0], [0.9, 0, 2], [1.8, 0, 4], [2.7, 1, 0], [3.6, 1, 2], [4.8, 1, 4], [6.0, 2, 0], [7.6, 1, 0], [7.6, 1, 2], [7.6, 1, 4], [7.6, 2, 0]].forEach(([t, o, s]) => key(tail + t, hz(o, s), 0.15, 2.6));
  return { master: 0.6, events: [...bed.hiss(), ...ev] };
};

export default film({ name: 'one-year', look: LOOK, timeline: [sand], score });
