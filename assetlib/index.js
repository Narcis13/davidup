// assetlib: one asset library for davidup and hdf (docs/asset-library-plan.md).
//
// An asset is a content-addressed blob with a record that says what it is, where it came from, what it is
// for and how each app takes it. The library is a directory, not a service: shelves are read in order
// (project, user, house), the first shelf holding an id wins, and the record says which shelves it shadows.
//
//   const lib = openLibrary({ shelves: [{ name: 'project', root: 'my-film/assets' }, { name: 'house', root: HOUSE_ROOT }] });
//   lib.get('teapot');                 // the record: the entry plus id, media, shelf, shadowed
//   lib.locate('teapot');              // { id, shelf, root, entry, path, thumb, shadowed }
//   lib.resolve('sha:9f2c1a3b4c5d');   // the blob's path, by any 12+ hex prefix of its sha
//   lib.search({ q: 'warm paper', media: 'raster' });   // ranked hits with why, facets
//   await lib.preview('teapot');       // { path, png, by, cached }: the host's previewer, else a card
//   await lib.sheet(['teapot', 'fox']);   // one contact sheet PNG with id captions
//   lib.use('teapot');                 // { davidup: { tool: 'register_asset', args }, hdf: { assets, code, ... } }
//   await lib.put('user', { id: 'paper', kind: 'stock', ... }, bytes, { probes });   // one way in
//   lib.update('paper', { tags: ['paper', 'warm'] });   // an entry's own fields, in place
//   lib.move('paper', 'house');        // the editor's promote, generalised
//   lib.remove('paper'); lib.gc();     // and out
//
// Plain ESM, zero dependencies: hdf imports it as it is, davidup through index.d.ts. Anything heavier (a
// probe, a previewer, a ranker) is injected by the host.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extFor, readShelf, sha } from './catalogue.js';
import { colours, imageType, usesAlpha } from './image.js';
import { PREVIEW_WIDTH, card, contactSheet, decodePng, fresh, previewer, tagOf, tagged } from './preview.js';
import { SCHEMAS, mediaOf } from './record.js';
import { searchIndex } from './search.js';
import { newest, useOf } from './use.js';

export { KINDS, MEDIA, LICENCES, SCHEMAS, ID, SHA256, SHA1, isLegacySha, mediaOf, validate } from './record.js';
export { FROM_BYTES, readShelf, sha } from './catalogue.js';
export { colours, imageInfo, imageType, quantise, sniff } from './image.js';
export { CARD_H, CARD_W, PREVIEW_VERSION, PREVIEW_WIDTH, TAG_KEY, card, cardKey, contactSheet, decodePng, encodePng, factsOf, fresh, lettering, pngText, tagOf, withText } from './preview.js';
export { DAVIDUP_TYPE, DAVIDUP_VIA, PIN, assetSrc, davidupUse, hdfUse, useOf } from './use.js';
export { LEVELS, RULES, check } from './check.js';
export { migrateSha256 } from './migrate.js';
export { KNOWN_HOSTS, loadHosts } from './hosts.js';
export { DARK, EXACT_ID, HUES, SYNONYM, SYNONYMS, WEIGHTS, facetsOf, fold, hueOf, lightness, parseQuery, search, searchIndex, tokenise } from './search.js';

// The house shelf: in git, where in-house production lands. hdf's store is it by path until H4 moves it to
// <repo>/assets/.
export const HOUSE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'handdrawn', 'assets');

// The standard shelves in search order: the open project's `assets/` (when a project is named), the user's
// pool ($DAVIDUP_ASSETS, else ~/.davidup/assets), the house ($DAVIDUP_HOUSE, else HOUSE_ROOT).
export function standardShelves({ project, env = process.env, home = homedir() } = {}) {
  return [
    ...(project ? [{ name: 'project', root: join(resolve(project), 'assets') }] : []),
    { name: 'user', root: env.DAVIDUP_ASSETS || join(home, '.davidup', 'assets') },
    { name: 'house', root: env.DAVIDUP_HOUSE || HOUSE_ROOT },
  ];
}

// ---------- probes ----------

