// The `use` block (asset-library plan §4.3, A5): for each app that can take a record, the exact call that
// brings it in. The agent copies it; it does not translate.
//
//   useOf(teapot)   // { davidup: { tool: 'register_asset', args: { id: 'teapot', type: 'image',
//                   //     src: 'asset:teapot@9f2c1a3b4c5d', credit: '...', licence: 'CC0' } },
//                   //   hdf: { assets: ['teapot'], code: "fromStore(['teapot'])",
//                   //     take: "photo(pin(fromStore(['teapot'])['teapot'], { x: 540, y: 540, h: 420 }))",
//                   //     look: 'doodlePastel~from:teapot' } }
//
// davidup takes a record as one of its four asset types, by an `asset:<id>@<sha12>` src (resolved by D1).
// A puppet, hand or motif has no davidup type of its own: it is offered through a record made from it (a
// sprite sheet, a font, an image; made.from names it), or not at all. hdf takes its own seven kinds through
// fromStore, plus a font as the source of `hdf hand --font`. An app that cannot take the record gets null.

import { resolve } from 'node:path';

// The davidup asset type of each kind; null for the kinds davidup takes only through something made from them.
export const DAVIDUP_TYPE = Object.freeze({
  image: 'image', cutout: 'image', stock: 'image',
  video: 'video',
  audio: 'audio', sample: 'audio',
  font: 'font',
  puppet: null, hand: null, motif: null, clip: null,
});

// What davidup takes in place of a kind it cannot take, best first: a puppet as its sprite sheet (an image
// with a `sheet`), else any image made from it (a model sheet); a hand as the font exported from it; a motif
// as an image of it.
export const DAVIDUP_VIA = Object.freeze({
  puppet: [(r) => r.kind === 'image' && !!r.sheet, (r) => r.kind === 'image'],
  hand: [(r) => r.kind === 'font'],
  motif: [(r) => r.kind === 'image'],
});

// The pin a composition carries: the first 12 hex of the record's sha.
export const PIN = 12;

// `asset:<id>@<sha12>`, the src a composition names a record by (plan §2; D1 resolves it).
export const assetSrc = (record) => `asset:${record.id}@${String(record.sha).slice(0, PIN)}`;

const js = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const sh = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, "'\\''")}'`);

// register_asset's args for a record davidup takes as it is: the record's provenance copied in (so
// W_ASSET_CREDIT and a credits card need nothing typed), a font's family, an image's sprite sheet.
function registerArgs(record) {
  const type = DAVIDUP_TYPE[record.kind];
  return {
    id: record.id, type, src: assetSrc(record),
    ...(type === 'font' && record.family ? { family: record.family } : {}),
    ...(type === 'image' && record.sheet ? { sheet: record.sheet } : {}),
    ...(record.credit ? { credit: record.credit } : {}),
    ...(record.licence ? { licence: record.licence } : {}),
  };
}

// Newest first, then by id: the order search breaks ties in.
export const newest = (a, b) => String(b.added ?? '').localeCompare(String(a.added ?? '')) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// davidup's call for a record, or null. `made` is the records made from it (made.from holds its id).
export function davidupUse(record, { made = [] } = {}) {
  if (DAVIDUP_TYPE[record.kind]) return { tool: 'register_asset', args: registerArgs(record) };
  const prefs = DAVIDUP_VIA[record.kind];
  if (!prefs) return null;
  const takes = made.filter((r) => r.id !== record.id && DAVIDUP_TYPE[r.kind]).sort(newest);
  const pick = prefs.map((ok) => takes.find(ok)).find(Boolean);
  if (!pick) return null;
  const also = takes.filter((r) => r !== pick && prefs.some((ok) => ok(r))).map((r) => r.id);
  return { tool: 'register_asset', args: registerArgs(pick), via: pick.id, ...(also.length ? { also } : {}) };
}

// hdf's call for a record, or null. `root` is the shelf the record is on; `store` is the store hdf reads when
// fromStore names none (handdrawn/assets, the house shelf), so a record anywhere else is read with `{ from }`.
// `path` is the blob, which a font is handed to `hdf hand --font` as.
//   assets  what the film's `assets:` names (an id, or { id, from } off hdf's own store)
//   code    the line at the top of the film that reads it
//   take    the expression that puts it to work, where hdf has one (a cutout placed, a puppet as an actor, a
//           clip registered, a sample voiced in the score, a stock or a motif as the record fromStore reads)
//   look    the look modifier that reads it: '~hand:<id>' letters in a hand, '~from:<id>' takes a cutout's
//           colours. hdf has no modifier for a stock or a motif yet, so they have none.
//   cli     for a font: the command that makes a hand of it
export function hdfUse(record, { root, store, path } = {}) {
  const { id, kind } = record;
  if (kind === 'font') {
    if (!path) return null;
    const flags = [`--name ${sh(id)}`, ...(record.licence ? [`--licence ${sh(record.licence)}`] : []), ...(record.credit ? [`--credit ${sh(record.credit)}`] : [])];
    return { cli: `hdf hand --font ${sh(path)} ${flags.join(' ')}` };
  }
  if (!['cutout', 'stock', 'motif', 'puppet', 'clip', 'sample', 'hand'].includes(kind)) return null;
  const off = !!root && (!store || resolve(root) !== resolve(store));
  const read = `fromStore([${js(id)}]${off ? `, { from: ${js(root)} }` : ''})`;
  const take = {
    cutout: `photo(pin(${read}[${js(id)}], { x: 540, y: 540, h: 420 }))`,
    stock: `${read}[${js(id)}]`,
    motif: `${read}[${js(id)}]`,
    puppet: `actorOf(puppet(${js(id)}))`,
    clip: `clipFromStore(${js(id)})`,
    sample: `voice(${js(id)}, 0)`,
  }[kind];
  const look = { cutout: `doodlePastel~from:${id}`, hand: `paperInk~hand:${id}` }[kind];
  return {
    assets: [off ? { id, from: root } : id],
    code: read,
    ...(take ? { take } : {}),
    ...(look ? { look } : {}),
  };
}

// The `use` block: { davidup, hdf }, each the call or null.
export function useOf(record, opts = {}) {
  return { davidup: davidupUse(record, opts), hdf: hdfUse(record, opts) };
}
