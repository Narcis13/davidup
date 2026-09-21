// hdf hand: hands into the store (plan 1.4). A hand is the glyphs a look letters in and the pen profile its
// strokes are drawn with; `--look 'risoPop~hand:<id>'` letters and draws a film in it.
//
//   hdf hand --template > out/hand-template.pdf         the sheet to print, both pages (A4; --paper letter for US
//                                                        letter; --pages latin for the letters alone)
//   hdf hand latin.jpg symbols.jpg --name narcis         photos of the filled-in pages -> the hand 'narcis'
//   hdf hand --synth test                                a deterministic hand made from the house one (tests, goldens)
//   hdf hand --template --letter test > out/sample.jpg   a page filled in by a stored hand, as a 300 dpi JPEG
//                                                        (the latin page; --pages symbols for the other)
//   ... --root ../other                                  into (or from) a store that is not handdrawn/assets
//
// Reading a sheet writes the hand into the store, its page next to the house's (assets/sheets/<id>.jpg, as
// `hdf sheet --hand <id>` does) and each photo straightened with the traces over it (out/hand-<id>-trace.jpg for
// the latin page, out/hand-<id>-trace-<page>.jpg for the others). Each photo's page is read off its code, in any
// order. Boxes left blank, and pages not photographed, are drawn by the house hand, glyph by glyph; the report
// names the blank boxes.
import { existsSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadImage } from 'skia-canvas';
import { ASSET_ROOT, readCatalogue } from '../core/assets.js';
import { GLYPHS, asHand } from '../core/glyphs.js';
import {
  FRAME, PAGES, PAPERS, SHAPES, UNIT, cellToFrame, drawTemplate, emToFrame, frameOrigin, glyphBoxes, readSheet, sample,
} from '../core/handsheet.js';
import { group, poly, stroke } from '../core/list.js';
import { LOOKS, modifyLook } from '../core/looks.js';
import { hash32, rng } from '../core/rand.js';
import { handText } from '../core/text.js';
import { place } from '../core/tree.js';
import { putPayload } from './import.mjs';
import { parseArgs } from './hdf.mjs';
import { UsageError } from './load.mjs';
import { outDir, paint } from './sheets.mjs';
import { handSheetFile } from './sheet.mjs';
import { skiaCanvas } from './skia.mjs';

// The synthetic hand's profile: a backhand (slant -6), looser and faster than the house, corners run past,
// lines hooked on entry, pressed hardest mid-stroke.
export const SYNTH = Object.freeze({
  track: 6, slant: -6, baselineDrift: 1.8,
  stroke: { wobble: 2.2, overshoot: 0.15, hook: 0.35, pressure: [0.7, 1, 0.85], speed: 1150, tremor: 0.5, rounding: 0.3 },
});

const r1 = (v) => Math.round(v * 10) / 10;

// The house glyphs perturbed by a seeded rng: each glyph a little narrower and taller, each stroke pushed by
// two slow waves (about 2.5 em units), so every letter is recognisably itself and none is the house's.
export function synthHand(id) {
  const r = rng(hash32('hand', id)), glyphs = {};
  for (const [ch, g] of Object.entries(GLYPHS)) {
    if (!g.s.length) { glyphs[ch] = { w: g.w, s: [] }; continue; }   // the space
    const sx = 0.9 + r() * 0.08, sy = 1.04 + r() * 0.08;
    glyphs[ch] = {
      w: r1(Math.max(8, g.w * sx)),
      s: g.s.map((pts) => {
        const a = 1.8 + r() * 1.4, f1 = 0.04 + r() * 0.05, f2 = 0.04 + r() * 0.05, p1 = r() * 6.3, p2 = r() * 6.3, out = new Array(pts.length);
        for (let i = 0; i < pts.length; i += 2) {
          const x = pts[i], y = pts[i + 1];
          out[i] = r1(x * sx + a * Math.sin(y * f1 + p1));
          out[i + 1] = r1(y * sy + a * 0.7 * Math.sin(x * f2 + p2));
        }
        return out;
      }),
    };
  }
  return { kind: 'hand', name: id, glyphs, ...SYNTH, stroke: { ...SYNTH.stroke }, credit: 'synthesised from the house hand by `hdf hand --synth`', licence: 'own' };
}

// ---------- the template ----------

const PT = 72 / 25.4;   // points per mm

// The empty template as a PDF, a page for each of pages (names in PAGES).
export async function templatePdf(paper = 'a4', pages = Object.keys(PAGES)) {
  const [pw, ph] = PAPERS[paper];
  const canvas = skiaCanvas(pw * PT, ph * PT);
  for (const page of pages) {
    const ctx = canvas.newPage(pw * PT, ph * PT);
    ctx.scale(PT, PT);
    drawTemplate(ctx, paper, page);
  }
  return canvas.toBuffer('pdf');
}

