// THE HEDGEHOG AND THE MOON. Paper in space (engines/stage3d.js, recipes/book.js): a pop-up book on a table.
// Every sheet is an ordinary display list (brush, wash, gouache, museum cutouts), projected into a room: the
// cover opens, leaves turn about the spine, pieces fold flat and rise, the camera travels, a lamp shades the
// sheets and drops their shadows on the pages. Port of v1 examples/moon-book.html; v1's author card is a
// sign-off card here. Photos: The Metropolitan Museum of Art, Open Access (CC0), credits in the asset store
// (`hdf find met --kind cutout`).
// t      what happens
// 0.0    the shut book on the table, the camera pushes in on the cover
// 2.2    the cover opens, spread 1 rises: night sky, the moon on its stick, pines, the hedgehog looking up
// 11.5   the leaf turns: the forest folds down, the tower of museum things stands up, he climbs it
// 19.5   the room goes dark, the paper moon lights up
// 23.6   the book shuts; a card lies on the table
import {
  film, shot, night, fill, stroke, clip, meta, circle, rect, poly, cubic, spline, union, rng, ramp, ease, withLook,
  pen, pin, photo, wash, grain, handText, signOff, glow, linear, radial, V3, camera3, proj3, card3, project, shadows,
  book3, note, burst, pentHz,
} from '../core/index.js';
import { hog } from '../recipes/doodle.js';
import { fromStore } from '../core/assets.js';

// The five cutouts, by id, out of the store next to the package (assets/catalogue.json).
const IDS = ['lantern', 'violin', 'watch', 'helmet', 'hourglass'];
const PHOTOS = fromStore(IDS);

const W = 1080, H = 1080, CX = 540, CY = 540, PW = 460, PD = 620;
const lerp = (a, b, u) => a + (b - a) * u;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const K = (t, a, b, e = ease.io) => ramp(a, b, t, e);

const LOOK = withLook('doodlePastel', {
  name: 'moon-book', words: 10,
  palette: {
    paper: '#f1e8d2', ink: '#2b2018', light: '#fffaf0', night: '#120c09', chalk: '#f7f3e8',
    fills: ['#5f9a78', '#4f8a6a', '#7fb58f', '#f3d98b', '#e9a15f', '#8fb4d6'], accents: ['#c8473f', '#2f6db0', '#e0a526', '#4c9a6a'],
    board: '#27335c', edge: '#e9dfc8', gold: '#e3c477', moonFace: '#fbf1c9', moonWash: '#f3d98b', crater: '#d9b86a', craterLine: '#b09050',
    sky: '#2a3463', skyLow: '#5b6db0', star: '#fff6d0', trunk: '#a9805a', pine: '#f6f1e2', stick: '#efe6cf', quills: '#b78d63',
    wood: '#6a4930', woodDark: '#3a2510', woodGap: '#190c04', groundA: '#a9c7a0', groundB: '#c9c2a0', grain: '#5a4628', spine: '#3c2814',
    dusk: '#232a55', lamp: '#ffe9a8', lampCore: '#fff6d0', lantern: '#ffcf70', cardPaper: '#fffdf7', room: '#0a0500',
  },
});

// ---------- helpers ----------
const ink = (seed, build) => pen(99, 0, -9, seed, build, { still: true });        // a finished doodle on a sheet
const sheetGrain = (w, h, seed, n = 500) => grain([0, 0, w, h], n, 'grain', 0.07, seed, 1.6);
const ellPts = (cx, cy, rx, ry, n = 20) => Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });
const blob = (pts) => spline(pts, { closed: true, tension: 0, n: 6 });
const cutout = (name, w, h, hh, o = {}) => photo(pin(PHOTOS[name], { x: w / 2, y: h, h: hh, pivot: [0.5, 1], ...o }), { shadow: 0 });

