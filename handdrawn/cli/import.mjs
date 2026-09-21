// hdf import: any payload into the asset store (plan 1.1). The file's bytes are the payload -- a raster keeps
// the bytes it came in as, so a cutout imported here and the same cutout inlined in a 2.0 module decode to the
// same pixels and no golden moves.
//
//   hdf import work/teapot.png --kind cutout --name teapot --credit "The Met, CC0" --source <url> --licence CC0
//   hdf import work/fox.puppet.json --kind puppet --name fox --licence own --tags fox,cast
//   hdf import work/horse.json --kind clip --name horse --licence PD
//   hdf import ... --root ../other-store          import into a store that is not handdrawn/assets
//   hdf import --v2 films/held-once-photos.js --licence CC0   a 2.0 data module: every record into the store
//
// A stick source (`hdf stick` writes one, 4.0 K2) imported as a puppet is compiled to parts on the way in.
//
// A cutout is expected to be cut out already (alpha, as `hdf photo` writes it): its silhouette and colours
// table are traced here so `pin()` and `derive({ from })` see the shape they see today. The entry is validated
// before anything is written; `--licence` defaults to `unknown`, which `hdf lint` refuses to render.
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadImage } from 'skia-canvas';
import { ASSET_ROOT, KINDS, LICENCES, SCHEMAS, imageType, readCatalogue, validatePayload } from '../core/assets.js';
import { bounds, parse } from '../core/list.js';
import { lintPuppet } from '../core/lint.js';
import { checkStick, compileStick, isStick } from '../core/stick.js';
import { UsageError } from './load.mjs';
import { colours, silhouette } from './photo.mjs';
import { skiaCanvas } from './skia.mjs';

export async function run(args, flags) {
  if (flags.v2) return importV2(String(flags.v2 === true ? args[0] : flags.v2), flags);
  const file = args[0], kind = str(flags.kind), name = str(flags.name);
  if (!file) throw usage('import: need <file>');
  if (!KINDS.includes(kind)) throw usage(`import: --kind ${kind || '<kind>'} (expected ${KINDS.join(' | ')})`);
  if (!name) throw usage('import: need --name <id>');
  const abs = resolve(file);
  if (!existsSync(abs)) throw usage(`import: no such file '${file}'`);

  return putPayload({ kind, name, bytes: readFileSync(abs), abs, flags });
}

