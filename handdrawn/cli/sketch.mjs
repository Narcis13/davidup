// hdf sketch: a child's drawing on a rig sheet into the store as a puppet that walks (4.0 W1).
//
//   hdf hand --template --rig biped > out/rig-sheet.pdf            the sheet to print (--rig biped,biped-front for
//                                                                  the face-on page too; --paper letter)
//   hdf sketch mia.jpg --sheet biped --name mia                    the photo -> the puppet 'mia', its walk strip
//   hdf sketch mia.jpg mia-front.jpg --name mia                    with the face-on sheet: views side and front
//   hdf hand --template --rig biped --drawn > out/rig-drawn.jpg    a sheet drawn in by the package, a 300 dpi JPEG
//                                                                  (a test figure; --rig biped-front for its face)
//   hdf sketch mia.png --auto --name mia [--view front|side]       one drawing, no sheet (4.0 W3): cut at the joints
//                                                                  core/autorig.js finds; an .svg is always --auto
//   hdf sketch mia.jpg mia-front.jpg --name mia --face stick       the stick's face grafted on the head (drawn with
//                                                                  no face), so it talks, emotes and looks (RE-3);
//                                                                  --face-r 38 the head's radius in puppet units
//   hdf sketch mia.jpg --name mia --roles ask                      the colour table to mia.roles.json; stops
//   hdf sketch mia.jpg --name mia --roles '#3b6fd4=fills.0,#4b4f58=shade'    colours to roles (or a JSON file)
//
// Each photo's sheet is read off its code; --sheet says which it must be. The puppet goes into the store (licence
// own unless --licence says) with the standard biped names, so the vocabulary poses and walks it, and `hdf
// retarget --clip me --to mia --name walk` needs no map. Writes out/sketch-<id>-trace[-front].jpg (the photo
// straightened, lines in red, fills outlined in blue, dots in green) and the store sheet with the walk as its strip
// (the puppet's own walk when it has one, the vocabulary's otherwise).
//
// Roles (core/rigsheet.js rolesOf): the pen is ink, a skin tone `skin`, a dark fill lighter than the pen `shade`,
// paper the lines close in `light`, the rest the nearest house fill or accent. The table printed says which, and
// `--roles` (as hdf svg takes it) names any of them; a colour within 0.15 of a given one takes its role.
import { existsSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { loadImage } from 'skia-canvas';
import { APPM, PARTS, TALL, autoRig, figureOf } from '../core/autorig.js';
import { FRAME, PAPERS, frameOrigin, sample } from '../core/handsheet.js';
import { poly, stroke } from '../core/list.js';
import { LOOKS } from '../core/looks.js';
import { hash32, rng } from '../core/rand.js';
import { ORDER, PIECES, RIG_SHEETS, drawRigTemplate, jointsIn, readRigSheet, rigBoxes, rigPuppet } from '../core/rigsheet.js';
import { graftFace } from '../core/stick.js';
import { traceAlpha } from '../core/trace.js';
import { putPayload } from './import.mjs';
import { UsageError } from './load.mjs';
import { outDir, paint } from './sheets.mjs';
import { storeSheet } from './sheet.mjs';
import { skiaCanvas } from './skia.mjs';
import { keepRetargeted, readRoles } from './svg.mjs';

const PT = 72 / 25.4;   // points per mm
const str = (v) => (v === undefined || v === true ? '' : String(v));

// --rig biped,biped-front -> ['biped', 'biped-front'].
export function rigsOf(flag) {
  const rigs = (flag === true || flag === undefined ? 'biped' : String(flag)).split(',').map((s) => s.trim()).filter(Boolean);
  const bad = rigs.filter((r) => !RIG_SHEETS[r]);
  if (!rigs.length || bad.length) throw new UsageError(`hand: --rig ${flag} (expected a list of ${Object.keys(RIG_SHEETS).join(', ')})`);
  return [...new Set(rigs)];
}

// The empty rig sheets as a PDF, a page each.
export async function rigTemplatePdf(paper = 'a4', sheets = ['biped']) {
  const [pw, ph] = PAPERS[paper];
  const canvas = skiaCanvas(pw * PT, ph * PT);
  for (const s of sheets) {
    const ctx = canvas.newPage(pw * PT, ph * PT);
    ctx.scale(PT, PT);
    drawRigTemplate(ctx, paper, s);
  }
  return canvas.toBuffer('pdf');
}

// ---------- a sheet drawn in (tests, the demo) ----------

// The test figure, piece by piece, in mm about its pivot: fills (colour, a path in mm) under outlines (strokes
// drawn by the house pen) and dots. A kid in a red top, jeans, black shoes, brown hair.
const SKIN = '#f0c39b', TOP = '#d8433b', JEANS = '#3d64b0', SHOE = '#26221f', HAIR = '#6e3f1c';
const capsule = (len, r) => {
  const pts = [];
  for (let i = 0; i <= 12; i++) { const a = Math.PI + (i / 12) * Math.PI; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
  for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI; pts.push([r * Math.cos(a), len + r * Math.sin(a)]); }
  return pts;
};
const ring = (cx, cy, rx, ry, n = 36) => Array.from({ length: n + 1 }, (_, i) => [cx + rx * Math.cos((i / n) * 2 * Math.PI), cy + ry * Math.sin((i / n) * 2 * Math.PI)]);
export const TEST_FIGURE = Object.freeze({
  biped: {
    head: { fills: [[SKIN, ring(2, -28, 23, 23)], [HAIR, [[-21, -34], [-16, -46], [-2, -52], [14, -50], [24, -40], [18, -40], [6, -44], [-8, -40], [-14, -30], [-20, -24]]]],
      lines: [ring(2, -28, 23, 23), [[10, -17], [17, -19]], [[24, -30], [28, -25], [24, -23]]], dots: [[14, -31, 1.7]] },
    body: { fills: [[TOP, [[-13, -50], [13, -50], [16, -40], [14, 3], [-14, 3], [-16, -40]]]],
      lines: [[[-13, -50], [13, -50], [16, -40], [14, 3], [-14, 3], [-16, -40], [-13, -50]], [[-10, -20], [10, -20]]] },
    arm: { fills: [[TOP, capsule(27, 6)]], lines: [capsule(27, 6)] },
    fore: { fills: [[SKIN, capsule(26, 4.5)]], lines: [capsule(26, 4.5)] },
    hand: { fills: [[SKIN, ring(0, 8, 6, 8.5)]], lines: [ring(0, 8, 6, 8.5), [[4, 4], [8, 1]]] },
    foot: { fills: [[SHOE, [[-6, -3], [6, -3], [7, 2], [20, 3], [24, 7], [-6, 7]]]], lines: [] },
    leg: { fills: [[JEANS, capsule(34, 7)]], lines: [capsule(34, 7)] },
    shin: { fills: [[JEANS, capsule(33, 6)]], lines: [capsule(33, 6)] },
  },
  'biped-front': {
    head: { fills: [[SKIN, ring(0, -28, 23, 23)], [HAIR, [[-23, -30], [-18, -46], [0, -52], [18, -46], [23, -30], [16, -40], [0, -44], [-16, -40]]]],
      lines: [ring(0, -28, 23, 23), [[-6, -16], [0, -13], [6, -16]]], dots: [[-8, -30, 1.7], [8, -30, 1.7]] },
    body: { fills: [[TOP, [[-20, -50], [20, -50], [22, -40], [16, 3], [-16, 3], [-22, -40]]]],
      lines: [[[-20, -50], [20, -50], [22, -40], [16, 3], [-16, 3], [-22, -40], [-20, -50]]] },
    foot: { fills: [[SHOE, ring(0, 3.5, 7, 4)]], lines: [] },
  },
});

// A rig sheet drawn in: the template, then each piece of `figure` (TEST_FIGURE's shape) in its box: fills flat
// in their colours, outlines by the house pen at w mm, dots. skip: pieces left blank. Returns a skia canvas at dpi.
export function drawnRigSheet({ paper = 'a4', sheet = 'biped', dpi = 300, w = 0.8, figure = TEST_FIGURE[sheet], skip = [] } = {}) {
  const [pw, ph] = PAPERS[paper], k = dpi / 25.4, [ox, oy] = frameOrigin(paper);
  const canvas = skiaCanvas(Math.round(pw * k), Math.round(ph * k)), ctx = canvas.getContext('2d');
  ctx.save(); ctx.scale(k, k); drawRigTemplate(ctx, paper, sheet); ctx.restore();
  const list = [], r = rng(hash32('rig', sheet));
  for (const b of rigBoxes(sheet)) {
    const f = figure?.[b.piece];
    if (!f || skip.includes(b.piece)) continue;
    const X = ox + b.px, Y = oy + b.py;
    ctx.save(); ctx.scale(k, k); ctx.translate(X, Y);
    for (const [colour, pts] of f.fills ?? []) {
      ctx.fillStyle = colour;
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
      // A crayon's grain: a few paler flecks inside.
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      for (let j = 0; j < 30; j++) {
        const [x0, y0] = pts[Math.floor(r() * pts.length)], [x1, y1] = pts[Math.floor(r() * pts.length)], t = r();
        ctx.fillRect(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.4, 0.4);
      }
    }
    for (const [x, y, rr] of f.dots ?? []) { ctx.fillStyle = '#1e1630'; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    for (const pts of f.lines ?? []) list.push(stroke(poly(pts.map(([x, y]) => [X + x, Y + y]), false), 'ink', { w, name: b.piece }));
  }
  paint(list, { look: LOOKS.paperInk, W: pw, H: ph, width: canvas.width, onto: canvas, seed: hash32('rig-sheet', sheet) });
  return canvas;
}

// ---------- reading ----------

// An image file as luminance and colour planes (0..1).
export async function planes(file) {
  const img = await loadImage(file), w = img.width, h = img.height, c = skiaCanvas(w, h), g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  return planesOf(g.getImageData(0, 0, w, h).data, w, h);
}
export function planesOf(rgba, w, h) {
  const lum = new Float32Array(w * h), rgb = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
  for (let i = 0; i < lum.length; i++) {
    const R = rgba[4 * i] / 255, G = rgba[4 * i + 1] / 255, B = rgba[4 * i + 2] / 255;
    rgb[0][i] = R; rgb[1][i] = G; rgb[2][i] = B;
    lum[i] = 0.299 * R + 0.587 * G + 0.114 * B;
  }
  return { img: { data: lum, w, h }, rgb };
}

// The photo straightened (3 px per mm) with what was read over it: lines red, fills blue, dots green.
async function traceCheck({ img, rgb }, read, file) {
  const S = 3, [W, H] = FRAME, fw = W * S, fh = H * S, id = (x, y) => [x, y];
  const flat = [0, 1, 2].map((c) => sample({ data: rgb[c], w: img.w, h: img.h }, read.at, id, [0, 0, W, H], S));
  const c = skiaCanvas(fw, fh), g = c.getContext('2d'), im = g.createImageData(fw, fh);
  for (let i = 0; i < fw * fh; i++) im.data.set([flat[0].data[i] * 255, flat[1].data[i] * 255, flat[2].data[i] * 255, 255], 4 * i);
  g.putImageData(im, 0, 0);
  g.scale(S, S);
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const b of rigBoxes(read.sheet)) {
    const p = read.pieces[b.piece];
    if (!p) {
      g.strokeStyle = 'rgba(230,120,0,.9)'; g.lineWidth = 0.35;
      g.beginPath(); g.moveTo(b.x + 2, b.y + 2); g.lineTo(b.x + b.w - 2, b.y + b.h - 2); g.moveTo(b.x + b.w - 2, b.y + 2); g.lineTo(b.x + 2, b.y + b.h - 2); g.stroke();
      continue;
    }
    const at = ([x, y]) => [b.px + x, b.py + y];
    g.strokeStyle = 'rgba(40,90,230,.95)'; g.lineWidth = 0.3;
    for (const f of p.blobs) for (const s of f.subs) { g.beginPath(); s.map(at).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke(); }
    g.strokeStyle = 'rgba(230,30,30,.95)'; g.lineWidth = 0.35;
    for (const l of p.lines) { g.beginPath(); l.pts.map(at).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); }
    g.strokeStyle = 'rgba(20,170,60,.95)';
    for (const d of p.dots) { const [x, y] = at(d.c); g.beginPath(); g.arc(x, y, d.r + 0.3, 0, Math.PI * 2); g.stroke(); }
  }
  await c.toFile(file, { quality: 0.88 });
}

