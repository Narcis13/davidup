// hdf's previewers (asset-library plan H3): the picture the asset library shows for each of the seven kinds hdf
// draws, in place of the fallback card. `asset thumb`, `asset sheet` and davidup's get_asset_preview find them
// through host.mjs, which loads this module (and skia) only when a thumb is drawn.
//
//   puppet   its rest pose; a turnaround's views side by side (side, three-quarter, front)
//   hand     its name and a pangram in its own letters (Cyrillic or Greek when that is what it draws)
//   motif    its op list, fitted
//   cutout   the pixels with the silhouette hdf traced drawn round them
//   clip     four frames spread over the clip, as sticks where it has a skeleton, else as outlines; a track
//            (4.0 K7) as its channels over time
//   sample   the waveform, the words hdf aligned as ticks under it, the copy lettered over it
//   stock    the paper at 1:1 with a pen stroke over it
//
// Each is render(file, record, { width }) -> PNG bytes, `width` x 2/3 `width` (the card's shape, so a contact
// sheet lines up), drawn in paperInk from a seed of the record's id: the same record draws the same thumb.
// `hdf sheet store <id>` stays the full check and model sheets; these are the one look an agent takes first.
import { readFileSync } from 'node:fs';
import { loadImage } from 'skia-canvas';
import { bounds, circle, fill, group, image, line, mkPath, norm, paper, parse, poly, rect, stroke } from '../core/list.js';
import { LOOKS, modifyLook } from '../core/looks.js';
import { VIEW_DIRS, puppet } from '../core/puppet.js';
import { hash32 } from '../core/rand.js';
import { handText } from '../core/text.js';
import { asHand } from '../core/glyphs.js';
import { decodeWav } from '../core/wav.js';
import { createRenderer } from '../core/raster.js';
import { place, seedList } from '../core/tree.js';
import { skiaCanvas } from './skia.mjs';

// The logical page every preview is laid out on; it is painted `width` pixels wide.
const W = 480, H = 320, M = 18;
const LOOK = LOOKS.paperInk;

// A display list painted W x H at `width` pixels, as PNG bytes. `images` maps an image op's src to a decoded image.
async function draw(list, { id, look = LOOK, width = W, images = null }) {
  const S = width / W, canvas = skiaCanvas(Math.round(W * S), Math.round(H * S));
  const r = createRenderer({ makeCanvas: skiaCanvas, dedup: false, images });
  r.draw(canvas.getContext('2d'), seedList(norm(list), hash32('preview', id)), { look, S, W, H });
  return canvas.toBuffer('png');
}

// `g`, whose own box is [bx, by, bw, bh], scaled to fit the box [x, y, w, h] and centred in it.
function fit(g, [bx, by, bw, bh], [x, y, w, h], most = Infinity) {
  const k = Math.min(w / (bw || 1), h / (bh || 1), most);
  return { k, op: place(x + w / 2 - (bx + bw / 2) * k, y + h / 2 - (by + bh / 2) * k, k === 1 ? {} : { scale: k }, g) };
}

// `n` boxes side by side across the page inside the margin.
function cells(n, { top = M, bottom = H - M, gap = 12 } = {}) {
  const w = (W - 2 * M - (n - 1) * gap) / n;
  return Array.from({ length: n }, (_, i) => [M + i * (w + gap), top, w, bottom - top]);
}

const idOf = (record) => record.id ?? record.name ?? 'asset';
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));

// ---------- puppet ----------

// The rest pose, or a turnaround's views (each dir once, side first), every figure at one scale.
async function puppetPreview(file, record, { width }) {
  const id = idOf(record), make = puppet({ ...json(file), name: id });
  const rest = make.rest ?? {}, box = make.cel?.box ?? record.box;
  const dirs = [...new Set((make.views ?? []).map((v) => VIEW_DIRS[v] ?? 1))].sort((a, b) => b - a).slice(0, 3);
  const figures = dirs.length > 1 ? dirs.map((dir) => make({ ...rest, dir })) : [make(rest)];
  const boxes = cells(figures.length), k = Math.min(...boxes.map((b) => Math.min(b[2] / box[2], b[3] / box[3])));
  return draw([paper(), ...figures.map((g, i) => fit(g, box, boxes[i], k).op)], { id, width });
}

// ---------- hand ----------

const PANGRAMS = [
  'The quick brown fox jumps over the lazy dog.',
  'Съешь же ещё этих мягких французских булок, да выпей чаю.',
  'Ξεσκεπάζω την ψυχοφθόρα βδελυγμία.',
];