// A host's probes (davidup's ffprobe, skia in either app), each optional and each given the payload as a file:
//   probeVideo(file) -> { sec | duration, fps, w | width, h | height, alpha | hasAlpha, codec, audio | hasAudio }
//   probeAudio(file) -> { sec | duration, rate | sampleRate, channels, codec }      (audio and sample kinds)
//   fontMeta(file)   -> { family, weight, style, glyphs }
//   pixels(file, { kind, ext }) -> { data: RGBA, width, height }   (a raster's pixels, a video's representative frame)
// davidup's probe results read as they are; only the fields the kind's schema has are kept.
const PROBE_OF = { video: 'probeVideo', audio: 'probeAudio', sample: 'probeAudio', font: 'fontMeta' };
const RENAME = { duration: 'sec', width: 'w', height: 'h', sampleRate: 'rate', hasAlpha: 'alpha', hasAudio: 'audio' };

// The facts a host's probes give for a payload, and a warning for every probe that is missing or failed while
// the entry still lacks what it would have said. Throws only when the bytes are not the kind's (extFor).
export async function probeFacts(entry, bytes, probes = {}) {
  const s = SCHEMAS[entry?.kind], facts = {}, warnings = [];
  if (!s) return { facts, warnings };
  const ext = extFor(entry, bytes), media = mediaOf(entry.kind);
  const lacks = (keys) => keys.filter((k) => entry[k] === undefined);
  let dir = null;
  const file = () => {
    if (!dir) { dir = mkdtempSync(join(tmpdir(), 'assetlib-')); writeFileSync(join(dir, `payload.${ext}`), bytes); }
    return join(dir, `payload.${ext}`);
  };
  const run = async (name, fn, why) => {
    try { return await fn(); } catch (err) { warnings.push(`${name} could not read the ${entry.kind}: ${err?.message ?? err}; ${why} left empty`); return null; }
  };
  try {
    const name = PROBE_OF[entry.kind];
    if (name) {
      const keys = Object.keys(s.fields ?? {}).filter((k) => !['colours', 'align', 'mouth'].includes(k));
      const want = lacks(keys);
      if (want.length && !probes[name]) warnings.push(`no ${name} probe: ${want.join(', ')} left empty`);
      else if (want.length) {
        const got = await run(name, () => probes[name](file()), want.join(', '));
        for (const [k, v] of Object.entries(got ?? {})) {
          const key = RENAME[k] ?? k;
          if (v !== undefined && v !== null && s.fields?.[key]) facts[key] = v;
        }
      }
    }
    if ((media === 'raster' || media === 'video') && entry.colours === undefined) {
      if (!probes.pixels) warnings.push('no pixels probe: colours left empty');
      else {
        const px = await run('pixels', () => probes.pixels(file(), { kind: entry.kind, ext }), 'colours');
        if (px?.data) {
          facts.colours = colours(px, { sil: entry.sil });
          if (media === 'raster') Object.assign(facts, { w: px.width, h: px.height, alpha: usesAlpha(px) });
        }
      }
    }
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
  return { facts, warnings };
}

// ---------- previews ----------

// Where a thumb goes when its shelf cannot be written (a packaged house shelf, a read-only mount): one cache
// per machine, keyed by sha like a shelf's, so the tag still decides whether it answers. openLibrary's
// `thumbCache` names another.
export const THUMB_CACHE = join(tmpdir(), 'assetlib-thumbs');

// Writes a thumb whole or not at all; false when the directory cannot be written.
function writeThumb(file, png) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(tmp, png);
    renameSync(tmp, file);
    return true;
  } catch (err) {
    rmSync(tmp, { force: true });
    if (['EACCES', 'EPERM', 'EROFS'].includes(err?.code)) return false;
    throw err;
  }
}

// `sha:<hex>` names the bytes, not the record: any unambiguous prefix of 12 or more hex.
const SHA_REF = /^sha:([0-9a-f]{12,64})$/;

