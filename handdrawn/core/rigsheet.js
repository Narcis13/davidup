// The rig sheet (4.0 W1): a child draws a character inside labelled boxes, one box a piece (head, body, upper arm,
// forearm, hand, thigh, shin, foot, one side), the sheet is photographed, and the drawing becomes a puppet with the
// standard biped part names, so it walks, points and cheers from the vocabulary (core/actor.js) with no rigging.
// Pure, like core/handsheet.js, whose frame it shares: the same corner marks, the same homography, the same
// sampling; the sheet is told by its code squares (index 4 and up; a hand page is 0 to 2).
//
// Every box is a window onto one figure (RIG.joints, side view facing right, the ground at y = 0, up negative, in
// mm on the page): its printed pivot dot is the joint the piece is pinned at, and its rings are where the pieces
// below it are pinned, so the pieces meet when they are put together. Arms and legs hang straight down from the
// dot at rest, the foot points forward, the head sits on the neck; the vocabulary's angles are turns from there.
// The whole sheet is one scale: K puppet units a mm, the figure RIG.units tall.
//
// Reading a box (readRigSheet, readBox): the photo sampled over the box at PPM pixels a mm, each pixel against the
// box's own paper (its 90th percentile, per channel). Ink (dark and grey: a pen, a black marker) thicker than BLOB
// mm is a blob, small and round a dot, the rest thinned to strokes (core/skeleton.js, as a hand sheet's glyphs
// are). Colour (crayon, felt tip, a coloured pencil) is closed over together with the ink round it, so a coloured-in
// area becomes one `fill` op with finish: true that reaches under its outline, crayon over the line included; a
// thin run of colour is a line of its own. The printed dot and rings are left out of the colour, and the faint
// guides print lighter than SOFT. Colours are clustered over the whole sheet; the colour most of the lines are
// drawn in is `ink`, and the rest get roles by core/svg.js autoRoles (the nearest house fill or accent), so a look
// recolours the drawing like any other.
//
// The puppet (rigPuppet): parts in painter order far arm, far leg, near leg, hips, body, head, near arm; `-l` is
// the far side in profile and the drawing's left in the front view, both sides drawn from the one box. `hips`
// is the root (it draws nothing) so the body leans over the legs as the vocabulary's bow asks. A front sheet
// (biped-front: head, body and foot face on) adds the view `front`: the limbs hang from the shoulders and hips
// its body box marks, the -l ones mirrored. The payload carries `skeleton` (the side view's joints and bones in
// the stick's names, core/stick.js), so `hdf retarget` derives a map for it as it does for a stick.
import { components, distanceTransform, simplify, traceSkeleton } from './skeleton.js';
import { FRAME, PAPERS, drawMarks, frameMap, frameOrigin, readCode, sample, skeletonOf } from './handsheet.js';
import { VOCABULARY } from './actor.js';
import { bounds, circle, ellipse, fill, mkPath, poly, serialise, stroke } from './list.js';
import { VIEW_DIRS, puppet } from './puppet.js';
import { LOOKS, hsl, parse, resolveRole } from './looks.js';
import { autoRoles, distance } from './svg.js';
import { traceAlpha } from './trace.js';

export const PPM = 6;                          // pixels per mm when reading
export const INK = 0.45, INK_C = 0.22, SOFT = 0.78, CHROMA = 0.16;   // of the paper: ink (dark, grey); any mark; a colour
export const BLOB = 2.6;                       // mm: a mark this thick is filled, not a line
export const MARGIN = 1.2;                     // mm of a box's inside left out, so its border never reads
export const PAPER_IN = 0.005;                 // of a drawing's area: paper closed in by its lines kept as a fill

// The figure, side view, in mm: the ground at 0, up negative, facing right. units: its height in the puppet.
export const RIG = Object.freeze({
  units: 300, height: 180,
  joints: Object.freeze({
    hip: [0, -74], chest: [0, -120], neck: [0, -126], head: [2, -154],
    shoulder: [0, -120], elbow: [0, -93], wrist: [0, -67], knee: [0, -40], ankle: [0, -7], toe: [20, -2],
  }),
  headR: 26,
  // The front view: how far each chain hangs from the middle (the shoulders' from the chest, the hips' from the hip).
  spread: Object.freeze({ shoulder: 20, hip: 9 }),
});
export const K = RIG.units / RIG.height;       // puppet units a mm

const J = RIG.joints;
const rel = (a, b) => [J[b][0] - J[a][0], J[b][1] - J[a][1]];   // joint b from joint a, mm

