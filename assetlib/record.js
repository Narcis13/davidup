// The record (asset-library plan §3.1): what an asset is, where it came from, what it is for.
//
// Every kind of both apps lives here: davidup's four (image, video, audio, font) and hdf's seven (cutout,
// clip, puppet, hand, stock, motif, sample). Each kind has one `media`, the axis an app filters on: a
// davidup agent asking for raster gets cutouts and paper, an hdf film asking for kind stock gets paper only.
//
// The checks are plain JS, no library. The per-kind fields are hdf's (core/assets.js SCHEMAS) plus davidup's
// probe facts; the few fields whose exact shape only hdf knows (a sample's word timing and mouth track, a
// clip's track kind) are checked structurally here, and a host that knows more passes its own checks to
// validate() as `fields` (hdf does, from H1 on).

export const KINDS = Object.freeze(['image', 'video', 'audio', 'font', 'cutout', 'clip', 'puppet', 'hand', 'stock', 'motif', 'sample']);

export const MEDIA = Object.freeze(['raster', 'video', 'audio', 'font', 'vector', 'data']);

// One list with davidup's ASSET_LICENCES (src/schema/zod.ts, RE-14); tests/assets/assetlib.test.ts holds them equal.
export const LICENCES = Object.freeze(['CC0', 'CC-BY', 'CC-BY-SA', 'OFL', 'PD', 'own', 'unknown']);

const KIND_MEDIA = Object.freeze({
  image: 'raster', cutout: 'raster', stock: 'raster',
  video: 'video',
  audio: 'audio', sample: 'audio',
  font: 'font',
  motif: 'vector',
  clip: 'data', puppet: 'data', hand: 'data',
});

// The media of a kind, or throws naming the kinds there are.
export function mediaOf(kind) {
  const m = KIND_MEDIA[kind];
  if (!m) throw new Error(`kind '${kind}': expected ${KINDS.join(' | ')}`);
  return m;
}

// An id: flat, lower-case letters, digits and dashes; `pack:<cel>` is the mirror of an hdf pack cel.
export const ID = /^(pack:)?[a-z0-9][a-z0-9-]*$/;

// sha256 is what the library writes; a 40-hex sha1 (a shelf from before H1) is still read, `asset check` flags
// it and `asset migrate --sha256` rehashes it.
export const SHA256 = /^[0-9a-f]{64}$/;
export const SHA1 = /^[0-9a-f]{40}$/;
export const isLegacySha = (s) => typeof s === 'string' && SHA1.test(s);

// ---------- field checks ----------

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string';
const isStrs = (v) => Array.isArray(v) && v.every(isStr);
const opt = (f) => ({ ...f, opt: true });
const posNum = { why: 'a number > 0', ok: (v) => isNum(v) && v > 0 };
const posInt = { why: 'an integer > 0', ok: (v) => Number.isInteger(v) && v > 0 };
const str = { why: 'a string', ok: isStr };
const bool = { why: 'true or false', ok: (v) => typeof v === 'boolean' };
const path = { why: 'a path ({ sub: [{ pts, closed }], box })', ok: (v) => !!v && Array.isArray(v.sub) && Array.isArray(v.box) && v.sub.every((s) => Array.isArray(s.pts) && s.pts.length >= 4 && s.pts.length % 2 === 0) };
const colours = { opt: true, why: 'a table of { hex, area }', ok: (v) => Array.isArray(v) && v.every((c) => c && isStr(c.hex) && isNum(c.area)) };
const align = { opt: true, why: 'word timing: { text, by, words: [[text, t0, t1], ...] }', ok: (v) => !!v && typeof v === 'object' && isStr(v.text) && Array.isArray(v.words) };
const mouth = { opt: true, why: "mouth shapes: { by, shapes: 'XBDCA...' }", ok: (v) => !!v && typeof v === 'object' && isStr(v.shapes) };
const track = { opt: true, why: "a track's kind (hdf: 'face' | 'hands')", ok: (v) => isStr(v) && v.length > 0 };

