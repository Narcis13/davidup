// The asset store (plan 1.1): one catalogue of entries, one blob per payload, addressed by content.
//
//   assets/catalogue.json        id -> { kind, sha, ext, file, tags, credit, source, licence, box, ... }
//   assets/blobs/<sha>.webp      raster payloads (cutout pixels, paper stocks)
//   assets/blobs/<sha>.json      data payloads (clips, puppets, hands, motifs)
//   assets/sheets/<id>.jpg       check sheets, regenerated, gitignored
//   assets/thumbs/<sha>.png      previews (asset thumb; hdf draws them, cli/previews.mjs), gitignored
//
// The engine is assetlib (<repo>/assetlib, asset-library plan H1): this store is its `house` shelf, and what
// is here is hdf's view of it -- the seven kinds hdf draws, the checks only hdf knows (a clip's track, a
// sample's word timing and mouth shapes, every payload's shape), the entry keyed by its `name`, the sheets.
// An id is lower-case letters, digits and dashes; `pack:<cel>` is the mirror of a pack cel (3.0 S13), which
// `hdf donate --manifest` writes and nothing else should.
//
// `sha` is 64 hex, the sha256 of the payload bytes (sha1 before H1; `asset migrate --sha256` rehashed the
// shelf), so two imports of the same file are one blob. The entry is what a film refers to, by id; the blob
// is what the loader decodes. Every kind has a schema below and a validator `hdf import` runs before anything
// is written -- plain JS checks, no library.
//
//   const st = readCatalogue();                 // the house store (<repo>/assets)
//   st.entry('teapot');                         // the catalogue entry, or an error naming the ones there are
//   st.payloadPath(st.entry('teapot'));         // assets/blobs/<sha>.webp
//   st.put({ kind: 'cutout', name: 'teapot', ... }, bytes);   // hash, write the blob, replace the entry
//   fromStore(['teapot', 'cup'])              // { id: record }, as a film reads its assets at the top
//
// Node only (fs, crypto). A film that names its assets by id imports `fromStore` from here and nothing else
// out of this module; `hdf bundle` and `hdf dev` serve core/assets.web.js in its place, so the same film
// plays in the browser. `cli/load.mjs` resolves the film's `assets` list the same way, for the renderer.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HOUSE_ROOT, KINDS as LIBRARY_KINDS, LICENCES, SHA256, imageType, isLegacySha, openLibrary, readShelf, search as searchRecords, sha, validate as validateRecord } from '../../assetlib/index.js';
import { mkPath } from './list.js';
import { peek, register, setReader } from './store.js';
import { setPcmReader } from './synth.js';
import { checkAlign } from './align.js';
import { checkMouth } from './mouth.js';
import { TRACKS, checkTrack } from './face.js';
import { MARKS } from './glyphs.js';

export { LICENCES, imageType, sha };

// The store unless a command names another root: the library's house shelf, <repo>/assets (asset-library
// plan H4; handdrawn/assets before).
export const ASSET_ROOT = HOUSE_ROOT;

// ---------- schemas ----------

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const posNum = { why: 'a number > 0', ok: (v) => isNum(v) && v > 0 };
const posInt = { why: 'an integer > 0', ok: (v) => Number.isInteger(v) && v > 0 };

// Each kind: how its payload is stored, whether the entry carries a box, and the checks over a decoded JSON
// payload. `box` is [x, y, w, h] in the asset's own units. The entry's fields are assetlib's (record.js
// SCHEMAS); `fields` are the ones hdf checks harder, handed to assetlib's validate().
export const SCHEMAS = {
  cutout: { payload: 'raster', box: true },
  clip: { payload: 'json', box: true, fields: { track: { opt: true, why: `a track's kind: ${TRACKS.join(' | ')} (4.0 K7)`, ok: (v) => TRACKS.includes(v) } }, checkPayload: checkClip },
  puppet: { payload: 'json', box: true, checkPayload: checkPuppet },
  hand: { payload: 'json', checkPayload: checkHand },
  stock: { payload: 'raster', box: true },
  motif: { payload: 'json', box: true, checkPayload: checkMotif },
  sample: { payload: 'audio', fields: { align: { opt: true, why: 'word timing (hdf align): { text, by, words: [[text, t0, t1], ...] }', ok: (v) => !checkAlign(v).length }, mouth: { opt: true, why: "mouth shapes (hdf align --mouth): { by, shapes: 'XBDCA...' }, a letter per 1/12 s", ok: (v) => !checkMouth(v).length } } },
};

