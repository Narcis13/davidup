// ALL FOUR HOOVES. Found motion: the horse, the elephant, the kangaroo and the pigeons move the way real
// animals moved in front of Eadweard Muybridge's cameras. The poses come from the drawings he had made for his
// zoopraxiscope discs (Descriptive Zoopraxography, 1893, public domain); cli/roto.py traced every pen stroke
// into vectors (now clips in the asset store, `hdf find muybridge`) and engines/traced.js redraws them with
// the brush, one pose per frame.
// Port of v1 examples/gallop.html; v1's author card is left out, every colour is a role of the film's look.
// Beat sheet
// t      dur  shot      what happens
// 0.0    3.5  question  the horse gallops in place, too fast to read; the question is written
// 3.5    2.5  guess     what painters drew: legs stretched out, floating
// 6.0    6.5  cameras   1878: 12 cameras, 12 threads, the horse trips them one by one, 12 cards
// 12.5   4.5  answer    the airborne frame, drawn on stroke by stroke: tucked under, not stretched out
// 17.0   6.5  disc      1879: the poses on a glass disc; it spins up until the horse runs again
// 23.5   7.0  parade    everything began to move: elephant, kangaroo, pigeons
// 30.5   4.0  end       sign-off
import {
  film, seq, shot, cel, fill, stroke, group, meta, circle, rect, poly, line, arc, cubic, rng, ramp, ease, boil,
  withLook, mix, pen, backdrop, speedLines, cam, glow, signOff, translate, rotate, scale, mmul,
  clipFromStore, traced, gap, airborne, clipOf, note, burst, pentHz,
} from '../core/index.js';
import { fromStore } from '../core/assets.js';

// The four traced clips, by id, out of the store next to the package; each one handed to the engine.
const IDS = ['horse', 'kangaroo', 'elephant', 'pigeons'];
fromStore(IDS);
IDS.forEach((id) => clipFromStore(id));

// One traced pose as a cel, ground point at the origin, 300 units tall (for sheets and packs).
export const horse = cel('horse', ({ pose = 0, flip = 0 }) => [
  traced('horse', pose, { x: 0, y: 0, h: 300, flip: !!flip, wash: 'fills.0', seed: 5 }),
], { box: [-240, -310, 480, 320], inputs: { pose: [0, 11, 1], flip: [0, 1, 1] }, desc: 'a galloping horse: one of 12 Muybridge poses traced from film (found motion); feet at the origin' });

const TAU = Math.PI * 2, W = 1080, CX = 540, CY = 540;
const lerp = (a, b, u) => a + (b - a) * u;
const sm = (a, b, t, e = ease.io) => ramp(a, b, t, e);
const lin = (t) => t;

// The doodle look on sepia paper (v1 makePalette over doodlePastel). A captioned documentary: its shots
// carry sentences, so the word allowance is raised from the doodle look's 3.
const BASE = withLook('doodlePastel', {
  name: 'gallop', words: 18,
  palette: {
    paper: '#efe3c8', ink: '#2b2018', light: '#fffaf0', shade: '#7a6a58', blush: '#d98b7a',
    fills: ['#b98457', '#9db0bd', '#e0a05a', '#a9b98a', '#d9b26a', '#c8a6a0'], accents: ['#c8473f', '#2f6db0', '#e0a526', '#4c9a6a'],
    gold: '#ffe2a0', flashCore: '#fff8dc',
  },
});
// The disc at night (v1 chalkPalette): chalk lines on a dark blue card.
const NIGHT = withLook(BASE, {
  name: 'gallop~night',
  palette: { paper: '#23243f', ink: BASE.palette.chalk, light: mix(BASE.palette.night, BASE.palette.chalk, 0.2), shade: BASE.palette.chalkDim },
});
const SEPIA = 'fills.0', N = 12, AIR = airborne('horse'), STRETCH = 5;