// Validates a payload, puts it in the store (--root, or handdrawn/assets) under `name` and says what changed.
// `hdf svg` hands its puppet or motif here, so an SVG import passes every check a JSON import does.
export async function putPayload({ kind, name, bytes, abs, flags }) {
  bytes = stickBytes(kind, name, bytes, abs);
  const licence = str(flags.licence) || 'unknown';
  if (!LICENCES.includes(licence)) throw usage(`import: --licence ${licence} (expected ${LICENCES.join(' | ')})`);
  const meta = {
    kind, name, file: basename(abs), licence,
    credit: str(flags.credit), source: str(flags.source),
    tags: str(flags.tags).split(',').map((t) => t.trim()).filter(Boolean),
    ...(str(flags.desc) ? { desc: str(flags.desc) } : {}),
  };
  const entry = { ...meta, ...await fields(kind, bytes, abs, name) };

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

// A stick source (4.0 K2: kind 'stick', joints and bones) goes in compiled, so the store holds ordinary parts
// and every reader of a puppet sees one; the source rides along as the payload's `stick`.
function stickBytes(kind, name, bytes, abs) {
  if (kind !== 'puppet') return bytes;
  let d;
  try { d = JSON.parse(bytes.toString('utf8')); } catch { return bytes; }
  if (!isStick(d)) return bytes;
  const bad = checkStick(d);
  if (bad.length) throw usage(`import: ${basename(abs)} is not a valid stick:\n  ${bad.join('\n  ')}`);
  return Buffer.from(JSON.stringify(compileStick({ ...d, name })));
}
const usage = (msg) => new UsageError(msg);

// The entry fields a kind adds, read off the payload itself (never off flags: the payload is the truth).
async function fields(kind, bytes, abs, name) {
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
  if (kind === 'puppet') {
    // The rules a puppet has to pass before it is in the store: joints on the grid, roles instead of hex, and
    // a box that holds every pose, every variant and every cycle frame (`hdf sheet store <id>` draws them).
    const found = lintPuppet(data, name);
    if (found.length) throw usage(`import: this puppet does not pass lint:\n  ${found.map((f) => `${f.rule}  ${f.detail}`).join('\n  ')}`);
    return { units: data.units, box: box4(data.box) ?? puppetBox(data) };
  }
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
    const lists = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.values(v) : [v]);   // keyed by view, or not
    for (const ops of [...lists(p.ops), ...Object.values(p.variants ?? {}).flatMap(lists)]) {
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

// ---------- --v2: a 2.0 data module into the store ----------

// The kind a 2.0 record is: a clip carries its poses, a cutout its pixels.
const kindOfRecord = (r) => (Array.isArray(r?.frames) ? 'clip' : typeof r?.src === 'string' ? 'cutout' : null);

// The bytes of a data URL, and the image type they are. The bytes are kept exactly as the module carried
// them, so a migrated cutout decodes to the pixels it decoded to inline and no golden moves.
function dataBytes(src, id) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(src ?? '');
  if (!m) throw usage(`import --v2: '${id}' has no inline data URL (src: ${String(src).slice(0, 40)}...)`);
  const bytes = Buffer.from(m[2], 'base64'), ext = imageType(bytes);
  if (!ext) throw usage(`import --v2: '${id}' is ${m[1]}, which is not a webp, png or jpeg image`);
  return { bytes, ext };
}

// Reads a 2.0 photos.js or clips.js ({ id: record }) and puts every record in the store: the cutout's pixels
// or the clip's poses as the blob, everything else (its silhouette, its colours, its provenance) as the
// entry. Prints the `assets:` line the film is rewritten to.
async function importV2(file, flags) {
  const abs = resolve(file);
  if (!existsSync(abs)) throw usage(`import --v2: no such file '${file}'`);
  const licence = str(flags.licence) || 'unknown';
  if (!LICENCES.includes(licence)) throw usage(`import --v2: --licence ${licence} (expected ${LICENCES.join(' | ')})`);
  const mod = await import(pathToFileURL(abs).href);
  const all = Object.entries(mod.default ?? {});
  if (!all.length) throw usage(`import --v2: ${basename(abs)} has no records in its default export`);

  const st = readCatalogue(flags.root ? resolve(String(flags.root)) : ASSET_ROOT);
  const tags = str(flags.tags).split(',').map((t) => t.trim()).filter(Boolean);
  const ids = [];
  for (const [id, rec] of all) {
    const kind = kindOfRecord(rec);
    if (!kind) throw usage(`import --v2: '${id}' is neither a cutout (src) nor a clip (frames)`);
    const meta = {
      kind, name: id, file: basename(abs), licence: rec.licence ?? licence,
      credit: rec.credit ?? '', source: rec.source ?? '', tags,
      ...(rec.desc ? { desc: rec.desc } : {}),
    };
    let entry, bytes;
    if (kind === 'cutout') {
      const { bytes: b, ext } = dataBytes(rec.src, id);
      bytes = b;
      entry = { ...meta, ext, w: rec.w, h: rec.h, sil: rec.sil, box: [0, 0, rec.w, rec.h], ...(rec.colours ? { colours: rec.colours } : {}) };
    } else {
      const data = { n: rec.n ?? rec.frames.length, fps: rec.fps ?? 12, h: rec.h, frames: rec.frames };
      const bad = validatePayload('clip', data);
      if (bad.length) throw usage(`import --v2: '${id}' is not a valid clip:\n  ${bad.join('\n  ')}`);
      bytes = Buffer.from(JSON.stringify(data), 'utf8');
      entry = { ...meta, ext: 'json', n: data.n, fps: data.fps, h: data.h, box: clipBox(data) };
    }
    const had = st.has(id) ? st.entry(id) : null;
    const put = st.put(entry, bytes);
    ids.push(id);
    process.stdout.write(`${id.padEnd(12)} ${kind.padEnd(7)} ${put.sha}.${put.ext}  ${put.licence.padEnd(7)} `
      + `${(bytes.length / 1024).toFixed(0)} KB  (${had && had.sha === put.sha ? 'unchanged' : had ? `replaces ${had.sha.slice(0, 8)}` : 'new'})\n`);
  }
  process.stdout.write(`${ids.length} records -> ${st.file}\n  assets: [${ids.map((i) => `'${i}'`).join(', ')}],\n`);
  return 0;
}