// The kinds hdf draws, in the library's order: cutout clip puppet hand stock motif sample.
export const KINDS = LIBRARY_KINDS.filter((k) => SCHEMAS[k]);

// How a payload of any kind on a shelf is read: hdf's seven by SCHEMAS, davidup's four by their media (an image is
// a raster, an audio an audio file, a video or a font a file), so a shelf both apps write reads whole (the house
// pack, I2, puts images, beds and fonts there).
const OTHER = { image: 'raster', audio: 'audio', video: 'file', font: 'file' };
export const payloadOf = (kind) => SCHEMAS[kind]?.payload ?? OTHER[kind] ?? 'file';

// What hdf hands assetlib's validate() and put: its own fields, and `file` (the name the payload came in as),
// which the library leaves optional and every hdf entry has.
export const FIELDS = Object.fromEntries(KINDS.map((k) => [k, { file: { why: 'a string', ok: (v) => typeof v === 'string' }, ...SCHEMAS[k].fields }]));

// ---------- validators ----------

// Everything wrong with an entry, as sentences. An empty array is a valid entry. assetlib's checks with hdf's
// fields, over hdf's kinds only, and a sha1 is refused: hdf writes sha256 since H1.
export function validate(id, entry) {
  if (entry && typeof entry === 'object' && !Array.isArray(entry) && !SCHEMAS[entry.kind]) {
    return [...validateRecord(id, {}).filter((m) => m.startsWith('id ')), `kind '${entry.kind}': expected ${KINDS.join(' | ')}`];
  }
  const bad = validateRecord(id, entry, { fields: FIELDS });
  if (!entry || typeof entry !== 'object' || SHA256.test(entry.sha)) return bad;
  return [...bad.filter((m) => !m.startsWith('sha:')), `sha: 64 hex, the sha256 of the payload bytes${isLegacySha(entry.sha) ? ' (a sha1: asset migrate --sha256)' : ''}`];
}

// Everything wrong with a decoded payload for a kind (JSON kinds only; a raster or a wav is checked by its magic).
export function validatePayload(kind, data) {
  const s = SCHEMAS[kind];
  if (!s) return [`kind '${kind}': expected ${KINDS.join(' | ')}`];
  return s.checkPayload ? s.checkPayload(data) ?? [] : [];
}

// Throws the findings of validate() as one error naming the id.
export function check(id, entry) {
  const bad = validate(id, entry);
  if (bad.length) throw new Error(`asset '${id}' is not a valid ${entry?.kind ?? 'asset'}:\n  ${bad.join('\n  ')}`);
  return entry;
}

// A clip draws (outlines a frame, h its tallest); a track (4.0 K7: a face's or hands' numbers a frame) does not.
function checkClip(d) {
  const bad = [];
  if (!d || typeof d !== 'object') return ['clip: not an object'];
  if (d.track !== undefined) return checkTrack(d);
  if (!posInt.ok(d.n)) bad.push('n: an integer > 0');
  if (!posNum.ok(d.h)) bad.push('h: the tallest pose in clip units, > 0');
  if (!Array.isArray(d.frames) || !d.frames.length) bad.push('frames: a non-empty array');
  else {
    if (posInt.ok(d.n) && d.frames.length !== d.n) bad.push(`frames: ${d.frames.length} of them, n says ${d.n}`);
    d.frames.forEach((f, i) => { if (!f || !f.outer) bad.push(`frames[${i}]: no outer path`); });
  }
  return bad;
}

