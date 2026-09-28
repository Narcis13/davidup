// hdf find: search the asset library before drawing anything. It is `asset find` (assetlib, asset-library plan
// H2): ranked, each word a prefix of a word in an asset's id, name, tags, description, credit or source (or of a
// synonym's: dog finds an animal), with every `asset find` filter; hdf prints its own line for each hit.
//
//   hdf find fox                         every asset about a fox, best first, and why each matched
//   hdf find horse gallop --kind clip    narrowed to one kind (--kind clip,puppet for several)
//   hdf find --kind puppet               the whole kind
//   hdf find --look paperInk             what a look can use: a stock to draw on, a hand to letter in
//   hdf find teapot --root ../other      a store that is not the library's (that directory alone)
//   hdf find fox --json                  what `asset find fox --json` prints, the same bytes
//
// The library is the user's pool (~/.davidup/assets) and the house (handdrawn/assets), as `asset` opens it. One
// line per hit: id, kind, licence, what it takes (a puppet's inputs, a clip's poses, a cutout's pixels), then
// indented under it why it matched, its check sheet, its credit and source, and how a film reads it when that
// is not plain fromStore(['id']). A pack cel is found as its mirror in the store (`pack:<cel>`, 3.0 S13).
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { factsOf } from '../../assetlib/index.js';
import { parseArgs, run as asset, UsageError as AssetUsage } from '../../assetlib/cli.js';
import { KINDS, library } from '../core/assets.js';
import { LOOKS, parseLookName } from '../core/looks.js';
import { PACKS } from './donate.mjs';
import { UsageError } from './load.mjs';

// What a look can use from the store: every look is drawn on a stock and lettered in a hand ('~hand:<id>');
// the look of doodles on photos also takes its palette from a cutout ('doodlePastel~from:<id>').
export function lookKinds(name) {
  const { base } = parseLookName(name);
  if (!LOOKS[base]) throw new UsageError(`find: --look ${name} (expected ${Object.keys(LOOKS).join(' | ')})`);
  return base === 'doodlePastel' ? ['cutout', 'hand', 'stock'] : ['hand', 'stock'];
}

// `asset find` over hdf's library, as hdf's command line asks it: --root opens that store alone, --look narrows
// --kind. Resolves to { code, data, lib, kinds, words } (data is what `asset find --json` prints).
export async function findAssets(argv) {
  const { args, flags } = parseArgs(argv);   // assetlib's reading: --alpha and --json take no value
  const lib = library({ root: flags.root === undefined || flags.root === true ? undefined : String(flags.root) });
  const f = { ...flags };
  delete f.root; delete f.look;
  let kinds = f.kind === undefined || f.kind === true ? null : String(f.kind).split(',').map((k) => k.trim()).filter(Boolean);
  if (flags.look !== undefined) {
    if (flags.look === true) throw new UsageError('find: --look needs a look name (paperInk, doodlePastel, ...)');
    const can = lookKinds(String(flags.look));
    const both = kinds ? kinds.filter((k) => can.includes(k)) : can;
    if (!both.length) throw new UsageError(`find: look ${flags.look} uses ${can.join(', ')}, not ${kinds.join(', ')}`);
    kinds = both;
  }
  if (kinds) f.kind = kinds.join(',');
  try {
    const res = await asset('find', { args, flags: f }, { library: lib });
    return { ...res, lib, kinds, words: args, json: !!flags.json };
  } catch (e) {
    if (e instanceof AssetUsage) throw new UsageError(e.message);
    throw e;
  }
}

// `argv` is the command line after `find` (hdf's main passes it), read here as `asset` reads it.
export async function run(args, flags, { argv = args } = {}) {
  const res = await findAssets(argv);
  const { data, lib } = res, out = (s) => process.stdout.write(s);
  if (res.json) { out(`${JSON.stringify(data, null, 2)}\n`); return res.code; }

  const where = lib.shelves.map((s) => `${rel(s.root)}${lib.shelves.length > 1 ? ` (${s.name})` : ''}`).join(', ');
  if (!data.hits.length) {
    const has = Object.entries(data.facets?.kind ?? {}).map(([k, n]) => `${n} ${k}`).join(', ');
    out(`no ${res.kinds?.join(' or ') || 'asset'} in ${where} matches ${res.words.join(' ') || 'the filters'}`
      + ` (${data.total} in the library${has ? `: ${has}` : ''})\n`);
    return 1;
  }
  for (const h of data.hits) {
    const r = h.record, what = inputs(r, h.path);
    out(`${h.id.padEnd(16)} ${r.kind.padEnd(7)} ${String(r.licence).padEnd(9)} ${what}\n`);
    for (const n of notes(h, lib)) out(`                 ${n}\n`);
  }
  const shown = data.count > data.hits.length ? `, the first ${data.hits.length} shown (--limit)` : '';
  out(`${data.count} of ${data.total} in ${where}${shown}\n`);
  return 0;
}

