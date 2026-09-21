// hdf sheet <film.js> <cel>: one JPEG for judging a cel before it goes in a shot. Rows are the preset
// looks; columns are the cel at 0.6, 1 and 1.8 scale for each input variant (defaults, then every declared
// input at its min and max), with the declared box as a guide. A last row holds the silhouette (the
// union of its fills in ink) and the cel at scale 1 in a full frame rendered 240 px wide.
// The cel is found among the film module's exports; failing that, the first group drawn with that cel
// name in the film is used as is (no input variants).
//
// hdf sheet store <id> [--pose wave] [--cycle walk]: the same sheet for a puppet in the asset store
// (`store` in place of a film says look in the catalogue). Its columns are the puppet's poses and then
// every variant of every part; `--cycle` adds the cycle's frames as a strip along the bottom. It writes
// assets/sheets/<id>.jpg, which is what `hdf find` points at.
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ASSET_ROOT, readCatalogue } from '../core/assets.js';
import { FPS } from '../core/curves.js';
import { format } from '../core/fit.js';
import { fill, group, hashList, paper, rect, stroke, walk, xf } from '../core/list.js';
import { LOOKS, resolveLook } from '../core/looks.js';
import { puppet } from '../core/puppet.js';
import { hash32 } from '../core/rand.js';
import { frame, place } from '../core/tree.js';
import { outDir, paint, tileSheet } from './sheets.mjs';
import { imagesOf, UsageError } from './load.mjs';
import { skiaCanvas } from './skia.mjs';

const SCALES = [0.6, 1, 1.8];

async function findCel(path, film, name) {
  const mod = await import(pathToFileURL(resolve(path)).href);
  const make = Object.values(mod).find((v) => typeof v === 'function' && v.cel?.name === name);
  if (make) return { make, meta: make.cel };
  for (let i = 0; i < film.n; i++) {
    let hit = null;
    walk(frame(film, i).list, (op) => { if (!hit && op.op === 'group' && op.cel === name) hit = op; });
    if (hit) return { make: () => hit, meta: { name, box: hit.box, inputs: {} } };
  }
  const known = Object.values(mod).filter((v) => typeof v === 'function' && v.cel).map((v) => v.cel.name);
  throw new Error(`sheet: no cel '${name}' in ${path}${known.length ? ` (exported: ${known.join(', ')})` : '; export it from the film module'}`);
}

// [label, inputs]: defaults, then each input at its min and at its max; variants that draw the same are dropped.
function variants(make, inputs) {
  const out = [['defaults', {}]];
  for (const [k, spec] of Object.entries(inputs ?? {})) {
    if (!Array.isArray(spec)) continue;
    out.push([`${k}=${spec[0]}`, { [k]: spec[0] }], [`${k}=${spec[1]}`, { [k]: spec[1] }]);
  }
  const seen = new Set();
  return out.filter(([, v]) => { const h = hashList(make(v).kids); if (seen.has(h)) return false; seen.add(h); return true; });
}

// Union of the cel's fills, through nested group transforms, as one ink fill.
function silhouette(g) {
  const sub = [];
  walk(g.kids, (op, m) => { if (op.op === 'fill') sub.push(...xf(op.path, m).sub); });
  return sub.length ? [fill({ sub, box: g.box ?? [0, 0, 0, 0] }, 'ink')] : [];
}

export async function run([path, name], flags, { loadFilm }) {
  if (path === 'store') return storeSheet(name, flags);
  if (!name) throw new Error('sheet: say which cel, e.g. hdf sheet films/mini.js ball');
  const film = await loadFilm(path);
  const { make, meta } = await findCel(path, film, name);
  const file = join(outDir(flags), `${film.name}-sheet-${name}.jpg`);
  const { looks, variants: nv } = await celSheet(make, meta, { look: film.look, format: film.format, images: imagesOf(film), file });
  process.stdout.write(`${file}  ${looks} looks x ${nv} variant${nv > 1 ? 's' : ''} x ${SCALES.length} scales\n`);
  return 0;
}

