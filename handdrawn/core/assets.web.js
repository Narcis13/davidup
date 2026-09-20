// The browser twin of core/assets.js. `hdf bundle` and `hdf dev` serve this file's source in place of
// core/assets.js, so a film that reads its assets from the store at the top of the module runs in the player
// too -- there is no file system there, and the page was handed what the film needs instead:
//
//   window.HDF.catalogue   { id: record } for every id the film named, the pixels left out
//   window.HDF.assets      { id: src } for every raster: a data URL (bundle) or a URL under /v0/ (dev)
//
// Only `fromStore` is here: it is the one export a film takes from core/assets.js.
import { register } from './store.js';

// The records for the ids a film names, off the page's catalogue, into the registry (core/store.js).
export function fromStore(ids) {
  const cfg = globalThis.HDF ?? {}, cat = cfg.catalogue ?? {};
  return register(Object.fromEntries((Array.isArray(ids) ? ids : [ids]).map((id) => {
    const r = cat[id];
    if (!r) throw new Error(`asset '${id}' is not in window.HDF.catalogue (have ${Object.keys(cat).join(', ') || 'none'}); re-run hdf bundle`);
    const src = cfg.assets?.[id];
    return [id, src ? { ...r, src } : r];
  })));
}
