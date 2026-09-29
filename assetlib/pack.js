// Packs as tarballs (asset-library plan I3): sharing is a file.
//
//   const { tgz } = exportPack(lib, ['paper-warm', 'sfx-pop']);   // or exportPack(lib, [], { shelf: 'user' })
//   writeFileSync('pack.tgz', tgz);
//   importPack(lib, readFileSync('pack.tgz'), { shelf: 'user' });  // { added, same, kept, conflicts, results }
//
// A pack is a gzipped ustar archive laid out as a shelf, so `tar xzf pack.tgz -C dir` gives a shelf that opens:
//
//   pack.json                   { pack: 'assetlib', version, ids }: what it is and what it holds
//   catalogue.json              the entries, exactly as their shelves stored them (the shelf's line format)
//   blobs/<sha256>.<ext>        each payload once
//   thumbs/<sha256>.png         each preview there was, once
//
// Export is deterministic: the same records give the same bytes, whichever shelf they came from (files sorted,
// mtime 0, owner 0, mode 644).
// Import merges by sha: a new id is placed verbatim (licence, credit, made, added all kept), an id the shelf
// holds with the same bytes is left as the shelf has it, and an id it holds with other bytes is a conflict,
// reported and never overwritten. Every blob is hashed and every entry validated before anything is written,
// so a damaged pack writes nothing. A tarball of a shelf directory made by hand (`tar czf x.tgz -C shelf .`)
// imports too; pack.json is optional.
import { gunzipSync, gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { targetShelf } from './add.js';
import { catalogueText, sha } from './catalogue.js';
import { imageType } from './image.js';
import { isLegacySha, validate } from './record.js';

export const PACK_VERSION = 1;

// ---------- tar (ustar, regular files only) ----------

const BLOCK = 512;
const octal = (n, width) => `${n.toString(8).padStart(width - 1, '0')}\0`;

// A ustar archive of [{ name, bytes }] in the order given: mode 644, owner 0, mtime 0, so the same files give
// the same archive. Names are at most 100 bytes (a pack's are under 80).
export function writeTar(files) {
  const parts = [];
  for (const { name, bytes } of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    if (nameBytes.length > 100) throw new Error(`tar: '${name}' is longer than 100 bytes`);
    const h = Buffer.alloc(BLOCK);
    nameBytes.copy(h, 0);
    h.write(octal(0o644, 8), 100, 'latin1');
    h.write(octal(0, 8), 108, 'latin1');
    h.write(octal(0, 8), 116, 'latin1');
    h.write(octal(bytes.length, 12), 124, 'latin1');
    h.write(octal(0, 12), 136, 'latin1');
    h.fill(0x20, 148, 156);
    h.write('0', 156, 'latin1');
    h.write('ustar\u000000', 257, 'latin1');
    let sum = 0;
    for (const b of h) sum += b;
    h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
    parts.push(h, Buffer.from(bytes));
    const pad = (BLOCK - (bytes.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

const field = (h, at, len) => {
  const f = h.subarray(at, at + len), nul = f.indexOf(0);
  return f.subarray(0, nul < 0 ? len : nul).toString('utf8');
};

// The regular files in a tar archive (gzipped or not), as a Map of name -> bytes, names without a leading
// './'. Directories, links and pax/GNU header records are skipped; a header whose checksum is wrong throws.
export function readTar(buf) {
  const tar = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : Buffer.from(buf);
  const files = new Map();
  let at = 0;
  while (at + BLOCK <= tar.length) {
    const h = tar.subarray(at, at + BLOCK);
    if (h.every((b) => b === 0)) break;
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
    const want = parseInt(field(h, 148, 8).trim(), 8);
    if (sum !== want) throw new Error(`not a tar archive (the header at byte ${at} has a bad checksum)`);
    if (h[124] & 0x80) throw new Error(`tar: '${field(h, 0, 100)}' is too large for a pack`);
    const size = parseInt(field(h, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 0x30);
    // POSIX ustar ('ustar\0') splits a long name into prefix/name; GNU's 'ustar ' uses those bytes otherwise.
    const prefix = h.subarray(257, 263).toString('latin1') === 'ustar\0' ? field(h, 345, 155) : '';
    const name = (prefix ? `${prefix}/${field(h, 0, 100)}` : field(h, 0, 100)).replace(/^(\.\/)+/, '');
    const body = at + BLOCK;
    if (body + size > tar.length) throw new Error(`tar: '${name}' is cut short`);
    if ((type === '0' || type === '7') && name) files.set(name, Buffer.from(tar.subarray(body, body + size)));
    at = body + Math.ceil(size / BLOCK) * BLOCK;
  }
  return files;
}

// ---------- the pack ----------

const BLOB = /^blobs\/([0-9a-f]{64})\.(\w+)$/;
const THUMB = /^thumbs\/([0-9a-f]{64})\.png$/;
const IGNORED = /(^|\/)(\._[^/]*|\.DS_Store)$|\/$/;

// A pack's contents: { meta (pack.json, or null), entries: Map id -> entry, blobs: Map '<sha>.<ext>' -> bytes,
// thumbs: Map sha -> PNG bytes, warnings }. Throws when it is not a pack: not a tar, no catalogue.json, a
// catalogue that is not an object of entries, or a pack.json from a newer assetlib.
export function readPack(bytes) {
  let files;
  try { files = readTar(bytes); } catch (err) { throw new Error(`not an asset pack: ${err.message}`); }
  const warnings = [];
  let meta = null;
  if (files.has('pack.json')) {
    try { meta = JSON.parse(files.get('pack.json').toString('utf8')); } catch (err) { throw new Error(`not an asset pack: pack.json is not JSON (${err.message})`); }
    if (meta?.pack !== 'assetlib') throw new Error("not an asset pack: pack.json does not say pack: 'assetlib'");
    if (!(Number.isInteger(meta.version) && meta.version >= 1)) throw new Error(`not an asset pack: pack.json version ${meta.version}`);
    if (meta.version > PACK_VERSION) throw new Error(`the pack is version ${meta.version}; this assetlib reads version ${PACK_VERSION} and older`);
  }
  if (!files.has('catalogue.json')) throw new Error(`not an asset pack: no catalogue.json (it has ${[...files.keys()].slice(0, 6).join(', ') || 'nothing'})`);
  let raw;
  try { raw = JSON.parse(files.get('catalogue.json').toString('utf8')); } catch (err) { throw new Error(`not an asset pack: catalogue.json is not JSON (${err.message})`); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not an asset pack: catalogue.json must be an object of id -> entry');
  const entries = new Map(Object.entries(raw)), blobs = new Map(), thumbs = new Map();
  for (const [name, data] of files) {
    let m;
    if (name === 'pack.json' || name === 'catalogue.json' || IGNORED.test(name)) continue;
    if ((m = BLOB.exec(name))) blobs.set(`${m[1]}.${m[2]}`, data);
    else if ((m = THUMB.exec(name))) thumbs.set(m[1], data);
    else warnings.push(`ignored ${name}: a pack holds pack.json, catalogue.json, blobs/<sha256>.<ext> and thumbs/<sha256>.png`);
  }
  const named = new Set([...entries.values()].map((e) => `${e?.sha}.${e?.ext}`));
  for (const b of blobs.keys()) if (!named.has(b)) warnings.push(`ignored blobs/${b}: no entry in the pack's catalogue names it`);
  if (meta && Array.isArray(meta.ids)) {
    const listed = [...meta.ids].sort().join(','), has = [...entries.keys()].sort().join(',');
    if (listed !== has) warnings.push('pack.json lists other ids than its catalogue holds; the catalogue is what is imported');
  }
  return { meta, entries, blobs, thumbs, warnings };
}

// The entry on shelf `s` for a ref: an id, or sha:<hex> (12+ hex) naming bytes that shelf holds.
function onShelf(s, ref) {
  const m = /^sha:([0-9a-f]{12,64})$/.exec(ref);
  if (!m) return { id: ref, entry: s.entry(ref) };
  const hit = s.ids.filter((id) => String(s.entries.get(id).sha).startsWith(m[1]));
  if (!hit.length) throw new Error(`no asset with sha ${m[1]} on shelf ${s.name}`);
  return { id: hit[0], entry: s.entries.get(hit[0]) };
}

// A pack of some records: `refs` (ids or sha:<hex>) as the library resolves them, or with `shelf` as that
// shelf holds them; `shelf` alone packs the whole shelf. Entries go in as their shelves stored them, each blob
// and thumb once (a thumb from the shelf, else the library's thumb cache). Throws, naming every one, when a
// record cannot travel: a sha1 entry (asset migrate --sha256 first), a missing blob, a blob whose bytes miss
// its sha. Returns { tgz, ids, blobs, thumbs, bytes, entries: [{ id, shelf, kind, sha, ext, bytes }], warnings }
// -- warnings name what a record was made from that the pack does not carry.
export function exportPack(lib, refs = [], { shelf } = {}) {
  const from = shelf ? lib.shelf(shelf) : null;
  const list = refs.length ? refs : from ? from.ids : [];
  if (!list.length) throw new Error(from ? `shelf ${from.name} is empty; there is nothing to pack` : 'name the ids to pack, or a shelf');
  const picked = new Map(), bad = [];
  for (const ref of list) {
    const loc = from ? onShelf(from, ref) : lib.locate(ref);
    const s = from ?? lib.shelf(loc.shelf), { id, entry } = loc;
    if (picked.has(id)) continue;
    if (isLegacySha(entry.sha)) { bad.push(`'${id}' on ${s.name} is a sha1 entry (asset migrate --sha256 ${s.name} first)`); continue; }
    const path = s.blobPath(entry);
    if (!existsSync(path)) { bad.push(`'${id}' on ${s.name}: blob ${entry.sha.slice(0, 12)}….${entry.ext} is missing${entry.made ? ` (asset remake ${id})` : ''}`); continue; }
    const bytes = readFileSync(path);
    if (sha(bytes) !== entry.sha) { bad.push(`'${id}' on ${s.name}: blob ${entry.sha.slice(0, 12)}….${entry.ext} hashes to ${sha(bytes).slice(0, 12)}… (asset check)`); continue; }
    const thumb = [s.thumbPath(entry), ...(lib.thumbCache ? [join(lib.thumbCache, `${entry.sha}.png`)] : [])].find((p) => existsSync(p));
    picked.set(id, { id, shelf: s.name, entry, bytes, thumb });
  }
  if (bad.length) throw new Error(`cannot pack ${bad.length === 1 ? 'a record' : `${bad.length} records`}:\n  ${bad.join('\n  ')}`);

  const ids = [...picked.keys()].sort(), blobs = new Map(), thumbs = new Map(), warnings = [];
  for (const id of ids) {
    const p = picked.get(id);
    blobs.set(`${p.entry.sha}.${p.entry.ext}`, p.bytes);
    if (p.thumb && !thumbs.has(p.entry.sha)) {
      const png = readFileSync(p.thumb);
      if (imageType(png) === 'png') thumbs.set(p.entry.sha, png);
    }
    const out = [...new Set(p.entry.made?.from ?? [])].filter((f) => !picked.has(f));
    if (out.length) warnings.push(`'${id}' was made from ${out.map((f) => `'${f}'`).join(', ')}, not in the pack (asset remake needs ${out.length === 1 ? 'it' : 'them'} on a shelf)`);
  }
  // No shelf names or times: the same records give the same pack wherever they sit.
  const meta = { pack: 'assetlib', version: PACK_VERSION, ids };
  const sorted = (m) => [...m.keys()].sort().map((k) => [k, m.get(k)]);
  const tar = writeTar([
    { name: 'pack.json', bytes: Buffer.from(`${JSON.stringify(meta)}\n`) },
    { name: 'catalogue.json', bytes: Buffer.from(catalogueText(new Map(ids.map((id) => [id, picked.get(id).entry])))) },
    ...sorted(blobs).map(([name, bytes]) => ({ name: `blobs/${name}`, bytes })),
    ...sorted(thumbs).map(([h, bytes]) => ({ name: `thumbs/${h}.png`, bytes })),
  ]);
  const tgz = gzipSync(tar, { level: 9 });
  const entries = ids.map((id) => { const { shelf: s, entry: e } = picked.get(id); return { id, shelf: s, kind: e.kind, sha: e.sha, ext: e.ext, bytes: e.bytes ?? picked.get(id).bytes.length }; });
  return { tgz, ids, blobs: blobs.size, thumbs: thumbs.size, bytes: tgz.length, entries, warnings };
}

// Which shelves hold `id` before and after `target` in search order: the shelf that will shadow it there and
// the shelves it shadows.
function shadowsOf(lib, target, id) {
  const at = lib.shelves.indexOf(target);
  const holds = (s) => s.has(id);
  return {
    shadowedBy: lib.shelves.slice(0, at).find(holds)?.name ?? null,
    shadows: lib.shelves.slice(at + 1).filter(holds).map((s) => s.name),
  };
}

// Brings a pack (its bytes) onto `shelf` (default as addAsset's: the project when one is open, else the user's
// pool). Each id resolves to one status:
//   added     not on the shelf: placed verbatim, its blob written unless the shelf has those bytes already
//   same      on the shelf with the same bytes and the same record: nothing to do
//   kept      on the shelf with the same bytes and another record (tags, desc...): the shelf's is kept
//   conflict  on the shelf with other bytes: reported, not overwritten
// A thumb the shelf lacks is written for added, same and kept alike. `dry` writes nothing and says what would
// happen. Throws, having written nothing, when the pack is damaged: an entry that does not validate, a blob
// missing from the pack or one whose bytes miss its entry's sha. Returns { shelf, dry, results: [{ id, kind,
// status, sha, blob: 'new' | 'had', thumb, differs, ours, shadowedBy, shadows }], added, same, kept, conflicts,
// warnings }.
export function importPack(lib, bytes, { shelf, fields, dry = false } = {}) {
  const pack = readPack(bytes), warnings = [...pack.warnings];
  const target = lib.shelf(targetShelf(lib, shelf));
  const ids = [...pack.entries.keys()].sort();
  if (!ids.length) throw new Error('the pack is empty');

  const bad = [];
  for (const id of ids) {
    const e = pack.entries.get(id), why = validate(id, e, { fields });
    if (why.length) { bad.push(`'${id}': ${why.join('; ')}`); continue; }
    if (isLegacySha(e.sha)) { bad.push(`'${id}': a sha1 entry (only sha256 travels in a pack)`); continue; }
    const blob = pack.blobs.get(`${e.sha}.${e.ext}`);
    if (!blob) bad.push(`'${id}': blobs/${e.sha}.${e.ext} is not in the pack`);
    else if (sha(blob) !== e.sha) bad.push(`'${id}': blobs/${e.sha.slice(0, 12)}….${e.ext} hashes to ${sha(blob).slice(0, 12)}…`);
  }
  if (bad.length) throw new Error(`the pack is damaged; nothing was imported:\n  ${bad.join('\n  ')}`);

  const results = [];
  for (const id of ids) {
    const e = pack.entries.get(id), there = target.entries.get(id);
    const png = pack.thumbs.get(e.sha);
    const thumb = png && imageType(png) === 'png' && !existsSync(target.thumbPath(e)) ? png : undefined;
    const blob = existsSync(target.blobPath(e)) ? 'had' : 'new';
    const r = { id, kind: e.kind, sha: e.sha, blob, thumb: false };
    if (!there) r.status = 'added';
    else if (there.sha !== e.sha) Object.assign(r, { status: 'conflict', blob: null, ours: there.sha });
    else {
      const keys = [...new Set([...Object.keys(there), ...Object.keys(e)])];
      const differs = keys.filter((k) => JSON.stringify(there[k]) !== JSON.stringify(e[k]));
      Object.assign(r, differs.length ? { status: 'kept', differs } : { status: 'same' });
    }
    if (r.status !== 'conflict') r.thumb = !!thumb;
    if (!dry && r.status === 'added') lib.place(target.name, id, e, pack.blobs.get(`${e.sha}.${e.ext}`), { thumb, fields });
    else if (!dry && r.thumb) target.putThumb(e, thumb);
    results.push(r);
  }
  for (const r of results) {
    if (r.status === 'conflict') continue;
    Object.assign(r, shadowsOf(lib, target, r.id));
  }
  const count = (s) => results.filter((r) => r.status === s).length;
  return { shelf: target.name, dry, results, added: count('added'), same: count('same'), kept: count('kept'), conflicts: count('conflict'), warnings };
}
