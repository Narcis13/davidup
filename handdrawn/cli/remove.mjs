// hdf remove <id>: an asset out of the store (RE-8). The entry goes from assets/catalogue.json, its blob from
// assets/blobs when no other entry shares the bytes, and its sheets from assets/sheets.
//
//   hdf remove octo-raw                  a trial import
//   hdf remove octo-raw --root ../other  a store that is not handdrawn/assets
//
// A pack mirror (`pack:<cel>`) is written by `hdf donate --manifest` and comes back on the next one; remove
// the cel from its pack instead. Films that still name the id fail to load, so `hdf find` it first.
import { isAbsolute, relative, resolve } from 'node:path';
import { ASSET_ROOT, readCatalogue } from '../core/assets.js';
import { UsageError } from './load.mjs';

export async function run(ids, flags) {
  if (!ids.length) throw new UsageError('remove: need <id...>, e.g. hdf remove octo-raw');
  const st = readCatalogue(flags.root ? resolve(String(flags.root)) : ASSET_ROOT);
  for (const id of ids) {
    if (id.startsWith('pack:') && !flags.force) throw new UsageError(`remove: '${id}' mirrors a pack cel; hdf donate --manifest writes it back (--force to remove it anyway)`);
    st.entry(id);   // an unknown id is an error naming the ones there are, before anything is deleted
  }
  for (const id of ids) {
    const gone = st.remove(id);
    process.stdout.write(`${id}  removed${gone.length ? `; deleted ${gone.map((p) => show(p)).join(', ')}` : ''}\n`);
  }
  return 0;
}

// A path under the working directory as a relative one, anything else as it is.
const show = (p) => { const r = relative(process.cwd(), p); return r.startsWith('..') || isAbsolute(r) ? p : r; };