// ---------- helpers ----------
const tf = (x, y, s, rot = 0) => (px, py) => { const X = px * s, Y = py * s, ca = Math.cos(rot), sa = Math.sin(rot); return [x + X * ca - Y * sa, y + X * sa + Y * ca]; };
const M = (T, pts) => pts.map((p) => T(p[0], p[1]));
const ellPts = (cx, cy, rx, ry, rot = 0, n = 44) => Array.from({ length: n }, (_, i) => { const a = i / n * TAU, x = rx * Math.cos(a), y = ry * Math.sin(a); return [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]; });
const groundLine = (d, y, x0 = -400, x1 = W + 400) => d.line([[x0, y + 3], [lerp(x0, x1, 0.3), y - 2], [lerp(x0, x1, 0.65), y + 4], [x1, y]], { w: 3.6 });
function tufts(d, y, off, n = 9, span = 1500) {
  for (let k = 0; k < n; k++) {
    const x = ((k * 173 - off) % span + span) % span - 200;
    d.lines([[[x, y], [x - 7, y - 22]], [[x + 10, y], [x + 12, y - 30]], [[x + 20, y], [x + 29, y - 19]]], { w: 2.6, dur: 0.03 });
  }
}
function camera(d, x, y, s = 1) {
  const T = tf(x, y, s), body = M(T, [[-22, -34], [22, -34], [22, 0], [-22, 0]]);
  d.fill(poly(body), 'light').line(body, { close: true, w: 2.8, smooth: false }).line(ellPts(...T(0, -17), 9 * s, 9 * s, 0, 8), { close: true, w: 2.4 });
  d.lines([[T(-14, 0), T(-26, 46)], [T(0, 0), T(0, 48)], [T(14, 0), T(26, 46)]], { w: 2.6, dur: 0.04 });
  return d;
}
// A camera's flash: rays and a pale core (v1 burst).
function flash(x, y, r, seed) {
  const q = rng(seed), rays = [];
  for (let k = 0; k < 9; k++) { const a = k / 9 * TAU + q() * 0.3; rays.push({ pts: [x + Math.cos(a) * r * 0.45, y + Math.sin(a) * r * 0.45, x + Math.cos(a) * r, y + Math.sin(a) * r], closed: false }); }
  return group(`flash${seed}`, [
    stroke({ sub: rays, box: [x - r, y - r, 2 * r, 2 * r] }, 'accents.2', { w: 3, wobble: 0 }),
    fill(circle(x, y, r * 0.36, 24), 'flashCore'),
  ]);
}
// A quadratic Bezier as a polyline path.
const quad = (p0, q, p1) => cubic(p0, [p0[0] + 2 / 3 * (q[0] - p0[0]), p0[1] + 2 / 3 * (q[1] - p0[1])], [p1[0] + 2 / 3 * (q[0] - p1[0]), p1[1] + 2 / 3 * (q[1] - p1[1])], p1, 12);
// A pose on a little card (v1 card + rotoSprite at 50 units).
function card(k, x, y, { s = 1, rot = 0, hot = false, w = 80, h = 68 } = {}) {
  const m = mmul(mmul(translate(x, y), rotate(rot)), scale(s));
  return group({ name: `card${k}`, xf: m, cache: 'never' }, [
    fill(rect(-w / 2 + 3, -h / 2 + 4, w, h), { base: 'ink', alpha: 0.16 }, { name: 'shadow' }),
    fill(rect(-w / 2, -h / 2, w, h), 'light', { name: 'sheet' }),
    stroke(rect(-w / 2, -h / 2, w, h), hot ? 'accents.0' : 'ink', { w: hot ? 4 : 2, wobble: 0, name: 'edge' }),
    traced('horse', k, { x: 0, y: h / 2 - 8, h: 50, fill: null, weight: 1.5 }),
  ]);
}
const threadX = (k) => 96 + k * 80.6;
const cardRot = (k) => (rng(k + 2)() - 0.5) * 0.12;
const view = (v, kids) => cam({ x: v.x ?? CX, y: v.y ?? CY, zoom: v.zoom ?? 1 }, kids);

// ---------- shots ----------
const question = shot('question', 3.5, ({ t, i }) => {
  const GY = 800;
  return [
    ...backdrop(), meta('anchor', { name: 'traced:horse' }),
    view({ zoom: 1.02 + 0.05 * t / 3.5, y: CY + 10 }, [
      pen(t, i, 0.1, 1, (d) => { groundLine(d, GY); tufts(d, GY, t * 900, 9); }, { speed: 4000, still: true }),
      traced('horse', i, { x: CX, y: GY, h: 470, wash: SEPIA, seed: 5 + boil(i, 2) }),
      speedLines(CX - 300, GY - 250, 0, 5 + i, { n: 8, alpha: 0.6 }),
      pen(t, i, 0.3, 21, (d) => d.text('when a horse gallops,', 70, 140, { size: 74 })),
      pen(t, i, 1.4, 22, (d) => d.text('do all four hooves', 70, 232, { size: 74 })),
      pen(t, i, 2.2, 23, (d) => d.text('ever leave the ground?', 70, 324, { size: 74 })),
    ]),
  ];
});

