// Film loading, shared by the CLI and render workers. Image assets (cutouts, backdrops) are decoded once
// here, so every renderer made for the film can draw its image ops synchronously.
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadImage } from 'skia-canvas';
import { mapLooks, withRootLook } from '../core/tree.js';
import { modifyLook, parseLookName, resolveLook } from '../core/looks.js';

export class UsageError extends Error {}

const decoded = new WeakMap();

// asset id -> decoded image for a film loaded through loadFilm (empty for any other film).
export const imagesOf = (film) => decoded.get(film) ?? new Map();

const isImageSrc = (s) => typeof s === 'string' && (/^data:image\//.test(s) || /\.(png|jpe?g|webp|gif)$/i.test(s));

// Decodes every asset with an image src ({ src: dataURL | path relative to the film }).
export async function loadImages(film, dir = '.') {
  const out = new Map();
  for (const [id, a] of Object.entries(film.assets ?? {})) {
    if (!a || !isImageSrc(a.src)) continue;
    const src = a.src.startsWith('data:') ? a.src : resolve(dir, a.src);
    try { out.set(id, await loadImage(src)); } catch (e) { throw new Error(`asset '${id}': cannot decode image (${e.message})`); }
  }
  decoded.set(film, out);
  return out;
}

// Imports a film module and checks its default export has the shape film() produces. look: a preset name
// replacing the film's root look (--look), which may carry modifiers read off the film's assets
// ('doodlePastel~from:teapot'); it is resolved here, once, so renderers downstream never need them.
export async function loadFilm(path, { look } = {}) {
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
  if (!look) return f;
  const full = resolveLook(look, f.assets);   // fails early on an unknown name or modifier
  const { mods } = parseLookName(typeof look === 'string' ? look : look?.name ?? '');
  // A plain preset replaces the root only; a modified one repaints the looks the film pins shot by shot too.
  const rooted = withRootLook(f, full);
  const g = mods.length ? mapLooks(rooted, (l) => (l === full ? l : modifyLook(l, mods, f.assets))) : rooted;
  decoded.set(g, decoded.get(f));
  return g;
}
