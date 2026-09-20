// The registry of asset records a film named (plan 1.1, S3). `fromStore` fills it at the top of the film;
// anything drawn from an asset reads it back by id. Browser-safe on purpose: the reading of the catalogue
// and the blobs is node's job (core/assets.js), and `hdf bundle` / `hdf dev` serve core/assets.web.js in its
// place, so the same film module runs in the player with the records the page was given.
//
//   const PHOTOS = fromStore(['teapot', 'cup']);   // films/held-once.js
//   record('teapot')                               // the same record, anywhere downstream
const RECORDS = new Map();

// Registers { id: record } and returns it unchanged, so a film can write `const P = register(...)`.
export function register(records) {
  for (const [id, r] of Object.entries(records)) RECORDS.set(id, r);
  return records;
}

// The registered record, or an error naming the ids there are.
export function record(id) {
  const r = RECORDS.get(id);
  if (!r) throw new Error(`asset '${id}' was not read from the store (name it in fromStore([...]) at the top of the film; have ${[...RECORDS.keys()].join(', ') || 'none'})`);
  return r;
}

// Every id read from a store so far, sorted.
export const stored = () => [...RECORDS.keys()].sort();