// ---------- sheets ----------
const wood = (() => {
  const w = 1600, h = 1200, r = rng(9), planks = [], gaps = [], lines = [];
  for (let x = 0; x < w; x += 200) {
    planks.push(fill(rect(x, 0, 200, h), 'woodDark', { alpha: 0.2 + Math.floor(r() * 3) * 0.1 }));
    gaps.push(rect(x - 1.5, 0, 3, h));
  }
  for (let k = 0; k < 260; k++) { const x = r() * w, y = r() * h, l = 60 + r() * 260; lines.push(cubic([x, y], [x + 6, y + l * 0.3], [x - 6, y + l * 0.6], [x + 3, y + l], 8)); }
  return card3(w, h, [fill(rect(0, 0, w, h), 'wood'), ...planks, fill(union(...gaps), 'woodGap', { alpha: 0.55 }), stroke(union(...lines), { base: 'woodGap', alpha: 0.22 }, { w: 1.4, wobble: 0 })], { name: 'table' });
})();

const cover = (() => {
  const w = PW + 16, h = PD + 16;
  return card3(w, h, [
    fill(rect(0, 0, w, h), 'board'), grain([0, 0, w, h], 2600, 'light', 0.035, 4, 1.4),
    ink(11, (d) => {
      d.line([[30, 30], [w - 30, 30], [w - 30, h - 30], [30, h - 30]], { close: true, smooth: false, w: 4, role: 'gold' })
        .line([[44, 44], [w - 44, 44], [w - 44, h - 44], [44, h - 44]], { close: true, smooth: false, w: 1.8, role: 'gold' });
      d.fill(circle(w / 2, 200, 84), 'moonWash').line(ellPts(w / 2, 200, 84, 84, 16), { close: true, w: 3.4, role: 'gold' });
      hog(d, w / 2 - 6, 470, 50, { rot: -0.3, body: 'light', quills: 'quills' });
    }),
    handText('the hedgehog', w / 2, 352, { size: 62, role: 'gold', ink2: null, align: 'center' }),
    handText('and the moon', w / 2, 590, { size: 62, role: 'gold', ink2: null, align: 'center' }),
  ], { name: 'cover' });
})();

const sky = (() => {
  const w = 880, h = 470;
  const arch = poly([0, h, 0, 190, ...cubic([0, 190], [0, 40], [160, 0], [w / 2, 0], 16).sub[0].pts.slice(2), ...cubic([w / 2, 0], [w - 160, 0], [w, 40], [w, 190], 16).sub[0].pts.slice(2), w, h]);
  const r = rng(8), stars = [];
  for (let k = 0; k < 150; k++) { const a = 0.4 + r() * 0.6, x = r() * w, y = r() * h * 0.85, rad = 0.8 + r() * 1.8; stars.push(fill(circle(x, y, rad, 8), 'star', { alpha: +a.toFixed(2) })); }
  return card3(w, h, [
    fill(arch, 'sky'),
    clip(arch, [wash(rect(-20, h - 170, w + 40, 200), 'skyLow', { al: 0.55, off: 0, blend: 'source-over', seed: 3 }), ...stars]),
    ink(13, (d) => { [[120, 120, 11], [260, 60, 8], [640, 80, 10], [770, 170, 12], [420, 40, 7]].forEach(([x, y, s]) => d.lines([[[x - s, y], [x + s, y]], [[x, y - s], [x, y + s]]], { w: 2.4, role: 'star' })); }),
    stroke(arch, 'ink', { w: 4, wobble: 0.8 }),
  ], { name: 'sky' });
})();

