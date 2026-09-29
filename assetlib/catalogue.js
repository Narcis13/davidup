// One shelf (asset-library plan §2, §3.3): a directory, nothing else.
//
//   <shelf>/catalogue.json        id -> entry, one entry per line, ids sorted (hdf's format, unchanged)
//   <shelf>/blobs/<sha>.<ext>     the payloads, named by the sha of their bytes
//   <shelf>/thumbs/<sha>.png      previews, regenerable
//   <shelf>/src/                  sources worth keeping
//
// A missing directory or catalogue reads as an empty shelf, so a fresh project has one before anything is
// added. Reading never validates: a shelf with a bad entry still opens, and `asset check` says what is wrong.
// Writing always does, before anything touches the disk (A2).
//
//   shelf.put({ id: 'teapot', kind: 'cutout', ... }, bytes)   hash, derive, validate, write the blob if new, save
//   shelf.remove('teapot')                                    the entry, and its blob and thumb when nothing shares them
//   shelf.update('teapot', { tags: [...] })                   an entry's own fields, in place; the blob untouched
//   shelf.place('teapot', entry, bytes, { thumb })            an entry as another shelf stored it (a pack's), verbatim
//   shelf.gc()                                                blobs and thumbs no entry points at
//
// These are synchronous and derive only what the bytes say by themselves (type, size, header dims); the
// library's put (index.js) runs a host's probes first and hands their facts in.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { imageInfo, sameContainer, sniff } from './image.js';
import { SCHEMAS, mediaOf, validate } from './record.js';

// 64 hex over some bytes (a string is hashed as utf8): a blob's name and its entry's `sha`.
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

const BLOB = /^([0-9a-f]{64}|[0-9a-f]{40})\.\w+$/;
const THUMB = /^([0-9a-f]{64}|[0-9a-f]{40})\.png$/;
const EMPTY = '{\n}\n';

// Fields a record carries that are not the entry's: the id is the catalogue's key, the rest are where the
// library found it. A record from lib.get() puts back as the entry it came from.
const NOT_STORED = ['id', 'shelf', 'shadowed'];

// Fields the bytes decide: update() refuses them; a new payload goes through put().
export const FROM_BYTES = Object.freeze(['kind', 'media', 'sha', 'ext', 'bytes']);

const today = () => new Date().toISOString().slice(0, 10);

// Writes a file whole or not at all: a temp file next to it, then a rename.
function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tmp, data);
  try { renameSync(tmp, file); } catch (err) { rmSync(tmp, { force: true }); throw err; }
}

// The blob's extension: JSON kinds are json (and must parse); anything else by its magic, keeping a caller's
// ext when it names the same container; failing that the caller's ext or the extension of `file`.
export function extFor(entry, bytes) {
  const s = SCHEMAS[entry.kind];
  if (s?.exts.length === 1 && s.exts[0] === 'json') {
    try { JSON.parse(Buffer.from(bytes).toString('utf8')); } catch (err) { throw new Error(`a ${entry.kind} payload must be JSON (${err.message})`); }
    return 'json';
  }
  const seen = sniff(bytes, entry.kind);
  if (seen && entry.ext && !sameContainer(seen, entry.ext)) throw new Error(`ext '${entry.ext}': the bytes are ${seen}`);
  const ext = (seen && entry.ext) || seen || entry.ext || extname(entry.file ?? '').slice(1).toLowerCase();
  if (!ext) throw new Error(`cannot tell what the ${entry.kind} payload is from its bytes; pass ext or file`);
  return ext === 'jpeg' ? 'jpg' : ext;
}

// The entry as it will be stored: the caller's fields (in their order) win over what is derived, except the
// four the bytes decide (media, sha, ext, bytes). `facts` are a host's probe results; the header's dims and
// alpha fill in under them. `prev` is the entry being replaced, whose `added` date is kept.
export function stored(entry, bytes, { facts = {}, prev, by } = {}) {
  const out = {};
  for (const [k, v] of Object.entries(entry)) if (!NOT_STORED.includes(k) && v !== undefined) out[k] = v;
  let media;
  try { media = mediaOf(entry.kind); } catch { media = undefined; }   // validate() names the kinds there are
  const ext = media ? extFor(entry, bytes) : entry.ext;
  const head = media === 'raster' ? imageInfo(bytes) : null;
  const derived = {
    ...(head ? { w: head.w, h: head.h, alpha: head.alpha } : {}),
    ...Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== undefined)),
    added: prev?.added ?? today(),
    ...(by ? { by } : {}),
  };
  Object.assign(out, { media, sha: sha(bytes), ext, bytes: bytes.length });
  for (const [k, v] of Object.entries(derived)) if (out[k] === undefined) out[k] = v;
  if (out.media === undefined) delete out.media;
  return out;
}

