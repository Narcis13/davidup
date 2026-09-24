// The drawings how-ai-learns needs that no pack or store has: a cat and a dog to be the examples (sitting, front
// on, a coat input for the variety of a photo pile), a polaroid to hold them, and the small things around them.
// Every cel stands on y = 0 or is centred on its origin, and draws only roles.
import { cel, place, group, fill, stroke, clip, circle, ellipse, rect, roundRect, poly, line, spline, rng, handText, reveal } from '../../core/index.js';
import { splinePts } from '../../core/spline.js';

const TAU = Math.PI * 2;

// ---------- shape helpers ----------

// A closed smooth outline through the points (Catmull-Rom).
export const smooth = (pts, n = 6) => spline(pts, { closed: true, tension: 0, n });
// An open smooth line through the points.
export const curve = (pts, n = 6) => spline(pts, { tension: 0, n });
const mx = (pts) => pts.map(([x, y]) => [-x, y]);
// A left-right symmetric outline from its right half, listed from the top of the middle down to the bottom of it.
export const sym = (half, n = 6) => smooth([...half, ...mx(half.slice(1, -1)).reverse()], n);
// A tube round a smooth centre line, w0 wide at its start and w1 at its end, with a round tip at the end.
export function tube(centre, w0, w1, { n = 8, tip = true } = {}) {
  const f = splinePts(centre, { tension: 0, n }), P = [];
  for (let i = 0; i < f.length; i += 2) P.push([f[i], f[i + 1]]);
  const L = [], R = [], m = P.length;
  for (let i = 0; i < m; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(m - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
    const w = (w0 + (w1 - w0) * (i / (m - 1))) / 2, nx = -dy / d, ny = dx / d;
    L.push([P[i][0] + nx * w, P[i][1] + ny * w]); R.push([P[i][0] - nx * w, P[i][1] - ny * w]);
  }
  const end = P[m - 1], prev = P[m - 2], ang = Math.atan2(end[1] - prev[1], end[0] - prev[0]), cap = [];
  if (tip) for (let j = 1; j < 8; j++) { const a = ang + Math.PI / 2 - (j / 8) * Math.PI; cap.push([end[0] + Math.cos(a) * w1 / 2, end[1] + Math.sin(a) * w1 / 2]); }
  return poly([...L, ...cap, ...R.reverse()], true);
}
const lines = (segs) => ({ sub: segs.map((s) => ({ pts: s.flat(), closed: false })), box: boxOf(segs.flat()) });
function boxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1 - x0, y1 - y0];
}
const ink = (path, o = {}) => stroke(path, 'ink', { w: 3, wobble: 0.7, ...o });

// ---------- the cat ----------