const moon = card3(260, 600, [ink(17, (d) => {
  const w = 260, h = 600, st = [[w / 2 - 8, 236], [w / 2 + 8, 236], [w / 2 + 8, h], [w / 2 - 8, h]];
  d.fill(poly(st), 'stick').line(st, { close: true, smooth: false, w: 2.6 });
  d.fill(circle(w / 2, 126, 118), 'moonFace').wash(circle(w / 2 + 6, 132, 108), 'moonWash', { al: 0.7, off: 4 }).line(ellPts(w / 2, 126, 118, 118), { close: true, w: 4.4 });
  [[-44, -40, 17], [38, -58, 11], [50, 30, 20], [-20, 56, 12]].forEach(([x, y, r]) => d.wash(circle(w / 2 + x, 126 + y, r), 'crater', { al: 0.55, off: 1 }).line(ellPts(w / 2 + x, 126 + y, r, r, 8), { close: true, w: 1.8, role: 'craterLine' }));
  d.lines([[[w / 2 - 50, 120], [w / 2 - 38, 110], [w / 2 - 26, 120]], [[w / 2 + 6, 112], [w / 2 + 18, 102], [w / 2 + 30, 112]], [[w / 2 - 28, 150], [w / 2 - 8, 164], [w / 2 + 14, 150]]], { w: 3 });
})], { name: 'moon' });

const pines = [0, 1, 2].map((v) => card3(180, 370, [ink(21 + v, (d) => {
  const w = 180, h = 370, tr = [[w / 2 - 12, h - 70], [w / 2 + 12, h - 70], [w / 2 + 12, h], [w / 2 - 12, h]];
  d.fill(poly(tr), 'trunk').line(tr, { close: true, smooth: false, w: 3 });
  [[10, 300, 90], [26, 210, 72], [44, 130, 54]].forEach(([top, bot, half], k) => {
    const P = [[w / 2, top], [w / 2 + half * 0.45, lerp(top, bot, 0.55)], [w / 2 + half, bot], [w / 2 + half * 0.4, bot - 12], [w / 2, bot + 4], [w / 2 - half * 0.4, bot - 12], [w / 2 - half, bot], [w / 2 - half * 0.45, lerp(top, bot, 0.55)]];
    d.fill(poly(P), 'pine').wash(poly(P), `fills.${v}`, { al: 0.9, off: 2, seed: 30 + k + v }).line(P, { close: true, smooth: false, w: 3.4 });
  });
})], { name: `pine${v}` }));

const hogCard = card3(210, 170, [ink(31, (d) => hog(d, 96, 104, 56, { rot: -0.32, quills: 'quills' }))], { name: 'hog' });
const grass = card3(160, 70, [ink(33, (d) => { for (let k = 0; k < 7; k++) { const x = 14 + k * 21; d.line([[x, 70], [x + (k % 2 ? 5 : -5), 70 - 26 - (k % 3) * 12], [x + (k % 2 ? 9 : -8), 70 - 44 - (k % 3) * 12]], { w: 3, role: 'accents.3' }); } })], { name: 'grass' });
const violin = card3(140, 400, [cutout('violin', 140, 400, 396)], { name: 'violin' });
const lantern = card3(160, 310, [cutout('lantern', 160, 310, 306)], { name: 'lantern' });
const solid = card3(8, 8, [fill(rect(0, 0, 8, 8), 'ink')]);

// The tower of museum things, with the hedgehog climbing its ladder.
function tower(climb, reach) {
  const w = 320, h = 860, top = climb >= 1, hx = top ? w / 2 + 10 : lerp(64, 112, climb) + 6, hy = top ? 74 : lerp(h - 60, 150, climb), bob = top ? 0 : Math.sin(climb * 40) * 3;
  return card3(w, h, [
    cutout('helmet', w, h, 330, { x: w / 2 + 6 }), cutout('hourglass', w, h - 300, 250, { x: w / 2 - 4 }), cutout('watch', w, h - 528, 215, { x: w / 2 + 4, rot: 0.1 }),
    ink(51, (d) => {
      const L0 = [44, h - 4], L1 = [92, 118], R0 = [84, h - 4], R1 = [132, 118];
      d.line([L0, L1], { w: 3.4 }).line([R0, R1], { w: 3.4 });
      for (let k = 1; k < 15; k++) { const u = k / 15; d.line([[lerp(L0[0], L1[0], u), lerp(L0[1], L1[1], u)], [lerp(R0[0], R1[0], u), lerp(R0[1], R1[1], u)]], { w: 2.6 }); }
    }),
    ink(53, (d) => hog(d, hx, hy + bob, 44, { rot: top ? -0.2 : -1.0, eye: top && reach > 0.6 ? 'happy' : 'dot', quills: 'quills', hand: top ? [hx + 70 + reach * 26, hy - 40 - reach * 22] : null })),
  ], { name: 'tower' });
}

