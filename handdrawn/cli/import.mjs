// hdf import: any payload into the asset store (plan 1.1). The file's bytes are the payload -- a raster keeps
// the bytes it came in as, so a cutout imported here and the same cutout inlined in a 2.0 module decode to the
// same pixels and no golden moves.
//
//   hdf import work/teapot.png --kind cutout --name teapot --credit "The Met, CC0" --source <url> --licence CC0
//   hdf import work/fox.puppet.json --kind puppet --name fox --licence own --tags fox,cast
//   hdf import work/horse.json --kind clip --name horse --licence PD
//   hdf import ... --root ../other-store          import into a store that is not handdrawn/assets
//
// A cutout is expected to be cut out already (alpha, as `hdf photo` writes it): its silhouette and colours
// table are traced here so `pin()` and `derive({ from })` see the shape they see today. The entry is validated
// before anything is written; `--licence` defaults to `unknown`, which `hdf lint` refuses to render.
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { loadImage } from 'skia-canvas';
import { ASSET_ROOT, KINDS, LICENCES, SCHEMAS, imageType, readCatalogue, validatePayload } from '../core/assets.js';
import { bounds, parse } from '../core/list.js';
import { UsageError } from './load.mjs';
import { colours, silhouette } from './photo.mjs';
import { skiaCanvas } from './skia.mjs';

export async function run(args, flags) {
  const file = args[0], kind = str(flags.kind), name = str(flags.name);
  if (!file) throw usage('import: need <file>');
  if (!KINDS.includes(kind)) throw usage(`import: --kind ${kind || '<kind>'} (expected ${KINDS.join(' | ')})`);
  if (!name) throw usage('import: need --name <id>');
  const licence = str(flags.licence) || 'unknown';
  if (!LICENCES.includes(licence)) throw usage(`import: --licence ${licence} (expected ${LICENCES.join(' | ')})`);
  const abs = resolve(file);
  if (!existsSync(abs)) throw usage(`import: no such file '${file}'`);

  const bytes = readFileSync(abs);
  const meta = {
    kind, name, file: basename(abs), licence,
    credit: str(flags.credit), source: str(flags.source),
    tags: str(flags.tags).split(',').map((t) => t.trim()).filter(Boolean),
    ...(str(flags.desc) ? { desc: str(flags.desc) } : {}),
  };
  const entry = { ...meta, ...await fields(kind, bytes, abs) };

  const st = readCatalogue(flags.root ? resolve(String(flags.root)) : ASSET_ROOT);
  const had = st.has(name) ? st.entry(name) : null;
  const put = st.put(entry, bytes);
  const where = had && had.sha === put.sha ? 'unchanged' : had ? `replaces ${had.sha.slice(0, 8)}` : 'new';
  process.stdout.write(`${name}  ${kind}  ${put.sha}.${put.ext}  ${licence}  (${where})\n`
    + `${st.payloadPath(put)}  ${(bytes.length / 1024).toFixed(0)} KB\n`);
  if (licence === 'unknown') process.stderr.write(`warning: '${name}' has licence unknown; lint rule 'credit' fails any film that renders it\n`);
  return 0;
}

const str = (v) => (v === undefined || v === true ? '' : String(v));
const usage = (msg) => new UsageError(msg);

// The entry fields a kind adds, read off the payload itself (never off flags: the payload is the truth).
async function fields(kind, bytes, abs) {
  const how = SCHEMAS[kind].payload;
  if (how === 'raster') {
    if (!imageType(bytes)) throw usage(`import: a ${kind} must be a webp, png or jpeg image`);
    const img = await loadImage(abs), w = img.width, h = img.height;
    if (kind === 'stock') return { w, h, box: [0, 0, w, h] };
    const cv = skiaCanvas(w, h);
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    const sil = silhouette(cv);
    if (sil.sub.length === 1 && sil.sub[0].pts.length <= 32 && sil.box[2] >= w - 2 && sil.box[3] >= h - 2) {
      process.stderr.write('warning: the silhouette is the whole frame -- cut the background out first (`hdf photo <img> --name <id>`)\n');
    }
    return { w, h, sil, colours: colours(cv, sil), box: [0, 0, w, h] };
  }
  if (how === 'audio') {
    if (bytes.subarray(0, 4).toString('latin1') !== 'RIFF' || bytes.subarray(8, 12).toString('latin1') !== 'WAVE') throw usage(`import: a ${kind} must be a wav file`);
    const rate = bytes.readUInt32LE(24), bits = bytes.readUInt16LE(34), ch = bytes.readUInt16LE(22);
    const sec = rate && bits && ch ? +((bytes.length - 44) / (rate * ch * bits / 8)).toFixed(3) : undefined;
    return sec > 0 ? { sec } : {};
  }
  const data = json(bytes, abs);
  const bad = validatePayload(kind, data);
  if (bad.length) throw usage(`import: this is not a valid ${kind}:\n  ${bad.join('\n  ')}`);
  if (kind === 'clip') return { n: data.n, fps: data.fps ?? 12, h: data.h, box: clipBox(data) };
  if (kind === 'puppet') return { units: data.units, box: box4(data.box) ?? puppetBox(data) };
  if (kind === 'motif') return { box: bounds(parse(JSON.stringify(data))) ?? [0, 0, 0, 0] };
  return { glyphs: Object.keys(data.glyphs).length };
}

function json(bytes, abs) {
  try { return JSON.parse(bytes.toString('utf8')); } catch (e) { throw usage(`import: ${basename(abs)} is not JSON (${e.message})`); }
}

const box4 = (b) => (Array.isArray(b) && b.length === 4 && b.every((v) => Number.isFinite(v)) ? b : null);
const unite = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]),
  Math.max(a[0] + a[2], b[0] + b[2]) - Math.min(a[0], b[0]), Math.max(a[1] + a[3], b[1] + b[3]) - Math.min(a[1], b[1])]);

// A clip's box is every pose's outer path together, in clip units (the ground at y = 0).
function clipBox(d) {
  let b = null;
  for (const f of d.frames) b = unite(b, box4(f.outer?.box) ?? boxOfSubs(f.outer));
  return b ?? [0, 0, 0, d.h];
}

// A puppet that did not declare its box: every part's ops together, pivots included.
function puppetBox(d) {
  let b = null;
  for (const p of Object.values(d.parts)) {
    for (const ops of [p.ops, ...Object.values(p.variants ?? {})]) {
      if (!Array.isArray(ops) || !ops.length) continue;
      let ob = null;
      try { ob = bounds(parse(JSON.stringify(ops))); } catch { ob = null; }
      b = unite(b, ob);
    }
  }
  return b ?? [0, 0, 0, d.units];
}

// The box of a v1-shaped outer (sub lists or raw point lists), for a clip that carries no box.
function boxOfSubs(outer) {
  const subs = Array.isArray(outer?.sub) ? outer.sub.map((s) => s.pts) : Array.isArray(outer) ? outer.map((c) => c.flat()) : [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pts of subs) for (let i = 0; i < pts.length; i += 2) {
    if (pts[i] < x0) x0 = pts[i]; if (pts[i] > x1) x1 = pts[i];
    if (pts[i + 1] < y0) y0 = pts[i + 1]; if (pts[i + 1] > y1) y1 = pts[i + 1];
  }
  return Number.isFinite(x0) ? [x0, y0, x1 - x0, y1 - y0] : null;
}