// Coats: the body, its stripes (null for none), the bib and the eyes.
const CAT_COATS = [
  { name: 'ginger', body: 'fills.4', stripe: { base: 'fills.4', shade: 0.38 }, bib: 'light', eye: 'ink' },
  { name: 'grey', body: { base: 'shade', tint: 0.55 }, stripe: { base: 'shade', shade: 0.1 }, bib: 'light', eye: 'ink' },
  { name: 'black', body: { base: 'ink', tint: 0.12 }, stripe: null, bib: null, eye: 'fills.0' },
  { name: 'white', body: 'light', stripe: null, bib: null, eye: 'ink', patch: 'fills.4' },
  { name: 'hairless', body: { base: 'fills.2', tint: 0.45 }, stripe: null, bib: null, eye: 'ink', wrinkles: true },
];
const CAT = {
  body: sym([[0, -126], [30, -122], [46, -104], [56, -76], [68, -40], [70, -14], [58, 0], [0, 0]]),
  bib: sym([[0, -124], [20, -120], [28, -100], [22, -76], [0, -64]]),
  head: sym([[0, -206], [30, -204], [52, -190], [63, -166], [60, -144], [46, -128], [22, -120], [0, -118]]),
  earL: poly([[-58, -176], [-50, -238], [-14, -202]], true), earR: poly([[58, -176], [50, -238], [14, -202]], true),
  innerL: poly([[-50, -186], [-47, -224], [-24, -202]], true), innerR: poly([[50, -186], [47, -224], [24, -202]], true),
  tail: tube([[46, -18], [92, -26], [112, -66], [104, -112], [84, -128]], 24, 16),
};
// A cat sitting, front on, feet on y = 0: coat 0 ginger tabby, 1 grey tabby, 2 black, 3 white with ginger
// patches; look -1..1 turns the head a little; blink closes the eyes (a happy squint).
export const cat = cel('cat', ({ coat = 0, look = 0, blink = 0, tail = 1 }) => {
  const C = CAT_COATS[coat] ?? CAT_COATS[0], hx = look * 6, turn = look * 0.08;
  const face = [
    // eyes: dots with a highlight, or a squint
    ...[-1, 1].map((s) => (blink
      ? ink(curve([[s * 24 - 10 + hx, -164], [s * 24 + hx, -171], [s * 24 + 10 + hx, -164]]), { w: 3.4, name: 'squint' })
      : group('eye', [
        fill(ellipse(s * 24 + hx, -164, 8.5, 11, 24), C.eye, { name: 'iris' }),
        C.eye !== 'ink' && fill(ellipse(s * 24 + hx, -164, 2.6, 9, 16), 'ink', { name: 'slit' }),
        fill(circle(s * 24 - 3 + hx, -168, 3, 12), 'light', { name: 'glint' }),
      ]))),
    fill(poly([[-7 + hx, -148], [7 + hx, -148], [hx, -140]], true), 'fills.2', { name: 'nose' }),
    ink(curve([[-11 + hx, -133], [-5 + hx, -130], [hx, -136], [5 + hx, -130], [11 + hx, -133]], 3), { w: 2.4, name: 'mouth' }),
    ink(lines([[[hx, -140], [hx, -136]]]), { w: 2.4, name: 'philtrum' }),
    stroke(lines([
      [[-32 + hx, -146], [-86 + hx, -158]], [[-33 + hx, -140], [-90 + hx, -141]], [[-32 + hx, -134], [-84 + hx, -122]],
      [[32 + hx, -146], [86 + hx, -158]], [[33 + hx, -140], [90 + hx, -141]], [[32 + hx, -134], [84 + hx, -122]],
    ]), coat === 2 ? 'light' : 'ink', { w: 1.8, wobble: 0.5, name: 'whiskers' }),
  ];
  const stripes = C.stripe && stroke(lines([
    [[0, -202], [0, -188]], [[-13, -200], [-11, -188]], [[13, -200], [11, -188]],
    [[-62, -164], [-48, -161]], [[-61, -154], [-49, -152]], [[62, -164], [48, -161]], [[61, -154], [49, -152]],
    [[-54, -82], [-40, -78]], [[-63, -56], [-48, -52]], [[54, -82], [40, -78]], [[63, -56], [48, -52]],
  ]), C.stripe, { w: 5, wobble: 0.8, name: 'stripes' });
  const tailRings = C.stripe && stroke(lines([[[96, -44], [114, -52]], [[100, -84], [118, -80]]]), C.stripe, { w: 5, wobble: 0.6, name: 'tailRings' });
  return [
    fill(ellipse(0, 2, 84, 10, 32), 'shade', { alpha: 0.18, name: 'shadow' }),
    ...(tail ? [fill(CAT.tail, 'paper', { name: 'under' }), fill(CAT.tail, C.body, { finish: true, name: 'tail' }), tailRings, ink(CAT.tail, { name: 'tailLine' })] : []),
    fill(CAT.body, 'paper', { name: 'under' }), fill(CAT.body, C.body, { finish: true, name: 'body' }),
    C.patch && fill(sym([[0, -100], [26, -98], [40, -78], [30, -60], [0, -56]]), C.patch, { finish: true, name: 'patch' }),
    C.bib && fill(CAT.bib, C.bib, { name: 'bib' }),
    stripes,
    ink(lines([[[0, -72], [0, -8]], [[-30, -64], [-33, -8]], [[30, -64], [33, -8]]]), { w: 2.6, name: 'legs' }),
    ...[-1, 1].map((s) => group('paw', [fill(ellipse(s * 17, -6, 16, 9, 20), C.body, { name: 'pawFill' }), ink(ellipse(s * 17, -6, 16, 9, 20), { w: 2.6 })])),
    ink(CAT.body, { name: 'bodyLine' }),
    place(0, -118, { rot: turn }, group('headGroup', [place(0, 118, [
      fill(CAT.earL, C.patch ?? C.body, { finish: true, name: 'earL' }), fill(CAT.earR, C.body, { finish: true, name: 'earR' }),
      fill(CAT.innerL, 'fills.2', { alpha: 0.8, name: 'inner' }), fill(CAT.innerR, 'fills.2', { alpha: 0.8, name: 'inner' }),
      ink(CAT.earL), ink(CAT.earR),
      fill(CAT.head, 'paper', { name: 'under' }), fill(CAT.head, C.body, { finish: true, name: 'head' }),
      C.patch && fill(ellipse(-26 + hx, -170, 24, 20, 24), C.patch, { finish: true, name: 'eyePatch' }),
      stripes && C.stripe && stroke(lines([[[0, -202], [0, -188]], [[-13, -200], [-11, -188]], [[13, -200], [11, -188]], [[-62, -164], [-48, -161]], [[62, -164], [48, -161]]]), C.stripe, { w: 5, wobble: 0.8, name: 'headStripes' }),
      C.wrinkles && stroke(lines([[[-16, -196], [16, -196]], [[-12, -189], [12, -189]]]), { base: 'fills.2', shade: 0.35 }, { w: 2.4, wobble: 0.8, name: 'wrinkles' }),
      ink(CAT.head, { name: 'headLine' }),
      ...face,
    ])])),
  ];
}, { box: [-106, -248, 236, 262], inputs: { coat: [0, 4, 1], look: [-1, 1, 1], blink: [0, 1, 1], tail: [0, 1, 1] }, desc: 'a cat sitting front on, feet on y = 0: coat 0 ginger tabby, 1 grey tabby, 2 black, 3 white with ginger patches, 4 hairless; look turns the head; blink squints; tail 0 for none' });