// The pangram whose letters the hand has most of (a Hershey Cyrillic hand has no Latin of its own). Its glyph
// keys, not glyph(): a letter no hand has draws as the hand's own '?'.
function pangramFor(glyphs) {
  const own = (s) => { const cs = [...new Set(s.normalize('NFD').replace(/[^\p{L}]/gu, ''))]; return cs.filter((c) => glyphs[c]).length / cs.length; };
  return PANGRAMS.map((p) => [p, own(p)]).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}

async function handPreview(file, record, { width }) {
  const id = idOf(record), rec = { ...json(file), name: id }, hand = asHand(rec);
  const look = modifyLook(LOOK, [['hand', id]], { [id]: rec });
  const list = [
    paper(),
    handText(id, M + 4, M + 44, { size: 44, hand, ink2: null }),
    stroke(line(M, M + 62, W - M, M + 62), 'guide', { w: 1, wobble: 0 }),
    handText(pangramFor(rec.glyphs), M + 4, M + 112, { size: 38, width: W - 2 * M - 8, maxLines: 4, hand, ink2: null }),
  ];
  return draw(list, { id, look, width });
}

// ---------- motif ----------

async function motifPreview(file, record, { width }) {
  const id = idOf(record), ops = parse(readFileSync(file, 'utf8')), g = group(`motif:${id}`, ops);
  const box = record.box ?? bounds(ops);
  return draw([paper(), fit(g, box, [M, M, W - 2 * M, H - 2 * M]).op], { id, width });
}

// ---------- cutout ----------

// The pixels over the paper, fitted, and the silhouette hdf traced (record.sil, in the cutout's pixels) in red.
async function cutoutPreview(file, record, { width }) {
  const id = idOf(record), img = await loadImage(file), w = record.w ?? img.width, h = record.h ?? img.height;
  const kids = [image(id, 0, 0, w, h)];
  const k = Math.min((W - 2 * M) / w, (H - 2 * M) / h);
  if (record.sil?.sub?.length) kids.push(stroke(mkPath(record.sil.sub), 'inks.1', { w: 2.2 / k, wobble: 0 }));
  const { op } = fit(group(`cutout:${id}`, kids), [0, 0, w, h], [M, M, W - 2 * M, H - 2 * M]);
  return draw([paper(), op], { id, width, images: new Map([[id, img]]) });
}

// ---------- clip ----------

// A frame as sticks: every chain of its skeleton a line, every joint a dot; the outline faint behind.
function sticks(f, k) {
  const out = [stroke(mkPath(f.outer.sub), { base: 'ink', alpha: 0.28 }, { w: 1.4 / k, wobble: 0 })];
  for (const chain of f.skel.chains ?? []) {
    const pts = chain.map((j) => f.skel.joints[j]).filter(Boolean);
    if (pts.length > 1) out.push(stroke(poly(pts, false), 'ink', { w: 3.4 / k }));
  }
  for (const p of Object.values(f.skel.joints ?? {})) out.push(fill(circle(p[0], p[1], 3.6 / k, 12), 'inks.1'));
  return out;
}
// A frame as it was traced: the outline and the inner lines.
const outline = (f, k) => [stroke(mkPath(f.outer.sub), 'ink', { w: 2.2 / k }), ...(f.lines ?? []).map((l) => stroke(mkPath(l.path.sub), 'ink', { w: Math.max(1.2, l.w * 0.5) / k }))];

async function clipPreview(file, record, { width }) {
  const id = idOf(record), d = json(file);
  if (d.track) return trackPreview(id, d, width);
  const n = d.frames.length, picks = [...new Set([0, 1, 2, 3].map((j) => Math.round((j * n) / 4) % n))];
  const box = record.box ?? bounds(d.frames.map((f) => stroke(mkPath(f.outer.sub))));
  const boxes = cells(picks.length, { gap: 6 }), k = Math.min(...boxes.map((b) => Math.min(b[2] / box[2], b[3] / box[3])));
  const figs = picks.map((i, j) => {
    const f = d.frames[i];
    return fit(group(`frame:${i}`, f.skel ? sticks(f, k) : outline(f, k)), box, boxes[j], k).op;
  });
  // The ground the clip stands on, under all four.
  const ground = boxes[0][1] + boxes[0][3] / 2 - (box[1] + box[3] / 2) * k;
  return draw([paper(), stroke(line(M, ground, W - M, ground), 'guide', { w: 1, wobble: 0 }), ...figs], { id, width });
}