const guess = shot('guess', 2.5, ({ t, i }) => {
  const GY = 800, lift = 70 + Math.sin(t * 3) * 8;
  return [
    ...backdrop(), meta('anchor', { name: 'traced:horse' }),
    view({ zoom: 1.03 }, [
      pen(t, i, 0, 1, (d) => groundLine(d, GY), { speed: 4000, still: true }),
      traced('horse', STRETCH, { x: CX + 20, y: GY - lift, h: 470, wash: SEPIA, p: sm(0.1, 1.2, t, lin), seed: 9 + boil(i) }),
      pen(t, i, 1.3, 31, (d) => {
        d.line([[CX + 30, GY - 8], [CX + 30, GY - lift + 4]], { w: 3.6, role: 'accents.0' })
          .lines([[[CX + 16, GY - 24], [CX + 30, GY - 8], [CX + 44, GY - 24]], [[CX + 16, GY - lift + 20], [CX + 30, GY - lift + 4], [CX + 44, GY - lift + 20]]], { w: 3.6, role: 'accents.0', dur: 0.05 });
        d.text('?', CX + 70, GY - 6, { size: 130, role: 'accents.0' });
      }),
      pen(t, i, 0.2, 21, (d) => d.text('for centuries painters guessed:', 70, 140, { size: 66 })),
      pen(t, i, 1.2, 22, (d) => d.text('stretched out, like a rocking horse.', 70, 226, { size: 60 })),
    ]),
  ];
});

const cameras = shot('cameras', 6.5, ({ t, i }) => {
  const GY = 700, t0 = 1.7, pc = (t - t0) * 6, p = Math.floor(pc), hx = threadX(0) + (pc - 1) * 80.6 - 150, gone = pc > 15;
  const threads = [];
  for (let k = 0; k < N; k++) {
    const tripped = pc >= k + 1, x = threadX(k), a = sm(0.5 + k * 0.05, 0.7 + k * 0.05, t);
    if (a <= 0) continue;
    const paths = tripped ? [quad([x, GY - 300], [x + 26, GY - 210], [x + 8, GY - 150]), quad([x, GY + 40], [x + 22, GY - 10], [x + 30, GY - 30])] : [line(x, GY - 300, x, GY + 40)];
    threads.push(stroke({ sub: paths.flatMap((q) => q.sub), box: [x - 2, GY - 300, 36, 342] }, 'shade', { w: 2, wobble: 0, dash: [9, 8], alpha: a, name: `thread${k}` }));
  }
  const cards = [];
  for (let k = 0; k < N; k++) {
    const tk = t0 + (k + 1) / 6;
    if (t < tk) continue;
    const a = ease.out(sm(tk, tk + 0.14, t, lin));
    if (t < tk + 0.17) cards.push(flash(threadX(k), GY + 76, 40, k));
    cards.push(card(k, threadX(k), 330 - (1 - a) * 40, { s: 0.4 + 0.6 * a, rot: cardRot(k) }));
  }
  return [
    ...backdrop(), meta('anchor', { name: 'traced:horse' }), meta('anchor', { name: 'ground' }), meta('intent', 'crop'),
    view({ zoom: 1.0 + 0.03 * sm(0, 6.5, t, lin) }, [
      group('ground', [pen(t, i, -9, 1, (d) => groundLine(d, GY), { still: true })]),
      ...threads,
      pen(t, i, 0.45, 3, (d) => { for (let k = 0; k < N; k++) camera(d, threadX(k), GY + 96, 0.9); }, { speed: 5200, gap: 0.004, still: true }),
      t > t0 - 0.4 && !gone && [
        traced('horse', p - 1, { x: hx - 40, y: GY, h: 260, fill: null, alpha: 0.16, seed: 4, name: 'ghost' }),
        traced('horse', p, { x: hx, y: GY, h: 260, wash: SEPIA, seed: 5 + boil(i, 2) }),
      ],
      ...cards,
      pen(t, i, 0.2, 21, (d) => d.text('1878. palo alto.', 70, 130, { size: 72 })),
      pen(t, i, 0.9, 22, (d) => d.text('12 cameras. 12 threads across the track.', 70, 212, { size: 54 })),
      t > 4.6 && pen(t, i, 4.6, 23, (d) => d.text('one stride. 12 photographs.', 70, 985, { size: 64 })),
    ]),
  ];
});

