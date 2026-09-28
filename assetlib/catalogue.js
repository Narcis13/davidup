// One shelf (asset-library plan §2, §3.3): a directory, nothing else.
//
//   <shelf>/catalogue.json        id -> entry, one entry per line, ids sorted (hdf's format, unchanged)
//   <shelf>/blobs/<sha>.<ext>     the payloads, named by the sha of their bytes
//   <shelf>/thumbs/<sha>.png      previews, regenerable
//   <shelf>/src/                  sources worth keeping
//
// A missing directory or catalogue reads as an empty shelf, so a fresh project has one before anything is
// added. Reading never validates: a shelf with a bad entry still opens, and `asset check` says what is wrong.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

// 64 hex over some bytes (a string is hashed as utf8): a blob's name and its entry's `sha`.
export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

const BLOB = /^([0-9a-f]{64}|[0-9a-f]{40})\.\w+$/;

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
  const ids = [...entries.keys()].sort();
  const of = (e) => (typeof e === 'string' ? shelf.entry(e) : e);
  const shelf = {
    root: dir, name: shelfName, file, entries, ids,
    has: (id) => entries.has(id),
    entry(id) {
      const e = entries.get(id);
      if (!e) throw new Error(`no asset '${id}' on shelf ${shelfName} (${dir}; has ${ids.join(', ') || 'none'})`);
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
  };
  return shelf;
}