// The shelves, read once and merged. `shelves` is [{ name, root }] in search order (default: standardShelves()).
// `rank(record, query, { score })` replaces search's built-in scorer (search.js). `previewers` is { kind:
// previewer } for lib.preview (preview.js), each a function (file, record, { width }) -> PNG bytes or
// { name, version, render }; `thumbCache` is where thumbs go for a shelf that cannot be written.
export function openLibrary({ shelves = standardShelves(), rank, previewers = {}, thumbCache = THUMB_CACHE } = {}) {
  const read = shelves.map((s) => readShelf(s.root, { name: s.name }));
  const names = read.map((s) => s.name);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new Error(`shelf '${dup}' is named twice (shelves: ${names.join(', ')})`);

  // id -> the shelves holding it, in search order; sha -> [{ shelf, id }] for every entry with those bytes.
  // Rebuilt after every write, which also drops the search index (built on the first search after).
  let byId, bySha, finder, madeFrom;
  const index = () => {
    byId = new Map(); bySha = new Map(); finder = null; madeFrom = null;
    for (const s of read) {
      for (const id of s.ids) {
        if (!byId.has(id)) byId.set(id, []);
        byId.get(id).push(s);
        const e = s.entries.get(id);
        if (typeof e?.sha !== 'string') continue;
        if (!bySha.has(e.sha)) bySha.set(e.sha, []);
        bySha.get(e.sha).push({ shelf: s.name, id });
      }
    }
  };
  index();
  const searched = () => read.map((s) => `${s.name} (${s.root})`).join(', ') || 'none';

  const shaOf = (prefix) => {
    const full = [...bySha.keys()].filter((h) => h.startsWith(prefix));
    if (!full.length) throw new Error(`no asset with sha ${prefix} on shelves ${searched()}`);
    if (full.length > 1) throw new Error(`sha ${prefix} is ambiguous (${full.map((h) => h.slice(0, 16)).join(', ')}); give more hex`);
    return full[0];
  };
  const at = (s, id, shadowed) => {
    const entry = s.entries.get(id);
    return { id, shelf: s.name, root: s.root, entry, path: s.blobPath(entry), thumb: s.thumbPath(entry), shadowed };
  };

  // Where a write lands when none is named: the project when one is open, else the user's pool.
  const writable = () => {
    const s = read.find((x) => x.name === 'project') ?? read.find((x) => x.name === 'user');
    if (!s) throw new Error(`name a shelf to write to (shelves: ${names.join(', ') || 'none'})`);
    return s;
  };
  const holder = (id) => {
    const h = byId.get(id);
    if (!h) throw new Error(`no asset '${id}' on shelves ${searched()}`);
    return h[0];
  };

  const lib = {
    shelves: read,
    get ids() { return [...byId.keys()].sort(); },
    shelf(name) {
      const s = read.find((x) => x.name === name);
      if (!s) throw new Error(`no shelf '${name}' (shelves: ${names.join(', ') || 'none'})`);
      return s;
    },
    has(ref) {
      const m = SHA_REF.exec(ref);
      return m ? [...bySha.keys()].some((h) => h.startsWith(m[1])) : byId.has(ref);
    },
    // Where a ref lives: the winning shelf for an id, with the later shelves it shadows; for `sha:<hex>`
    // the first shelf holding those bytes, under the id it has there (shadowed is then empty).
    locate(ref) {
      const m = SHA_REF.exec(ref);
      if (m) {
        const { shelf, id } = bySha.get(shaOf(m[1]))[0];
        return at(lib.shelf(shelf), id, []);
      }
      const holders = byId.get(ref);
      if (!holders) throw new Error(`no asset '${ref}' on shelves ${searched()}`);
      return at(holders[0], ref, holders.slice(1).map((s) => s.name));
    },
    // The record: the entry as the shelf holds it, plus its id, media, the shelf it came from and the
    // shelves it shadows. A fresh object each call; the shelf's entry is not touched.
    get(ref) {
      const { id, shelf, entry, shadowed } = lib.locate(ref);
      let media = entry.media;
      if (media === undefined) try { media = mediaOf(entry.kind); } catch { media = undefined; }
      return { ...entry, id, media, shelf, shadowed };
    },
    // The blob's path for a ref.
    resolve: (ref) => lib.locate(ref).path,
    // Every shelf holding some bytes (a full sha or a 12+ hex prefix): [{ shelf, id }] in search order.
    holders: (hex) => bySha.get(shaOf(String(hex).replace(/^sha:/, ''))).map((h) => ({ ...h })),

    // The records made from a ref (their made.from names its id), over the winning records, newest first.
    made(ref) {
      if (!madeFrom) {
        madeFrom = new Map();
        for (const id of lib.ids) {
          const r = lib.get(id);
          for (const from of new Set(r.made?.from ?? [])) {
            if (!madeFrom.has(from)) madeFrom.set(from, []);
            madeFrom.get(from).push(r);
          }
        }
      }
      const out = madeFrom.get(lib.locate(ref).id) ?? [];
      return out.map((r) => ({ ...r })).sort(newest);
    },
    // The `use` block (use.js): { davidup, hdf }, each the exact call that brings the ref into that app, or
    // null. A puppet, hand or motif is offered to davidup through a record made from it.
    use(ref) {
      const loc = lib.locate(ref);
      return useOf(lib.get(ref), { made: lib.made(ref), root: loc.root, store: HOUSE_ROOT, path: loc.path });
    },

    // Ranked, filtered, explained (plan §4; search.js): { count, total, facetsOf, facets, hits }. Each hit is
    // { id, shelf, score, why, record, path, thumb, use } over the winning records (a shadowed one is not
    // listed twice); `thumb` is null until lib.preview has drawn it. A string is `{ q }`.
    search(query) {
      finder ??= searchIndex(lib.ids.map((id) => lib.get(id)));
      const out = finder.search(query, { rank, shelves: names });
      for (const h of out.hits) {
        const loc = lib.locate(h.id);
        h.path = loc.path;
        h.thumb = [loc.thumb, join(thumbCache, `${loc.entry.sha}.png`)].find((t) => existsSync(t)) ?? null;
        h.use = lib.use(h.id);
      }
      return out;
    },

    // ---------- previews (A4) ----------

    // The preview of a ref: the cached thumb when its tag still answers for the record (preview.js fresh()),
    // else the host's previewer for the kind (given the blob's path, the record and { width: 480 }), else the
    // fallback card; the new thumb is written to the shelf's thumbs/<sha>.png (the thumbCache when the shelf
    // is read-only). `previewers` add to or replace the library's; `force` redraws. A previewer that throws,
    // or returns something other than a PNG, gives the card and a warning (and is asked again next time).
    // Resolves to { id, shelf, path, png, by, cached, warnings }.
    async preview(ref, { previewers: more, force = false } = {}) {
      const loc = lib.locate(ref), record = lib.get(ref), warnings = [];
      const p = previewer({ ...previewers, ...more }[record.kind]);
      const cachedAt = [loc.thumb, join(thumbCache, `${loc.entry.sha}.png`)];
      if (!force) {
        for (const path of cachedAt) {
          if (!existsSync(path)) continue;
          const png = readFileSync(path);
          if (fresh(tagOf(png), record, p)) return { id: loc.id, shelf: loc.shelf, path, png, by: tagOf(png).by, cached: true, warnings };
        }
      }
      let png = null, by = null;
      if (p && !existsSync(loc.path)) warnings.push(`previewer ${p.by} not asked: blob ${loc.entry.sha}.${loc.entry.ext} is missing from ${dirname(loc.path)}`);
      else if (p) {
        try {
          const out = await p.render(loc.path, record, { width: PREVIEW_WIDTH });
          if (!out || imageType(out) !== 'png') throw new Error(`returned ${out ? imageType(out) ?? 'bytes that are not an image' : 'nothing'}, not a PNG`);
          png = tagged(out, p);
          by = p.by;
        } catch (err) {
          warnings.push(`previewer ${p.by} could not draw '${loc.id}' (${record.kind}): ${err?.message ?? err}; drew its card`);
        }
      }
      if (!png) { png = card(record); by = tagOf(png).by; }
      const path = writeThumb(cachedAt[0], png) ? cachedAt[0] : (writeThumb(cachedAt[1], png) ? cachedAt[1] : null);
      if (!path) warnings.push(`thumb not written: neither ${dirname(cachedAt[0])} nor ${thumbCache} can be written`);
      return { id: loc.id, shelf: loc.shelf, path, png, by, cached: false, warnings };
    },
    // One contact sheet PNG of some refs' previews, `cols` across (default: the square root, rounded up) with
    // the id under each; what an agent asks for to compare candidates in one look. Previews are made (and
    // cached) as lib.preview makes them. `out` also writes the sheet there. Resolves to { png, path, width,
    // height, cols, rows, cells: [{ id, shelf, x, y, w, h }], warnings }.
    async sheet(refs, { cols, cell, previewers: more, force, out } = {}) {
      const list = Array.isArray(refs) ? refs : [refs];
      if (!list.length) throw new Error('a contact sheet needs at least one asset');
      const missing = list.filter((r) => !lib.has(r));
      if (missing.length) throw new Error(`no asset ${missing.map((r) => `'${r}'`).join(', ')} on shelves ${searched()}`);
      const items = [], warnings = [];
      for (const ref of list) {
        const pv = await lib.preview(ref, { previewers: more, force });
        warnings.push(...pv.warnings);
        let pixels;
        try { pixels = decodePng(pv.png); } catch (err) {
          warnings.push(`preview of '${pv.id}' could not be read (${err.message}); its card is on the sheet`);
          pixels = decodePng(card(lib.get(ref)));
        }
        items.push({ id: pv.id, shelf: pv.shelf, pixels });
      }
      const sheet = contactSheet(items, { cols, cell });
      if (out) { mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(out, sheet.png); }
      return { ...sheet, cells: sheet.cells.map((c, i) => ({ id: c.id, shelf: items[i].shelf, x: c.x, y: c.y, w: c.w, h: c.h })), path: out ? resolve(out) : null, warnings };
    },

    // ---------- writes (A2) ----------

    // Probes the payload with the host's probes, then puts it on `shelf` (a name; null for the project, else
    // the user's pool): hashed, derived, validated, and only then written. Resolves to { id, shelf, entry,
    // path, created, warnings }; rejects, having written nothing, when the entry is not valid.
    async put(shelf, entry, bytes, { probes, fields, by } = {}) {
      const s = shelf ? lib.shelf(shelf) : writable();
      const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      const { facts, warnings } = await probeFacts(entry, buf, probes);
      const out = s.put(entry, buf, { facts, fields, by });
      index();
      return { ...out, shelf: s.name, warnings };
    },
    // Changes a record's own fields (tags, desc, credit, licence...) on `shelf` (default: the shelf it resolves
    // to), validated before the catalogue is saved; the blob is not touched. A null removes a field; the fields
    // the bytes decide are refused. Returns { id, shelf, entry }.
    update(id, patch, { shelf, fields } = {}) {
      const s = shelf ? lib.shelf(shelf) : holder(id);
      const out = s.update(id, patch, { fields });
      index();
      return { ...out, shelf: s.name };
    },
    // Removes an id from `shelf` (default: the shelf it resolves to), with its blob and thumb when nothing
    // else on that shelf shares them. Returns { id, shelf, removed: [paths] }.
    remove(id, { shelf } = {}) {
      const s = shelf ? lib.shelf(shelf) : holder(id);
      const removed = s.remove(id);
      index();
      return { id, shelf: s.name, removed };
    },
    // Moves an id to another shelf: blob, thumb and entry are written there (rehashed as sha256, validated),
    // then removed from where it was (`from`, default the shelf it resolves to). Refuses when the target
    // holds the id with other bytes. Returns { id, from, to, entry, path }.
    move(id, to, { from, fields } = {}) {
      const src = from ? lib.shelf(from) : holder(id), dst = lib.shelf(to);
      if (src === dst) throw new Error(`'${id}' is already on shelf ${dst.name}`);
      const e = src.entry(id), bytes = src.payload(e), there = dst.entries.get(id);
      if (there && there.sha !== sha(bytes) && there.sha !== e.sha) {
        throw new Error(`shelf ${dst.name} already has '${id}' with other bytes (${there.sha.slice(0, 12)}, not ${sha(bytes).slice(0, 12)}); remove it there or move under another id`);
      }
      const out = dst.put({ ...e, id }, bytes, { fields });
      const thumb = src.thumbPath(e);
      if (existsSync(thumb) && !existsSync(dst.thumbPath(out.entry))) {
        mkdirSync(dirname(dst.thumbPath(out.entry)), { recursive: true });
        copyFileSync(thumb, dst.thumbPath(out.entry));
      }
      src.remove(id);
      index();
      return { id, from: src.name, to: dst.name, entry: out.entry, path: out.path };
    },
    // Deletes the orphan blobs and stale thumbs on every shelf (or `shelf`); `dry` lists them only.
    // Returns [{ shelf, path, bytes }].
    gc({ shelf, dry = false } = {}) {
      return (shelf ? [lib.shelf(shelf)] : read).flatMap((s) => s.gc({ dry }).map((g) => ({ shelf: s.name, ...g })));
    },
  };
  return lib;
}