// ---------- one drawing (4.0 W3) ----------

// The test figure standing in one drawing, as a child colours one in and then goes round it with a pen: a round
// head on a neck, a red top, blue jeans, skin arms and hands, black shoes, brown hair, face on (the shoulders and
// hips apart) or in profile (both sides on one line), each part turned by pose (degrees, as a puppet's joints).
// -> { fills: [[colour, pts]], lines: [pts] (the outline round the whole, then the mouth), dots: [[x, y, r]],
// joints: { part: [x, y] } (each part's pivot as drawn) } in mm, the ground at y = 0, the hip over x = 0.
const ROUND = (cx, cy, r, n = 36) => ring(cx, cy, r, r, n);
export const FIGURE = Object.freeze({
  body: { front: [[TOP, [[-20, -52], [20, -52], [23, -40], [17, 3], [-17, 3], [-23, -40]]]], side: [[TOP, [[-12, -52], [12, -52], [15, -40], [13, 3], [-13, 3], [-15, -40]]]] },
  head: { front: [[SKIN, [[-5, -6], [5, -6], [5, 4], [-5, 4]]], [SKIN, ROUND(0, -21, 23)], [HAIR, [[-23, -24], [-19, -38], [0, -45], [19, -38], [23, -24], [15, -33], [0, -36], [-15, -33]]]],
    side: [[SKIN, [[-5, -6], [5, -6], [5, 4], [-5, 4]]], [SKIN, ROUND(2, -21, 23)], [HAIR, [[-21, -27], [-16, -39], [-2, -45], [14, -43], [24, -33], [18, -33], [6, -37], [-8, -33], [-14, -23], [-20, -17]]]] },
  arm: [[TOP, capsule(27, 6.5)]], fore: [[SKIN, capsule(26, 4.8)]], hand: [[SKIN, ROUND(0, 7, 6.5, 20)]],
  leg: [[JEANS, capsule(34, 7.5)]], shin: [[JEANS, capsule(33, 6.5)]],
  foot: { front: [[SHOE, ring(0, 4, 8, 4.5, 20)]], side: [[SHOE, [[-6, -3], [6, -3], [7, 2], [20, 3], [24, 7], [-6, 7]]]] },
});
export function figureShapes({ view = 'front', pose = {}, k = 4 } = {}) {
  const J = jointsIn(view), jointOf = Object.fromEntries(ORDER.map(([n, par, j]) => [n, [par, j]])), world = {};
  const place = (n) => {
    if (world[n]) return world[n];
    const [par, j] = jointOf[n], a = pose[n] ?? 0;
    if (!par) return (world[n] = { at: J[j], a });
    const P = place(par), v = [J[j][0] - J[jointOf[par][1]][0], J[j][1] - J[jointOf[par][1]][1]], t = (P.a * Math.PI) / 180;
    return (world[n] = { at: [P.at[0] + v[0] * Math.cos(t) - v[1] * Math.sin(t), P.at[1] + v[0] * Math.sin(t) + v[1] * Math.cos(t)], a: P.a + a });
  };
  const out = { fills: [], lines: [], dots: [], joints: {} };
  let X = null;
  for (const [n] of ORDER) {
    if (n === 'hips') continue;
    const { at, a } = place(n), t = (a * Math.PI) / 180, f = FIGURE[n.replace(/-(l|r)$/, '')];
    X = ([x, y]) => [at[0] + x * Math.cos(t) - y * Math.sin(t), at[1] + x * Math.sin(t) + y * Math.cos(t)];
    for (const [c, pts] of Array.isArray(f) ? f : f[view]) out.fills.push([c, pts.map(X)]);
    out.joints[n] = at;
    if (n === 'head') {
      const face = view === 'front' ? { eyes: [[-8, -23], [8, -23]], mouth: [[-7, -11], [0, -8], [7, -11]] } : { eyes: [[13, -24]], mouth: [[15, -10], [21, -12]] };
      for (const [x, y] of face.eyes) out.dots.push([...X([x, y]), 1.8]);
      out.mouth = face.mouth.map(X);
    }
  }
  // The pen round the whole: the fills' silhouette, traced.
  const W = 260, H = 240, ox = W / 2, oy = H - 10, c = skiaCanvas(W * k, H * k), g = c.getContext('2d');
  g.scale(k, k); g.translate(ox, oy); g.fillStyle = '#000';
  for (const [, pts] of out.fills) { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); }
  const { sub } = traceAlpha(g.getImageData(0, 0, W * k, H * k).data, W * k, H * k, { threshold: 127, step: 1, eps: 0.8, minArea: 20 });
  for (const s of sub) {
    const pts = [];
    for (let i = 0; i < s.pts.length; i += 2) pts.push([s.pts[i] / k - ox, s.pts[i + 1] / k - oy]);
    out.lines.push([...pts, pts[0]]);
  }
  out.lines.push(out.mouth);
  delete out.mouth;
  return out;
}