const answer = shot('answer', 4.5, ({ t, i }) => {
  const GY = 850, g = gap('horse', AIR) * 470 / clipOf('horse').h, HX = CX - 90;
  return [
    ...backdrop(), meta('anchor', { name: 'traced:horse' }),
    view({ zoom: 1 + 0.06 * sm(0.4, 4.5, t, lin), y: CY + 30 * sm(0.4, 4.5, t) }, [
      ...Array.from({ length: N }, (_, k) => card(k, threadX(k), 120, { rot: cardRot(k), hot: k === AIR && t > 0.3 })),
      t > 0.3 && pen(t, i, 0.3, 5, (d) => d.line([[threadX(AIR), 160], [threadX(AIR) - 120, 250], [HX + 120, 330]], { w: 3, role: 'accents.0' }), { still: true }),
      pen(t, i, 0.2, 1, (d) => groundLine(d, GY), { speed: 4000, still: true }),
      traced('horse', AIR, { x: HX, y: GY, h: 470, wash: SEPIA, p: sm(0.4, 1.9, t, lin), seed: 11 + boil(i) }),
      t > 1.9 && pen(t, i, 1.9, 7, (d) => {
        d.line(ellPts(HX - 10, GY - g - 52, 190, 82, -0.04, 18), { close: true, w: 4.4, role: 'accents.0' });
        const ax = HX + 215;
        d.line([[ax, GY - 5], [ax, GY - g + 3]], { w: 4.4, role: 'accents.0' })
          .lines([[[ax - 14, GY - 20], [ax, GY - 5], [ax + 14, GY - 20]], [[ax - 14, GY - g + 18], [ax, GY - g + 3], [ax + 14, GY - g + 18]], [[ax - 40, GY - g], [ax + 40, GY - g]]], { w: 4, role: 'accents.0', dur: 0.05 });
      }, { still: true }),
      pen(t, i, 1.6, 21, (d) => d.text(`photograph ${AIR + 1}:`, 70, 300, { size: 60 })),
      pen(t, i, 2.1, 22, (d) => d.text('all four. in the air.', 70, 955, { size: 84, role: 'accents.0' })),
      t > 3.3 && pen(t, i, 3.3, 24, (d) => d.text('tucked under, not stretched out.', 70, 1025, { size: 46 })),
      t > 3.0 && [
        traced('horse', STRETCH, { x: 905, y: 640, h: 150, wash: SEPIA, alpha: sm(3.0, 3.2, t), name: 'stretched' }),
        pen(t, i, 3.2, 9, (d) => d.lines([[[800, 495], [1010, 650]], [[1010, 495], [800, 650]]], { w: 5, role: 'accents.0' }), { still: true }),
      ],
    ]),
  ];
});

