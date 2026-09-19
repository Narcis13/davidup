// hdf sheet <film.js> <cel>: one JPEG for judging a cel before it goes in a shot. Rows are the preset
// looks; columns are the cel at 0.6, 1 and 1.8 scale for each input variant (defaults, then every declared
// input at its min and max), with the declared box as a guide. A last row holds the silhouette (the
// union of its fills in ink) and the cel at scale 1 in a full frame rendered 240 px wide.
// The cel is found among the film module's exports; failing that, the first group drawn with that cel
// name in the film is used as is (no input variants).
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fill, group, hashList, paper, rect, stroke, walk, xf } from '../core/list.js';
import { LOOKS } from '../core/looks.js';
import { hash32 } from '../core/rand.js';
import { frame, place } from '../core/tree.js';
import { outDir, paint, tileSheet } from './sheets.mjs';

const SCALES = [0.6, 1, 1.8], CELL = 200;

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
  if (!name) throw new Error('sheet: say which cel, e.g. hdf sheet films/mini.js ball');
  const film = await loadFilm(path);
  const { make, meta } = await findCel(path, film, name);
  const base = make({});
  const box = meta.box ?? base.box;
  if (!box) throw new Error(`sheet: cel '${name}' has no box`);
  const [bx, by, bw, bh] = box, C = Math.max(bw, bh) * SCALES.at(-1) * 1.15, seed = hash32('sheet', name);
  // The cel centred in a C x C cell at scale s, over its declared box drawn as a guide.
  const cell = (g, s) => [
    paper(),
    place(C / 2 - (bx + bw / 2) * s, C / 2 - (by + bh / 2) * s, s === 1 ? {} : { scale: s }, group('frame', [stroke(rect(bx, by, bw, bh), 'guide', { w: 1 / s, wobble: 0 }), g])),
  ];
  const vs = variants(make, meta.inputs), tiles = [];
  for (const look of Object.values(LOOKS)) {
    for (const [label, inputs] of vs) for (const s of SCALES) {
      tiles.push({ canvas: paint(cell(make(inputs), s), { look, W: C, H: C, width: CELL, seed }), label: `${look.name} ${s}x ${label}` });
    }
  }
  const cols = vs.length * SCALES.length;
  tiles.push({ canvas: paint([paper(), place(C / 2 - bx - bw / 2, C / 2 - by - bh / 2, group('sil', silhouette(base)))], { look: film.look, W: C, H: C, width: CELL, seed }), label: 'silhouette' });
  const fw = film.format.W, fh = film.format.H;
  tiles.push({ canvas: paint([paper(), place(fw / 2 - bx - bw / 2, fh / 2 - by - bh / 2, base)], { look: film.look, W: fw, H: fh, width: 240, seed }), label: '240 px' });
  const file = join(outDir(flags), `${film.name}-sheet-${name}.jpg`);
  await tileSheet(tiles, { cols, label: 18 }).toFile(file, { quality: 0.9 });
  process.stdout.write(`${file}  ${Object.keys(LOOKS).length} looks x ${vs.length} variant${vs.length > 1 ? 's' : ''} x ${SCALES.length} scales\n`);
  return 0;
}