// A face or hands track: each channel over the frames, scaled to its own range, one line per channel.
function trackPreview(id, d, width) {
  const channels = d.track === 'face'
    ? d.keys.map((_, c) => d.frames.map((f) => f[c]))
    : ['l', 'r'].flatMap((s) => [0, 1, 2, 3, 4].map((c) => d.frames.map((f) => f[s]?.[c] ?? null)));
  const [x0, y0, pw, ph] = [M, M + 48, W - 2 * M, H - 2 * M - 48], list = [paper(), handText(`${d.track} track, ${d.n} frames`, M + 4, M + 32, { size: 30, ink2: null })];
  list.push(stroke(rect(x0, y0, pw, ph), 'guide', { w: 1, wobble: 0 }));
  channels.forEach((vs, c) => {
    const ok = vs.filter((v) => v !== null && Number.isFinite(v)), lo = Math.min(...ok), hi = Math.max(...ok);
    let run = [];
    const flush = () => { if (run.length > 1) list.push(stroke(poly(run, false), c < 3 ? `inks.${c}` : `fills.${c % 4}`, { w: 1.6, wobble: 0 })); run = []; };
    vs.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) return flush();
      run.push([x0 + (vs.length > 1 ? (i / (vs.length - 1)) * pw : pw / 2), y0 + ph - 6 - (hi > lo ? (v - lo) / (hi - lo) : 0.5) * (ph - 12)]);
    });
    flush();
  });
  return draw(list, { id, width });
}

// ---------- sample ----------

// The waveform (each column the loudest sample under it, up and down from the middle), a tick where each
// aligned word starts, and the copy (the aligned text, else the description) lettered above.
async function samplePreview(file, record, { width }) {
  const id = idOf(record), x = decodeWav(readFileSync(file)), copy = record.align?.text ?? record.desc ?? id;
  const x0 = M, pw = W - 2 * M, mid = 196, amp = 64, cols = Math.round(pw / 2);
  const per = x.length / cols;
  let peak = 1e-6;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  const list = [paper(), handText(copy, M + 4, M + 34, { size: 30, width: pw - 8, maxLines: 2, ink2: null })];
  list.push(stroke(line(x0, mid, x0 + pw, mid), 'guide', { w: 1, wobble: 0 }));
  for (let c = 0; c < cols; c++) {
    let a = 0;
    for (let i = Math.floor(c * per), e = Math.min(x.length, Math.floor((c + 1) * per)); i < e; i++) a = Math.max(a, Math.abs(x[i]));
    const h = Math.max(0.6, (a / peak) * amp), cx = x0 + (c + 0.5) * (pw / cols);
    list.push(stroke(line(cx, mid - h, cx, mid + h), 'ink', { w: 1.4, wobble: 0 }));
  }
  const sec = x.length / 44100 || record.sec || 1;
  for (const [, t0] of record.align?.words ?? []) {
    const tx = x0 + Math.min(1, t0 / sec) * pw;
    list.push(stroke(line(tx, mid + amp + 6, tx, mid + amp + 16), 'inks.1', { w: 1.8, wobble: 0 }));
  }
  list.push(handText(`${(record.sec ?? sec).toFixed(1)} s${record.align ? `, ${record.align.words.length} words` : ''}${record.mouth ? ', mouth' : ''}`, W - M - 4, H - 10, { size: 20, align: 'right', ink2: null }));
  return draw(list, { id, width });
}

// ---------- stock ----------

// The paper at 1:1 (scaled up only when it is smaller than the thumb), centred, with a pen stroke across it.
async function stockPreview(file, record, { width }) {
  const id = idOf(record), img = await loadImage(file), w = record.w ?? img.width, h = record.h ?? img.height;
  const k = Math.max(1, W / w, H / h);
  const pen = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24; pen.push([M * 2 + t * (W - 4 * M), H / 2 + Math.sin(t * Math.PI * 2.2) * 56 * (1 - t * 0.4)]); }
  const list = [image(id, (W - w * k) / 2, (H - h * k) / 2, w * k, h * k), stroke(poly(pen, false), 'ink', { w: 3.2 })];
  return draw(list, { id, width, images: new Map([[id, img]]) });
}

export const RENDERERS = {
  puppet: puppetPreview, hand: handPreview, motif: motifPreview, cutout: cutoutPreview,
  clip: clipPreview, sample: samplePreview, stock: stockPreview,
};