// The pieces: the part each names (both sides for a limb), the joint it is pinned at, its box about that joint
// ([x0, y0, x1, y1] mm), the rings it carries (joints pinned to it, mm from its pivot), its label and its guide.
const capsule = (len, r) => ({ kind: 'capsule', len, r });
export const PIECES = Object.freeze({
  biped: Object.freeze([
    { piece: 'head', parts: ['head'], pivot: 'neck', box: [-32, -62, 36, 10], label: 'head', guide: { kind: 'circle', c: rel('neck', 'head'), r: RIG.headR } },
    { piece: 'body', parts: ['body'], pivot: 'hip', box: [-30, -62, 30, 14], label: 'body', rings: { neck: rel('hip', 'neck'), shoulder: rel('hip', 'shoulder') }, guide: { kind: 'torso', top: rel('hip', 'neck')[1] + 3, w: 15 } },
    { piece: 'arm', parts: ['arm-l', 'arm-r'], pivot: 'shoulder', box: [-16, -8, 16, 38], label: 'upper arm', rings: { elbow: rel('shoulder', 'elbow') }, guide: capsule(rel('shoulder', 'elbow')[1], 6) },
    { piece: 'fore', parts: ['fore-l', 'fore-r'], pivot: 'elbow', box: [-16, -8, 16, 38], label: 'forearm', rings: { wrist: rel('elbow', 'wrist') }, guide: capsule(rel('elbow', 'wrist')[1], 5) },
    { piece: 'hand', parts: ['hand-l', 'hand-r'], pivot: 'wrist', box: [-16, -8, 16, 28], label: 'hand', guide: { kind: 'mitt', c: [0, 9], rx: 6.5, ry: 9 } },
    { piece: 'foot', parts: ['foot-l', 'foot-r'], pivot: 'ankle', box: [-14, -8, 36, 18], label: 'foot', guide: { kind: 'shoe', toe: rel('ankle', 'toe'), ground: -J.ankle[1] } },
    { piece: 'leg', parts: ['leg-l', 'leg-r'], pivot: 'hip', box: [-17, -8, 17, 46], label: 'thigh', rings: { knee: rel('hip', 'knee') }, guide: capsule(rel('hip', 'knee')[1], 7) },
    { piece: 'shin', parts: ['shin-l', 'shin-r'], pivot: 'knee', box: [-17, -8, 17, 44], label: 'shin', rings: { ankle: rel('knee', 'ankle') }, guide: capsule(rel('knee', 'ankle')[1], 6) },
  ].map(Object.freeze)),
  'biped-front': Object.freeze([
    { piece: 'head', parts: ['head'], pivot: 'neck', box: [-34, -62, 34, 10], label: 'head, face on', guide: { kind: 'circle', c: [0, rel('neck', 'head')[1]], r: RIG.headR } },
    { piece: 'body', parts: ['body'], pivot: 'hip', box: [-38, -62, 38, 14], label: 'body, face on',
      rings: { neck: rel('hip', 'neck'), 'shoulder-l': [-RIG.spread.shoulder, rel('hip', 'shoulder')[1]], 'shoulder-r': [RIG.spread.shoulder, rel('hip', 'shoulder')[1]], 'hip-l': [-RIG.spread.hip, 0], 'hip-r': [RIG.spread.hip, 0] },
      guide: { kind: 'torso', top: rel('hip', 'neck')[1] + 3, w: 22 } },
    { piece: 'foot', parts: ['foot-l', 'foot-r'], pivot: 'ankle', box: [-18, -8, 18, 18], label: 'foot, face on', guide: { kind: 'mitt', c: [0, 4], rx: 7, ry: 4.5, ground: -J.ankle[1] } },
  ].map(Object.freeze)),
});
// The sheets: code index, the view the sheet draws, its title.
export const RIG_SHEETS = Object.freeze({
  biped: Object.freeze({ index: 4, view: 'side', title: 'rig sheet: biped, side on' }),
  'biped-front': Object.freeze({ index: 5, view: 'front', title: 'rig sheet: biped, face on' }),
});
const sheetOf = (name) => {
  const s = RIG_SHEETS[name];
  if (!s) throw new Error(`rig sheet: '${name}' (expected ${Object.keys(RIG_SHEETS).join(' | ')})`);
  return s;
};

// Where the boxes sit in the frame (mm, top left): rows of pieces, left to right.
const LAYOUT = Object.freeze({
  biped: Object.freeze({ rows: [['head', 'body'], ['arm', 'fore', 'hand', 'foot'], ['leg', 'shin']], top: 30, gap: [8, 12] }),
  'biped-front': Object.freeze({ rows: [['head', 'body'], ['foot']], top: 30, gap: [8, 12] }),
});

// The boxes of a sheet in frame mm: { piece, parts, pivot, x, y, w, h, px, py (the pivot dot), rings: { joint: [x, y] }, ... }.
export function rigBoxes(sheet = 'biped') {
  sheetOf(sheet);
  const byName = Object.fromEntries(PIECES[sheet].map((p) => [p.piece, p])), L = LAYOUT[sheet], out = [];
  let y = L.top;
  for (const row of L.rows) {
    let x = 0, tall = 0;
    for (const n of row) {
      const p = byName[n], [x0, y0, x1, y1] = p.box, w = x1 - x0, h = y1 - y0;
      out.push({ ...p, x, y, w, h, px: x - x0, py: y - y0, rings: Object.fromEntries(Object.entries(p.rings ?? {}).map(([k, [rx, ry]]) => [k, [x - x0 + rx, y - y0 + ry]])) });
      x += w + L.gap[0]; tall = Math.max(tall, h);
    }
    y += tall + L.gap[1];
  }
  return out;
}

// ---------- drawing the template ----------

const EDGE = '#bdbdbd', GUIDE = '#dadada', PIN = '#f2a07b', LABEL = '#6a6a6a';
export const DOT = 1.4, RING = 1.8;           // mm: the pivot dot's radius, a ring's

// A piece's guide silhouette as a path about its pivot (mm).
function guidePath(g) {
  if (g.kind === 'circle') return circle(g.c[0], g.c[1], g.r, 40);
  if (g.kind === 'mitt') return ellipse(g.c[0], g.c[1], g.rx, g.ry, 24);
  if (g.kind === 'capsule') {
    const pts = [];
    for (let i = 0; i <= 10; i++) { const a = Math.PI + (i / 10) * Math.PI; pts.push([g.r * Math.cos(a), g.r * Math.sin(a)]); }
    for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI; pts.push([g.r * Math.cos(a), g.len + g.r * Math.sin(a)]); }
    return poly(pts);
  }
  if (g.kind === 'torso') {
    const { top, w } = g;
    return poly([[-w * 0.7, top], [w * 0.7, top], [w, top + 8], [w * 0.9, 2], [-w * 0.9, 2], [-w, top + 8]]);
  }
  if (g.kind === 'shoe') {
    const [tx] = g.toe, gy = g.ground;
    return poly([[-5, -2], [5, -2], [6, gy - 5], [tx + 2, gy - 3], [tx + 3, gy], [-6, gy]]);
  }
  throw new Error(`rig sheet: guide '${g.kind}'`);
}

