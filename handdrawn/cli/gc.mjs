// hdf gc: delete the blobs no catalogue entry points at (RE-8) -- a replaced payload's old bytes, a blob left
// behind by a hand-edited catalogue -- and the thumbs of bytes no entry has. It is `asset gc` (asset-library
// plan H2) on the house shelf (or --root). `--dry` lists them and deletes nothing.
//
//   hdf gc [--dry] [--root ../other]
import { isAbsolute, relative, resolve } from 'node:path';
import { run as asset } from '../../assetlib/cli.js';
import { ASSET_ROOT, library } from '../core/assets.js';

export async function run(args, flags) {
  const lib = library({ root: flags.root ? resolve(String(flags.root)) : ASSET_ROOT }), dry = !!flags.dry;
  const { data } = await asset('gc', { args: [], flags: { dry } }, { library: lib });
  let bytes = 0;
  for (const g of data) {
    bytes += g.bytes;
    process.stdout.write(`${dry ? 'would delete' : 'deleted'}  ${show(g.path)}\n`);
  }
  const thumbs = data.filter((g) => g.path.endsWith('.png') && /[\\/]thumbs[\\/]/.test(g.path)).length, blobs = data.length - thumbs;
  const n = (k, one) => `${k} ${one}${k === 1 ? '' : 's'}`;
  process.stdout.write(`${n(blobs, 'orphan blob')}${thumbs ? ` and ${n(thumbs, 'stale thumb')}` : ''}, ${(bytes / 1024).toFixed(0)} KB${dry ? ' (dry run)' : ''}\n`);
  return 0;
}

// A path under the working directory as a relative one, anything else as it is.
const show = (p) => { const r = relative(process.cwd(), p); return r.startsWith('..') || isAbsolute(r) ? p : r; };