// --pages latin,symbols -> ['latin', 'symbols'], every page when not given.
export function pagesOf(flag) {
  if (flag === undefined) return Object.keys(PAGES);
  const pages = String(flag).split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
  const bad = pages.filter((p) => !PAGES[p]);
  if (!pages.length || bad.length) throw new UsageError(`hand: --pages ${flag} (expected a list of ${Object.keys(PAGES).join(', ')})`);
  return [...new Set(pages)];
}

// A page of the template filled in by a hand record, as a skia canvas at dpi: every box lettered by handText
// in that hand, the pen row (on the latin page) drawn with its pen (a look carrying the hand, so wobble,
// overshoot, hook and pressure all apply). This is how the package tests `hdf hand` without a photo; w is the
// pen row's width in em units.
export function letterSheet(hand, { paper = 'a4', page = 'latin', dpi = 300, w = 4.5, skip = [] } = {}) {
  const [pw, ph] = PAPERS[paper], k = dpi / 25.4, [ox, oy] = frameOrigin(paper), H = asHand(hand);
  const canvas = skiaCanvas(Math.round(pw * k), Math.round(ph * k)), ctx = canvas.getContext('2d');
  ctx.save(); ctx.scale(k, k); drawTemplate(ctx, paper, page); ctx.restore();
  const list = [];
  for (const b of glyphBoxes(page)) {
    if (skip.includes(b.ch)) continue;
    const [x, y] = emToFrame(b, 12, 0);
    list.push(handText(b.ch, ox + x, oy + y, { size: 100 * UNIT, hand: H, ink2: null }));
  }
  for (const c of PAGES[page].pen ? SHAPES : []) {
    const [x, y] = cellToFrame(c, 0, 0);
    list.push(place(ox + x, oy + y, { scale: UNIT }, group(`pen:${c.name}`, c.paths.map((p, i) => stroke(poly(p, false), 'ink', { w, name: `${c.name}${i}` })))));
  }
  const look = modifyLook(LOOKS.paperInk, [['hand', H.name]], { [H.name]: H });
  paint(list, { look, W: pw, H: ph, width: canvas.width, onto: canvas, seed: hash32('sheet', H.name) });
  return canvas;
}

// ---------- reading a photo ----------

// An image file as a luminance plane { data, w, h } (0..1).
export async function luminance(file) {
  const img = await loadImage(file), w = img.width, h = img.height, c = skiaCanvas(w, h), g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  return lumOf(g.getImageData(0, 0, w, h).data, w, h);
}
export function lumOf(rgba, w, h) {
  const data = new Float32Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = (0.299 * rgba[4 * i] + 0.587 * rgba[4 * i + 1] + 0.114 * rgba[4 * i + 2]) / 255;
  return { data, w, h };
}

const FIELDS = ['wobble', 'overshoot', 'hook', 'pressure', 'tremor', 'rounding'];

// Read sheet pages (one readSheet() result, or a list of them) as a hand record: the glyphs written on every
// page, the profile fitted from the page with the pen row (speed is not on a sheet: the house's).
export function handFromSheet(read, id, { credit = '' } = {}) {
  const reads = [read].flat(), glyphs = Object.assign({}, ...reads.map((r) => r.glyphs));
  const profile = reads.find((r) => r.profile.found.length)?.profile ?? {};
  const stroke = Object.fromEntries(FIELDS.filter((k) => profile[k] !== undefined).map((k) => [k, profile[k]]));
  return { kind: 'hand', name: id, glyphs, stroke, credit, licence: 'own' };
}

// The photo straightened (3 px per mm) with every trace over it in red and blank boxes crossed out.
async function traceCheck(img, read, file) {
  const S = 3, [W, H] = FRAME, fw = W * S, fh = H * S;
  const flat = sample(img, read.at, (x, y) => [x, y], [0, 0, W, H], S);
  const c = skiaCanvas(fw, fh), g = c.getContext('2d'), id = g.createImageData(fw, fh);
  for (let i = 0; i < flat.data.length; i++) { const v = Math.round(flat.data[i] * 255); id.data.set([v, v, v, 255], 4 * i); }
  g.putImageData(id, 0, 0);
  g.scale(S, S);
  g.lineWidth = 0.35; g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = 'rgba(230,30,30,.9)';
  for (const strokes of Object.values(read.traced)) for (const s of strokes) {
    g.beginPath(); s.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
  }
  g.strokeStyle = 'rgba(230,120,0,.9)';
  for (const b of glyphBoxes(read.page)) {
    if (!read.missing.includes(b.ch)) continue;
    g.beginPath(); g.moveTo(b.x + 2, b.y + 2); g.lineTo(b.x + b.w - 2, b.y + b.h - 2); g.moveTo(b.x + b.w - 2, b.y + 2); g.lineTo(b.x + 2, b.y + b.h - 2); g.stroke();
  }
  await c.toFile(file, { quality: 0.88 });
}