// The figure drawn at k px a mm, the house pen on its lines: a skia canvas (white, or clear with alpha: true).
export function drawnFigure({ view = 'front', pose = {}, k = 4, alpha = false, w = 1 } = {}) {
  const S = figureShapes({ view, pose }), W = 260, H = 240, ox = W / 2, oy = H - 10;
  const canvas = skiaCanvas(Math.round(W * k), Math.round(H * k)), ctx = canvas.getContext('2d');
  if (!alpha) { ctx.fillStyle = '#fbf8f1'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.save(); ctx.scale(k, k); ctx.translate(ox, oy);
  for (const [c, pts] of S.fills) { ctx.fillStyle = c; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); }
  for (const [x, y, r] of S.dots) { ctx.fillStyle = '#1e1630'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  const list = S.lines.map((pts) => stroke(poly(pts.map(([x, y]) => [ox + x, oy + y]), false), 'ink', { w }));
  paint(list, { look: LOOKS.paperInk, W, H, width: canvas.width, onto: canvas, seed: hash32('figure', view) });
  return canvas;
}

// The same figure as an SVG: flat fills, black outlines (what a vector drawing app exports).
export function figureSvg({ view = 'front', pose = {} } = {}) {
  const S = figureShapes({ view, pose }), W = 260, H = 240, ox = W / 2, oy = H - 10;
  const d = (pts, close) => `M${pts.map(([x, y]) => `${(ox + x).toFixed(2)} ${(oy + y).toFixed(2)}`).join('L')}${close ? 'Z' : ''}`;
  return [`<svg xmlns="http://www.w3.org/2000/svg" width="${W * 4}" height="${H * 4}" viewBox="0 0 ${W} ${H}">`,
    ...S.fills.map(([c, pts]) => `<path d="${d(pts, true)}" fill="${c}"/>`),
    ...S.dots.map(([x, y, r]) => `<circle cx="${(ox + x).toFixed(2)}" cy="${(oy + y).toFixed(2)}" r="${r}" fill="#1e1630"/>`),
    ...S.lines.map((pts) => `<path d="${d(pts, false)}" fill="none" stroke="#1e1630" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>`),
    '</svg>'].join('\n');
}

// An image's pixels as a drawing's planes: colour over white where it is clear, and its alpha when it has any (clear
// in over 1% of the image; `clear` says so for a crop of it, whose edge may be off the image).
function drawingPlanesOf(rgba, w, h, clear) {
  if (clear === undefined) { let n = 0; for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 250) n++; clear = n > 0.01 * w * h; }
  const alpha = clear ? new Float32Array(w * h) : null, rgb = [0, 1, 2].map(() => new Float32Array(w * h)), lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = rgba[4 * i + 3] / 255, [R, G, B] = [0, 1, 2].map((c) => (rgba[4 * i + c] / 255) * a + (1 - a));
    rgb[0][i] = R; rgb[1][i] = G; rgb[2][i] = B;
    lum[i] = 0.299 * R + 0.587 * G + 0.114 * B;
    if (alpha) alpha[i] = a;
  }
  return { img: { data: lum, w, h }, rgb, alpha };
}

