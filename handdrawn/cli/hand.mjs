// hdf hand: hands into the store (plan 1.4). A hand is the glyphs a look letters in and the pen profile its
// strokes are drawn with; `--look 'risoPop~hand:<id>'` letters and draws a film in it.
//
//   hdf hand --template > out/hand-template.pdf         the sheet to print, all three pages (A4; --paper letter for
//                                                        US letter; --pages latin for the letters alone)
//   hdf hand latin.jpg symbols.jpg marks.jpg --name narcis   photos of the filled-in pages -> the hand 'narcis'
//   hdf hand --synth test                                a deterministic hand made from the house one (tests, goldens)
//   hdf hand --hershey scripts.jhf --name hershey-script  a Hershey font as a hand (4.0 T3; --map ascii | greek |
//                                                        cyrillic when the file's name does not say; --merge <id>
//                                                        adds its glyphs to a stored hand, the hand's own kept)
//   hdf hand --font Inter.ttf --name inter --licence OFL  a font as a hand (4.0 T4; --glyphs latin,cyrillic,greek,symbols,
//                                                        every set by default, the font drawing those it has; --px 400)
//   hdf hand --template --letter test > out/sample.jpg   a page filled in by a stored hand, as a 300 dpi JPEG
//                                                        (the latin page; --pages symbols or marks for another)
//   ... --root ../other                                  into (or from) a store that is not handdrawn/assets
//
// Reading a sheet writes the hand into the store, its page next to the house's (assets/sheets/<id>.jpg, as
// `hdf sheet --hand <id>` does) and each photo straightened with the traces over it (out/hand-<id>-trace.jpg for
// the latin page, out/hand-<id>-trace-<page>.jpg for the others). Each photo's page is read off its code, in any
// order. Boxes left blank, and pages not photographed, are drawn by the house hand, glyph by glyph; the report
// names the blank boxes.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FontLibrary, loadImage } from 'skia-canvas';
import { ASSET_ROOT, readCatalogue } from '../core/assets.js';
import { GLYPHS, MARKS, asHand } from '../core/glyphs.js';
import { FONT_MARKS, GLYPH_SETS, emScale, fontHandRecord, pressureOf, setsOf, strays } from '../core/fonthand.js';
import { MAPS, hersheyHand, mapFor, mergeHand } from '../core/hershey.js';
import {
  FRAME, PAGES, PAPERS, SHAPES, UNIT, cellToFrame, drawTemplate, emToFrame, frameOrigin, glyphBoxes, readSheet, sample, traceGlyph,
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
// two slow waves (about 2.5 em units), so every letter is recognisably itself and none is the house's. The
// house marks (4.0 T2) follow the glyphs, pushed by waves a third as big, so the hand composes its own accents.
export function synthHand(id) {
  const r = rng(hash32('hand', id)), glyphs = {}, marks = {};
  const wave = (pts, sx, sy, k) => {
    const a = (1.8 + r() * 1.4) * k, f1 = 0.04 + r() * 0.05, f2 = 0.04 + r() * 0.05, p1 = r() * 6.3, p2 = r() * 6.3, out = new Array(pts.length);
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i], y = pts[i + 1];
      out[i] = r1(x * sx + a * Math.sin(y * f1 + p1));
      out[i + 1] = r1(y * sy + a * 0.7 * Math.sin(x * f2 + p2));
    }
    return out;
  };
  for (const [ch, g] of Object.entries(GLYPHS)) {
    if (!g.s.length) { glyphs[ch] = { w: g.w, s: [] }; continue; }   // the space
    const sx = 0.9 + r() * 0.08, sy = 1.04 + r() * 0.08;
    glyphs[ch] = { w: r1(Math.max(8, g.w * sx)), s: g.s.map((pts) => wave(pts, sx, sy, 1)) };
  }
  for (const [m, g] of Object.entries(MARKS)) {
    const sx = 0.9 + r() * 0.2, sy = 0.9 + r() * 0.2;
    marks[m] = { s: g.s.map((pts) => wave(pts, sx, sy, 1 / 3)) };
  }
  return { kind: 'hand', name: id, glyphs, marks, ...SYNTH, stroke: { ...SYNTH.stroke }, credit: 'synthesised from the house hand by `hdf hand --synth`', licence: 'own' };
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

