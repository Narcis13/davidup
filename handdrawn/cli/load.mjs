// Film loading, shared by the CLI and render workers.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export class UsageError extends Error {}

// Imports a film module and checks its default export has the shape film() produces.
export async function loadFilm(path) {
  if (!path) throw new UsageError('missing <film.js>');
  const abs = resolve(path);
  if (!existsSync(abs)) throw new UsageError(`film not found: ${path}`);
  const mod = await import(pathToFileURL(abs).href);
  const f = mod.default;
  if (!f || typeof f !== 'object') throw new Error(`${path}: default export must be film({...})`);
  if (typeof f.name !== 'string' || !f.name) throw new Error(`${path}: film has no name`);
  if (!f.look || typeof f.look !== 'object') throw new Error(`${path}: film has no look`);
  if (f.timeline == null) throw new Error(`${path}: film has no timeline`);
  return f;
}
