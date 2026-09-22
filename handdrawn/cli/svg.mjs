// hdf svg: an SVG drawing into the asset store as a puppet (or a motif), then its check sheet (plan 1.5).
//
//   hdf svg assets/src/fox.svg --name fox --licence own --roles assets/src/fox.roles.json
//   hdf svg fox.svg --name fox --roles ask          the colour table to fox.roles.json next to the SVG; stops
//   hdf svg star.svg --name star --kind motif        one op list, no rig
//   [--flatten 0.6] [--units 300] [--credit] [--source] [--tags] [--desc] [--root ../other-store] [--no-sheet]
//
// The rules the file has to follow (ids, pivots, variants, poses, cycles, colours) are in core/svg.js. The
// colour table is printed on every import, so what each source colour became is never a guess; `--roles ask`
// writes it as JSON for the author to edit and pass back with `--roles <file>`. The payload then goes through
// exactly what `hdf import` does (validation, puppet lint, the store) and gets `hdf sheet store <id>` (a puppet
// or a motif). A puppet's box is widened to hold every pose, view and cycle frame first (widen, below), so a
// wave that swings past the viewBox is not a `cel-box` refusal and a second import.
// A cycle `hdf retarget` wrote into the stored puppet (it carries `from`) is not in the SVG, so a re-import
// keeps it, unless the SVG now draws a cycle of that name.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { ASSET_ROOT, readCatalogue } from '../core/assets.js';
import { puppetReach } from '../core/lint.js';
import { SvgError, svgColours, svgMotif, svgPuppet } from '../core/svg.js';
import { putPayload } from './import.mjs';
import { UsageError } from './load.mjs';
import { storeSheet } from './sheet.mjs';

const KINDS = ['puppet', 'motif'];
const str = (v) => (v === undefined || v === true ? '' : String(v));

export async function run([file], flags) {
  const kind = str(flags.kind) || 'puppet', name = str(flags.name);
  if (!file) throw new UsageError('svg: need <file.svg>');
  if (!KINDS.includes(kind)) throw new UsageError(`svg: --kind ${kind} (expected ${KINDS.join(' | ')})`);
  if (!name) throw new UsageError('svg: need --name <id>');
  const abs = resolve(file);
  if (!existsSync(abs)) throw new UsageError(`svg: no such file '${file}'`);
  const src = readFileSync(abs, 'utf8');
  const opts = { name, flatten: flags.flatten === undefined ? 0.6 : +flags.flatten, ...(flags.units ? { units: +flags.units } : {}) };

  try {
    if (flags.roles === 'ask') {
      const table = svgColours(src, opts), out = join(dirname(file), `${name}.roles.json`);
      writeFileSync(resolve(out), `${JSON.stringify(Object.fromEntries(table.map((r) => [r.hex, r.role])), null, 2)}\n`);
      process.stdout.write(`${tableText(table)}${out}  edit the roles, then: hdf svg ${file} --name ${name} --roles ${out}\n`);
      return 0;
    }
    opts.roles = flags.roles ? readRoles(String(flags.roles)) : {};
    const { payload, table } = (kind === 'puppet' ? svgPuppet : svgMotif)(src, opts);
    process.stdout.write(tableText(table));
    if (kind === 'puppet') { keepRetargeted(payload, name, flags); widen(payload, name); }
    await putPayload({ kind, name, bytes: Buffer.from(JSON.stringify(payload)), abs, flags });
    if (flags.sheet !== false) {
      await storeSheet(name, { root: flags.root, ...(kind === 'puppet' ? { cycle: Object.keys(payload.cycles ?? {})[0] } : {}) });
    }
    return 0;
  } catch (e) {
    if (e instanceof SvgError) throw new UsageError(`svg: ${basename(abs)}: ${e.message}`);
    throw e;
  }
}

function readRoles(path) {
  if (!existsSync(path)) throw new UsageError(`svg: --roles ${path}: no such file (--roles ask writes one)`);
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) { throw new UsageError(`svg: --roles ${path} is not JSON (${e.message})`); }
}

// A pose, view or cycle frame that swings a part past the viewBox would fail `cel-box` on import, so the box
// is every drawing the puppet makes (the rest pose, views, poses, variants, cycle frames) together, padded
// by 3% and rounded out to whole units. The viewBox stays in the payload as `frame`, the drawing's own frame.
export function widen(payload, name) {
  const reach = puppetReach(payload, name);
  if (!reach?.by.length) return payload;
  const [x, y, w, h] = payload.box, [rx, ry, rw, rh] = reach.box, pad = 0.03 * Math.max(w, h);
  const x0 = Math.floor(Math.min(x, rx - pad)), y0 = Math.floor(Math.min(y, ry - pad));
  const x1 = Math.ceil(Math.max(x + w, rx + rw + pad)), y1 = Math.ceil(Math.max(y + h, ry + rh + pad));
  payload.frame = payload.box;
  payload.box = [x0, y0, x1 - x0, y1 - y0];
  const more = reach.by.length > 3 ? ` and ${reach.by.length - 3} more` : '';
  process.stdout.write(`box ${payload.box.join(' ')} (the viewBox ${payload.frame.join(' ')} widened for ${reach.by.slice(0, 3).join(', ')}${more})\n`);
  return payload;
}

// colour  area  role  (auto | map), one line each.
const tableText = (table) => table.map((r) => `${r.hex}  ${String(r.area).padStart(7)}  ${r.role.padEnd(10)} ${r.how}\n`).join('');

// The retargeted cycles of the puppet already in the store under this name, and the poses and cycles the
// workbench (4.0 W2, `hdf dev`'s Rig tab) recorded on it, carried over to the new payload.
export function keepRetargeted(payload, name, flags) {
  const st = readCatalogue(flags.root ? resolve(String(flags.root)) : ASSET_ROOT);
  if (!st.has(name) || st.entry(name).kind !== 'puppet') return;
  const old = st.json(name), bench = old.workbench ?? {};
  const kept = Object.entries(old.cycles ?? {}).filter(([k, c]) => (c?.from || bench.cycles?.includes(k)) && !payload.cycles?.[k]);
  const poses = Object.entries(old.poses ?? {}).filter(([k]) => bench.poses?.includes(k) && !payload.poses?.[k]);
  if (kept.length) payload.cycles = { ...(payload.cycles ?? {}), ...Object.fromEntries(kept) };
  if (poses.length) payload.poses = { ...(payload.poses ?? {}), ...Object.fromEntries(poses) };
  const noted = { poses: poses.map(([k]) => k), cycles: kept.filter(([k]) => bench.cycles?.includes(k)).map(([k]) => k) };
  if (noted.poses.length || noted.cycles.length) payload.workbench = noted;
  if (!kept.length && !poses.length) return;
  process.stdout.write(`keeps ${[...kept.map(([k, c]) => (c.from ? `cycle ${k} (retargeted from ${c.from.clip})` : `cycle ${k} (recorded)`)), ...poses.map(([k]) => `pose ${k} (recorded)`)].join(', ')}\n`);
}