// The disc: 12 poses on the rim, heads to the hub. It spins up to exactly one pose per drawn frame, and then
// the horse runs again: a disc that has turned a whole number of poses looks still.
function discAngle(n) { let th = 0; for (let q = 1; q <= n; q++) th += Math.min(1, Math.pow(q / 30, 2)) * TAU / N; return th; }
const disc = shot('disc', 6.5, ({ t, i, k: f }) => {
  const n = Math.max(0, f - 16), locked = n >= 30, th = discAngle(n), zoom = 1 + 1.5 * sm(5.3, 6.5, t, ease.in), cx = CX, cy = 520, R = 360, steps = locked ? n - 30 : 0;
  const poses = [];
  for (let j = 0; j < N; j++) {
    const a0 = sm(0.3 + j * 0.07, 0.5 + j * 0.07, t);
    if (a0 <= 0) continue;
    const a = -j * TAU / N + th - (locked ? steps * TAU / N : 0), x = cx + Math.sin(a) * R, y = cy + Math.cos(a) * R;
    poses.push(traced('horse', locked ? j + steps : j, { x, y, h: 150, rot: -a, fill: 'light', weight: 1.3, alpha: a0, name: `pose${j}` }));
  }
  const streaks = [];
  if (n > 6) for (let q = 0; q < 16; q++) {
    const a = q / 16 * TAU + th * 1.7 + (locked ? f * 1.3 : 0), r0 = q % 2 ? R + 30 + (q % 3) * 9 : 60 + (q % 4) * 22;
    streaks.push(...arc(cx, cy, r0, a, a + 0.3 * Math.min(1, n / 20), 8).sub);
  }
  return [
    ...backdrop({ vignette: 0.4, spot: 0.12 }), meta('anchor', { name: 'pose0' }), meta('anchor', { name: 'rim' }), meta('intent', 'crop'),
    view({ zoom, x: lerp(CX, cx, sm(5.3, 6.5, t)), y: lerp(CY, cy + R - 80, sm(5.3, 6.5, t)) }, [
      locked && glow(cx, cy + R - 80, 210, { role: 'gold', k: 0.5 * sm(3.9, 4.3, t) }),
      group('rim', [pen(t, i, -0.2, 3, (d) => {
        d.line(ellPts(cx, cy, R + 14, R + 14, 0, 40), { close: true, w: 4 }).line(ellPts(cx, cy, 64, 64, 0, 14), { close: true, w: 2.6 }).line(ellPts(cx, cy, 26, 26, 0, 10), { close: true, w: 4 });
      }, { speed: 5000, still: true })]),
      ...poses,
      streaks.length && stroke({ sub: streaks, box: [cx - R - 60, cy - R - 60, 2 * R + 120, 2 * R + 120] }, { base: 'ink', alpha: locked ? 0.16 : 0.25 }, { w: 2, wobble: 0, name: 'streaks' }),
      pen(t, i, 3.4, 9, (d) => d.line([[cx - 120, cy + R + 26], [cx - 120, cy + R - 190], [cx + 120, cy + R - 190], [cx + 120, cy + R + 26]], { close: true, w: 3.4, smooth: false, role: 'gold' }), { still: true }),
      pen(t, i, 0.2, 21, (d) => d.text('1879. he paints the 12 poses', 60, 70, { size: 50 })),
      pen(t, i, 1.2, 22, (d) => d.text('on a glass disc. and spins it.', 60, 1040, { size: 50 })),
      t > 3.9 && t < 5.6 && pen(t, i, 3.9, 23, (d) => d.text('the horse runs again.', cx, cy - 105, { size: 48, align: 'center' })),
    ]),
  ];
}, { look: NIGHT });

const parade = shot('parade', 7.0, ({ t, i }) => {
  const GY = 800, off = t * 620, ex = 1500 - (t - 0.6) * 300, kx = 1500 - (t - 1.6) * 120, px = 250 + t * 38, FAR = GY - 150;
  const kp = ((i % 12) + 12) % 12, hopY = -70 * Math.max(0, Math.sin((kp - 3.5) / 7 * Math.PI));
  return [
    ...backdrop(), meta('anchor', { name: 'traced:horse' }), meta('intent', 'crop'),
    view({ zoom: 1.04, x: CX + 20 * Math.sin(t * 0.7) }, [
      pen(t, i, -9, 2, (d) => {
        for (let k = 0; k < 4; k++) { const x = ((k * 520 - off * 0.25) % 2080 + 2080) % 2080 - 500; d.line([[x, GY - 60], [x + 170, GY - 190], [x + 330, GY - 110], [x + 470, GY - 170], [x + 640, GY - 60]], { w: 2.6, role: 'shade' }); }
      }, { still: true }),
      pen(t, i, -9, 1, (d) => { groundLine(d, GY); tufts(d, GY, off, 10, 1600); }, { still: true }),
      pen(t, i, -9, 4, (d) => d.line([[-400, FAR + 2], [300, FAR - 3], [800, FAR + 3], [W + 400, FAR]], { w: 2.4, role: 'shade' }), { still: true }),
      traced('pigeons', i, { x: px, y: 300 + Math.sin(t * 2) * 14, h: 170, wash: 'fills.1', seed: 31 }),
      traced('pigeons', i + 5, { x: px + 520, y: 250 + Math.cos(t * 2.3) * 12, h: 120, wash: 'fills.1', seed: 33, name: 'traced:pigeons2' }),
      traced('elephant', Math.floor(i / 2), { x: ex, y: FAR, h: 380, wash: 'fills.1', washAl: 0.45, seed: 41 + boil(i, 2) }),
      traced('kangaroo', i, { x: kx, y: GY + hopY, h: 300, wash: 'fills.2', seed: 51 }),
      traced('horse', i, { x: 330, y: GY, h: 380, wash: SEPIA, seed: 5 }),
      speedLines(100, GY - 200, 0, 5 + i, { n: 7, alpha: 0.55 }),
      pen(t, i, 0.3, 21, (d) => d.text('then everything began to move.', 60, 120, { size: 68 })),
      t > 4.2 && pen(t, i, 4.2, 22, (d) => d.text('real motion, from his 1893 drawings. every stroke redrawn by code.', 60, 1000, { size: 40 })),
    ]),
  ];
});

