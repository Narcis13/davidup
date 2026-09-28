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
//
// Plain ESM, zero dependencies: hdf imports it as it is, davidup through index.d.ts. Anything heavier (a
// probe, a previewer, a ranker) is injected by the host.
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readShelf } from './catalogue.js';
import { mediaOf } from './record.js';

export { KINDS, MEDIA, LICENCES, SCHEMAS, ID, SHA256, SHA1, isLegacySha, mediaOf, validate } from './record.js';
export { readShelf, sha } from './catalogue.js';

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

// `sha:<hex>` names the bytes, not the record: any unambiguous prefix of 12 or more hex.
const SHA_REF = /^sha:([0-9a-f]{12,64})$/;

// The shelves, read once and merged. `shelves` is [{ name, root }] in search order (default: standardShelves()).
export function openLibrary({ shelves = standardShelves() } = {}) {
  const read = shelves.map((s) => readShelf(s.root, { name: s.name }));
  const names = read.map((s) => s.name);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new Error(`shelf '${dup}' is named twice (shelves: ${names.join(', ')})`);

  // id -> the shelves holding it, in search order; sha -> [{ shelf, id }] for every entry with those bytes.
  const byId = new Map(), bySha = new Map();
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
  const ids = [...byId.keys()].sort();
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

  const lib = {
    shelves: read,
    ids,
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
  };
  return lib;
}
