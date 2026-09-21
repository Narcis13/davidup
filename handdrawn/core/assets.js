// The asset store (plan 1.1): one catalogue of entries, one blob per payload, addressed by content.
//
//   assets/catalogue.json        id -> { kind, sha, ext, file, tags, credit, source, licence, box, ... }
//   assets/blobs/<sha>.webp      raster payloads (cutout pixels, paper stocks)
//   assets/blobs/<sha>.json      data payloads (clips, puppets, hands, motifs)
//   assets/sheets/<id>.jpg       check sheets, regenerated, gitignored
//
// An id is lower-case letters, digits and dashes; `pack:<cel>` is the mirror of a pack cel (3.0 S13), which
// `hdf donate --manifest` writes and nothing else should.
//
// `sha` is 40 hex over the payload bytes, so two imports of the same file are one blob. The entry is what a
// film refers to, by id; the blob is what the loader decodes. Every kind has a schema below and a validator
// `hdf import` runs before anything is written -- plain JS checks, no library.
//
//   const st = readCatalogue();                 // the store next to the package
//   st.entry('teapot');                         // the catalogue entry, or an error naming the ones there are
//   st.payloadPath(st.entry('teapot'));         // assets/blobs/<sha>.webp
//   st.put({ kind: 'cutout', name: 'teapot', ... }, bytes);   // hash, write the blob, replace the entry
//   fromStore(['teapot', 'cup'])              // { id: record }, as a film reads its assets at the top
//
// Node only (fs, crypto). A film that names its assets by id imports `fromStore` from here and nothing else
// out of this module; `hdf bundle` and `hdf dev` serve core/assets.web.js in its place, so the same film
// plays in the browser. `cli/load.mjs` resolves the film's `assets` list the same way, for the renderer.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkPath } from './list.js';
import { register, setReader } from './store.js';

// The store next to the package (handdrawn/assets) unless a command names another root.
export const ASSET_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

export const KINDS = ['cutout', 'clip', 'puppet', 'hand', 'stock', 'motif', 'sample'];
export const LICENCES = ['CC0', 'CC-BY', 'CC-BY-SA', 'PD', 'own', 'unknown'];

// 40 hex over the payload bytes (a string is hashed as utf8), the blob's name and the entry's `sha`.
export const sha = (bytes) => createHash('sha1').update(bytes).digest('hex');

// ---------- schemas ----------

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const posNum = { why: 'a number > 0', ok: (v) => isNum(v) && v > 0 };
const posInt = { why: 'an integer > 0', ok: (v) => Number.isInteger(v) && v > 0 };
const path = { why: 'a path ({ sub: [{ pts, closed }], box })', ok: (v) => !!v && Array.isArray(v.sub) && Array.isArray(v.box) && v.sub.every((s) => Array.isArray(s.pts) && s.pts.length >= 4 && s.pts.length % 2 === 0) };
const colourTable = { opt: true, why: 'a table of { hex, area } (see `hdf photo --refresh`)', ok: (v) => Array.isArray(v) && v.every((c) => c && typeof c.hex === 'string' && isNum(c.area)) };

// Each kind: how its payload is stored, whether the entry carries a box, the entry fields it adds, and the
// checks over a decoded JSON payload. `box` is [x, y, w, h] in the asset's own units.
export const SCHEMAS = {
  cutout: { payload: 'raster', box: true, fields: { w: posInt, h: posInt, sil: path, colours: colourTable } },
  clip: { payload: 'json', box: true, fields: { n: posInt, fps: posNum, h: posNum }, checkPayload: checkClip },
  puppet: { payload: 'json', box: true, fields: { units: posNum }, checkPayload: checkPuppet },
  hand: { payload: 'json', fields: { glyphs: posInt }, checkPayload: checkHand },
  stock: { payload: 'raster', box: true, fields: { w: posInt, h: posInt } },
  motif: { payload: 'json', box: true, checkPayload: checkMotif },
  sample: { payload: 'audio', fields: { sec: { ...posNum, opt: true } } },
};

// The blob's extension for a payload: rasters keep the bytes they came in as (so a migrated cutout is the
// same bytes it was inside the JS module, and the goldens do not move).
export const EXTS = { raster: ['webp', 'png', 'jpg'], json: ['json'], audio: ['wav'] };