function checkPuppet(d) {
  const bad = [];
  if (!d || typeof d !== 'object') return ['puppet: not an object'];
  if (!posNum.ok(d.units)) bad.push('units: the tallest pose in logical units, > 0');
  const parts = d.parts && typeof d.parts === 'object' ? d.parts : null;
  if (!parts || !Object.keys(parts).length) return [...bad, 'parts: a non-empty object, in painter order'];
  // Turnarounds: with views, ops, each variant and a pivot may be keyed by view name.
  const views = d.views === undefined ? null : Array.isArray(d.views) && d.views.length && d.views.every((v) => typeof v === 'string' && v) ? d.views : undefined;
  if (views === undefined) bad.push("views: view names, the first the one a part falls back to (['side', 'three-quarter', 'front'])");
  const byView = (v, ok) => (ok(v) || (!!views && v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0
    && Object.entries(v).every(([k, x]) => views.includes(k) && ok(x))));
  const isOps = (v) => Array.isArray(v), isPt = (v) => Array.isArray(v) && v.length === 2 && v.every(isNum);
  for (const [name, p] of Object.entries(parts)) {
    if (!p || typeof p !== 'object') { bad.push(`parts.${name}: not an object`); continue; }
    if (!byView(p.ops, isOps) && !(p.variants && typeof p.variants === 'object' && Object.keys(p.variants).length)) bad.push(`parts.${name}: needs ops or variants${views ? ' (either may be keyed by view)' : ''}`);
    for (const [k, v] of Object.entries(p.variants ?? {})) if (!byView(v, isOps)) bad.push(`parts.${name}.variants.${k}: an op list${views ? ', or op lists keyed by view' : ''}`);
    if (p.pivot !== undefined && !byView(p.pivot, isPt)) bad.push(`parts.${name}.pivot: [x, y]${views ? ', or [x, y] keyed by view' : ''}`);
    if (p.parent !== undefined && !parts[p.parent]) bad.push(`parts.${name}.parent: no part '${p.parent}'`);
  }
  return bad;
}

function checkHand(d) {
  const bad = [];
  if (!d || typeof d !== 'object') return ['hand: not an object'];
  const g = d.glyphs && typeof d.glyphs === 'object' ? d.glyphs : null;
  if (!g || !Object.keys(g).length) return [...bad, 'glyphs: a non-empty object keyed by character'];
  // A stroke is flat [x0, y0, x1, y1, ...] as in core/glyphs.js, or [[x, y], ...]; only a blank draws none.
  const flat = (st) => st.length >= 4 && st.length % 2 === 0 && st.every(isNum);
  const pairs = (st) => st.length >= 2 && st.every((p) => Array.isArray(p) && p.length === 2 && p.every(isNum));
  for (const [c, gl] of Object.entries(g)) {
    if (!gl || !posNum.ok(gl.w)) bad.push(`glyphs.${c}.w: the advance in the 100-unit em, > 0`);
    if (!Array.isArray(gl?.s) || (!gl.s.length && c.trim()) || !gl.s.every((st) => Array.isArray(st) && (flat(st) || pairs(st)))) {
      bad.push(`glyphs.${c}.s: strokes, each a flat [x0, y0, x1, y1, ...] or [[x, y], ...]`);
    }
  }
  // 4.0 T2: the marks it composes accented letters with, each strokes like a glyph's, keyed by a MARKS name.
  if (d.marks !== undefined) {
    if (!d.marks || typeof d.marks !== 'object' || Array.isArray(d.marks)) bad.push(`marks: an object keyed by mark (${Object.keys(MARKS).join(', ')})`);
    else for (const [m, mk] of Object.entries(d.marks)) {
      if (!MARKS[m]) bad.push(`marks.${m}: no such mark (${Object.keys(MARKS).join(', ')})`);
      else if (!Array.isArray(mk?.s) || !mk.s.length || !mk.s.every((st) => Array.isArray(st) && (flat(st) || pairs(st)))) bad.push(`marks.${m}.s: strokes, each a flat [x0, y0, x1, y1, ...] or [[x, y], ...]`);
    }
  }
  for (const k of ['track', 'slant', 'baselineDrift']) if (d[k] !== undefined && !isNum(d[k])) bad.push(`${k}: a number (em units; slant in degrees)`);
  const st = d.stroke;
  if (st !== undefined) {
    if (!st || typeof st !== 'object') bad.push('stroke: { wobble, overshoot, hook, pressure, speed, tremor, rounding }');
    else {
      for (const k of ['wobble', 'overshoot', 'hook', 'tremor', 'rounding']) if (st[k] !== undefined && !(isNum(st[k]) && st[k] >= 0)) bad.push(`stroke.${k}: a number >= 0`);
      if (st.speed !== undefined && !posNum.ok(st.speed)) bad.push('stroke.speed: units per second, > 0');
      if (st.pressure !== undefined && !(Array.isArray(st.pressure) && st.pressure.length === 3 && st.pressure.every((v) => isNum(v) && v > 0))) bad.push('stroke.pressure: [at 0.1, at 0.5, at 0.9] of the pen width, each > 0');
    }
  }
  return bad;
}