// What is printed under a hit: why it matched, its sheet, its provenance, and how a film reads it where that is
// more than fromStore(['id']) (another shelf, a pack cel, a font).
function notes(h, lib) {
  const r = h.record, use = h.use?.hdf, sheet = sheetOf(h, lib);
  const read = !use ? `hdf does not read a ${r.kind}` : use.cli ? use.cli
    : typeof use.assets?.[0] === 'object' ? use.code : null;
  return [h.why.length ? `why: ${h.why.join(', ')}` : null, sheet, r.credit, r.source, mirrorOf(r, h.path) ?? read].filter(Boolean);
}

// The check sheet (`hdf sheet store <id>`), else the pack's own sheet for a mirror, else the thumb.
function sheetOf(h, lib) {
  const root = lib.shelf(h.shelf).root, sheet = join(root, 'sheets', `${h.id.replace(':', '_')}.jpg`);
  const own = h.id.startsWith('pack:') ? join(PACKS, 'sheets', `${h.id.slice(5)}.jpg`) : null;
  if (existsSync(sheet)) return rel(sheet);
  if (own && existsSync(own)) return rel(own);
  if (h.thumb) return rel(h.thumb);
  return KINDS.includes(h.record.kind) ? `no sheet (hdf sheet store ${h.id})` : null;
}

// A pack cel's mirror: where the cel lives, as the manifest says it.
function mirrorOf(r, path) {
  if (r.kind !== 'puppet' || !r.id.startsWith('pack:')) return null;
  const d = payload(path);
  return d?.mirror ? `import { ${d.mirror.export} } from 'packs/${d.mirror.pack}.js' or puppet('${r.id}')` : null;
}

function payload(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// A cel's inputs as 'lid 0..1 step 0.25, steam 0..1'.
const spans = (inputs = {}) => Object.entries(inputs).map(([k, [lo, hi, step]]) => `${k} ${lo}..${hi}${step && step !== hi - lo ? ` step ${step}` : ''}`).join(', ') || 'no inputs';

// A path under the working directory as a relative one, under the home directory from ~, anything else as it is.
const rel = (p) => {
  const r = relative(process.cwd(), p), h = relative(homedir(), p);
  return r && !r.startsWith('..') && !isAbsolute(r) ? r : h && !h.startsWith('..') && !isAbsolute(h) ? join('~', h) : p;
};

// What a hit takes or holds, without decoding its blob where the entry already says.
function inputs(e, path) {
  switch (e.kind) {
    case 'cutout': return `${e.w}x${e.h} px, ${e.sil?.sub?.length ?? 0} subs, ${(e.colours ?? []).slice(0, 4).map((c) => c.hex).join(' ')}`;
    case 'stock': return `${e.w}x${e.h} px`;
    case 'clip': return e.track ? `a ${e.track} track, ${e.n} frames @ ${e.fps} fps` : `${e.n} poses @ ${e.fps} fps, h ${Math.round(e.h)}`;
    case 'puppet': return puppet(e, path);
    case 'hand': return `${e.glyphs} glyphs${e.marks ? `, ${e.marks} marks` : ''}`;
    case 'sample': return e.sec ? `${e.sec} s` : 'wav';
    case 'motif': return `box ${(e.box ?? []).map(Math.round).join(' ')}`;
    default: return factsOf(e);
  }
}

function puppet(e, path) {
  const d = payload(path);
  if (!d) return `units ${e.units} (blob missing)`;
  if (d.mirror) return `mirror of ${d.mirror.export} in packs/${d.mirror.pack}.js: ${spans(d.inputs)} (${Object.keys(d.parts[d.name]?.variants ?? {}).length} states)`;
  const ins = Object.entries(d.inputs ?? {}).map(([k, v]) => `${k}:${Array.isArray(v) ? v.join('|') : v}`);
  const parts = Object.keys(d.parts ?? {});
  return `units ${e.units}, ${parts.length} parts (${parts.slice(0, 6).join(' ')})`
    + `${ins.length ? `, inputs ${ins.join(' ')}` : ''}`
    + `${Object.keys(d.poses ?? {}).length ? `, poses ${Object.keys(d.poses).join(' ')}` : ''}`
    + `${Object.keys(d.cycles ?? {}).length ? `, cycles ${Object.keys(d.cycles).join(' ')}` : ''}`;
}