const end = shot('end', 4.0, ({ t, i }) => {
  const GY = 850;
  return [
    ...backdrop(), meta('anchor', { name: 'traced:horse' }),
    view({ zoom: 1.02 }, [
      pen(t, i, -9, 1, (d) => { groundLine(d, GY); tufts(d, GY, t * 500, 8, 1500); }, { still: true }),
      traced('horse', i, { x: 790, y: GY, h: 300, wash: SEPIA, seed: 5 }),
      traced('pigeons', i + 3, { x: 560, y: 250, h: 120, wash: 'fills.1', seed: 31 }),
      signOff('found motion', 'after muybridge, 1878', { x: 400, y: 330, size: 88, pA: sm(0.3, 1.0, t, lin), pB: sm(1.1, 2.0, t, lin) }),
    ]),
  ];
});

// ---------- score (v1, hooves and a music box on G) ----------
const score = () => {
  const ev = [], hz = (o, s) => pentHz(o, s, 196);
  const box = (t, f, g = 0.18, d = 0.9) => ev.push(note(t, f, d, 'sine', g), note(t, f * 2, d * 0.5, 'triangle', g * 0.2));
  const hoof = (t, g = 0.2) => ev.push(burst(t, 0.05, g, 3), note(t, 70, 0.09, 'sine', g * 1.4));
  const stride = (t, g) => { hoof(t, g); hoof(t + 0.11, g * 0.8); hoof(t + 0.24, g); };
  for (let t = 0; t < 3.4; t += 1) stride(t + 0.05, 0.22);
  [[0.3, 1, 0], [1.4, 1, 2], [2.2, 1, 4], [2.9, 2, 0]].forEach(([t, o, s]) => box(t, hz(o, s)));
  [[3.6, 1, 3], [4.7, 1, 1], [5.4, 0, 4]].forEach(([t, o, s]) => box(t, hz(o, s), 0.17, 1.4));
  [[6.2, 1, 0], [6.9, 1, 2]].forEach(([t, o, s]) => box(t, hz(o, s)));
  for (let k = 0; k < 12; k++) { const t = 6 + 1.7 + (k + 1) / 6; ev.push(burst(t, 0.03, 0.3, k + 2)); box(t, hz(1 + Math.floor(k / 5), k % 5), 0.15, 0.5); }
  for (let t = 7.6; t < 10.4; t += 1) stride(t, 0.16);
  box(10.7, hz(1, 0), 0.2, 2);
  [[12.5, 0, 0], [12.5, 1, 2]].forEach(([t, o, s]) => box(t, hz(o, s), 0.16, 2.5));
  [[14.6, 1, 0], [14.6, 1, 2], [14.6, 2, 0], [14.6, 1, 4]].forEach(([t, o, s]) => box(t, hz(o, s), 0.2, 2.6));
  for (let n = 1; n <= 62; n++) { const t = 17 + (16 + n) / 12, g = Math.min(0.22, 0.04 + n * 0.006); if (t < 23.4) ev.push(burst(t, 0.02, g, n % 5 + 1)); }
  [[17.2, 0, 0], [18.2, 0, 2], [19.2, 0, 4]].forEach(([t, o, s]) => box(t, hz(o, s), 0.16, 1.4));
  for (let k = 0; k < 16; k++) box(20.9 + k * 0.125, hz(1 + Math.floor((k % 10) / 5), k % 5), 0.12, 0.5);
  for (let k = 0; k < 14; k++) { const t = 23.5 + k * 0.5; stride(t, 0.15); ev.push(note(t, hz(-1, [0, 0, 3, 4][k % 4]), 0.4, 'saw', 0.06)); }
  [0, 2, 4, 2, 3, 4, 2, 0, 1, 2, 4, 3, 2, 0].forEach((s, k) => box(23.5 + k * 0.5, hz(1 + (k > 8 ? 1 : 0), s), 0.16, 0.7));
  [[30.5, 0, 0], [30.5, 1, 0], [30.5, 1, 2], [30.5, 1, 4], [32.0, 2, 0], [32.5, 2, 2], [33.0, 2, 4]].forEach(([t, o, s]) => box(t, hz(o, s), 0.17, 2.4));
  for (let t = 30.6; t < 33; t += 1) stride(t, 0.1);
  return { master: 0.5, events: ev };
};

export default film({
  name: 'gallop', look: BASE, score,
  timeline: seq(question, guess, cameras, answer, disc, parade, end),
  assets: IDS,
});