function checkMotif(d) { return Array.isArray(d) && d.length ? [] : ['motif: a non-empty serialised op list']; }

// ---------- the catalogue ----------

// The store rooted at `root`: an assetlib shelf (the catalogue read once, the blobs on demand) as hdf reads
// it. Missing files read as empty, so a fresh checkout has a store before anything is imported.
export function readCatalogue(root = ASSET_ROOT) {
  const shelf = readShelf(root, resolve(root) === ASSET_ROOT ? { name: 'house' } : {});
  const dir = shelf.root, entries = shelf.entries;
  const of = (e) => (typeof e === 'string' ? st.entry(e) : e);
  const st = {
    root: dir, file: shelf.file, entries, shelf,
    get ids() { return shelf.ids; },
    has: (id) => entries.has(id),
    entry(id) {
      const e = entries.get(id);
      if (!e) throw new Error(`no asset '${id}' in ${dir} (has ${st.ids.join(', ') || 'none'}; try \`hdf find ${id}\`)`);
      return e;
    },
    payloadPath: (e) => shelf.blobPath(of(e)),
    sheetPath: (id) => join(dir, 'sheets', `${id.replace(':', '_')}.jpg`),   // pack:boat -> pack_boat.jpg
    payload: (e) => shelf.payload(of(e)),
    json(e) { return JSON.parse(st.payload(e).toString('utf8')); },
    search: (words, opt) => search(st, words, opt),
    // assetlib's put, keyed by the entry's name: hashes the payload (sha256), validates with hdf's checks,
    // writes the blob if it is new, replaces the entry, saves. Returns the entry as stored.
    put(entry, bytes) {
      if (!SCHEMAS[entry?.kind]) throw new Error(`asset '${entry?.name}' is not a valid asset:\n  kind '${entry?.kind}': expected ${KINDS.join(' | ')}`);
      return shelf.put({ ...entry, id: entry.name }, bytes, { fields: FIELDS }).entry;
    },
    // Drops the entry, its blob and thumb when no other entry shares them, and its sheets; saves. Returns the
    // paths deleted.
    remove(id) {
      st.entry(id);
      const gone = shelf.remove(id);
      for (const s of [st.sheetPath(id), st.sheetPath(id).replace(/\.jpg$/, '-model.jpg')]) if (existsSync(s)) { rmSync(s); gone.push(s); }
      return gone;
    },
    // Blobs no entry points at (a replaced payload's old bytes, a removed entry's), as paths.
    orphans: () => shelf.orphans(),
    // One entry per line, ids sorted: a change to one asset is a one-line diff (keep it that way by hand too).
    save: () => shelf.save(),
  };
  return st;
}