// A drawing file (PNG, JPEG, SVG) -> planes with the figure TALL * APPM px tall and a margin round it: read once
// to find the figure, then drawn again at that scale (off the image's edge its paper, or clear).
export async function drawingPlanes(file) {
  const img = await loadImage(file), s0 = Math.min(4, 1200 / Math.max(img.width, img.height));
  const at = (s, [x0, y0, cw, ch] = [0, 0, Math.ceil(img.width * s), Math.ceil(img.height * s)], clear) => {
    const c = skiaCanvas(cw, ch), g = c.getContext('2d');
    if (clear === false) { g.fillStyle = '#fff'; g.fillRect(0, 0, cw, ch); }
    g.drawImage(img, -x0, -y0, img.width * s, img.height * s);
    return drawingPlanesOf(g.getImageData(0, 0, cw, ch).data, cw, ch, clear);
  };
  const P0 = at(s0), F = figureOf(P0), k = (TALL * APPM) / F.height, s1 = s0 * k, m = 12 * APPM;
  const [bx0, by0, bx1, by1] = F.box.map((v) => v * k);
  return at(s1, [Math.floor(bx0 - m), Math.floor(by0 - m), Math.ceil(bx1 - bx0 + 2 * m), Math.ceil(by1 - by0 + 2 * m)], !!P0.alpha);
}

