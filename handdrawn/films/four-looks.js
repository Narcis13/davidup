// FOUR LOOKS. One subject, a paper boat, through the four flat looks of the reference films and the
// devices each is known for. Port of v1 examples/four-looks.html, built from recipes:
//   riso      seed dot, crayon ripples, iris (N), a 4-cards-per-second montage of printed plates (O),
//             the badge gallery (P)
//   screen    flat shapes under a dot screen, day and night, the boat constant (U)
//   pencil    torn sections, a wall of squiggle text, pressed plants, a thread, a dark section (W)
//   ink       the fruit-fly look: hatched ground, construction lines, scribble (A)
//   sign-off  hand lettering in two inks with two dots (S)
// Beat sheet
// t      dur   shot      look            what happens
// 0.0    2.0   intro     root (risoPop)  dot, a ring every 4 drawn frames, iris opens on card 1 at 1.3
// 2.0    2.0   montage   root            8 cards, 0.25 s each, the dot stays
// 4.0    1.5   gallery   root            cards as badges on rings, then everything shrinks to the dot
// 5.5    2.5   sea       screenSea       boat on a lake by day, cut to night at 1.5
// 8.0    2.5   page      pencilMinimal   text wall, sticky note, pink section rises, plants, dark section
// 10.5   1.5   ink       paperInk        boat on a hatched peach with guides and scribble, push-in
// 12.0   2.5   signoff   root            letters over 1 s, two dots, hold (v1: 1.5 s; lint wants 1.5 s of hold)
// The riso shots take the film's root look, so `--look` restyles them; the other three are their looks.
import {
  film, seq, fill, stroke, circle, rect, poly, ellipse, cubic, knockout, linear, radial, rng, pulse,
  speedLines, withLook, plucks, cueNotes, dyad, sparse,
} from '../core/index.js';
import {
  ellipseRot, risoCard, seedRipples, montage, badgeGallery, landscapeDayNight, tornPage, establishing, signOffShot, boat,
} from '../recipes/shots.js';

const W = 1080, H = 1080;

// ---------- riso cards: three plates (inks 0, 1, 2), coverage as shapes; later shapes cover earlier ones ----------
const c = (path, cov) => fill(path, 'ink', { cov });
const band = (path, w, cov) => stroke(path, 'ink', { w, cov });
const arcTop = (x, y, r) => ({ sub: [{ pts: Array.from({ length: 65 }, (_, j) => { const a = Math.PI + j / 64 * Math.PI; return [x + r * Math.cos(a), y + r * Math.sin(a)]; }).flat(), closed: false }], box: [x - r, y - r, 2 * r, r] });
const ridge = (y, a, w) => { const pts = [0, 1080, 0, y]; for (let x = 0; x <= 1080; x += 20) pts.push(x, y - Math.abs(Math.sin(x / w) * a) - Math.sin(x / 37) * 12); pts.push(1080, 1080); return poly(pts); };
const wavePath = poly([
  0, 1080,
  ...cubic([0, 500], [300, 380], [700, 120], [860, 260], 24).sub[0].pts,
  ...cubic([860, 260], [900, 330], [760, 400], [700, 380], 12).sub[0].pts,
  ...cubic([700, 380], [820, 480], [1080, 560], [1080, 700], 24).sub[0].pts,
  1080, 1080,
]);