// A puppet in the store: its poses and variants as the columns, the cycle `--cycle` names as a strip.
export async function storeSheet(id, flags) {
  if (!id) throw new UsageError('sheet: say which asset, e.g. hdf sheet store fox');
  const st = readCatalogue(flags.root ? resolve(String(flags.root)) : ASSET_ROOT);
  const e = st.entry(id);
  if (e.kind !== 'puppet') throw new UsageError(`sheet: '${id}' is a ${e.kind}; hdf sheet store draws a puppet (hdf sheet <film.js> <cel> for a cel)`);
  const d = st.json(e), make = puppet({ ...d, name: id });

  const poses = flags.pose ? [String(flags.pose)] : make.poses;
  const cases = poses.map((p) => [`pose ${p}`, make.poseOf(p, 1)]);
  if (!cases.length) cases.push(['rest', make.rest]);
  for (const [pn, part] of Object.entries(d.parts)) for (const k of Object.keys(part.variants ?? {})) cases.push([`${pn}=${k}`, { ...make.rest, [pn]: k }]);

  const cyc = flags.cycle === true ? make.cycles[0] : flags.cycle ? String(flags.cycle) : null;
  const c = cyc ? d.cycles?.[cyc] : null;
  if (cyc && !c) throw new UsageError(`sheet: '${id}' has no cycle '${cyc}' (has ${make.cycles.join(', ') || 'none'})`);
  const strip = c ? c.frames.map((_, j) => [`${cyc} ${j}`, make.frameOf(cyc, j / (c.fps ?? FPS))]) : [];

  const file = st.sheetPath(id);
  mkdirSync(dirname(file), { recursive: true });
  const { looks } = await celSheet(make, make.cel, {
    look: flags.look ? resolveLook(String(flags.look)) : LOOKS.doodlePastel, format: format('1:1'), file, cell: 160, cases, strip,
  });
  process.stdout.write(`${file}  ${looks} looks x ${cases.length} state${cases.length > 1 ? 's' : ''} x ${SCALES.length} scales`
    + `${strip.length ? ` + ${strip.length} frames of ${cyc}` : ''}\n`);
  return 0;
}

// The sheet of one cel (make: the cel function, meta: make.cel) written to `file` as a JPEG. look and
// format are the film's (the silhouette and the 240 px cell use them); cell is the tile size in pixels.
// cases replaces the input extremes with states of your own ([label, inputs]), and strip adds a row of
// them at scale 1 in `look` -- the two together are what a puppet's poses, variants and cycle come in as.
export async function celSheet(make, meta, { look: filmLook, format: fmt, images = new Map(), file, cell: CELL = 200, quality = 0.9, cases, strip = [] }) {
  const { name } = meta;
  const base = make({});
  const box = meta.box ?? base.box;
  if (!box) throw new Error(`sheet: cel '${name}' has no box`);
  const [bx, by, bw, bh] = box, C = Math.max(bw, bh) * SCALES.at(-1) * 1.15, seed = hash32('sheet', name);
  // The cel centred in a C x C cell at scale s, over its declared box drawn as a guide.
  const cell = (g, s) => [
    paper(),
    place(C / 2 - (bx + bw / 2) * s, C / 2 - (by + bh / 2) * s, s === 1 ? {} : { scale: s }, group('frame', [stroke(rect(bx, by, bw, bh), 'guide', { w: 1 / s, wobble: 0 }), g])),
  ];
  const vs = cases ?? variants(make, meta.inputs), tiles = [];
  for (const look of Object.values(LOOKS)) {
    for (const [label, inputs] of vs) for (const s of SCALES) {
      tiles.push({ canvas: paint(cell(make(inputs), s), { look, W: C, H: C, width: CELL, seed, images }), label: `${look.name} ${s}x ${label}` });
    }
  }
  const cols = vs.length * SCALES.length;
  tiles.push({ canvas: paint([paper(), place(C / 2 - bx - bw / 2, C / 2 - by - bh / 2, group('sil', silhouette(base)))], { look: filmLook, W: C, H: C, width: CELL, seed, images }), label: 'silhouette' });
  const fw = fmt.W, fh = fmt.H;
  tiles.push({ canvas: paint([paper(), place(fw / 2 - bx - bw / 2, fh / 2 - by - bh / 2, base)], { look: filmLook, W: fw, H: fh, width: 240, seed, images }), label: '240 px' });
  if (strip.length) {
    while (tiles.length % cols) tiles.push({ canvas: skiaCanvas(1, 1) });   // the strip starts on a row of its own
    for (const [label, inputs] of strip) tiles.push({ canvas: paint(cell(make(inputs), SCALES.at(-1)), { look: filmLook, W: C, H: C, width: CELL, seed, images }), label });
  }
  await tileSheet(tiles, { cols, label: 18 }).toFile(file, { quality });
  return { looks: Object.keys(LOOKS).length, variants: vs.length };
}