// The drawing with what the rig found over it: each part tinted, the bones white over black, the joints dotted.
async function rigCheck(P, rig, file) {
  const { w, h, label } = rig, c = skiaCanvas(w, h), g = c.getContext('2d'), im = g.createImageData(w, h);
  const hue = (k) => { const a = (k * 137.5) % 360, f = (n) => { const q = (n + a / 30) % 12; return 0.5 - 0.5 * Math.max(-1, Math.min(q - 3, 9 - q, 1)); }; return [f(0), f(8), f(4)]; };
  const tint = PARTS.map((_, k) => hue(k));
  for (let i = 0; i < w * h; i++) {
    const base = [P.rgb[0][i], P.rgb[1][i], P.rgb[2][i]], t = label[i] >= 0 ? tint[label[i]] : null;
    im.data.set([...base.map((v, ch) => (t ? 0.55 * v + 0.45 * t[ch] : v) * 255), 255], 4 * i);
  }
  g.putImageData(im, 0, 0);
  g.lineCap = 'round';
  for (const [wd, col] of [[5, '#000'], [2.5, '#fff']]) {
    g.lineWidth = wd; g.strokeStyle = col;
    for (const [a, b] of rig.bones) { const p = rig.joints[a], q = rig.joints[b]; if (!p || !q) continue; g.beginPath(); g.moveTo(...p); g.lineTo(...q); g.stroke(); }
  }
  for (const p of Object.values(rig.joints)) { g.fillStyle = '#000'; g.beginPath(); g.arc(...p, 5, 0, Math.PI * 2); g.fill(); g.fillStyle = '#ffd400'; g.beginPath(); g.arc(...p, 3.2, 0, Math.PI * 2); g.fill(); }
  await c.toFile(file, { quality: 0.88 });
}