const CARDS = [
  // sun over the sea
  () => risoCard([
    [c(rect(0, 0, W, 600), linear(0, 0, 0, 600, 0.02, 0.35)), knockout(circle(540, 430, 150)), c(rect(0, 600, W, 480), 0.85)],
    [c(rect(0, 0, W, 600), radial(540, 430, 60, 520, 0.9, 0))],
    [c(circle(540, 430, 150), 0.95), c(rect(0, 600, W, 480), 0.4)],
  ]),
  // lighthouse
  () => risoCard([
    [c(rect(0, 0, W, 700), 0.15), knockout(rect(460, 240, 160, 470)), c(rect(0, 700, W, 380), 0.8), ...[0, 2, 4].map((i) => c(rect(470, 250 + i * 90, 140, 90), 0.9))],
    [c(rect(0, 0, W, 700), linear(0, 0, 0, 700, 0.55, 0)), knockout(rect(460, 240, 160, 470)), ...[1, 3].map((i) => c(rect(470, 250 + i * 90, 140, 90), 0.9))],
    [c(poly([540, 200, 1080, 40, 1080, 330]), 0.9), c(poly([540, 200, 0, 60, 0, 320]), 0.9), c(rect(500, 180, 80, 70), 0.9)],
  ]),
  // big moon
  () => risoCard([
    [c(rect(0, 0, W, H), 0.9), knockout(circle(540, 420, 300))],
    [c(rect(0, 0, W, H), radial(540, 420, 300, 520, 0.6, 0))],
    [c(circle(540, 420, 300), 0.7), ...[[470, 350, 40], [600, 480, 60], [520, 560, 25]].map(([x, y, r]) => c(circle(x, y, r), 0.3))],
  ]),
  // the wave
  () => risoCard([
    [c(wavePath, 0.9), ...Array.from({ length: 12 }, (_, i) => knockout(circle(700 + i * 28, 300 + Math.sin(i) * 30, 14 + (i % 3) * 5)))],
    [c(rect(0, 0, W, 700), linear(0, 0, 0, 700, 0.8, 0))],
    [c(rect(0, 0, W, 500), radial(200, 160, 40, 300, 0.9, 0))],
  ]),
  // city lights
  () => {
    const r0 = rng(5), r2 = rng(5), wins = [];
    for (let b = 0; b < 9; b++) for (let y = 400; y < 1000; y += 46) for (let x = 0; x < 3; x++) if (r2() < 0.55) wins.push(c(rect(b * 120 + 14 + x * 32, y, 20, 26), 0.95));
    return risoCard([
      [c(rect(0, 0, W, H), 0.85), ...Array.from({ length: 9 }, (_, b) => c(rect(b * 120, 360 + (r0() * 300 | 0), 110, 800), 0.98))],
      [c(rect(600, 0, 480, 400), radial(900, 160, 60, 300, 0.6, 0))],
      [...wins, c(circle(900, 160, 60), 0.95)],
    ]);
  },
  // mountains at dusk
  () => risoCard([
    [c(ridge(620, 220, 260), 0.45), c(ridge(780, 160, 170), 0.9)],
    [c(rect(0, 0, W, 700), linear(0, 0, 0, 700, 0.1, 0.75)), knockout(ridge(620, 220, 260))],
    [c(circle(760, 420, 90), 0.95), c(rect(0, 300, W, 400), linear(0, 300, 0, 700, 0, 0.7))],
  ]),
  // rain and a rainbow
  () => {
    const r = rng(9), rain = [];
    for (let i = 0; i < 160; i++) { const x = r() * W, y = r() * 700; rain.push(band(poly([x, y, x - 12, y + 60], false), 3, 0.7)); }
    return risoCard([
      [c(rect(0, 700, W, 380), 0.8), ...rain, band(arcTop(540, 760, 330), 26, 0.9)],
      [band(arcTop(540, 760, 385), 26, 0.9)],
      [band(arcTop(540, 760, 358), 26, 0.9), c(rect(0, 0, W, 600), linear(0, 0, 0, 600, 0.3, 0))],
    ]);
  },
  // a ringed planet
  () => {
    const r = rng(11), ring = (w, cov) => band(ellipseRot(560, 520, 420, 110, -0.35, 96), w, cov);
    return risoCard([
      [c(rect(0, 0, W, H), 0.92), knockout(circle(560, 520, 220)), ...Array.from({ length: 90 }, () => knockout(circle(r() * W, r() * H, 2 + r() * 3, 8))), ring(22, 0)],
      [c(circle(560, 520, 220), radial(480, 440, 40, 280, 0.95, 0.3)), ring(18, 0.8)],
      [c(ellipse(560, 520, 220, 60), 0.6)],
    ]);
  },
];

// ---------- shots ----------
const intro = seedRipples({ name: 'intro', dur: 2, iris: { card: CARDS[0], from: 1.3, to: 2.0 } });
const cards = montage({ name: 'montage', cards: CARDS, per: 0.25 });
const gallery = badgeGallery({ name: 'gallery', cards: CARDS });
const sea = landscapeDayNight({ name: 'sea', look: 'screenSea', nightAt: 1.5 });
// The label is three words; pencilMinimal allows none by default, so this page allows three.
const page = tornPage({ name: 'page', look: withLook('pencilMinimal', { words: 3 }) });
const ink = establishing({
  name: 'ink', dur: 1.5, look: 'paperInk', push: [1.1, 1.2], at: [540, 520],
  subject: () => boat({ note: 1 }), x: 540, y: 440, rot: -0.1, scale: 1.9, construction: { y: -10, r: 110 },
  ground: { x: 560, y: 1000, r: 700, role: 'fills.0' },
  extras: (ctx) => pulse(ctx.i, 9) && speedLines(440, 470, Math.PI, 107 + ctx.i, { n: 5, alpha: 0.4 }),
});
const signoff = signOffShot({ name: 'signoff', a: 'four looks', b: 'one core', y: 500, size: 96 });

// ---------- score (v1 table: plucks, square cues for cards, dyads, sparse sines for the page) ----------
const score = ({ shots }) => {
  const at = Object.fromEntries(shots.map((s) => [s.name, s]));
  return {
    master: 0.6,
    events: [
      plucks(at.intro.t0, at.intro.dur, { every: 1 / 3, oct: 1, len: 0.3, gain: 0.15 }),
      cueNotes(Array.from({ length: 8 }, (_, k) => at.montage.t0 + k * 0.25), { type: 'square', gain: 0.07, len: 0.22 }),
      dyad(at.gallery.t0, 1.2),
      plucks(at.sea.t0, at.sea.dur, { every: 0.5, len: 0.6, gain: 0.14, seed: 3 }),
      sparse(at.page.t0, at.page.dur),
      plucks(at.ink.t0, at.ink.dur, { every: 0.5, len: 0.6, gain: 0.15, seed: 5 }),
      dyad(at.signoff.t0, 1.4),
    ],
  };
};

export { CARDS };
export default film({ name: 'four-looks', look: 'risoPop', timeline: seq(intro, cards, gallery, sea, page, ink, signoff), score });
