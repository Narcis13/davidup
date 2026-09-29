// The one way in (asset-library plan A6, D3): what `asset add` does with a payload, for the CLI and for a host
// that holds the bytes itself (hdf import, davidup's add_asset). Kept out of cli.js so a server can import it
// without the bin (cli.js starts with a shebang, which a dev loader transforming modules may choke on).
import { addHost } from './hosts.js';
import { imageInfo } from './image.js';
import { defaultProbes } from './probe.js';

const defined = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// A name as an id: "Warm paper" -> "warm-paper".
export const idOf = (name) => String(name).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9:]+/g, '-').replace(/^-+|-+$/g, '');

// The shelf a write lands on when `shelf` names none: the only shelf, else the project, else the user's pool.
export const targetShelf = (lib, shelf) => shelf ?? (lib.shelves.length === 1 ? lib.shelves[0].name : lib.shelves.some((s) => s.name === 'project') ? 'project' : 'user');

// ---------- what `add` derives ----------

const jsonOf = (bytes) => { try { return JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { return null; } };
const box4 = (b) => (Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) ? b : undefined);
const frame = (bytes) => { const h = imageInfo(bytes); return h ? { box: [0, 0, h.w, h.h] } : {}; };

// The per-kind fields `asset add` reads off a payload itself, where the payload says them: a raster's frame as
// its box, a JSON kind's own counts and box. What only hdf can work out (a cutout's silhouette, a puppet's box
// from its parts, a motif's bounds) comes from the host's `derive` (hdf's, from H2) or from --with.
export const DERIVE = Object.freeze({
  stock: frame,
  cutout: frame,
  hand: (bytes) => {
    const d = jsonOf(bytes), marks = Object.keys(d?.marks ?? {}).length;
    return d?.glyphs && typeof d.glyphs === 'object' ? { glyphs: Object.keys(d.glyphs).length, ...(marks ? { marks } : {}) } : {};
  },
  clip: (bytes) => {
    const d = jsonOf(bytes);
    if (!d) return {};
    const n = Number.isInteger(d.n) ? d.n : Array.isArray(d.frames) ? d.frames.length : undefined;
    return defined({ n, fps: d.fps ?? 12, h: Number.isFinite(d.h) ? d.h : undefined, track: d.track, box: box4(d.box) ?? (d.track ? [0, 0, 0, 0] : undefined) });
  },
  puppet: (bytes) => { const d = jsonOf(bytes); return defined({ units: d?.units, box: box4(d?.box) }); },
  motif: (bytes) => defined({ box: box4(jsonOf(bytes)?.box) }),
});

// What to do when a kind's payload lacks what only a tool can derive.
const HINT = {
  cutout: "a cutout's silhouette is traced by `hdf import --kind cutout` (or `hdf photo`); or give it with --with '{\"sil\": {...}}'",
  puppet: "`hdf import --kind puppet` lints a puppet and works out its box; or give --with '{\"box\": [x, y, w, h]}'",
  motif: "`hdf svg --motif` works out a motif's box; or give --with '{\"box\": [x, y, w, h]}'",
  clip: "`hdf import --kind clip` works out a clip's box; or give --with '{\"box\": [x, y, w, h]}'",
  font: 'give the family the font is asked for by with --family',
};

// The one way in, for this CLI's `add` and for a host command that already holds the bytes (hdf import, which
// compiles a stick first): the fields the kind's payload says (the host's `derive`, else DERIVE; the entry's
// own fields win), then `extra`, then probed (probe.js's probes under the host's), validated and written on
// `shelf` (default: the only shelf, else the project, else the user's pool). Resolves to { id, shelf, entry,
// path, created, replaced, warnings }; `replaced` is the entry the id had on that shelf, or null.
export async function addAsset(lib, { bytes, file, entry, extra = {}, shelf }, host = {}) {
  const { id, kind } = entry;
  // A host's add side for this kind (loadHosts' `adds`, D3), under what the caller passed itself.
  if (host.adds?.[kind]) {
    const side = await addHost(host.adds, kind);
    host = { ...host, derive: { ...side.derive, ...host.derive }, fields: host.fields ?? side.fields, probes: { ...side.probes, ...host.probes } };
  }
  const own = host.derive?.[kind], derive = own ?? DERIVE[kind];
  const derived = derive ? (await derive(bytes, { file, entry })) ?? {} : {};
  const full = { ...entry, ...Object.fromEntries(Object.entries(derived).filter(([k]) => entry[k] === undefined)), ...extra };
  const target = targetShelf(lib, shelf);
  const replaced = lib.shelf(target).entries.get(id) ?? null;
  let out;
  try {
    out = await lib.put(target, full, bytes, { probes: { ...defaultProbes(), ...host.probes }, fields: host.fields, by: host.by ?? 'asset add' });
  } catch (err) {
    throw new Error(`${err.message}${HINT[kind] && !own ? `\n(${HINT[kind]})` : ''}`);
  }
  return { ...out, replaced };
}
