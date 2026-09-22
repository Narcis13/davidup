// hdf sketch: a child's drawing on a rig sheet into the store as a puppet that walks (4.0 W1).
//
//   hdf hand --template --rig biped > out/rig-sheet.pdf            the sheet to print (--rig biped,biped-front for
//                                                                  the face-on page too; --paper letter)
//   hdf sketch mia.jpg --sheet biped --name mia                    the photo -> the puppet 'mia', its walk strip
//   hdf sketch mia.jpg mia-front.jpg --name mia                    with the face-on sheet: views side and front
//   hdf hand --template --rig biped --drawn > out/rig-drawn.jpg    a sheet drawn in by the package, a 300 dpi JPEG
//                                                                  (a test figure; --rig biped-front for its face)
//
// Each photo's sheet is read off its code; --sheet says which it must be. The puppet goes into the store (licence
// own unless --licence says) with the standard biped names, so the vocabulary poses and walks it, and `hdf
// retarget --clip me --to mia --name walk` needs no map. Writes out/sketch-<id>-trace[-front].jpg (the photo
// straightened, lines in red, fills outlined in blue, dots in green) and the store sheet with the walk as its strip
// (the puppet's own walk when it has one, the vocabulary's otherwise).
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { loadImage } from 'skia-canvas';
import { FRAME, PAPERS, frameOrigin, sample } from '../core/handsheet.js';
import { poly, stroke } from '../core/list.js';
import { LOOKS } from '../core/looks.js';
import { hash32, rng } from '../core/rand.js';
import { PIECES, RIG_SHEETS, drawRigTemplate, readRigSheet, rigBoxes, rigPuppet } from '../core/rigsheet.js';
import { putPayload } from './import.mjs';
import { UsageError } from './load.mjs';
import { outDir, paint } from './sheets.mjs';
import { storeSheet } from './sheet.mjs';
import { skiaCanvas } from './skia.mjs';
import { keepRetargeted } from './svg.mjs';

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

export async function run(args, flags) {
  if (!args.length) throw new UsageError('sketch: need a photo of a rig sheet (print one: hdf hand --template --rig biped > out/rig-sheet.pdf)');
  const name = str(flags.name);
  if (!name) throw new UsageError('sketch: need --name <id>, e.g. hdf sketch mia.jpg --sheet biped --name mia');
  const want = typeof flags.sheet === 'string' ? flags.sheet : '';   // --no-sheet is sheet: false
  if (want && !RIG_SHEETS[want]) throw new UsageError(`sketch: --sheet ${want} (expected ${Object.keys(RIG_SHEETS).join(' | ')})`);
  for (const f of args) if (!existsSync(f)) throw new UsageError(`sketch: no file ${f}`);
  const photos = [];
  for (const file of args) {
    const p = await planes(file);
    let read;
    try { read = readRigSheet(p.img, { rgb: p.rgb, ...(args.length === 1 && want ? { sheet: want } : {}) }); } catch (e) { throw new UsageError(`sketch: ${basename(file)}: ${e.message.replace(/^rig sheet: /, '')}`); }
    const twin = photos.find((q) => q.read.sheet === read.sheet);
    if (twin) throw new UsageError(`sketch: ${basename(twin.file)} and ${basename(file)} are both the ${read.sheet} sheet`);
    photos.push({ file, ...p, read });
  }
  if (want && !photos.some((q) => q.read.sheet === want)) throw new UsageError(`sketch: no photo is the ${want} sheet (${photos.map((q) => `${basename(q.file)} is ${q.read.sheet}`).join(', ')})`);
  let got;
  try { got = rigPuppet(photos.map((q) => q.read), { name }); } catch (e) { throw new UsageError(`sketch: ${e.message.replace(/^rig sheet: /, '')}`); }
  const { payload, table, blank } = got;
  for (const q of photos) {
    const n = Object.keys(q.read.pieces).length, all = PIECES[q.read.sheet].length;
    process.stdout.write(`${basename(q.file)}: the ${q.read.sheet} sheet, ${n} of ${all} pieces drawn${q.read.blank.length ? ` (blank: ${q.read.blank.join(', ')})` : ''}\n`);
  }
  process.stdout.write(table.map((r) => `${r.hex}  ${String(r.area).padStart(6)}  ${r.role}\n`).join(''));
  keepRetargeted(payload, name, flags);
  const names = photos.map((q) => basename(q.file)).join(', ');
  const code = await putPayload({
    kind: 'puppet', name, bytes: Buffer.from(JSON.stringify(payload)), abs: resolve(photos[0].file),
    flags: { licence: 'own', credit: `drawn on a rig sheet, read by hdf sketch from ${names}`, source: names, tags: 'puppet,sketch,biped', ...flags },
  });
  process.stdout.write(`  parts: ${Object.keys(payload.parts).join(' ')}\n  views: ${payload.views.join(', ')}${blank.length ? `\n  drawn blank (they draw nothing): ${blank.join(', ')}` : ''}\n`);
  for (const q of photos) {
    const file = join(outDir(flags), `sketch-${name}-trace${q.read.sheet === 'biped' ? '' : '-front'}.jpg`);
    await traceCheck(q, q.read, file);
    process.stdout.write(`${file}  the ${q.read.sheet} sheet straightened: lines red, fills blue, dots green\n`);
  }
  if (flags.sheet !== false) await storeSheet(name, { root: flags.root, cycle: str(flags.cycle) || 'walk' });
  process.stdout.write(`next: hdf sheet store ${name} --vocabulary   (every pose and cycle it takes); hdf retarget --clip <biped clip> --to ${name} --name walk (no --map)\n`);
  return code;
}
