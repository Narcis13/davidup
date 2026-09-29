// hdf remove <id>: an asset out of the store (RE-8). It is `asset rm` (asset-library plan H2) on the house shelf
// (or --root): the entry goes from the catalogue, its blob and thumb when no other entry shares the bytes; hdf
// adds its sheets from assets/sheets.
//
//   hdf remove octo-raw                  a trial import
//   hdf remove octo-raw --root ../other  a store that is not <repo>/assets
//
// A pack mirror (`pack:<cel>`) is written by `hdf donate --manifest` and comes back on the next one; remove
// the cel from its pack instead. Films that still name the id fail to load, so `hdf find` it first.
import { existsSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { run as asset } from '../../assetlib/cli.js';
import { ASSET_ROOT, library } from '../core/assets.js';
import { UsageError } from './load.mjs';

export async function run(ids, flags) {
  if (!ids.length) throw new UsageError('remove: need <id...>, e.g. hdf remove octo-raw');
  const lib = library({ root: flags.root ? resolve(String(flags.root)) : ASSET_ROOT }), shelf = lib.shelves[0];
  for (const id of ids) {
    if (id.startsWith('pack:') && !flags.force) throw new UsageError(`remove: '${id}' mirrors a pack cel; hdf donate --manifest writes it back (--force to remove it anyway)`);
    shelf.entry(id);   // an unknown id is an error naming the ones there are, before anything is deleted
  }
  const { data } = await asset('rm', { args: ids, flags: {} }, { library: lib });
  for (const { id, removed } of data) {
    const sheet = join(shelf.root, 'sheets', `${id.replace(':', '_')}.jpg`);
    for (const s of [sheet, sheet.replace(/\.jpg$/, '-model.jpg')]) if (existsSync(s)) { rmSync(s); removed.push(s); }
    process.stdout.write(`${id}  removed${removed.length ? `; deleted ${removed.map((p) => show(p)).join(', ')}` : ''}\n`);
  }
  return 0;
}

// A path under the working directory as a relative one, anything else as it is.
const show = (p) => { const r = relative(process.cwd(), p); return r.startsWith('..') || isAbsolute(r) ? p : r; };
