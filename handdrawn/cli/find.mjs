// hdf find: search the asset store before drawing anything. Every word must appear in the id, name, tags,
// description, credit or source of an entry.
//
//   hdf find fox                         every asset whose text holds 'fox'
//   hdf find horse gallop --kind clip    narrowed to one kind
//   hdf find --kind puppet               the whole kind
//   hdf find teapot --root ../other      a store that is not handdrawn/assets
//
// One line per hit: id, kind, licence, what it takes (a puppet's inputs, a clip's poses, a cutout's pixels),
// then its check sheet and credit indented under it. The package's own store also lists the pack cels that
// match (kind `cel`, from packs/manifest.json), next to their mirrors in the store (`pack:<cel>`, 3.0 S13).
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ASSET_ROOT, KINDS, readCatalogue } from '../core/assets.js';
import { PACKS, readManifest } from './donate.mjs';
import { UsageError } from './load.mjs';

export async function run(args, flags) {
  const kind = flags.kind === undefined || flags.kind === true ? '' : String(flags.kind);
  if (kind && !KINDS.includes(kind)) throw new UsageError(`find: --kind ${kind} (expected ${KINDS.join(' | ')})`);
  if (!args.length && !kind) throw new UsageError('find: need <words...> or --kind <kind>');

  const st = readCatalogue(flags.root ? resolve(String(flags.root)) : ASSET_ROOT);
  const hits = st.search(args, { kind });
  const cels = flags.root || kind ? [] : packHits(args);
  if (!hits.length && !cels.length) {
    process.stdout.write(`no ${kind || 'asset'} in ${rel(st.root)} matches ${args.join(' ') || 'anything'}`
      + ` (${st.ids.length} in the store: ${st.ids.join(', ') || 'none'})\n`);
    return 1;
  }
  const line = (id, kind, licence, what, notes) => {
    process.stdout.write(`${id.padEnd(16)} ${kind.padEnd(7)} ${licence.padEnd(9)} ${what}\n`);
    for (const n of notes.filter(Boolean)) process.stdout.write(`                 ${n}\n`);
  };
  for (const c of cels) {
    line(c.name, 'cel', 'own', `${spans(c.inputs)}, in packs/${c.pack}.js`,
      [rel(join(PACKS, c.sheet)), `import { ${c.export} } from 'packs/${c.pack}.js'${c.store ? ` or puppet('${c.store.id}')` : ''}`]);
  }
  for (const { id, entry } of hits) {
    const sheet = st.sheetPath(id), own = entry.kind === 'puppet' && id.startsWith('pack:') ? join(PACKS, 'sheets', `${entry.name.slice(5)}.jpg`) : null;
    const where = existsSync(sheet) ? rel(sheet) : own && existsSync(own) ? rel(own) : `no sheet (hdf sheet store ${id})`;
    line(id, entry.kind, entry.licence, inputs(st, entry), [where, entry.credit, entry.source]);
  }
  process.stdout.write(`${hits.length} of ${st.ids.length} in ${rel(st.root)}${cels.length ? `, ${cels.length} pack cel${cels.length > 1 ? 's' : ''}` : ''}\n`);
  return 0;
}

// Pack cels whose name, pack or description hold every word.
function packHits(words) {
  const terms = words.map((w) => String(w).toLowerCase());
  return readManifest(PACKS).cels.filter((c) => terms.every((w) => `${c.name} ${c.pack} ${c.desc}`.toLowerCase().includes(w)));
}

// A cel's inputs as 'lid 0..1 step 0.25, steam 0..1'.
const spans = (inputs = {}) => Object.entries(inputs).map(([k, [lo, hi, step]]) => `${k} ${lo}..${hi}${step && step !== hi - lo ? ` step ${step}` : ''}`).join(', ') || 'no inputs';

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
  if (d.mirror) return `mirror of ${d.mirror.export} in packs/${d.mirror.pack}.js: ${spans(d.inputs)} (${Object.keys(d.parts[d.name]?.variants ?? {}).length} states)`;
  const ins = Object.entries(d.inputs ?? {}).map(([k, v]) => `${k}:${Array.isArray(v) ? v.join('|') : v}`);
  const parts = Object.keys(d.parts ?? {});
  return `units ${e.units}, ${parts.length} parts (${parts.slice(0, 6).join(' ')})`
    + `${ins.length ? `, inputs ${ins.join(' ')}` : ''}`
    + `${Object.keys(d.poses ?? {}).length ? `, poses ${Object.keys(d.poses).join(' ')}` : ''}`
    + `${Object.keys(d.cycles ?? {}).length ? `, cycles ${Object.keys(d.cycles).join(' ')}` : ''}`;
}