// One rig sheet, drawn with ctx in mm (the caller scales). paper: 'a4' | 'letter'.
export function drawRigTemplate(ctx, paper = 'a4', sheet = 'biped') {
  const s = sheetOf(sheet), [pw, ph] = PAPERS[paper] ?? PAPERS.a4, [ox, oy] = frameOrigin(paper);
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, pw, ph);
  ctx.translate(ox, oy);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  drawMarks(ctx, s.index);

  ctx.fillStyle = '#333';
  ctx.font = '5px sans-serif';
  ctx.fillText(s.title, 18, 7);
  ctx.fillStyle = LABEL;
  ctx.font = '2.3px sans-serif';
  ctx.fillText(`${paper === 'letter' ? 'US letter' : 'A4'}  ·  print at 100%, no scaling`, 18, 11);
  const say = s.view === 'side' ? [
    'Draw each piece of your character in its box, side on, looking right. Start at the orange dot: the piece is',
    'pinned there. Reach to the orange ring: the next piece is pinned there. Arms and legs hang straight down.',
    'Colour them in if you like. Photograph the whole sheet, flat, all four black corners and the squares in it.',
  ] : [
    'The same character looking at you: its head, its body and a foot. Start at the orange dot; the arms hang',
    'from the rings at the shoulders, the legs from the rings at the hips. Leave a box empty to use the side one.',
    'Photograph the whole sheet, flat, all four black corners and the squares along the bottom in the picture.',
  ];
  // 4.0 RE-3: hdf sketch --face stick grafts a face that moves onto a head drawn without one.
  say.push('For a face that talks, leave the face off the head and use hdf sketch --face stick.');
  say.forEach((line, i) => ctx.fillText(line, 0, 17 + 3.2 * i));

  for (const b of rigBoxes(sheet)) {
    ctx.strokeStyle = EDGE; ctx.lineWidth = 0.25; ctx.setLineDash([]);
    ctx.strokeRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = LABEL; ctx.font = '2.6px sans-serif';
    ctx.fillText(b.label, b.x + 0.5, b.y + b.h + 3.2);
    // The guide: the piece's shape, faint and dotted; the foot's ground line.
    ctx.strokeStyle = GUIDE; ctx.lineWidth = 0.35; ctx.setLineDash([0.5, 1.2]);
    for (const sub of guidePath(b.guide).sub) {
      ctx.beginPath();
      for (let i = 0; i < sub.pts.length; i += 2) { const x = b.px + sub.pts[i], y = b.py + sub.pts[i + 1]; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      if (sub.closed) ctx.closePath();
      ctx.stroke();
    }
    const ground = b.guide.ground;
    if (ground !== undefined) { ctx.beginPath(); ctx.moveTo(b.x + 2, b.py + ground); ctx.lineTo(b.x + b.w - 2, b.py + ground); ctx.stroke(); }
    ctx.setLineDash([]);
    // The pivot dot, and a ring where each piece below is pinned.
    ctx.fillStyle = PIN;
    ctx.beginPath(); ctx.arc(b.px, b.py, DOT, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = PIN; ctx.lineWidth = 0.45;
    for (const [x, y] of Object.values(b.rings)) { ctx.beginPath(); ctx.arc(x, y, RING, 0, Math.PI * 2); ctx.stroke(); }
  }
  // A little figure of how the pieces go together, bottom right.
  if (s.view === 'side') drawAssembly(ctx, [162, 100], 0.3);
  ctx.restore();
}

// The pieces' guides put together at their joints, small (scale k), the ground under the feet at `at`.
function drawAssembly(ctx, [ax, ay], k) {
  ctx.save();
  ctx.translate(ax, ay); ctx.scale(k, k);
  ctx.strokeStyle = LABEL; ctx.lineWidth = 0.5 / k; ctx.setLineDash([]);
  for (const p of PIECES.biped) {
    const [jx, jy] = J[p.pivot];
    for (const sub of guidePath(p.guide).sub) {
      ctx.beginPath();
      for (let i = 0; i < sub.pts.length; i += 2) { const x = jx + sub.pts[i], y = jy + sub.pts[i + 1]; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      if (sub.closed) ctx.closePath();
      ctx.stroke();
    }
    ctx.fillStyle = PIN; ctx.beginPath(); ctx.arc(jx, jy, 2.2 / k * 0.4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.beginPath(); ctx.moveTo(-30, 0); ctx.lineTo(40, 0); ctx.stroke();
  ctx.restore();
}

// ---------- reading a box ----------

const pct = (a, q) => { const s = Float32Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };

// The pixels within r of a mask's pixels (a dilation by a disc), through the distance transform of its complement.
export function grow(mask, w, h, r) {
  if (r <= 0) return mask;
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
  const d = distanceTransform(inv, w, h), out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i] <= r ? 1 : 0;
  return out;
}
// The opening of a mask by a disc of radius r: every pixel of it a disc of radius r inside it covers.
function opening(mask, w, h, r) {
  const d = distanceTransform(mask, w, h), core = new Uint8Array(w * h);
  let any = false;
  for (let i = 0; i < core.length; i++) if (d[i] > r) { core[i] = 1; any = true; }
  if (!any) return core;
  const g = grow(core, w, h, r);
  for (let i = 0; i < g.length; i++) g[i] &= mask[i];
  return g;
}

// The closing of a mask by a disc of radius r (grow, then shrink back): gaps narrower than 2r filled.
export function closing(mask, w, h, r) {
  const g = grow(mask, w, h, r), inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i++) inv[i] = g[i] ? 0 : 1;
  const back = grow(inv, w, h, r);
  for (let i = 0; i < back.length; i++) back[i] = back[i] ? 0 : 1;
  return back;
}

// The colour pixels of a box split by colour: a mask each, largest first. Colours (against the paper, rgb 0..1)
// are binned at 1/12, bins merged into the largest within CLASS of them, and every pixel given to its nearest
// class; a class of fewer than `least` pixels is dropped. Without colour (a grey photo) there is one class.
const CLASS = 0.2;
function colourClasses(colour, C, L, rgb, pc, n, least) {
  if (!rgb) return [colour];
  const px = [], val = [], bins = new Map();
  for (let i = 0; i < n; i++) {
    if (!colour[i]) continue;
    const v = [0, 1, 2].map((c) => Math.min(1, rgb[c].data[i] / pc[c]));
    px.push(i); val.push(v);
    const key = v.map((x) => Math.round(x * 12)).join(',');
    const b = bins.get(key) ?? bins.set(key, { n: 0, sum: [0, 0, 0] }).get(key);
    b.n++; b.sum = b.sum.map((s, c) => s + v[c]);
  }
  const classes = [];
  for (const b of [...bins.values()].sort((a, b) => b.n - a.n)) {
    const mean = b.sum.map((s) => s / b.n), k = classes.find((c) => dist(c.rgb, mean) < CLASS);
    if (k) { k.sum = k.sum.map((s, c) => s + b.sum[c]); k.n += b.n; k.rgb = k.sum.map((s) => s / k.n); } else classes.push({ rgb: mean, sum: [...b.sum], n: b.n });
  }
  const masks = classes.map(() => new Uint8Array(n)), count = classes.map(() => 0);
  px.forEach((i, j) => { const k = nearest(classes, val[j]); masks[k][i] = 1; count[k]++; });
  return masks.filter((_, k) => count[k] >= least).sort((a, b) => count[masks.indexOf(b)] - count[masks.indexOf(a)]);
}

// A box's rasters (lum 0..1 and, when the photo has colour, r g b) -> { lines: [{ pts, w, rgb, closed, len }],
// blobs: [{ subs, rgb, area, ink?, paper? }], dots: [{ c, r, rgb }] } in raster pixels, blobs in painter order
// (coloured-in areas biggest first, then paper the lines close in, then solid ink). skip: pixels no colour is read from (the printed dot and rings).
//
// Ink is dark and grey (under INK of the paper, less colourful than INK_C): a pen's lines, a black shoe, an eye.
// Colour is any other mark (under SOFT of the paper, or more colourful than CHROMA) that is not the grey halo
// round the ink. Ink thicker than BLOB is a blob and small round ink is a dot; the rest of the ink is thinned
// to lines. A coloured-in area is closed over, taken together with the ink round it (so it reaches under its
// outline, and a crayon over the line joins it), opened by a disc so thin marks fall away, and kept when most of
// what it covers is colour; its colour is the mean of its colour pixels. Colour left over is a coloured line.
// paper: [lum, [r, g, b]] when the caller knows it (a piece cut from a drawing may be all colour, 4.0 W3).
export function readBox({ lum, rgb = null, skip = null }, { ppm = PPM, blob = BLOB, paper: known } = {}) {
  const { w, h } = lum, n = w * h, paper = known?.[0] ?? pct(lum.data, 0.9);
  const pc = rgb ? known?.[1] ?? rgb.map((c) => pct(c.data, 0.9) || 1) : null;
  const L = new Float32Array(n), C = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = Math.min(1, lum.data[i] / (paper || 1));
    if (pc) {
      const r = Math.min(1, rgb[0].data[i] / pc[0]), g = Math.min(1, rgb[1].data[i] / pc[1]), b = Math.min(1, rgb[2].data[i] / pc[2]);
      C[i] = Math.max(r, g, b) - Math.min(r, g, b);
    }
  }
  const speck = Math.round(0.8 * ppm * ppm), unspeck = (m) => { for (const c of components(m, w, h)) if (c.area < speck) for (const i of c.px) m[i] = 0; return m; };
  const ink = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (L[i] < INK && C[i] < INK_C) ink[i] = 1;
  unspeck(ink);
  const halo = grow(ink, w, h, 0.5 * ppm), colour = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (!ink[i] && !skip?.[i] && (C[i] > CHROMA || (L[i] < SOFT && !halo[i]))) colour[i] = 1;
  unspeck(colour);
  const colourOf = (px, only) => {
    const use = only ? px.filter((i) => only[i]) : px;
    if (!use.length) return [0, 0, 0];
    if (!rgb) { let s = 0; for (const i of use) s += L[i]; const v = s / use.length; return [v, v, v]; }
    const out = [0, 0, 0];
    for (const i of use) for (let c = 0; c < 3; c++) out[c] += Math.min(1, rgb[c].data[i] / pc[c]);
    return out.map((v) => v / use.length);
  };
  const outline = (px) => {
    const plane = new Uint8Array(n);
    for (const i of px) plane[i] = 255;
    return traceAlpha(plane, w, h, { threshold: 127, step: 1, eps: 0.3 * ppm, minArea: 4 }).sub.map((s) => s.pts);
  };
  const r = (blob / 2) * ppm, blobs = [], dots = [];

  // Coloured-in areas, a colour at a time (hair and a face side by side are two): the colour and the ink round
  // it, closed and opened; kept when mostly that colour. Biggest first, so a small area lies on a big one.
  const found = [], covered = new Uint8Array(n);
  for (const mine of colourClasses(colour, C, L, rgb, pc, n, speck)) {
    // The printed pins were left out of the colour; under a coloured-in area they are that colour, not holes.
    const both = new Uint8Array(n), under = skip ? grow(mine, w, h, (RING + 1.2) * ppm) : null;
    for (let i = 0; i < n; i++) both[i] = mine[i] | ink[i] | (under && skip[i] && under[i] ? 1 : 0);
    const areas = opening(closing(both, w, h, 0.5 * ppm), w, h, 0.6 * r);
    for (const c of components(areas, w, h)) {
      if (c.area < 4 * ppm * ppm) continue;
      let k = 0;
      for (const i of c.px) k += mine[i];
      if (k < 0.3 * c.area) continue;
      for (const i of c.px) covered[i] = 1;
      found.push({ subs: outline(c.px), rgb: colourOf(c.px, mine), area: c.area });
    }
  }
  blobs.push(...found.sort((a, b) => b.area - a.area));
  // Paper inside the lines (4.0 RE-5): a pompom or an eye's white, left the paper's colour in a drawing that is
  // coloured in elsewhere, reads as no colour at all. An area of paper the marks close in (clear of the box's
  // edge, not a sliver) of at least PAPER_IN of the drawing is kept as a fill the look's `light` paints, reaching
  // under the line round it as a coloured-in area does. A drawing in line only has no such fills: its insides stay
  // open, as drawn.
  if (found.length) {
    const marks = new Uint8Array(n);
    for (let i = 0; i < n; i++) marks[i] = ink[i] | colour[i] | covered[i];
    const shut = closing(marks, w, h, 0.25 * ppm), open = new Uint8Array(n);
    for (let i = 0; i < n; i++) open[i] = shut[i] ? 0 : 1;
    const holes = components(opening(open, w, h, 0.5 * ppm), w, h).filter((c) => c.box[0] > 0 && c.box[1] > 0 && c.box[2] < w - 1 && c.box[3] < h - 1);
    let outside = 0;
    for (const c of components(open, w, h)) if (c.box[0] === 0 || c.box[1] === 0 || c.box[2] === w - 1 || c.box[3] === h - 1) outside += c.area;
    const least = Math.max(3 * ppm * ppm, PAPER_IN * (n - outside));
    for (const c of holes.sort((a, b) => b.area - a.area)) {
      if (c.area < least) continue;
      const hole = new Uint8Array(n);
      for (const i of c.px) hole[i] = 1;
      const under = grow(hole, w, h, 0.4 * ppm), px = [];
      for (let i = 0; i < n; i++) if (under[i]) px.push(i);
      blobs.push({ subs: outline(px), rgb: colourOf(c.px), area: c.area, paper: true });
    }
  }
  // Ink: dots (small, round, solid), blobs (thick), lines (the rest).
  for (const c of components(ink, w, h)) {
    const bw = c.box[2] - c.box[0] + 1, bh = c.box[3] - c.box[1] + 1, size = Math.max(bw, bh);
    if (size > 4 * ppm || Math.min(bw, bh) < 0.6 * size || c.area < 0.55 * bw * bh) continue;
    let sx = 0, sy = 0;
    for (const i of c.px) { sx += i % w; sy += Math.floor(i / w); ink[i] = 0; }
    dots.push({ c: [sx / c.area + 0.5, sy / c.area + 0.5], r: Math.sqrt(c.area / Math.PI), rgb: colourOf(c.px) });
  }
  const inkBlob = opening(ink, w, h, r);
  for (const c of components(inkBlob, w, h).sort((a, b) => b.area - a.area)) {
    if (c.area < 2 * ppm * ppm) continue;
    blobs.push({ subs: outline(c.px), rgb: colourOf(c.px), area: c.area, ink: true });
  }
  // Lines: ink that is no blob, and colour clear of the coloured-in areas (a marker line, a pencil line).
  const clear = grow(covered, w, h, 0.8 * ppm), grownBlob = grow(inkBlob, w, h, 0.3 * ppm), line = new Uint8Array(n);
  for (let i = 0; i < n; i++) line[i] = (ink[i] && !grownBlob[i]) || (colour[i] && !clear[i]) ? 1 : 0;
  unspeck(line);
  const dt = distanceTransform(line, w, h), { sk } = skeletonOf(line, w, h);
  const lines = traceSkeleton(sk, w, h, { dt, minLen: 2 * ppm }).map((s) => {
    const px = s.pts.map(([x, y]) => y * w + x), dark = px.filter((i) => ink[i]).length >= px.length / 2;
    return { pts: s.closed ? [...s.pts, s.pts[0]] : s.pts, w: s.w, closed: s.closed, rgb: colourOf(px, dark ? ink : colour), len: s.len };
  });
  return { lines, blobs, dots };
}

// ---------- the whole sheet ----------

// A photo of a rig sheet -> { sheet, pieces: { piece: readBox()'s in mm about the pivot }, blank: [piece], marks,
// at }. img: { data, w, h } luminance 0..1; rgb: [r, g, b] planes of the same size (0..1) when the photo has
// colour. sheet: which sheet it must be (read off its code either way).
export function readRigSheet(img, { rgb = null, sheet, ppm = PPM, blob = BLOB } = {}) {
  const { marks, at } = frameMap(img), index = readCode(img, at);
  const found = Object.keys(RIG_SHEETS).find((k) => RIG_SHEETS[k].index === index);
  if (!found) {
    throw new Error(index <= 2 ? 'rig sheet: this is a page of the hand sheet (hdf hand reads it), not a rig sheet'
      : `rig sheet: the code reads ${index}, which is no rig sheet (${Object.keys(RIG_SHEETS).join(', ')}); photograph the whole sheet`);
  }
  if (sheet && sheet !== found) throw new Error(`rig sheet: the photo is the ${found} sheet, not ${sheet}`);
  const pieces = {}, blank = [];
  for (const b of rigBoxes(found)) {
    const rect = [b.x + MARGIN, b.y + MARGIN, b.w - 2 * MARGIN, b.h - 2 * MARGIN], id = (x, y) => [x, y];
    const lum = sample(img, at, id, rect, ppm), plane = (p) => sample({ data: p, w: img.w, h: img.h }, at, id, rect, ppm);
    // The printed dot and rings, a little grown, are not soft marks.
    const skip = new Uint8Array(lum.w * lum.h);
    const pins = [[b.px, b.py, DOT + 0.9], ...Object.values(b.rings).map(([x, y]) => [x, y, RING + 0.9])];
    for (let j = 0; j < lum.h; j++) for (let i = 0; i < lum.w; i++) {
      const x = rect[0] + (i + 0.5) / ppm, y = rect[1] + (j + 0.5) / ppm;
      if (pins.some(([px, py, r]) => Math.hypot(x - px, y - py) <= r)) skip[j * lum.w + i] = 1;
    }
    const got = readBox({ lum, rgb: rgb ? rgb.map(plane) : null, skip }, { ppm, blob });
    if (!got.lines.length && !got.blobs.length && !got.dots.length) { blank.push(b.piece); continue; }
    // Raster pixels -> mm about the pivot: a skeleton pixel is its centre, a traced contour already continuous.
    const mmPx = ([x, y]) => [rect[0] + (x + 0.5) / ppm - b.px, rect[1] + (y + 0.5) / ppm - b.py];
    const mmC = ([x, y]) => [rect[0] + x / ppm - b.px, rect[1] + y / ppm - b.py];
    pieces[b.piece] = {
      lines: got.lines.map((l) => ({ pts: simplify(l.pts.map(mmPx), 0.18), w: l.w / ppm, rgb: l.rgb, closed: l.closed, len: l.len / ppm })),
      blobs: got.blobs.map((f) => ({ subs: f.subs.map((s) => { const out = []; for (let i = 0; i < s.length; i += 2) out.push(mmC([s[i], s[i + 1]])); return out; }), rgb: f.rgb, area: f.area / (ppm * ppm), ...(f.ink ? { ink: true } : {}), ...(f.paper ? { paper: true } : {}) })),
      dots: got.dots.map((d) => ({ c: mmC(d.c), r: d.r / ppm, rgb: d.rgb })),
    };
  }
  if (found === 'biped' && !pieces.body) throw new Error('rig sheet: nothing is drawn in the body box; draw the body (and the rest) and photograph it again');
  return { sheet: found, pieces, blank, marks, at };
}

// ---------- colours to roles ----------

const hex = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const nearest = (clusters, rgb) => clusters.reduce((bi, c, i) => (dist(c.rgb, rgb) < dist(clusters[bi].rgb, rgb) ? i : bi), 0);

// Every mark's colour (lines by length x width, blobs and dots by area) clustered (within 0.2 of each other in
// rgb, largest first); the lines' main colour is ink, and so is any dark grey; the rest get roles by autoRoles.
// Then (4.0 RE-4): a skin tone (SKIN) is `skin`; a dark grey drawn mostly as a fill, lighter than the pen by
// DARKER or more, is `shade`, so dark trousers and the line round them stay two roles; and `roles` ({ '#hex':
// role }, as hdf svg takes) names the role of any colour within 0.15 of a given one (core/svg.js distance), the
// nearest given colour winning. Paper the lines close in (readBox) is `light` and takes no part.
// Returns { roleOf(rgb), table: [{ hex, area, role, how: 'auto' | 'map' }] }.
export const SKIN = Object.freeze({ hue: [15, 45], sat: [0.2, 0.85], light: [0.55, 0.88] });
export const DARKER = 0.12;
export const isSkin = (hex) => {
  const [h, sat, l] = hsl(hex), within = (v, [a, b]) => v >= a && v <= b;
  return within(h, SKIN.hue) && within(sat, SKIN.sat) && within(l, SKIN.light);
};
export function rolesOf(reads, { roles = {} } = {}) {
  const given = Object.entries(roles ?? {}).map(([k, role]) => {
    let key;
    try { key = hex(parse(k).slice(0, 3).map((v) => v / 255)); } catch { throw new Error(`roles: '${k}' is not a colour (#rrggbb)`); }
    try { resolveRole(role, LOOKS.paperInk); } catch (e) { throw new Error(`roles: ${k} -> ${JSON.stringify(role)}: ${e.message}`); }
    return [key, role];
  });
  const marks = [];
  for (const r of reads) for (const p of Object.values(r.pieces)) {
    for (const l of p.lines) marks.push([l.rgb, l.len * l.w, 'line']);
    for (const f of p.blobs) if (!f.paper) marks.push([f.rgb, f.area, 'fill']);
    for (const d of p.dots) marks.push([d.rgb, Math.PI * d.r * d.r, 'dot']);
  }
  marks.sort((a, b) => b[1] - a[1]);
  const clusters = [];
  for (const [rgb, area, kind] of marks) {
    let c = clusters.find((k) => dist(k.rgb, rgb) < 0.2);
    if (c) { c.sum = c.sum.map((v, i) => v + rgb[i] * area); c.area += area; c.rgb = c.sum.map((v) => v / c.area); } else clusters.push((c = { rgb, sum: rgb.map((v) => v * area), area, fill: 0 }));
    if (kind === 'fill') c.fill += area;
  }
  const rows = clusters.map((c) => ({ hex: hex(c.rgb), area: Math.round(c.area) }));
  // The colour most of the lines are drawn in is the ink, whatever pen it was; autoRoles places the rest.
  const lineArea = clusters.map(() => 0);
  for (const r of reads) for (const p of Object.values(r.pieces)) for (const l of p.lines) lineArea[nearest(clusters, l.rgb)] += l.len * l.w;
  const main = lineArea.some((v) => v > 0) ? lineArea.indexOf(Math.max(...lineArea)) : -1;
  // A black shoe is ink too (dark and grey); any other colour goes to autoRoles, which is kept from calling a dark
  // brown ink by a black it sees first.
  const grey = (c) => Math.max(...c.rgb) <= 0.35 && Math.max(...c.rgb) - Math.min(...c.rgb) < 0.15;
  const rest = rows.filter((_, i) => i !== main && !grey(clusters[i]));
  const auto = autoRoles(main >= 0 ? [{ hex: '#000000', area: 0 }, ...rest] : rest);
  const penL = main >= 0 ? hsl(rows[main].hex)[2] : 0;
  rows.forEach((r, i) => {
    if (i === main) auto[r.hex] = 'ink';
    else if (grey(clusters[i])) auto[r.hex] = main >= 0 && clusters[i].fill > clusters[i].area / 2 && hsl(r.hex)[2] - penL >= DARKER ? 'shade' : 'ink';
    else if (isSkin(r.hex)) auto[r.hex] = 'skin';
  });
  const mapped = (h) => {
    let best = null;
    for (const [k, role] of given) { const d = distance(h, k); if (d < 0.15 && (!best || d < best.d)) best = { d, role }; }
    return best?.role;
  };
  const table = rows.map((r) => { const m = mapped(r.hex); return { ...r, role: m ?? auto[r.hex], how: m ? 'map' : 'auto' }; });
  const roleOf = (rgb) => table[nearest(clusters, rgb)]?.role ?? 'ink';
  return { roleOf, table };
}

// ---------- the puppet ----------

const r2 = (v) => Math.round(v * 100) / 100;
const data = (ops) => JSON.parse(serialise(ops));
const u = ([x, y]) => [r2(x * K), r2(y * K)];

// A read piece as ops in the part's own units (its pivot the origin): its blobs as readBox ordered them (coloured-in
// areas biggest first, then solid ink), then lines longest first, then dots; mirror: x -> -x (the -l side face on).
export function opsOf(p, roleOf, name, mirror = false) {
  if (!p) return [];
  const m = mirror ? ([x, y]) => [-x, y] : (q) => q, U = (q) => u(m(q)), out = [];
  // A coloured-in area takes the look's finish (a marker's passes, a crayon's strokes); solid ink does not.
  const finish = (f, role) => !f.ink && role !== 'ink';
  for (const f of p.blobs) {
    const role = f.paper ? 'light' : roleOf(f.rgb);
    if (role === 'paper') continue;
    out.push(fill(mkPath(f.subs.map((s) => ({ pts: s.flatMap(U), closed: true }))), role, { ...(finish(f, role) ? { finish: true } : {}), name }));
  }
  for (const l of [...p.lines].sort((a, b) => b.len - a.len)) {
    if (l.pts.length < 2) continue;
    const role = roleOf(l.rgb);
    out.push(stroke(poly(l.pts.map(U), false), role === 'paper' ? 'ink' : role, { w: r2(Math.max(0.6, l.w) * K), name }));
  }
  for (const d of p.dots) out.push(fill(circle(...u(m(d.c)), r2(Math.max(0.4, d.r) * K), 12), roleOf(d.rgb) === 'paper' ? 'ink' : roleOf(d.rgb), { name }));
  return out;
}

// The parts in painter order (see the top of this file) with their parents and pivot joints.
export const ORDER = Object.freeze([
  ['arm-l', 'body', 'shoulder-l'], ['fore-l', 'arm-l', 'elbow-l'], ['hand-l', 'fore-l', 'wrist-l'],
  ['leg-l', 'hips', 'hip-l'], ['shin-l', 'leg-l', 'knee-l'], ['foot-l', 'shin-l', 'ankle-l'],
  ['leg-r', 'hips', 'hip-r'], ['shin-r', 'leg-r', 'knee-r'], ['foot-r', 'shin-r', 'ankle-r'],
  ['hips', undefined, 'hip'], ['body', 'hips', 'hip'], ['head', 'body', 'neck'],
  ['arm-r', 'body', 'shoulder-r'], ['fore-r', 'arm-r', 'elbow-r'], ['hand-r', 'fore-r', 'wrist-r'],
]);
const PIECE_OF = (part) => part.replace(/-(l|r)$/, '');

// Every joint of the figure in a view, mm: the side view's as RIG.joints (both sides on one line), the front's
// each chain hung from its spread.
export function jointsIn(view) {
  const out = {};
  for (const [k, p] of Object.entries(J)) {
    if (['shoulder', 'elbow', 'wrist', 'knee', 'ankle', 'toe'].includes(k) || k === 'hip') {
      const s = k === 'shoulder' || k === 'elbow' || k === 'wrist' ? RIG.spread.shoulder : RIG.spread.hip;
      if (k === 'hip') out.hip = [p[0], p[1]];
      for (const [sd, sign] of [['l', -1], ['r', 1]]) out[`${k}-${sd}`] = view === 'front' ? [sign * s, p[1]] : [p[0], p[1]];
    } else out[k] = [view === 'front' ? 0 : p[0], p[1]];
  }
  return out;
}

// Rig sheet reads (one readRigSheet() result or a list: the side sheet, and the front one when there is one) ->
// { payload, table, blank } (roles: rolesOf's map of given colours): a puppet payload with the standard biped names, views ['side'] or ['side', 'front'].
export function rigPuppet(reads, { name = 'sketch', desc, roles } = {}) {
  const list = [reads].flat(), side = list.find((r) => r.sheet === 'biped'), front = list.find((r) => r.sheet === 'biped-front');
  if (!side) throw new Error('rig sheet: the side sheet (biped) is needed; the front one only adds a view');
  const { roleOf, table } = rolesOf(list, { roles });
  const views = front ? ['side', 'front'] : ['side'], at = Object.fromEntries(views.map((V) => [V, jointsIn(V)]));
  const parts = {};
  for (const [n, parent, joint] of ORDER) {
    const piece = PIECE_OF(n), mine = side.pieces[piece], face = front?.pieces[piece], left = /-l$/.test(n);
    const pivot = front ? Object.fromEntries(views.map((V) => [V, u(at[V][joint])])) : u(at.side[joint]);
    const part = { ...(parent ? { parent } : {}), pivot };
    if (n !== 'hips') {
      const sideOps = data(opsOf(mine, roleOf, n));
      // Face on: the front sheet's drawing when it has one; else the side's, the -l limbs mirrored.
      part.ops = front ? { side: sideOps, front: data(face ? opsOf(face, roleOf, n, left) : opsOf(mine, roleOf, n, left)) } : sideOps;
    } else part.ops = front ? { side: [], front: [] } : [];
    parts[n] = part;
  }
  // The box: everything a limb can reach turning about the hip, and the ground under the feet (as a stick's).
  const reachOf = (q) => Math.max(...q.pts.map(([x, y]) => Math.hypot(x, y)));
  const inkR = (piece) => {
    const p = side.pieces[piece];
    if (!p) return 0;
    return Math.max(0, ...p.lines.map(reachOf), ...p.blobs.flatMap((f) => f.subs.map((s) => reachOf({ pts: s }))), ...p.dots.map((d) => Math.hypot(...d.c) + d.r));
  };
  const hipY = J.hip[1], d = (a, b) => Math.hypot(J[a][0] - J[b][0], J[a][1] - J[b][1]);
  const R = Math.max(
    d('hip', 'neck') + inkR('head'), inkR('body'),
    d('hip', 'shoulder') + d('shoulder', 'elbow') + d('elbow', 'wrist') + inkR('hand'), d('hip', 'shoulder') + d('shoulder', 'elbow') + inkR('fore'),
    d('hip', 'knee') + d('knee', 'ankle') + inkR('foot'), d('hip', 'knee') + inkR('shin'), inkR('leg'),
    front ? RIG.spread.shoulder + d('hip', 'shoulder') + d('shoulder', 'wrist') + inkR('hand') : 0,
  ) + 3;
  let box = [r2(-R * K), r2((hipY - R) * K), r2(2 * R * K), r2(Math.max(-(hipY - R) + 3, R) * K)];
  // The side view's joints and bones in the stick's names, for `hdf retarget` (core/stick.js stickMap).
  const js = at.side, joints = { hip: u(js.hip), chest: u(J.chest), neck: u(js.neck), head: u(js.head) };
  const bones = [['hip', 'chest']];
  for (const s of ['l', 'r']) {
    for (const k of ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle']) joints[`${k}-${s}`] = u(js[`${k}-${s}`]);
    joints[`toe-${s}`] = u(J.toe);
    bones.push([`shoulder-${s}`, `elbow-${s}`], [`elbow-${s}`, `wrist-${s}`], [`hip-${s}`, `knee-${s}`], [`knee-${s}`, `ankle-${s}`], [`ankle-${s}`, `toe-${s}`]);
  }
  const blank = [...new Set(list.flatMap((r) => r.blank.map((p) => (r.sheet === 'biped' ? p : `${p} (face on)`))))];
  const hand = u([0, 9]);
  const payload = {
    kind: 'puppet', name, units: RIG.units, ground: [0, 0], box, views,
    desc: desc ?? `a drawing from a rig sheet (${list.map((r) => r.sheet).join(' + ')}): the standard biped parts, so the vocabulary poses and walks it`,
    parts,
    sockets: Object.fromEntries(['l', 'r'].map((s) => [`hand-${s}`, { part: `hand-${s}`, at: hand, angle: 90 }])),
    skeleton: { joints, bones },
  };
  payload.box = holdCycles(payload, box);
  return { payload, table, blank };
}

// A payload's box grown to hold the vocabulary's cycles untempered in every view (a walking leg's turned box
// reaches under the ground), so the actor walks it at full swing; a pose that lies down is still tempered to fit.
export function holdCycles(payload, box = payload.box) {
  const views = payload.views ?? [null];
  const p = puppet({ ...payload }), known =   // a copy: puppet() memoises per payload object, and the box changes
    (q) => Object.fromEntries(Object.entries(q).filter(([k]) => p.parts.includes(k)));
  for (const [cyc, c] of Object.entries(VOCABULARY.cycles)) {
    if (!(VOCABULARY.needs[cyc] ?? []).every((n) => p.parts.includes(n))) continue;
    for (const { lift: _l, ...q } of c.frames) for (const V of views) {
      const b = bounds(p({ ...p.rest, ...known(q), ...(V ? { dir: VIEW_DIRS[V] } : {}) }).kids);
      if (b) box = unite(box, b);
    }
  }
  return box.map(r2);
}
const unite = (a, b) => {
  const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]);
  return [x0, y0, Math.max(a[0] + a[2], b[0] + b[2]) - x0, Math.max(a[1] + a[3], b[1] + b[3]) - y0];
};
