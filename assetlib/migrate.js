// Rehashing a shelf as sha256 (asset-library plan §2 "sha256, one hash", §7 H1; `asset migrate --sha256`).
//
// hdf named its blobs by sha1. The migration renames them, it does not re-encode them: every blob keeps its
// bytes, so a film draws the same pixels and every golden holds. The one exception is a JSON payload that
// names another blob of the shelf by its sha1 (a puppet's retargeted cycle records the clip it came from,
// `cycles.run.from.sha`): that string becomes the other blob's sha256, so those bytes change and the payload
// is hashed after the rewrite. Anything outside the shelf that names a sha (hdf's packs/manifest.json) is
// the host's to rewrite; `map` says old -> new.
//
// Order, so a crash never leaves a catalogue naming a blob that is not there: the new blobs are written
// first (a copy, or the rewritten bytes), then the catalogue, then the old blobs and thumbs are removed. A
// crash in between leaves orphans, which `asset gc` collects. Before anything is written every legacy blob is
// read and must hash to its entry's sha1, or nothing is done.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha } from './catalogue.js';
import { isLegacySha } from './record.js';

const sha1 = (bytes) => createHash('sha1').update(bytes).digest('hex');

// Writes a file whole or not at all.
function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tmp, data);
  try { renameSync(tmp, file); } catch (err) { rmSync(tmp, { force: true }); throw err; }
}

// Rehashes every sha1 entry of a shelf (readShelf's) as sha256. With `dry` nothing is written. Returns
// { shelf, blobs: [{ from, to, ext, ids, rewrote }], map: { sha1: sha256 }, removed: [paths] }, where
// `rewrote` lists the old shas a JSON payload named and now names by their new ones.
export function migrateSha256(shelf, { dry = false } = {}) {
  // One blob per (sha, ext); two entries sharing bytes share the blob.
  const blobs = new Map();
  for (const id of shelf.ids) {
    const e = shelf.entries.get(id);
    if (!e || !isLegacySha(e.sha)) continue;
    const key = `${e.sha}.${e.ext}`;
    if (!blobs.has(key)) blobs.set(key, { from: e.sha, ext: e.ext, ids: [], path: shelf.blobPath(e) });
    blobs.get(key).ids.push(id);
  }
  const bad = [];
  for (const b of blobs.values()) {
    if (!existsSync(b.path)) { bad.push(`${b.ids.join(', ')}: blob ${b.from}.${b.ext} is missing`); continue; }
    b.bytes = readFileSync(b.path);
    if (sha1(b.bytes) !== b.from) bad.push(`${b.ids.join(', ')}: blob ${b.from}.${b.ext} hashes to ${sha1(b.bytes)} (sha1)`);
  }
  if (bad.length) throw new Error(`shelf ${shelf.name}: not migrated, nothing written:\n  ${bad.join('\n  ')}`);

  // The final bytes and sha256 of a blob: a JSON payload naming another legacy blob's sha1 names its sha256.
  const byFrom = new Map([...blobs.values()].map((b) => [b.from, b]));
  const doing = new Set();
  const settle = (b) => {
    if (b.to) return b.to;
    if (doing.has(b)) throw new Error(`shelf ${shelf.name}: blob ${b.from}.${b.ext} names itself through another payload`);
    doing.add(b);
    b.out = b.bytes;
    b.rewrote = [];
    if (b.ext === 'json') {
      const text = b.bytes.toString('utf8');
      const named = [...new Set(text.match(/"[0-9a-f]{40}"/g) ?? [])].map((q) => q.slice(1, -1)).filter((h) => byFrom.has(h) && h !== b.from);
      if (named.length) {
        let next = text;
        for (const h of named) {
          next = next.split(`"${h}"`).join(`"${settle(byFrom.get(h))}"`);
        }
        b.out = Buffer.from(next, 'utf8');
        b.rewrote = named;
      }
    }
    b.to = sha(b.out);
    doing.delete(b);
    return b.to;
  };
  for (const b of blobs.values()) settle(b);

  const map = Object.fromEntries([...blobs.values()].map((b) => [b.from, b.to]));
  const report = { shelf: shelf.name, blobs: [...blobs.values()].map((b) => ({ from: b.from, to: b.to, ext: b.ext, ids: b.ids, rewrote: b.rewrote })), map, removed: [] };
  if (dry || !blobs.size) return report;

  // New blobs (and thumbs) first, then the catalogue, then the old files.
  for (const b of blobs.values()) {
    const to = join(shelf.root, 'blobs', `${b.to}.${b.ext}`);
    if (!existsSync(to)) {
      if (b.out === b.bytes) copyFileSync(b.path, to); else writeAtomic(to, b.out);
    }
    const thumb = join(shelf.root, 'thumbs', `${b.from}.png`), next = join(shelf.root, 'thumbs', `${b.to}.png`);
    if (existsSync(thumb) && !existsSync(next)) copyFileSync(thumb, next);
  }
  for (const id of shelf.ids) {
    const e = shelf.entries.get(id);
    if (e && isLegacySha(e.sha) && map[e.sha]) shelf.entries.set(id, { ...e, sha: map[e.sha] });
  }
  shelf.save();
  const still = new Set([...shelf.entries.values()].map((e) => e?.sha));
  for (const b of blobs.values()) {
    if (still.has(b.from)) continue;
    for (const p of [b.path, join(shelf.root, 'thumbs', `${b.from}.png`)]) if (existsSync(p)) { rmSync(p); report.removed.push(p); }
  }
  return report;
}
