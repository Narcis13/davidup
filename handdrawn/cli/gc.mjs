// hdf gc: delete the blobs no catalogue entry points at (RE-8) -- a replaced payload's old bytes, a blob left
// behind by a hand-edited catalogue. `--dry` lists them and deletes nothing.
//
//   hdf gc [--dry] [--root ../other]
import { rmSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { ASSET_ROOT, readCatalogue } from '../core/assets.js';

export async function run(args, flags) {
  const st = readCatalogue(flags.root ? resolve(String(flags.root)) : ASSET_ROOT);
  const orphans = st.orphans();
  let bytes = 0;
  for (const p of orphans) {
    bytes += statSync(p).size;
    if (!flags.dry) rmSync(p);
    process.stdout.write(`${flags.dry ? 'would delete' : 'deleted'}  ${show(p)}\n`);
  }
  process.stdout.write(`${orphans.length} orphan blob${orphans.length === 1 ? '' : 's'}, ${(bytes / 1024).toFixed(0)} KB${flags.dry ? ' (dry run)' : ''}\n`);
  return 0;
}

// A path under the working directory as a relative one, anything else as it is.
const show = (p) => { const r = relative(process.cwd(), p); return r.startsWith('..') || isAbsolute(r) ? p : r; };