export async function run(args, flags) {
  if (flags.template) {
    const paper = flags.paper === undefined ? 'a4' : String(flags.paper).toLowerCase();
    if (!PAPERS[paper]) throw new UsageError(`hand: --paper ${paper} (expected ${Object.keys(PAPERS).join(' | ')})`);
    const pages = flags.letter && flags.pages === undefined ? ['latin'] : pagesOf(flags.pages);
    if (flags.letter && pages.length > 1) throw new UsageError('hand: --letter writes one page as a JPEG; say which with --pages latin or --pages symbols');
    if (process.stdout.isTTY) throw new UsageError(`hand: --template writes ${flags.letter ? 'a JPEG' : 'a PDF'} to stdout; redirect it, e.g. hdf hand --template > out/hand-template.${flags.letter ? 'jpg' : 'pdf'}`);
    let bytes;
    if (flags.letter) {
      const id = String(flags.letter), st = readCatalogue(flags.root ? resolve(String(flags.root)) : ASSET_ROOT);
      if (!st.has(id) || st.entry(id).kind !== 'hand') throw new UsageError(`hand: no hand '${id}' in the store`);
      bytes = await letterSheet({ ...st.json(id), name: id }, { paper, page: pages[0] }).toBuffer('jpg', { quality: 0.9 });
    } else bytes = await templatePdf(paper, pages);
    await new Promise((ok, fail) => process.stdout.write(bytes, (e) => (e ? fail(e) : ok())));
    return 0;
  }
  if (flags.synth !== undefined) {
    const id = flags.synth === true ? '' : String(flags.synth);
    if (!id) throw new UsageError('hand: need --synth <id>');
    const data = synthHand(id);
    return putPayload({
      kind: 'hand', name: id, bytes: Buffer.from(JSON.stringify(data) + '\n'), abs: resolve(`${id}.hand.json`),
      flags: { licence: 'own', credit: data.credit, tags: 'hand,synthetic', ...flags },
    });
  }
  if (!args.length) throw new UsageError('hand: say what to do: hdf hand --template > out/hand-template.pdf, hdf hand <page.jpg ...> --name <id>, or hdf hand --synth <id>');
  const id = flags.name === undefined || flags.name === true ? '' : String(flags.name);
  if (!id) throw new UsageError('hand: need --name <id> for the hand, e.g. hdf hand latin.jpg symbols.jpg --name narcis');
  if (id === 'house') throw new UsageError("hand: 'house' is the package's own hand; name yours something else");
  for (const file of args) if (!existsSync(file)) throw new UsageError(`hand: no file ${file}`);

  const photos = [];
  for (const file of args) {
    const img = await luminance(file), read = readSheet(img, { ratio: flags.thr }), twin = photos.find((p) => p.read.page === read.page);
    if (twin) throw new UsageError(`hand: ${basename(twin.file)} and ${basename(file)} are both the ${read.page} page`);
    photos.push({ file, img, read });
  }
  const reads = photos.map((p) => p.read), boxes = reads.reduce((t, r) => t + PAGES[r.page].chars.length, 0);
  const n = reads.reduce((t, r) => t + Object.keys(r.glyphs).length, 0), missing = reads.flatMap((r) => r.missing);
  if (n < 10) throw new Error(`hand: only ${n} of ${boxes} boxes have writing in them; is this a filled-in hand sheet (hdf hand --template)?`);
  const names = photos.map((p) => basename(p.file)).join(', ');
  const data = handFromSheet(reads, id, { credit: flags.credit === undefined ? `traced by hdf hand from ${names}` : String(flags.credit) });
  const code = await putPayload({
    kind: 'hand', name: id, bytes: Buffer.from(JSON.stringify(data) + '\n'), abs: resolve(`${id}.hand.json`),
    flags: { licence: 'own', credit: data.credit, source: names, tags: 'hand,sheet', ...flags },
  });
  const p = reads.find((r) => PAGES[r.page].pen)?.profile;
  process.stdout.write(`${n} of ${boxes} glyphs traced (${reads.map((r) => r.page).join(' + ')})${missing.length ? `; the house draws ${missing.join(' ')}` : ''}\n`);
  if (p) {
    process.stdout.write(`pen: ${FIELDS.filter((k) => p[k] !== undefined).map((k) => `${k} ${Array.isArray(p[k]) ? p[k].join('/') : p[k]}`).join(', ')}`
      + `${p.pen ? `, width ${p.pen} em` : ''}  (from ${p.found.join(' and ') || 'nothing: the pen row is blank, the house pen stands in'})\n`);
  } else process.stdout.write('pen: the house pen (the pen row is on the latin page)\n');
  for (const { img, read } of photos) {
    const check = join(outDir(flags), `hand-${id}-trace${read.page === 'latin' ? '' : `-${read.page}`}.jpg`);
    await traceCheck(img, read, check);
    process.stdout.write(`${check}  the ${read.page} page straightened, traces in red\n`);
  }
  if (flags.sheet !== false) await handSheetFile(id, flags);
  return code;
}

const entry = process.argv[1] && existsSync(process.argv[1]) ? realpathSync(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  const { args, flags } = parseArgs(process.argv.slice(2));
  run(args, flags).then((code) => { process.exitCode = code; }, (e) => { process.stderr.write(`hand: ${e.message}\n`); process.exitCode = e instanceof UsageError ? 2 : 1; });
}