// Fields any record may carry, whatever its kind. `file` is the name the payload came in as (hdf requires it
// on its own entries; a davidup upload may not know one).
const COMMON = {
  file: opt(str),
  desc: opt(str),
  bytes: opt({ why: 'an integer >= 0', ok: (v) => Number.isInteger(v) && v >= 0 }),
  added: opt({ why: 'a date, YYYY-MM-DD', ok: (v) => isStr(v) && /^\d{4}-\d{2}-\d{2}/.test(v) }),
  by: opt(str),
  made: opt({ why: '{ tool, from: [ids], args, at }', ok: (v) => !!v && typeof v === 'object' && isStr(v.tool) && (v.from === undefined || isStrs(v.from)) }),
  rel: opt({ why: '{ from: [ids], variants: [ids] }', ok: (v) => !!v && typeof v === 'object' && Object.values(v).every(isStrs) }),
};

// Each kind: the extensions its payload is stored as, whether the entry carries a box ([x, y, w, h] in the
// asset's own units), and the fields it adds. Rasters keep the bytes they came in as.
export const SCHEMAS = Object.freeze({
  image: { exts: ['png', 'jpg', 'webp', 'gif', 'svg'], fields: { w: opt(posInt), h: opt(posInt), alpha: opt(bool), colours } },
  cutout: { exts: ['webp', 'png', 'jpg'], box: true, fields: { w: posInt, h: posInt, sil: path, alpha: opt(bool), colours } },
  stock: { exts: ['webp', 'png', 'jpg'], box: true, fields: { w: posInt, h: posInt, alpha: opt(bool), colours } },
  video: { exts: ['mp4', 'mov', 'webm', 'mkv'], fields: { sec: opt(posNum), fps: opt(posNum), w: opt(posInt), h: opt(posInt), alpha: opt(bool), codec: opt(str), audio: opt(bool), colours } },
  audio: { exts: ['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac'], fields: { sec: opt(posNum), rate: opt(posInt), channels: opt(posInt), codec: opt(str) } },
  sample: { exts: ['wav'], fields: { sec: opt(posNum), align, mouth } },
  font: { exts: ['ttf', 'otf', 'woff', 'woff2'], fields: { family: { why: 'the family name a composition asks for', ok: (v) => isStr(v) && v.length > 0 }, weight: opt({ why: 'a number or a CSS weight', ok: (v) => isNum(v) || isStr(v) }), style: opt(str), glyphs: opt(posInt) } },
  motif: { exts: ['json'], box: true },
  clip: { exts: ['json'], box: true, fields: { n: posInt, fps: posNum, h: opt(posNum), track } },
  puppet: { exts: ['json'], box: true, fields: { units: posNum } },
  hand: { exts: ['json'], fields: { glyphs: posInt, marks: opt(posInt) } },
});

// Everything wrong with an entry, as sentences; an empty array is a valid entry. `fields` adds or replaces
// per-kind checks: { sample: { align: { why, ok, opt } } }.
export function validate(id, entry, { fields } = {}) {
  const bad = [];
  if (!isStr(id) || !ID.test(id)) bad.push(`id '${id}': lower-case letters, digits and dashes (a pack cel's mirror: pack:<cel>)`);
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [...bad, 'entry: not an object'];
  const s = SCHEMAS[entry.kind];
  if (!s) return [...bad, `kind '${entry.kind}': expected ${KINDS.join(' | ')}`];
  if (entry.media !== undefined && entry.media !== KIND_MEDIA[entry.kind]) bad.push(`media '${entry.media}': a ${entry.kind} is ${KIND_MEDIA[entry.kind]}`);
  if (!isStr(entry.sha) || !(SHA256.test(entry.sha) || SHA1.test(entry.sha))) bad.push('sha: 64 hex (sha256) over the payload bytes');
  if (!s.exts.includes(entry.ext)) bad.push(`ext '${entry.ext}': a ${entry.kind} payload is ${s.exts.join(', ')}`);
  if (!LICENCES.includes(entry.licence)) bad.push(`licence '${entry.licence}': expected ${LICENCES.join(' | ')}`);
  for (const k of ['name', 'credit', 'source']) if (!isStr(entry[k])) bad.push(`${k}: a string`);
  if (!isStrs(entry.tags)) bad.push('tags: an array of strings');
  if (s.box && !(Array.isArray(entry.box) && entry.box.length === 4 && entry.box.every(isNum))) bad.push("box: [x, y, w, h] in the asset's own units");
  for (const [k, f] of Object.entries({ ...COMMON, ...s.fields, ...fields?.[entry.kind] })) {
    if (entry[k] === undefined) { if (!f.opt) bad.push(`${k}: missing (${f.why})`); continue; }
    if (!f.ok(entry[k])) bad.push(`${k}: ${f.why}`);
  }
  return bad;
}
