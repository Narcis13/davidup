// Film loading, shared by the CLI and render workers. Image assets (cutouts, backdrops) are decoded once
// here, so every renderer made for the film can draw its image ops synchronously.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadImage } from 'skia-canvas';
import { ASSET_ROOT, fromStore, readCatalogue, recordOf } from '../core/assets.js';
import { mapLooks, withRootLook } from '../core/tree.js';
import { register } from '../core/store.js';
import { modifyLook, parseLookName, resolveLook } from '../core/looks.js';

export class UsageError extends Error {}

const decoded = new WeakMap();
const records = new WeakMap();

// asset id -> decoded image for a film loaded through loadFilm (empty for any other film).
export const imagesOf = (film) => decoded.get(film) ?? decoded.get(film?.whole) ?? new Map();   // an excerpt reads its whole film's

// asset id -> record ({ name, w, h, sil, src, ... } as `hdf photo` writes it) for a film loaded through
// loadFilm: the store entries its `assets` named, resolved. A 2.0 film's own object, unchanged.
export const assetsOf = (film) => records.get(film) ?? records.get(film?.whole) ?? film?.assets ?? {};

// film.assets is either the 2.0 object ({ id: record }) or a list of store references: an id, or
// { id, from: '<dir>' } for a store that is not handdrawn/assets (`from` is read relative to the film).
// Either way the result is { id: record }, so everything downstream sees one shape.
export function resolveAssets(film, dir = '.') {
  const list = film?.assets;
  if (!Array.isArray(list)) return list ?? {};
  const stores = new Map();
  const out = {};
  for (const ref of list) {
    const id = typeof ref === 'string' ? ref : ref?.id;
    const from = typeof ref === 'string' ? '' : ref?.from ?? '';
    if (!id) throw new Error(`film ${film.name}: an asset is neither an id nor { id, from } (got ${JSON.stringify(ref)})`);
    const root = from ? resolve(dir, from) : ASSET_ROOT;
    if (!stores.has(root)) stores.set(root, readCatalogue(root));
    try { out[id] = recordOf(stores.get(root), id); } catch (e) { throw new Error(`film ${film.name}: ${e.message}`); }
  }
  return out;
}

const isImageSrc = (s) => typeof s === 'string' && (/^data:image\//.test(s) || /\.(png|jpe?g|webp|gif)$/i.test(s));

// Resolves the film's assets (store ids or the 2.0 object) and decodes every one with an image src
// ({ src: dataURL | a blob in the store | a path relative to the film }).
export async function loadImages(film, dir = '.') {
  const assets = resolveAssets(film, dir);
  records.set(film, assets);
  const out = new Map();
  for (const [id, a] of Object.entries(assets)) {
    // A sample (a voice) is registered, so the synth reads it from the store the film named (4.0 V1).
    if (typeof a?.src === 'string' && /\.wav$/i.test(a.src)) register({ [id]: { ...a, src: resolve(dir, a.src) } });
    if (!a || !isImageSrc(a.src)) continue;
    const src = a.src.startsWith('data:') ? a.src : resolve(dir, a.src);
    try { out.set(id, await loadImage(src)); } catch (e) { throw new Error(`asset '${id}': cannot decode image (${e.message})`); }
  }
  decoded.set(film, out);
  return out;
}

// The hands the look names ('paperInk~hand:test'), read from the store into the registry so resolveLook finds
// them; one the store lacks is left for resolveLook (or lint's hand-missing) to name.
export function readHands(names, assets = {}) {
  let st = null;
  for (const name of names) {
    for (const [kind, id] of parseLookName(name ?? '').mods) {
      if (kind !== 'hand' || id === 'house' || assets[id]?.glyphs) continue;
      st ??= readCatalogue(ASSET_ROOT);
      if (st.has(id) && st.entry(id).kind === 'hand') fromStore([id]);
    }
  }
}

// Imports a film module and checks its default export has the shape film() produces. look: a preset name
// replacing the film's root look (--look), which may carry modifiers read off the film's assets
// ('doodlePastel~from:teapot'); it is resolved here, once, so renderers downstream never need them.
// alpha: every look the film pins goes on no stock (`~alpha`), for a render with a transparent background.
export async function loadFilm(path, { look, alpha } = {}) {
  const f = await loadLooked(path, look);
  if (!alpha) return f;
  const g = mapLooks(f, (l) => modifyLook(l, [['alpha', '']], assetsOf(f)));
  decoded.set(g, decoded.get(f));
  records.set(g, assetsOf(f));
  return g;
}

async function loadLooked(path, look) {
  if (!path) throw new UsageError('missing <film.js>');
  const abs = resolve(path);
  if (!existsSync(abs)) throw new UsageError(`film not found: ${path}`);
  const mod = await import(pathToFileURL(abs).href);
  const f = mod.default;
  if (!f || typeof f !== 'object') throw new Error(`${path}: default export must be film({...})`);
  if (typeof f.name !== 'string' || !f.name) throw new Error(`${path}: film has no name`);
  if (!f.look || typeof f.look !== 'object') throw new Error(`${path}: film has no look`);
  if (f.timeline == null) throw new Error(`${path}: film has no timeline`);
  if (!decoded.has(f)) await loadImages(f, dirname(abs));
  readHands([f.look.name, typeof look === 'string' ? look : look?.name], assetsOf(f));
  if (!look) return f;
  const full = resolveLook(look, assetsOf(f));   // fails early on an unknown name or modifier
  const { mods } = parseLookName(typeof look === 'string' ? look : look?.name ?? '');
  // A plain preset replaces the root only; a modified one repaints the looks the film pins shot by shot too.
  const rooted = withRootLook(f, full);
  const g = mods.length ? mapLooks(rooted, (l) => (l === full ? l : modifyLook(l, mods, assetsOf(f)))) : rooted;
  decoded.set(g, decoded.get(f));
  records.set(g, assetsOf(f));
  return g;
}
