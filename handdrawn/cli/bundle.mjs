// hdf bundle <film.js> [--out dir]: one HTML file that opens from disk and plays. The shell and its CSS
// inline, and an import map whose entries are data: URLs for every module the player and the film import
// (walked from their import statements). Each module's specifiers are rewritten to bare keys (hdf/<path>),
// because relative URLs cannot resolve against a data: URL. Image assets the film names by path are
// inlined as data URLs through window.HDF.assets, and so is every voice's wav. No bundler.
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { assetsOf, UsageError } from './load.mjs';
import { ASSET_ROOT, readCatalogue, recordOf } from '../core/assets.js';
import { scoreEvents, voiceIds } from '../core/synth.js';
import { outDir } from './sheets.mjs';
import { ROOT, commonDir, graph, posix, resolveSpec, rewrite } from './modules.mjs';

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.wav': 'audio/wav' };
const dataUrl = (type, bytes) => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
// Keeps an inline <script> from ending early.
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

export async function bundle(path, { loadFilm, out, look }) {
  const film = await loadFilm(path);
  const file = resolve(path), deps = join(ROOT, 'player/deps.js'), player = join(ROOT, 'player/player.js');
  const mods = graph([player, deps, file]);
  const base = commonDir([...mods.keys()]);
  const key = (f) => `hdf/${posix(relative(base, f))}`;
  const imports = {};
  // A JSON module keeps its type: it is imported `with { type: 'json' }`, which checks the MIME.
  for (const [f, src] of mods) imports[key(f)] = f.endsWith('.json') ? dataUrl('application/json', src) : dataUrl('text/javascript', rewrite(src, (s) => key(resolveSpec(s, f))));

  // Only the ids the film named: a record each, with the pixels of the rasters lifted out as data URLs.
  // A voice the score speaks but the film forgot to name comes from the store next to the package (4.0 V1).
  const assets = {}, catalogue = {}, named = { ...assetsOf(film) }, st = readCatalogue(ASSET_ROOT);
  for (const id of voiceIds(scoreEvents(film)?.events ?? [])) if (!named[id] && st.has(id)) named[id] = recordOf(st, id);
  for (const [id, a] of Object.entries(named)) {
    const { src, ...rest } = a ?? {};
    catalogue[id] = rest;
    if (typeof src !== 'string') continue;
    const type = MIME[extname(src).toLowerCase()];
    if (src.startsWith('data:')) assets[id] = src;
    else if (type) assets[id] = dataUrl(type, readFileSync(resolve(dirname(file), src)));
    else catalogue[id] = a;
  }

  const pkg = posix(relative(base, ROOT));
  const config = { film: key(file), hdf: `hdf/${pkg ? pkg + '/' : ''}`, assets, catalogue, ...(look ? { look } : {}) };
  const html = readFileSync(join(ROOT, 'player/player.html'), 'utf8')
    .replace('<link rel="stylesheet" href="shell.css">', () => `<style>\n${readFileSync(join(ROOT, 'player/shell.css'), 'utf8')}</style>`)
    .replace('<script type="module" src="./player.js"></script>', () => [
      `<script type="importmap">${safeJson({ imports })}</script>`,
      `<script>window.HDF = ${safeJson(config)};</script>`,
      `<script type="module">import '${key(player)}';</script>`,
    ].join('\n'));
  const dest = join(out, `${film.name}${look ? '-' + look : ''}.html`);
  mkdirSync(out, { recursive: true });
  writeFileSync(dest, html);
  return { dest, film, modules: mods.size, assets: Object.keys(assets).length, bytes: statSync(dest).size };
}

export async function run([path], flags, { loadFilm }) {
  if (!path) throw new UsageError('missing <film.js>');
  const r = await bundle(path, { loadFilm, out: outDir(flags), look: flags.look });
  process.stdout.write(`${r.dest}  ${r.modules} modules, ${r.assets} inlined assets, ${(r.bytes / 1024).toFixed(0)} KB  (${basename(path)})\n`);
  return 0;
}