// --face stick | none (the default: a child's own drawn face is the point) and --roles (ask, a file, #hex=role,...).
const FACES = ['none', 'stick'];
function faceOf(flags) {
  const f = str(flags.face) || 'none';
  if (!FACES.includes(f)) throw new UsageError(`sketch: --face ${f} (expected ${FACES.join(' | ')})`);
  if (flags.faceR !== undefined && !(+flags.faceR > 0)) throw new UsageError(`sketch: --face-r ${flags.faceR} (a radius in puppet units, above 0)`);
  if (flags.faceR !== undefined && f !== 'stick') throw new UsageError('sketch: --face-r sizes a grafted face; add --face stick');
  return f;
}
const rolesFlag = (flags) => (flags.roles && flags.roles !== 'ask' ? readRoles(String(flags.roles), 'sketch') : undefined);
function withFace(payload, flags) {
  if (faceOf(flags) !== 'stick') return payload;
  try { return graftFace(payload, flags.faceR === undefined ? {} : { r: +flags.faceR }); } catch (e) { throw new UsageError(`sketch: --face stick: ${e.message.replace(/^graftFace: /, '')}`); }
}
const tableText = (table) => table.map((r) => `${r.hex}  ${String(r.area).padStart(6)}  ${r.role.padEnd(10)} ${r.how ?? 'auto'}\n`).join('');
// --roles ask: the table to <name>.roles.json beside the (first) file, then stop.
function askRoles(table, file, name, again) {
  const out = join(dirname(file), `${name}.roles.json`);
  writeFileSync(resolve(out), `${JSON.stringify(Object.fromEntries(table.map((r) => [r.hex, r.role])), null, 2)}\n`);
  process.stdout.write(`${tableText(table)}${out}  edit the roles, then: ${again} --roles ${out}\n`);
  return 0;
}