// A catalogue's text: one entry per line, ids sorted, so a change to one asset is a one-line diff (hdf's
// format). `entries` is a Map or an object of id -> entry.
export function catalogueText(entries) {
  const m = entries instanceof Map ? entries : new Map(Object.entries(entries));
  const ids = [...m.keys()].sort();
  return ids.length ? `{\n${ids.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(m.get(k))}`).join(',\n')}\n}\n` : EMPTY;
}

// The shelf rooted at `root`, named `name` (default: the directory's name). The catalogue is read once.
export function readShelf(root, { name } = {}) {
  const dir = resolve(root), file = join(dir, 'catalogue.json');
  const shelfName = name ?? basename(dir);
  let raw = {};
  if (existsSync(file)) {
    try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch (err) { throw new Error(`shelf ${shelfName}: ${file} is not JSON (${err.message})`); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`shelf ${shelfName}: ${file} must be an object of id -> entry`);
  }
  const entries = new Map(Object.entries(raw));
  const of = (e) => (typeof e === 'string' ? shelf.entry(e) : e);
  const shared = (e) => [...entries.values()].some((o) => o.sha === e.sha);
  const shelf = {
    root: dir, name: shelfName, file, entries,
    get ids() { return [...entries.keys()].sort(); },
    has: (id) => entries.has(id),
    entry(id) {
      const e = entries.get(id);
      if (!e) throw new Error(`no asset '${id}' on shelf ${shelfName} (${dir}; has ${shelf.ids.join(', ') || 'none'})`);
      return e;
    },
    blobPath: (e) => join(dir, 'blobs', `${of(e).sha}.${of(e).ext}`),
    thumbPath: (e) => join(dir, 'thumbs', `${of(e).sha}.png`),
    // Blobs no entry points at (a replaced payload's old bytes, a removed entry's), as paths.
    orphans() {
      const bd = join(dir, 'blobs');
      if (!existsSync(bd)) return [];
      const used = new Set([...entries.values()].map((e) => `${e.sha}.${e.ext}`));
      return readdirSync(bd).filter((f) => BLOB.test(f) && !used.has(f)).sort().map((f) => join(bd, f));
    },
    // The payload's bytes, or an error naming the blob that is missing.
    payload(e) {
      const entry = of(e), p = shelf.blobPath(entry);
      if (!existsSync(p)) throw new Error(`asset '${entry.name}': blob ${entry.sha}.${entry.ext} is missing from ${join(dir, 'blobs')}`);
      return readFileSync(p);
    },

    // Hashes the bytes (sha256), derives media, ext, bytes, added and a raster's header dims, validates, and
    // only then writes: the blob if it is new, the catalogue atomically. The same bytes again are the same
    // blob; the entry is replaced (its `added` kept). `entry.id` names it. `facts` are probe results (from
    // the library's put), `fields` extra per-kind checks for validate(), `by` the door it came in by.
    // Returns { id, entry, path, created } -- created when the blob was new to this shelf.
    put(entry, bytes, { facts, fields, by } = {}) {
      const id = entry?.id;
      const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      const full = stored(entry ?? {}, buf, { facts, by, prev: entries.get(id) });
      const bad = validate(id, full, { fields });
      if (bad.length) throw new Error(`asset '${id}' is not a valid ${entry?.kind ?? 'asset'} (shelf ${shelfName}):\n  ${bad.join('\n  ')}`);
      mkdirSync(join(dir, 'blobs'), { recursive: true });
      const path = shelf.blobPath(full), created = !existsSync(path);
      if (created) writeAtomic(path, buf);
      entries.set(id, full);
      shelf.save();
      return { id, entry: full, path, created };
    },
    // Puts an entry exactly as another shelf stored it (a pack's, I3): nothing is derived, so its catalogue line
    // comes out byte for byte. The bytes must hash to its sha (sha256) and the entry must validate; an id this
    // shelf holds with other bytes is refused. The blob is written if new, and `thumb` (PNG bytes) when the
    // shelf has none for the sha. Returns { id, entry, path, created, thumb } -- thumb the path when written.
    place(id, entry, bytes, { thumb, fields } = {}) {
      const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      const full = Object.fromEntries(Object.entries(entry ?? {}).filter(([k, v]) => !NOT_STORED.includes(k) && v !== undefined));
      if (full.sha !== sha(buf)) throw new Error(`asset '${id}': its bytes hash to ${sha(buf).slice(0, 12)}…, not its sha ${String(full.sha).slice(0, 12)}…`);
      const bad = validate(id, full, { fields });
      if (bad.length) throw new Error(`asset '${id}' is not a valid ${full.kind ?? 'asset'} (shelf ${shelfName}):\n  ${bad.join('\n  ')}`);
      const there = entries.get(id);
      if (there && there.sha !== full.sha) throw new Error(`shelf ${shelfName} already has '${id}' with other bytes (${String(there.sha).slice(0, 12)}…, not ${full.sha.slice(0, 12)}…)`);
      mkdirSync(join(dir, 'blobs'), { recursive: true });
      const path = shelf.blobPath(full), created = !existsSync(path);
      if (created) writeAtomic(path, buf);
      entries.set(id, full);
      shelf.save();
      return { id, entry: full, path, created, thumb: thumb ? shelf.putThumb(full, thumb) : null };
    },
    // Writes a thumb (PNG bytes) for an entry's sha when the shelf has none; returns its path, or null when
    // one was there already.
    putThumb(e, png) {
      const p = shelf.thumbPath(e);
      if (existsSync(p)) return null;
      mkdirSync(join(dir, 'thumbs'), { recursive: true });
      writeAtomic(p, png);
      return p;
    },
    // Changes an entry's own fields in place (tags, desc, credit, licence...): the whole entry is validated
    // before the catalogue is saved, and the blob is not touched, so a legacy sha1 entry stays as it is.
    // The fields the bytes decide (FROM_BYTES) are refused; a null removes a field. Returns { id, entry }.
    update(id, patch, { fields } = {}) {
      const e = shelf.entry(id);
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error(`asset '${id}': an update is an object of fields`);
      const locked = Object.keys(patch).filter((k) => FROM_BYTES.includes(k));
      if (locked.length) throw new Error(`asset '${id}': ${locked.join(', ')} follow the bytes; put the payload again to change them`);
      const next = { ...e };
      for (const [k, v] of Object.entries(patch)) {
        if (NOT_STORED.includes(k)) continue;
        if (v === null || v === undefined) delete next[k]; else next[k] = v;
      }
      const bad = validate(id, next, { fields });
      if (bad.length) throw new Error(`asset '${id}' would not be a valid ${e.kind} (shelf ${shelfName}):\n  ${bad.join('\n  ')}`);
      entries.set(id, next);
      shelf.save();
      return { id, entry: next };
    },
    // Drops the entry, then its blob and thumb when no other entry shares the bytes; saves. Returns the paths
    // deleted.
    remove(id) {
      const e = shelf.entry(id), gone = [];
      entries.delete(id);
      shelf.save();
      if (!shared(e)) {
        for (const p of [shelf.blobPath(e), shelf.thumbPath(e)]) if (existsSync(p)) { rmSync(p); gone.push(p); }
      }
      return gone;
    },
    // Thumbs whose sha no entry has, as paths (orphans() is the blobs).
    staleThumbs() {
      const td = join(dir, 'thumbs');
      if (!existsSync(td)) return [];
      const used = new Set([...entries.values()].map((e) => e.sha));
      return readdirSync(td).filter((f) => THUMB.test(f) && !used.has(f.slice(0, -4))).sort().map((f) => join(td, f));
    },
    // Deletes the orphan blobs and stale thumbs (with `dry`, only lists them). Returns [{ path, bytes }].
    gc({ dry = false } = {}) {
      return [...shelf.orphans(), ...shelf.staleThumbs()].map((p) => {
        const size = statSync(p).size;
        if (!dry) rmSync(p);
        return { path: p, bytes: size };
      });
    },
    // One entry per line, ids sorted: a change to one asset is a one-line diff (hdf's format). Atomic.
    save() {
      mkdirSync(dir, { recursive: true });
      writeAtomic(file, catalogueText(entries));
    },
  };
  return shelf;
}
