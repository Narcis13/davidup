// hdf find: search the asset store before drawing anything. Every word must appear in the id, name, tags,
// description, credit or source of an entry.
//
//   hdf find fox                         every asset whose text holds 'fox'
//   hdf find horse gallop --kind clip    narrowed to one kind
//   hdf find --kind puppet               the whole kind
//   hdf find teapot --root ../other      a store that is not handdrawn/assets
//
// One line per hit: id, kind, licence, what it takes (a puppet's inputs, a clip's poses, a cutout's pixels),
// then its check sheet and credit indented under it.
import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { ASSET_ROOT, KINDS, readCatalogue } from '../core/assets.js';
import { UsageError } from './load.mjs';

export async function run(args, flags) {
  const kind = flags.kind === undefined || flags.kind === true ? '' : String(flags.kind);
  if (kind && !KINDS.includes(kind)) throw new UsageError(`find: --kind ${kind} (expected ${KINDS.join(' | ')})`);
  if (!args.length && !kind) throw new UsageError('find: need <words...> or --kind <kind>');

  const st = readCatalogue(flags.root ? resolve(String(flags.root)) : ASSET_ROOT);
  const hits = st.search(args, { kind });
  if (!hits.length) {
    process.stdout.write(`no ${kind || 'asset'} in ${rel(st.root)} matches ${args.join(' ') || 'anything'}`
      + ` (${st.ids.length} in the store: ${st.ids.join(', ') || 'none'})\n`);
    return 1;
  }
  for (const { id, entry } of hits) {
    process.stdout.write(`${id.padEnd(16)} ${entry.kind.padEnd(7)} ${entry.licence.padEnd(9)} ${inputs(st, entry)}\n`);
    const sheet = st.sheetPath(id);
    const notes = [existsSync(sheet) ? rel(sheet) : `no sheet (hdf sheet store ${id})`, entry.credit, entry.source].filter(Boolean);
    for (const n of notes) process.stdout.write(`                 ${n}\n`);
  }
  process.stdout.write(`${hits.length} of ${st.ids.length} in ${rel(st.root)}\n`);
  return 0;
}

const rel = (p) => { const r = relative(process.cwd(), p); return r && !r.startsWith('..') ? r : p; };

// What a hit takes or holds, without decoding its blob where the entry already says.
function inputs(st, e) {
  switch (e.kind) {
    case 'cutout': return `${e.w}x${e.h} px, ${e.sil?.sub?.length ?? 0} subs, ${(e.colours ?? []).slice(0, 4).map((c) => c.hex).join(' ')}`;
    case 'stock': return `${e.w}x${e.h} px`;
    case 'clip': return `${e.n} poses @ ${e.fps} fps, h ${Math.round(e.h)}`;
    case 'puppet': return puppet(st, e);
    case 'hand': return `${e.glyphs} glyphs`;
    case 'sample': return e.sec ? `${e.sec} s` : 'wav';
    default: return `box ${(e.box ?? []).map(Math.round).join(' ')}`;
  }
}

function puppet(st, e) {
  let d = null;
  try { d = st.json(e); } catch { return `units ${e.units} (blob missing)`; }
  const ins = Object.entries(d.inputs ?? {}).map(([k, v]) => `${k}:${Array.isArray(v) ? v.join('|') : v}`);
  const parts = Object.keys(d.parts ?? {});
  return `units ${e.units}, ${parts.length} parts (${parts.slice(0, 6).join(' ')})`
    + `${ins.length ? `, inputs ${ins.join(' ')}` : ''}`
    + `${Object.keys(d.poses ?? {}).length ? `, poses ${Object.keys(d.poses).join(' ')}` : ''}`
    + `${Object.keys(d.cycles ?? {}).length ? `, cycles ${Object.keys(d.cycles).join(' ')}` : ''}`;
}