// ---------- the dog ----------

const DOG_COATS = [
  { name: 'golden', body: 'fills.0', ear: { base: 'fills.4', shade: 0.1 }, muzzle: 'light', patch: null },
  { name: 'brown', body: { base: 'fills.4', shade: 0.3 }, ear: { base: 'fills.4', shade: 0.55 }, muzzle: { base: 'fills.4', tint: 0.45 }, patch: null },
  { name: 'spotty', body: 'light', ear: { base: 'ink', tint: 0.15 }, muzzle: 'light', patch: { base: 'ink', tint: 0.15 } },
  { name: 'grey', body: { base: 'shade', tint: 0.45 }, ear: { base: 'shade', shade: 0.05 }, muzzle: 'light', patch: null },
];
const DOG = {
  body: sym([[0, -120], [34, -118], [54, -98], [64, -66], [74, -30], [72, -8], [56, 0], [0, 0]]),
  chest: sym([[0, -120], [24, -114], [32, -90], [24, -66], [0, -58]]),
  head: sym([[0, -214], [34, -210], [56, -192], [62, -164], [56, -138], [38, -122], [0, -116]]),
  muzzle: sym([[0, -168], [22, -166], [34, -150], [30, -132], [14, -124], [0, -122]]),
  floppyL: smooth([[-40, -204], [-66, -198], [-80, -170], [-78, -136], [-64, -122], [-52, -140], [-48, -176]]),
  floppyR: smooth([[40, -204], [66, -198], [80, -170], [78, -136], [64, -122], [52, -140], [48, -176]]),
  upL: smooth([[-54, -186], [-66, -214], [-60, -246], [-42, -226], [-26, -206]]),
  upR: smooth([[54, -186], [66, -214], [60, -246], [42, -226], [26, -206]]),
  tail: tube([[56, -16], [88, -30], [108, -56], [116, -84]], 18, 12),
};
// A dog sitting, front on, feet on y = 0: coat 0 golden, 1 brown, 2 white with black spots, 3 grey; ears 0
// floppy, 1 up; wag -1..1 swings the tail; tongue out.
export const dog = cel('dog', ({ coat = 0, ears = 0, wag = 0 }) => {
  const C = DOG_COATS[coat] ?? DOG_COATS[0], [eL, eR] = ears ? [DOG.upL, DOG.upR] : [DOG.floppyL, DOG.floppyR];
  const earsOps = [fill(eL, 'paper'), fill(eR, 'paper'), fill(eL, C.ear, { finish: true, name: 'earL' }), fill(eR, C.ear, { finish: true, name: 'earR' }), ink(eL), ink(eR)];
  return [
    fill(ellipse(0, 2, 88, 10, 32), 'shade', { alpha: 0.18, name: 'shadow' }),
    place(56, -16, { rot: wag * 0.35 }, group('tail', [place(-56, 16, [fill(DOG.tail, 'paper'), fill(DOG.tail, C.body, { finish: true }), ink(DOG.tail)])])),
    fill(DOG.body, 'paper', { name: 'under' }), fill(DOG.body, C.body, { finish: true, name: 'body' }),
    C.patch && fill(ellipse(40, -62, 20, 16, 24), C.patch, { finish: true, name: 'spot' }),
    C.patch && fill(ellipse(-46, -40, 12, 10, 20), C.patch, { finish: true, name: 'spot' }),
    fill(DOG.chest, C.muzzle, { name: 'chest' }),
    ink(lines([[[0, -66], [0, -8]], [[-32, -60], [-34, -8]], [[32, -60], [34, -8]]]), { w: 2.6, name: 'legs' }),
    ...[-1, 1].map((s) => group('paw', [fill(ellipse(s * 18, -6, 18, 10, 20), C.body, { name: 'pawFill' }), ink(ellipse(s * 18, -6, 18, 10, 20), { w: 2.6 })])),
    ink(DOG.body, { name: 'bodyLine' }),
    ears ? earsOps : null,
    fill(DOG.head, 'paper', { name: 'under' }), fill(DOG.head, C.body, { finish: true, name: 'head' }),
    C.patch && fill(ellipse(24, -178, 20, 18, 24), C.patch, { finish: true, name: 'eyePatch' }),
    ink(DOG.head, { name: 'headLine' }),
    ears ? null : earsOps,
    fill(DOG.muzzle, C.muzzle, { name: 'muzzle' }),
    ink(DOG.muzzle, { w: 2.4, name: 'muzzleLine' }),
    // tongue, mouth, nose
    fill(sym([[0, -134], [8, -133], [11, -120], [7, -110], [0, -108]]), 'fills.2', { name: 'tongue' }),
    ink(sym([[0, -134], [8, -133], [11, -120], [7, -110], [0, -108]]), { w: 2.2, name: 'tongueLine' }),
    ink(curve([[-20, -140], [-10, -134], [0, -140], [10, -134], [20, -140]], 4), { w: 2.6, name: 'mouth' }),
    ink(lines([[[0, -152], [0, -140]]]), { w: 2.4 }),
    fill(sym([[0, -164], [11, -163], [13, -156], [6, -150], [0, -149]]), 'ink', { name: 'nose' }),
    fill(circle(-4, -160, 2.4, 10), 'light', { name: 'noseGlint' }),
    ...[-1, 1].map((s) => group('eye', [
      fill(circle(s * 24, -178, 8, 20), 'ink', { name: 'iris' }),
      fill(circle(s * 24 - 3, -181, 2.8, 10), 'light', { name: 'glint' }),
      ink(curve([[s * 24 - 10, -196], [s * 24, -199], [s * 24 + 8, -196]], 3), { w: 2.4, name: 'brow' }),
    ])),
  ];
}, { box: [-92, -252, 222, 264], inputs: { coat: [0, 3, 1], ears: [0, 1, 1], wag: [-1, 1, 0.5] }, desc: 'a dog sitting front on, feet on y = 0: coat 0 golden, 1 brown, 2 spotty, 3 grey; ears floppy or up; wag swings the tail' });