async function runAuto(args, flags, name) {
  if (args.length !== 1) throw new UsageError(`sketch --auto: one drawing at a time (got ${args.length})`);
  const view = str(flags.view) || 'front';
  if (view !== 'front' && view !== 'side') throw new UsageError(`sketch: --view ${view} (expected front | side)`);
  const [file] = args, P = await drawingPlanes(file);
  let got;
  faceOf(flags);
  try { got = autoRig(P, { name, view, roles: rolesFlag(flags) }); } catch (e) { throw new UsageError(`sketch: ${basename(file)}: ${e.message.replace(/^autorig: /, '')}`); }
  const { table, copied, blank, found } = got;
  process.stdout.write(`${basename(file)}: one drawing, ${view} view; found ${found.length ? found.join(', ') : 'no limbs'}${copied.length ? `; ${copied.join(', ')} drawn from the other side` : ''}\n`);
  if (flags.roles === 'ask') return askRoles(table, file, name, `hdf sketch ${file} --auto --name ${name}`);
  process.stdout.write(tableText(table));
  const payload = withFace(got.payload, flags);
  keepRetargeted(payload, name, flags);
  const code = await putPayload({
    kind: 'puppet', name, bytes: Buffer.from(JSON.stringify(payload)), abs: resolve(file),
    flags: { licence: 'own', credit: `one drawing, rigged by hdf sketch --auto from ${basename(file)}`, source: basename(file), tags: 'puppet,sketch,autorig,biped', ...flags },
  });
  const drawn = Object.entries(payload.poses.drawn).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ');
  process.stdout.write(`  parts: ${Object.keys(payload.parts).join(' ')}\n  pose drawn: ${drawn || 'all at rest'}${blank.length ? `\n  cut out empty (they draw nothing): ${blank.join(', ')}` : ''}\n`);
  const check = join(outDir(flags), `sketch-${name}-rig.jpg`);
  await rigCheck(P, got.rig, check);
  process.stdout.write(`${check}  the drawing cut into its parts, the bones found over it\n`);
  if (flags.sheet !== false) await storeSheet(name, { root: flags.root, cycle: str(flags.cycle) || 'walk' });
  process.stdout.write(`next: hdf dev <film> and R (the Rig tab) to move a pivot the cut got wrong; hdf sheet store ${name} --poses (the pose drawn is the drawing)\n`);
  return code;
}