// The image type of some bytes by their magic, or null.
export function imageType(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (b.length > 8 && b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG') return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  return null;
}

// ---------- validators ----------

// Everything wrong with an entry, as sentences. An empty array is a valid entry.
export function validate(id, entry) {
  const bad = [];
  if (!id || typeof id !== 'string' || !/^(pack:)?[a-z0-9][a-z0-9-]*$/i.test(id)) bad.push(`id '${id}': lower-case letters, digits and dashes (a pack cel's mirror: pack:<cel>)`);
  if (!entry || typeof entry !== 'object') return [...bad, 'entry: not an object'];
  const s = SCHEMAS[entry.kind];
  if (!s) return [...bad, `kind '${entry.kind}': expected ${KINDS.join(' | ')}`];
  if (typeof entry.sha !== 'string' || !/^[0-9a-f]{40}$/.test(entry.sha)) bad.push('sha: 40 hex over the payload bytes');
  if (!EXTS[s.payload].includes(entry.ext)) bad.push(`ext '${entry.ext}': a ${entry.kind} payload is ${EXTS[s.payload].join(' or ')}`);
  if (!LICENCES.includes(entry.licence)) bad.push(`licence '${entry.licence}': expected ${LICENCES.join(' | ')}`);
  for (const k of ['name', 'file', 'credit', 'source']) if (typeof entry[k] !== 'string') bad.push(`${k}: a string`);
  if (!Array.isArray(entry.tags) || entry.tags.some((t) => typeof t !== 'string')) bad.push('tags: an array of strings');
  if (s.box && !(Array.isArray(entry.box) && entry.box.length === 4 && entry.box.every(isNum))) bad.push('box: [x, y, w, h] in the asset\'s own units');
  for (const [k, f] of Object.entries(s.fields ?? {})) {
    if (entry[k] === undefined) { if (!f.opt) bad.push(`${k}: missing (${f.why})`); continue; }
    if (!f.ok(entry[k])) bad.push(`${k}: ${f.why}`);
  }
  return bad;
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

function checkClip(d) {
  const bad = [];
  if (!d || typeof d !== 'object') return ['clip: not an object'];
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

const EMPTY = '{\n}\n';

// The store rooted at `root`: the catalogue read once, the blobs on demand. Missing files read as empty, so a
// fresh checkout has a store before anything is imported.
export function readCatalogue(root = ASSET_ROOT) {
  const dir = resolve(root), file = join(dir, 'catalogue.json');
  const raw = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const entries = new Map(Object.entries(raw));
  const st = {
    root: dir, file, entries,
    get ids() { return [...entries.keys()].sort(); },
    has: (id) => entries.has(id),
    entry(id) {
      const e = entries.get(id);
      if (!e) throw new Error(`no asset '${id}' in ${dir} (has ${st.ids.join(', ') || 'none'}; try \`hdf find ${id}\`)`);
      return e;
    },
    payloadPath: (e) => join(dir, 'blobs', `${(typeof e === 'string' ? st.entry(e) : e).sha}.${(typeof e === 'string' ? st.entry(e) : e).ext}`),
    sheetPath: (id) => join(dir, 'sheets', `${id.replace(':', '_')}.jpg`),   // pack:boat -> pack_boat.jpg
    payload(e) {
      const entry = typeof e === 'string' ? st.entry(e) : e, p = st.payloadPath(entry);
      if (!existsSync(p)) throw new Error(`asset '${entry.name}': blob ${entry.sha}.${entry.ext} is missing from ${join(dir, 'blobs')}`);
      return readFileSync(p);
    },
    json(e) { return JSON.parse(st.payload(e).toString('utf8')); },
    search: (words, opt) => search(st, words, opt),
    // Hashes the payload, writes the blob if it is new, validates, replaces the entry, saves. Returns the entry.
    put(entry, bytes) {
      const id = entry.name, full = { ...entry, sha: sha(bytes), ext: entry.ext ?? extOf(entry.kind, bytes) };
      check(id, full);
      mkdirSync(join(dir, 'blobs'), { recursive: true });
      const p = st.payloadPath(full);
      if (!existsSync(p)) writeFileSync(p, bytes);
      entries.set(id, full);
      st.save();
      return full;
    },
    // Drops the entry, its sheets and its blob when no other entry shares it; saves. Returns the paths deleted.
    remove(id) {
      const e = st.entry(id), gone = [];
      entries.delete(id);
      st.save();
      const p = st.payloadPath(e);
      if (![...entries.values()].some((o) => o.sha === e.sha && o.ext === e.ext) && existsSync(p)) { rmSync(p); gone.push(p); }
      for (const s of [st.sheetPath(id), st.sheetPath(id).replace(/\.jpg$/, '-model.jpg')]) if (existsSync(s)) { rmSync(s); gone.push(s); }
      return gone;
    },
    // Blobs no entry points at (a replaced payload's old bytes, a removed entry's), as paths.
    orphans() {
      const bd = join(dir, 'blobs');
      if (!existsSync(bd)) return [];
      const used = new Set([...entries.values()].map((e) => `${e.sha}.${e.ext}`));
      return readdirSync(bd).filter((f) => /^[0-9a-f]{40}\.\w+$/.test(f) && !used.has(f)).sort().map((f) => join(bd, f));
    },
    // One entry per line, ids sorted: a change to one asset is a one-line diff (keep it that way by hand too).
    save() {
      mkdirSync(dir, { recursive: true });
      const ids = st.ids;
      writeFileSync(file, ids.length ? `{\n${ids.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(entries.get(k))}`).join(',\n')}\n}\n` : EMPTY);
    },
  };
  return st;
}

function extOf(kind, bytes) {
  const s = SCHEMAS[kind];
  if (!s) throw new Error(`kind '${kind}': expected ${KINDS.join(' | ')}`);
  if (s.payload === 'json') return 'json';
  if (s.payload === 'audio') return 'wav';
  const t = imageType(bytes);
  if (!t) throw new Error(`a ${kind} payload must be a webp, png or jpeg image`);
  return t;
}

// Catalogue entries whose id, name, tags, description or credit hold every word (case-insensitive), by id.
export function search(st, words, { kind } = {}) {
  const terms = (Array.isArray(words) ? words : String(words ?? '').split(/\s+/)).filter(Boolean).map((w) => w.toLowerCase());
  return st.ids.map((id) => [id, st.entries.get(id)])
    .filter(([id, e]) => (!kind || e.kind === kind)
      && terms.every((w) => `${id} ${e.name} ${(e.tags ?? []).join(' ')} ${e.desc ?? ''} ${e.credit ?? ''} ${e.source ?? ''}`.toLowerCase().includes(w)))
    .map(([id, e]) => ({ id, entry: e }));
}

// ---------- records ----------

// The 2.0 shape a film sees for an entry: a cutout as `hdf photo` writes it (src the blob's path, so the
// loader decodes it like any other image), a data asset as its payload plus its provenance. pin(),
// silhouette() and derive({ from }) read exactly what they read today.
export function recordOf(st, id) {
  const e = st.entry(id), prov = { name: id, credit: e.credit ?? '', source: e.source ?? '', licence: e.licence };
  const s = SCHEMAS[e.kind];
  if (s.payload === 'raster') {
    return { ...prov, w: e.w, h: e.h, src: st.payloadPath(e), ...(e.sil ? { sil: mkPath(e.sil.sub) } : {}), ...(e.colours ? { colours: e.colours } : {}) };
  }
  if (s.payload === 'audio') return { ...prov, src: st.payloadPath(e), ...(e.sec ? { sec: e.sec } : {}) };
  return { ...prov, ...st.json(e) };
}

// A look that names an asset the film has not read yet (`'pencilMinimal~hand:test'` at a module's top level)
// finds it here, in the store next to the package.
setReader((id) => {
  const st = readCatalogue(ASSET_ROOT);
  return st.has(id) ? recordOf(st, id) : undefined;
});

// The records for the ids a film names, read from the store next to the package (or `from`, a directory
// relative to the working directory). They go into the registry too (core/store.js), so an engine can read
// one back by id -- `clipFromStore('horse')` is how films/gallop.js hands a traced clip to the engine.
export function fromStore(ids, { from } = {}) {
  const st = readCatalogue(from ? resolve(from) : ASSET_ROOT);
  return register(Object.fromEntries((Array.isArray(ids) ? ids : [ids]).map((id) => [id, recordOf(st, id)])));
}