// A page: paper, grain, the shadow of the gutter, a wash of ground, a border, lines written by the pen.
function page(side, lines, tau, t0, ground) {
  const w = PW, h = PD, L = side === 'L';
  return card3(w, h, [
    fill(rect(0, 0, w, h), 'paper'), sheetGrain(w, h, L ? 3 : 4),
    fill(rect(0, 0, w, h), 'spine', { cov: linear(L ? w : 0, 0, L ? w - 90 : 90, 0, 0.32, 0) }),
    wash(blob(L ? [[20, 120], [200, 80], [w + 30, 110], [w + 30, 430], [200, 470], [20, 440]] : [[-30, 110], [250, 84], [w - 20, 130], [w - 20, 440], [260, 466], [-30, 430]]), ground, { al: 0.5, off: 3, seed: 5 }),
    stroke(rect(16, 16, w - 32, h - 32), { base: 'grain', alpha: 0.28 }, { w: 1.2, wobble: 0 }),
    ...lines.map(([str, x, y, size, dt], k) => pen(tau, 0, t0 + (dt ?? k * 0.9), 70 + k, (d) => d.text(str, x, y, { size }), { speed: 900 })),
  ], { name: `page${side}` });
}

function book(tau, climb, reach) {
  const P = [
    page('L', [['Every night', 36, 486, 48], ['the hedgehog looked', 36, 538, 48], ['at the moon.', 36, 590, 48]], tau, 4.6, 'groundA'),
    page('R', [['The moon', 190, 538, 48, 0], ['looked back.', 190, 590, 48, 0.7]], tau, 8.0, 'groundA'),
    page('L', [['So he stacked up', 36, 486, 48], ['everything', 36, 538, 48], ['the museum had.', 36, 590, 48]], tau, 13.6, 'groundB'),
    page('R', [['Almost.', 230, 580, 56, 0]], tau, 18.7, 'groundB'),
  ];
  return book3({
    PW, PD, cover, board: 'board', edge: 'edge',
    spreads: [
      { left: P[0], right: P[1], pieces: [
        { base: [[-440, -285], [440, -285]], h: 470, card: sky, mesh: 12 }, { base: [[-130, -215], [130, -215]], h: 600, card: moon },
        { base: [[-445, -150], [-265, -150]], h: 370, card: pines[0] }, { base: [[-330, -30], [-150, -30]], h: 400, card: pines[1] }, { base: [[-452, 70], [-302, 70]], h: 300, card: pines[2] },
        { base: [[262, -160], [442, -160]], h: 360, card: pines[1] }, { base: [[160, -40], [340, -40]], h: 410, card: pines[0] }, { base: [[330, 60], [452, 60]], h: 250, card: pines[2] },
        { base: [[-40, 150], [170, 150]], h: 170, card: hogCard }, { base: [[-270, 215], [-110, 215]], h: 70, card: grass }, { base: [[200, 225], [360, 225]], h: 70, card: grass },
      ] },
      { left: P[2], right: P[3], pieces: [
        { base: [[-440, -285], [440, -285]], h: 470, card: sky, mesh: 12 }, { base: [[70, -225], [330, -225]], h: 600, card: moon },
        { base: [[-330, -70], [-10, -70]], h: 860, card: tower(climb, reach), mesh: 14 }, { base: [[-450, 110], [-310, 110]], h: 400, card: violin, lean: 74 },
        { base: [[290, 150], [450, 150]], h: 310, card: lantern }, { base: [[60, 215], [220, 215]], h: 70, card: grass },
      ] },
    ],
  });
}

