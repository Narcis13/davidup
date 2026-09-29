// A generated asset is a recipe plus a blob (asset-library plan I1): `made: { tool, from, args, at, version }`
// says how it was made, and `asset remake <id>` makes it again.
//
//   const { makers } = await loadHosts();              // hdf's: hdf render, hdf sprite, hdf hand --export-ttf, hdf sheet store
//   await remake(lib, 'hdf-mini', { makers });         // { id, shelf, tool, was, sha, changed, entry, path, removed, warnings }
//
// A maker is { version, make(record, ctx) } (or the bare function), registered by a host under the `tool` it
// answers for. make resolves to { bytes | file, ext?, from?, fields?, warnings? }: the payload, the ids it was
// made from this time (else the record's), and fields only the maker knows (a sprite's `sheet`). The record is
// put again in place, on the shelf it is on: the facts its old bytes gave (dims, palette, duration, a box...)
// are dropped and read off the new bytes by the add side of its kind (add.js), the rest of the entry is kept,
// and `made` gets the new `from`, `at` and the maker's `version`. When the sha changes, the old blob and thumb
// go unless another entry on the shelf holds them.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { basename } from 'node:path';
import { addAsset } from './add.js';
import { maker } from './hosts.js';
import { SCHEMAS } from './record.js';

// The fields an entry keeps through a remake although its kind's schema lists them: what a composition asks
// the asset by (a font's family) and what kind of track a clip is, neither of which the bytes say.
export const KEPT = Object.freeze(['family', 'track']);

// The entry as a remake hands it on: the fields the old bytes decided dropped, so the new bytes say them.
export function recipeOf(entry) {
  const s = SCHEMAS[entry.kind], facts = new Set([...Object.keys(s?.fields ?? {}), ...(s?.box ? ['box'] : [])]);
  return Object.fromEntries(Object.entries(entry).filter(([k]) => !['sha', 'ext', 'bytes', 'media'].includes(k) && (!facts.has(k) || KEPT.includes(k))));
}

// Makes `ref` (an id, or sha:<hex>) again with the maker for its `made.tool`, and puts the new bytes in place on
// `shelf` (default: the shelf the ref resolves to). `makers` is { tool: maker } (loadHosts' makers); `host` is
// what addAsset takes (adds, derive, fields, probes). Resolves to { id, shelf, tool, was, sha, changed, entry,
// path, removed: [paths], warnings }; rejects, the shelf untouched, when the record was not made, no maker
// answers for its tool, the maker fails, or the new entry is not valid.
export async function remake(lib, ref, { makers = {}, shelf, host = {} } = {}) {
  const loc = lib.locate(ref), s = shelf ? lib.shelf(shelf) : lib.shelf(loc.shelf);
  const id = loc.id, e = s.entry(id);
  if (!e.made || typeof e.made !== 'object') throw new Error(`'${id}' on ${s.name} was not made by a tool (it has no made block), so there is nothing to remake`);
  const tool = e.made.tool, known = Object.keys(makers).sort();
  if (!makers[tool]) throw new Error(`no maker for '${tool}' (which made '${id}'); makers: ${known.join(', ') || 'none (is hdf next to assetlib?)'}`);
  const m = maker(makers[tool], tool);
  const record = { ...e, id, shelf: s.name };

  let out;
  try { out = (await m.make(record, { lib, shelf: s.name, root: s.root })) ?? {}; } catch (err) {
    throw new Error(`${tool} could not remake '${id}': ${err?.message ?? err}`);
  }
  if (out.file === undefined && out.bytes === undefined) throw new Error(`${tool} made nothing for '${id}' (a maker resolves to { bytes } or { file })`);
  const bytes = out.bytes !== undefined ? Buffer.from(out.bytes) : readFileSync(out.file);
  // The version is this maker's: one an older maker stamped does not outlive it.
  const { version: _old, ...recipe } = e.made, from = out.from ?? e.made.from;
  const madeNow = {
    ...recipe,
    ...(from !== undefined ? { from: [...from] } : {}),
    at: new Date().toISOString(),
    ...(m.version !== undefined ? { version: m.version } : {}),
  };
  const entry = { ...recipeOf(e), id, ...(out.fields ?? {}), ...(out.ext ? { ext: out.ext } : {}), ...(out.file ? { file: basename(out.file) } : {}), made: madeNow };
  // The door it came in by stays its door (recipeOf keeps `by`); one it never had is this one.
  const put = await addAsset(lib, { bytes, file: out.file ?? e.file, entry, shelf: s.name }, { ...host, by: e.by ?? 'asset remake' });

  // The old bytes go with the old record, unless the shelf holds them for another entry.
  const removed = [];
  if (put.entry.sha !== e.sha && ![...s.entries.values()].some((o) => o.sha === e.sha)) {
    for (const p of [s.blobPath(e), s.thumbPath(e)]) if (existsSync(p)) { rmSync(p); removed.push(p); }
  }
  return {
    id, shelf: s.name, tool, was: e.sha, sha: put.entry.sha, changed: put.entry.sha !== e.sha,
    entry: put.entry, path: put.path, removed, warnings: [...(out.warnings ?? []), ...put.warnings],
  };
}