// The library hdf's store commands open (asset-library plan H2): with `root`, that one directory as the only
// shelf (the house when it is ASSET_ROOT), as `--root` has always meant; without, the standard shelves in
// `asset`'s order (the user's pool, then the house), so `hdf find` answers what `asset find` answers.
export function library({ root } = {}) {
  if (!root) return openLibrary();
  const dir = resolve(root);
  return openLibrary({ shelves: [{ name: dir === ASSET_ROOT ? 'house' : undefined, root: dir }] });
}

// The entries a query finds in this store, best first: assetlib's ranked search (each word a prefix of a word in
// the id, name, tags, description, credit or source, or of a synonym's; plan §4), `kind` a filter. [{ id, entry }].
export function search(st, words, { kind } = {}) {
  const q = (Array.isArray(words) ? words : [words]).filter((w) => w !== undefined && w !== null).join(' ');
  const records = st.ids.map((id) => ({ ...st.entries.get(id), id, shelf: st.shelf.name }));
  return searchRecords(records, { q, ...(kind ? { kind } : {}), limit: records.length, facets: false }).hits.map((h) => ({ id: h.id, entry: st.entries.get(h.id) }));
}

// ---------- records ----------

// The 2.0 shape a film sees for an entry: a cutout as `hdf photo` writes it (src the blob's path, so the
// loader decodes it like any other image), a data asset as its payload plus its provenance. pin(),
// silhouette() and derive({ from }) read exactly what they read today.
export function recordOf(st, id) {
  const e = st.entry(id), prov = { name: id, credit: e.credit ?? '', source: e.source ?? '', licence: e.licence };
  const how = payloadOf(e.kind);
  if (how === 'raster') {
    return { ...prov, w: e.w, h: e.h, src: st.payloadPath(e), ...(e.sil ? { sil: mkPath(e.sil.sub) } : {}), ...(e.colours ? { colours: e.colours } : {}) };
  }
  // The copy (desc), the word timing (4.0 V2) and the mouth track (V3) ride along, so alignOf reads them in Node and the player.
  if (how === 'audio') return { ...prov, src: st.payloadPath(e), ...(e.sec ? { sec: e.sec } : {}), ...(e.desc ? { desc: e.desc } : {}), ...(e.align ? { align: e.align } : {}), ...(e.mouth ? { mouth: e.mouth } : {}) };
  if (how === 'file') return { ...prov, src: st.payloadPath(e) };
  return { ...prov, ...st.json(e) };
}

// A look that names an asset the film has not read yet (`'pencilMinimal~hand:test'` at a module's top level)
// finds it here, in the house store (<repo>/assets).
setReader((id) => {
  const st = readCatalogue(ASSET_ROOT);
  return st.has(id) ? recordOf(st, id) : undefined;
});

// A voice in a score (4.0 V1) reads its sample's wav through the registry: a record a film read (or
// cli/load.mjs registered from another store), else the house store (<repo>/assets).
setPcmReader((id) => {
  const r = peek(id);
  return typeof r?.src === 'string' && /\.wav$/i.test(r.src) && existsSync(r.src) ? readFileSync(r.src) : undefined;
});

// The records for the ids a film names, read from the house store, <repo>/assets (or `from`, a directory
// relative to the working directory). They go into the registry too (core/store.js), so an engine can read
// one back by id -- `clipFromStore('horse')` is how films/gallop.js hands a traced clip to the engine.
export function fromStore(ids, { from } = {}) {
  const st = readCatalogue(from ? resolve(from) : ASSET_ROOT);
  return register(Object.fromEntries((Array.isArray(ids) ? ids : [ids]).map((id) => [id, recordOf(st, id)])));
}