// The card left on the table at the end: the sign-off.
const endCard = (tau) => card3(444, 170, [
  fill(rect(0, 0, 444, 170), 'cardPaper'),
  ink(41, (d) => d.line([[2, 2], [442, 2], [442, 168], [2, 168]], { close: true, smooth: false, w: 3.2 })),
  signOff('the hedgehog', 'and the moon', { x: 222, y: 62, size: 50, pA: K(tau, 25.5, 26.2, (u) => u), pB: K(tau, 26.3, 27.0, (u) => u) }),
], { name: 'endCard' });

// ---------- the camera ----------
const PATH = [[0, [300, 840, 760], [236, 10, 30]], [2.2, [262, 760, 650], [236, 10, 30]], [4.2, [-240, 900, 1200], [0, 140, -40]], [9.2, [250, 830, 1080], [0, 170, -30]], [11.4, [170, 640, 860], [40, 230, -40]], [12.4, [0, 1000, 1300], [0, 170, -40]], [14.0, [-260, 960, 1230], [-60, 200, -40]],
  [18.6, [60, 1120, 1120], [-90, 520, -60]], [20.5, [150, 1000, 1100], [10, 520, -120]], [23.4, [120, 980, 1130], [10, 500, -120]], [25.4, [520, 1240, 1260], [480, 10, 70]], [29, [500, 1160, 1180], [480, 10, 70]]];
function camAt(t) {
  let eye = PATH[0][1], tg = PATH[0][2];
  for (let k = 0; k + 1 < PATH.length; k++) if (t >= PATH[k][0]) { const u = ease.io(clamp((t - PATH[k][0]) / (PATH[k + 1][0] - PATH[k][0]), 0, 1)); eye = V3.lerp(PATH[k][1], PATH[k + 1][1], u); tg = V3.lerp(PATH[k][2], PATH[k + 1][2], u); }
  return camera3({ eye, target: tg, f: 1500 });
}

const main = shot('book', 29, ({ t, i, look }) => {
  const turn = t < 2.2 ? 0 : t < 4.0 ? K(t, 2.2, 4.0) : t < 11.5 ? 1 : t < 13.3 ? 1 + K(t, 11.5, 13.3) : t < 23.6 ? 2 : 2 - 2 * K(t, 23.6, 25.6);
  const dim = K(t, 19.4, 20.8) * (1 - K(t, 23.2, 24.2)), climb = K(t, 14.2, 18.4, (u) => u), reach = K(t, 18.5, 19.4);
  const cam = camAt(t), out = [night(), meta('anchor', { name: 'book' }), meta('intent', 'crop')];
  out.push(project(cam, wood, [[-2300, -2, -1900], [2300, -2, -1900], [2300, -2, 1550], [-2300, -2, 1550]], { dark: 0.12, look }));
  // the book's own shadow on the table
  const x0 = -(PW + 14) * Math.min(1, turn);
  out.push(shadows(cam, [{ card: solid, P: [[x0 - 10, 60, -PD / 2 - 14], [PW + 24, 60, -PD / 2 - 14], [PW + 24, 60, PD / 2 + 14], [x0 - 10, 60, PD / 2 + 14]], r0: [0, -1, 0] }], { alpha: 0.38, look, name: 'bookShadow' }));
  out.push(book(t, climb, reach).draw({ turn, cam, look }));
  if (t > 24.6) {
    const a = K(t, 24.6, 25.5, ease.out), cx = 745 + (1 - a) * 600, cz = 190, rot = -0.14, w = 222, h = 85, ca = Math.cos(rot), sa = Math.sin(rot);
    const Q = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, z]) => [cx + x * ca - z * sa, 1.5, cz + x * sa + z * ca]), card = endCard(t);
    out.push(shadows(cam, [{ card, P: Q.map((p) => [p[0], 14, p[2]]) }], { alpha: 0.3, look, name: 'cardShadow' }), project(cam, card, Q, { dark: 0.05, look }));
  }
  // the lamp over the table, and later the dark with the paper moon alight
  out.push(fill(rect(-2, -2, W + 4, H + 4), 'room', { cov: radial(CX - 30, CY - 20, 260, 860, 0, 0.5), name: 'vignette' }));
  if (dim > 0) {
    const m = proj3(cam, [200, 480 + 14, -225]), ln = proj3(cam, [370, 190, 150]);
    out.push(
      fill(rect(-2, -2, W + 4, H + 4), 'dusk', { alpha: 0.78 * dim, blend: 'multiply', name: 'nightfall' }),
      glow(m[0], m[1], 420 * dim, { role: 'lamp', k: 0.8 * dim }), glow(m[0], m[1], 130 * dim, { role: 'lampCore', k: 0.6 * dim }), glow(ln[0], ln[1], 130 * dim, { role: 'lantern', k: 0.7 * dim }),
      pen(t, i, 20.9, 91, (d) => d.text('it was only paper.', 70, 960, { size: 62, role: 'chalk' })),
      pen(t, i, 22.0, 92, (d) => d.text('he loved it anyway.', 70, 1030, { size: 62, role: 'chalk' })),
    );
  }
  return out;
});