// ---------- a polaroid ----------

// A photo print centred at (x, y), s its scale (1: 220 wide), turned rot: a white card with a deeper bottom
// border, a tinted photo, the picture in it (kids drawn in the photo's own units: 190 x 190 about (0, 0),
// clipped), a soft shadow; `label` lettered on the bottom border, `labelP` how much of it is written.
export function polaroid(x, y, { s = 1, rot = 0, bg = 'fills.1', kids = [], label = null, labelP = 1, labelRole = 'ink', labelSize = 44, seed = 1, lift = 0, name = 'photo' } = {}) {
  const W = 220, H = 262, PH = 190, top = -H / 2, card = roundRect(-W / 2, top, W, H, 6);
  const photo = rect(-PH / 2, top + 15, PH, PH), cy = top + 15 + PH / 2;
  const q = rng(seed);
  return place(x, y, { rot, scale: s }, group({ name, cache: 'never' }, [
    fill(roundRect(-W / 2 + 7 + lift * 6, top + 10 + lift * 10, W, H, 8), 'ink', { alpha: 0.12 + lift * 0.04, name: 'shadow' }),
    fill(card, 'light', { name: 'card' }),
    stroke(card, { base: 'ink', alpha: 0.35 }, { w: 1.4, wobble: 0.3, seed, name: 'edge' }),
    fill(photo, { base: bg, tint: 0.35 }, { name: 'sky' }),
    clip(photo, [place(0, cy, [kids].flat().filter(Boolean))]),
    stroke(photo, { base: 'ink', alpha: 0.5 }, { w: 1.4, wobble: 0.3, seed: seed + 1, name: 'frame' }),
    label && labelP > 0 && reveal(Math.min(1, labelP), handText(label, (q() - 0.5) * 8, top + 15 + PH + 45, { size: labelSize, align: 'center', role: labelRole, ink2: null, seed: seed + 2 })),
  ]));
}