// --pages latin,marks -> ['latin', 'marks'], every page when not given.
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
  const list = [], boxes = glyphBoxes(page).filter((b) => !skip.includes(b.ch));
  // A mark is lettered as a glyph of its own (a private-use character): the hand's strokes, else the house's.
  const pua = (i) => String.fromCharCode(0xe000 + i), marks = boxes.filter((b) => MARKS[b.ch]);
  const MH = asHand({ ...H, glyphs: Object.fromEntries(marks.map((b, i) => [pua(i), { w: 60, s: (H.marks[b.ch] ?? MARKS[b.ch]).s }])) });
  for (const b of boxes) {
    const [x, y] = emToFrame(b, 12, 0), m = marks.indexOf(b);
    list.push(handText(m >= 0 ? pua(m) : b.ch, ox + x, oy + y, { size: 100 * UNIT, hand: m >= 0 ? MH : H, ink2: null }));
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
// page, the marks off the marks page (4.0 T2: the accents it composes with), the profile fitted from the page
// with the pen row (speed is not on a sheet: the house's).
export function handFromSheet(read, id, { credit = '' } = {}) {
  const reads = [read].flat(), all = Object.entries(Object.assign({}, ...reads.map((r) => r.glyphs)));
  const glyphs = Object.fromEntries(all.filter(([c]) => !MARKS[c]));
  const marks = Object.fromEntries(all.filter(([c]) => MARKS[c]).map(([c, g]) => [c, { s: g.s }]));
  const profile = reads.find((r) => r.profile.found.length)?.profile ?? {};
  const stroke = Object.fromEntries(FIELDS.filter((k) => profile[k] !== undefined).map((k) => [k, profile[k]]));
  return { kind: 'hand', name: id, glyphs, ...(Object.keys(marks).length ? { marks } : {}), stroke, credit, licence: 'own' };
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
    if (flags.letter && pages.length > 1) throw new UsageError('hand: --letter writes one page as a JPEG; say which with --pages latin, symbols or marks');
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
  if (flags.hershey !== undefined) return hershey(flags);
  if (flags.font !== undefined) return font(flags);
  if (!args.length) throw new UsageError('hand: say what to do: hdf hand --template > out/hand-template.pdf, hdf hand <page.jpg ...> --name <id>, hdf hand --hershey <file.jhf> --name <id>, hdf hand --font <file.ttf> --name <id>, or hdf hand --synth <id>');
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

// --hershey <file.jhf> --name <id> [--map] [--merge <id>]: a Hershey font into the store as a hand (licence PD,
// the Hershey notice as its credit), or its glyphs added to a stored hand (--name defaults to that hand).
async function hershey(flags) {
  const file = flags.hershey === true ? '' : String(flags.hershey);
  if (!file) throw new UsageError('hand: need --hershey <file.jhf>, e.g. hdf hand --hershey assets/src/hershey/scripts.jhf --name hershey-script');
  if (!existsSync(file)) throw new UsageError(`hand: no file ${file}`);
  const map = flags.map === undefined ? mapFor(file) : String(flags.map);
  if (!MAPS[map]) throw new UsageError(`hand: --map ${map} (expected ${Object.keys(MAPS).join(' | ')})`);
  const into = flags.merge === undefined || flags.merge === true ? '' : String(flags.merge);
  const id = flags.name === undefined || flags.name === true ? into : String(flags.name);
  if (!id) throw new UsageError('hand: need --name <id> for the hand, e.g. hdf hand --hershey scripts.jhf --name hershey-script');
  if (id === 'house') throw new UsageError("hand: 'house' is the package's own hand; name yours something else");
  let data;
  try { data = hersheyHand(readFileSync(file, 'latin1'), { name: id, map }); } catch (e) { throw new UsageError(`hand: ${basename(file)}: ${e.message}`); }
  const n = Object.keys(data.glyphs).length;
  let licence = 'PD', source = basename(file), report = `${n} glyphs from ${source} (map ${map})`;
  if (into) {
    const st = readCatalogue(flags.root ? resolve(String(flags.root)) : ASSET_ROOT);
    if (!st.has(into) || st.entry(into).kind !== 'hand') throw new UsageError(`hand: --merge ${into}: no hand '${into}' in the store`);
    const m = mergeHand({ ...st.json(into), name: id }, data);
    data = m.hand; licence = st.entry(into).licence; source = [st.entry(into).source, source].filter(Boolean).join(' + ');
    report = `${m.added.length} glyphs from ${basename(file)} (map ${map}) added to ${into}, ${m.kept.length} it has kept; ${Object.keys(data.glyphs).length} in all`;
  }
  const credit = [flags.credit === undefined || flags.credit === true ? '' : String(flags.credit), data.credit].filter(Boolean).join(' ');
  data = { ...data, credit, licence };
  const code = await putPayload({
    kind: 'hand', name: id, bytes: Buffer.from(JSON.stringify(data) + '\n'), abs: resolve(`${id}.hand.json`),
    flags: { tags: 'hand,hershey', ...flags, source, licence, credit },
  });
  process.stdout.write(`${report}\n`);
  if (flags.sheet !== false) await handSheetFile(id, flags);
  return code;
}

// ---------- a font (4.0 T4) ----------

export const FONT_PX = 400, FONT_SPUR = 2, FONT_ROUND = 0.6;
const r1f = (v) => Math.round(v * 10) / 10;

// A font file as a hand: every character of the sets the font itself draws (skia-canvas falls back to another face
// for one it lacks, and the text's runs say which face drew it), each drawn black on white at px pixels, traced as
// the sheet reader traces a box (thin serif spurs up to spur pen widths pruned, only round pieces read as dots)
// and scaled to the em by the font's own cap height and x-height (emScale) as its H and z trace, the H's foot on the
// baseline. Returns { hand, family, drawn: { set: n }, lacks: { set: [ch] }, blank: [ch], strays }.
export function fontHand(file, { name = 'font', sets = Object.keys(GLYPH_SETS), px = FONT_PX, spur = FONT_SPUR, round = FONT_ROUND, diagonal = true, credit, licence = 'unknown' } = {}) {
  const alias = `hdf-font-${hash32('font', resolve(file)).toString(36)}`;
  FontLibrary.use(alias, [resolve(file)]);
  const g = skiaCanvas(8, 8).getContext('2d');
  g.font = `${px}px "${alias}"`;
  const runs = (ch) => g.measureText(ch).lines?.[0]?.runs ?? [];
  const faceOf = (ch) => runs(ch)[0]?.family;
  // The font's own face: the one that draws most of what was asked for (skia names it from the font's metadata).
  const asked = sets.flatMap((s) => GLYPH_SETS[s]), votes = new Map();
  for (const ch of asked) { const f = faceOf(ch); if (f) votes.set(f, (votes.get(f) ?? 0) + 1); }
  const family = [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!family) throw new Error(`${basename(file)}: no glyphs drawn; is it a font file?`);
  const own = (ch) => faceOf(ch) === family;
  // The scale: first from the ink of an H and a z (or the font's metrics), then from their traced centre lines, since
  // a stroke is drawn about its centre and the house's capitals run from 72 to the baseline down theirs (a z's bars
  // and an H's stems end flat, so each traces half a pen inside its ink; an x's bars run out to the ink's corners).
  // base: the H's centre line's foot, which goes on the baseline.
  const Hc = ['H', 'Н', 'Η'].find(own), xc = ['z', 'н', 'π'].find(own), metrics = runs(asked.find(own))[0];
  let k = emScale(Hc ? g.measureText(Hc).actualBoundingBoxAscent : -metrics.capHeight, xc ? g.measureText(xc).actualBoundingBoxAscent : -metrics.xHeight);
  let ppu = 1 / k, base = 0, pen = 0;
  const pad = 8;
  const trace = (ch) => {
    const m = g.measureText(ch), L = Math.ceil(m.actualBoundingBoxLeft), A = Math.ceil(m.actualBoundingBoxAscent);
    const w = Math.max(1, L + Math.ceil(m.actualBoundingBoxRight)) + 2 * pad, h = Math.max(1, A + Math.ceil(m.actualBoundingBoxDescent)) + 2 * pad;
    const c = skiaCanvas(w, h), cx = c.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h);
    cx.fillStyle = '#000'; cx.font = g.font; cx.fillText(ch, pad + L, pad + A);
    const t = traceGlyph(lumOf(cx.getImageData(0, 0, w, h).data, w, h), [-(pad + L) * k, -(pad + A) * k, w * k, h * k], { ppu, spur, round, pen, diagonal });
    return t && { ...t, s: t.s.map((st) => st.map((v, i) => r1f(i % 2 ? v - base : v - t.dx))), adv: r1f(m.width * k) };
  };
  // The font's pen: the width of its l (or another plain stem), so a glyph that is only a dot (. ·) or two (¨) has one.
  const stem = ['l', 'I', 'і', 'ι', '|'].find(own), ref = stem && trace(stem);
  pen = ref ? ref.pen * ppu : 0;
  const span = (ch) => { const ys = ch ? trace(ch)?.s.flat().filter((_, i) => i % 2) : null; return ys?.length ? [Math.min(...ys), Math.max(...ys)] : null; };
  const Hs = span(Hc), xs = span(xc);
  if (Hs && xs && Hs[1] - Hs[0] > 0 && xs[1] - xs[0] > 0) {
    const f = emScale((Hs[1] - Hs[0]) / k, (xs[1] - xs[0]) / k) / k;
    k *= f; ppu = 1 / k; base = Hs[1] * f;
  }
  const glyphs = {}, traced = [], drawn = {}, lacks = {}, blank = [];
  if (own(' ') || !faceOf(' ')) glyphs[' '] = { w: r1f(g.measureText(' ').width * k), s: [] };
  for (const set of sets) {
    drawn[set] = 0; lacks[set] = [];
    for (const ch of GLYPH_SETS[set]) {
      if (glyphs[ch]) continue;
      if (!own(ch)) { lacks[set].push(ch); continue; }
      const t = trace(ch);
      if (!t) { blank.push(ch); continue; }
      glyphs[ch] = { w: Math.max(1, t.adv), s: t.s };
      traced.push(t); drawn[set]++;
    }
  }
  const marks = {};
  for (const [m, ch] of Object.entries(FONT_MARKS)) {
    const t = own(ch) ? trace(ch) : null;
    if (t) marks[m] = { s: t.s };
  }
  const hand = fontHandRecord({ name, glyphs, marks, pressure: pressureOf(traced), credit: credit ?? `${family}, traced from ${basename(file)} by hdf hand --font`, licence });
  return { hand, family, drawn, lacks, blank, strays: strays(glyphs) };
}

// --font <file> --name <id> [--glyphs] [--px] [--licence]: a font into the store as a hand. Without --licence the
// hand is 'unknown' (a warning, and lint 'credit' fails a film that letters in it).
async function font(flags) {
  const file = flags.font === true ? '' : String(flags.font);
  if (!file) throw new UsageError('hand: need --font <file.ttf|otf>, e.g. hdf hand --font ../fonts/Inter-Regular.ttf --name inter --licence OFL');
  if (!existsSync(file)) throw new UsageError(`hand: no file ${file}`);
  const id = flags.name === undefined || flags.name === true ? '' : String(flags.name);
  if (!id) throw new UsageError('hand: need --name <id> for the hand, e.g. hdf hand --font Inter-Regular.ttf --name inter');
  if (id === 'house') throw new UsageError("hand: 'house' is the package's own hand; name yours something else");
  let sets;
  try { sets = setsOf(flags.glyphs); } catch (e) { throw new UsageError(`hand: ${e.message}`); }
  const px = flags.px === undefined ? FONT_PX : Number(flags.px);
  if (!(px >= 50 && px <= 2000)) throw new UsageError(`hand: --px ${flags.px} (the size glyphs are drawn at, 50 to 2000)`);
  const licence = flags.licence === undefined || flags.licence === true ? 'unknown' : String(flags.licence);
  const got = fontHand(file, { name: id, sets, px, licence, ...(flags.credit === undefined || flags.credit === true ? {} : { credit: String(flags.credit) }) });
  const { hand } = got;
  const code = await putPayload({
    kind: 'hand', name: id, bytes: Buffer.from(JSON.stringify(hand) + '\n'), abs: resolve(`${id}.hand.json`),
    flags: { tags: 'hand,font', ...flags, source: basename(file), licence, credit: hand.credit },
  });
  const n = Object.keys(hand.glyphs).length, m = Object.keys(hand.marks ?? {}).length;
  process.stdout.write(`${n} glyphs from ${got.family} (${sets.map((s) => `${s} ${got.drawn[s]}/${GLYPH_SETS[s].length}`).join(', ')}), ${m} marks; pressure ${hand.stroke.pressure.join('/')}\n`);
  for (const s of sets) if (got.lacks[s].length && got.drawn[s]) process.stdout.write(`the font lacks ${got.lacks[s].length} ${s}: ${got.lacks[s].slice(0, 40).join(' ')}${got.lacks[s].length > 40 ? ' ...' : ''}\n`);
  if (got.blank.length) process.stdout.write(`drawn blank: ${got.blank.join(' ')}\n`);
  if (got.strays.length) process.stdout.write(`eyeball on the sheet (strokes vs the house's): ${got.strays.map((x) => `${x.ch} ${x.n}/${x.house}`).join(', ')}\n`);
  if (flags.sheet !== false) await handSheetFile(id, flags);
  return code;
}

const entry = process.argv[1] && existsSync(process.argv[1]) ? realpathSync(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  const { args, flags } = parseArgs(process.argv.slice(2));
  run(args, flags).then((code) => { process.exitCode = code; }, (e) => { process.stderr.write(`hand: ${e.message}\n`); process.exitCode = e instanceof UsageError ? 2 : 1; });
}