// ---------- score (v1: a music box, page swishes, his feet on the ladder) ----------
const score = () => {
  const ev = [], hz = (o, s) => pentHz(o, s, 220);
  const box = (t, f, g = 0.18, d = 1.2) => ev.push(note(t, f, d, 'sine', g), note(t, f * 2, d * 0.5, 'triangle', g * 0.22), note(t, f * 4, d * 0.2, 'sine', g * 0.06));
  const swish = (t, d, g) => { for (let k = 0; k < 6; k++) ev.push(burst(t + k * d / 6, d / 3, g * (0.5 + 0.5 * Math.sin(k / 5 * Math.PI)), 3 + k)); };
  const mel = [0, 2, 4, 2, 3, 4, 2, 0, 1, 2, 4, 3, 2, 1, 0, 2];
  for (let k = 0; k < 38; k++) { const t = 0.3 + k * 0.5; if (t > 19.2) break; box(t, hz(1 + (k % 8 > 5 ? 1 : 0), mel[k % 16]), 0.15); if (k % 3 === 0) box(t, hz(0, mel[k % 16]), 0.1, 1.6); }
  swish(2.3, 1.4, 0.12); swish(11.6, 1.5, 0.14); swish(23.7, 1.7, 0.14);
  [3.0, 3.3, 3.5, 12.6, 12.9, 13.1].forEach((t, k) => ev.push(burst(t, 0.05, 0.12, 20 + k)));
  for (let k = 0; k < 9; k++) ev.push(burst(14.3 + k * 0.46, 0.03, 0.1, 30 + k));
  [[19.6, 0, 0], [19.6, 1, 0], [19.6, 1, 2], [19.6, 1, 4], [19.6, 2, 0], [21.0, 2, 2], [22.0, 2, 4], [23.0, 3, 0]].forEach(([t, o, s]) => box(t, hz(o, s), 0.16, 3.2));
  [[25.6, 1, 4], [26.1, 1, 2], [26.6, 1, 0], [27.4, 0, 0], [27.4, 1, 0], [27.4, 1, 2]].forEach(([t, o, s]) => box(t, hz(o, s), 0.17, 2));
  return { master: 0.5, events: ev };
};

export default film({ name: 'moon-book', look: LOOK, timeline: [main], score, assets: IDS });
