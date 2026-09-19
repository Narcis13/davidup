// hdf bundle <film.js> [--out dir]: one HTML file that opens from disk and plays. The shell and its CSS
// inline, and an import map whose entries are data: URLs for every module the player and the film import
// (walked from their import statements). Each module's specifiers are rewritten to bare keys (hdf/<path>),
// because relative URLs cannot resolve against a data: URL. Image assets the film names by path are
// inlined as data URLs through window.HDF.assets. No bundler.
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { UsageError } from './load.mjs';
import { outDir } from './sheets.mjs';
import { ROOT, commonDir, graph, posix, resolveSpec, rewrite } from './modules.mjs';

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const dataUrl = (type, bytes) => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
// Keeps an inline <script> from ending early.
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c');

export async function bundle(path, { loadFilm, out }) {
  const film = await loadFilm(path);
  const file = resolve(path), deps = join(ROOT, 'player/deps.js'), player = join(ROOT, 'player/player.js');
  const mods = graph([player, deps, file]);
  const base = commonDir([...mods.keys()]);
  const key = (f) => `hdf/${posix(relative(base, f))}`;
  const imports = {};
  for (const [f, src] of mods) imports[key(f)] = dataUrl('text/javascript', rewrite(src, (s) => key(resolveSpec(s, f))));

  const assets = {};
  for (const [id, a] of Object.entries(film.assets ?? {})) {
    if (typeof a?.src !== 'string' || a.src.startsWith('data:')) continue;
    const type = MIME[extname(a.src).toLowerCase()];
    if (type) assets[id] = dataUrl(type, readFileSync(resolve(dirname(file), a.src)));
  }

  const pkg = posix(relative(base, ROOT));
  const config = { film: key(file), hdf: `hdf/${pkg ? pkg + '/' : ''}`, assets };
  const html = readFileSync(join(ROOT, 'player/player.html'), 'utf8')
    .replace('<link rel="stylesheet" href="shell.css">', () => `<style>\n${readFileSync(join(ROOT, 'player/shell.css'), 'utf8')}</style>`)
    .replace('<script type="module" src="./player.js"></script>', () => [
      `<script type="importmap">${safeJson({ imports })}</script>`,
      `<script>window.HDF = ${safeJson(config)};</script>`,
      `<script type="module">import '${key(player)}';</script>`,
    ].join('\n'));
  const dest = join(out, `${film.name}.html`);
  mkdirSync(out, { recursive: true });
  writeFileSync(dest, html);
  return { dest, film, modules: mods.size, assets: Object.keys(assets).length, bytes: statSync(dest).size };
}

export async function run([path], flags, { loadFilm }) {
  if (!path) throw new UsageError('missing <film.js>');
  const r = await bundle(path, { loadFilm, out: outDir(flags) });
  process.stdout.write(`${r.dest}  ${r.modules} modules, ${r.assets} inlined assets, ${(r.bytes / 1024).toFixed(0)} KB  (${basename(path)})\n`);
  return 0;
}