export async function run(args, flags) {
  if (typeof flags.auto === 'string') { args = [flags.auto, ...args]; flags = { ...flags, auto: true }; }   // --auto mia.png
  if (!args.length) throw new UsageError('sketch: need a photo of a rig sheet (print one: hdf hand --template --rig biped > out/rig-sheet.pdf), or one drawing with --auto');
  const name = str(flags.name);
  if (!name) throw new UsageError('sketch: need --name <id>, e.g. hdf sketch mia.jpg --sheet biped --name mia');
  for (const f of args) if (!existsSync(f)) throw new UsageError(`sketch: no file ${f}`);
  if (flags.auto || args.some((f) => /\.svg$/i.test(f))) return runAuto(args, flags, name);
  const want = typeof flags.sheet === 'string' ? flags.sheet : '';   // --no-sheet is sheet: false
  if (want && !RIG_SHEETS[want]) throw new UsageError(`sketch: --sheet ${want} (expected ${Object.keys(RIG_SHEETS).join(' | ')})`);
  const photos = [];
  for (const file of args) {
    const p = await planes(file);
    let read;
    try { read = readRigSheet(p.img, { rgb: p.rgb, ...(args.length === 1 && want ? { sheet: want } : {}) }); } catch (e) {
      const marks = /corner marks/.test(e.message) ? `; one drawing, not a rig sheet? hdf sketch ${basename(file)} --auto --name ${name}` : '';
      throw new UsageError(`sketch: ${basename(file)}: ${e.message.replace(/^(rig|hand) sheet: /, '')}${marks}`);
    }
    const twin = photos.find((q) => q.read.sheet === read.sheet);
    if (twin) throw new UsageError(`sketch: ${basename(twin.file)} and ${basename(file)} are both the ${read.sheet} sheet`);
    photos.push({ file, ...p, read });
  }
  if (want && !photos.some((q) => q.read.sheet === want)) throw new UsageError(`sketch: no photo is the ${want} sheet (${photos.map((q) => `${basename(q.file)} is ${q.read.sheet}`).join(', ')})`);
  faceOf(flags);
  let got;
  try { got = rigPuppet(photos.map((q) => q.read), { name, roles: rolesFlag(flags) }); } catch (e) { throw new UsageError(`sketch: ${e.message.replace(/^rig sheet: /, '')}`); }
  const { table, blank } = got;
  for (const q of photos) {
    const n = Object.keys(q.read.pieces).length, all = PIECES[q.read.sheet].length;
    process.stdout.write(`${basename(q.file)}: the ${q.read.sheet} sheet, ${n} of ${all} pieces drawn${q.read.blank.length ? ` (blank: ${q.read.blank.join(', ')})` : ''}\n`);
  }
  if (flags.roles === 'ask') return askRoles(table, photos[0].file, name, `hdf sketch ${args.join(' ')} --name ${name}`);
  process.stdout.write(tableText(table));
  const payload = withFace(got.payload, flags);
  keepRetargeted(payload, name, flags);
  const names = photos.map((q) => basename(q.file)).join(', ');
  const code = await putPayload({
    kind: 'puppet', name, bytes: Buffer.from(JSON.stringify(payload)), abs: resolve(photos[0].file),
    flags: { licence: 'own', credit: `drawn on a rig sheet, read by hdf sketch from ${names}`, source: names, tags: 'puppet,sketch,biped', ...flags },
  });
  process.stdout.write(`  parts: ${Object.keys(payload.parts).join(' ')}${payload.parts.mouth ? ' (the face grafted: it talks)' : ''}\n  views: ${payload.views.join(', ')}${blank.length ? `\n  drawn blank (they draw nothing): ${blank.join(', ')}` : ''}\n`);
  for (const q of photos) {
    const file = join(outDir(flags), `sketch-${name}-trace${q.read.sheet === 'biped' ? '' : '-front'}.jpg`);
    await traceCheck(q, q.read, file);
    process.stdout.write(`${file}  the ${q.read.sheet} sheet straightened: lines red, fills blue, dots green\n`);
  }
  if (flags.sheet !== false) await storeSheet(name, { root: flags.root, cycle: str(flags.cycle) || 'walk' });
  process.stdout.write(`next: hdf sheet store ${name} --vocabulary   (every pose and cycle it takes); hdf retarget --clip <biped clip> --to ${name} --name walk (no --map)\n`);
  return code;
}
