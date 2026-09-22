// hdf dev <film.js> [--port 4321]: the player with hot reload.
// Files are served from the deepest directory holding both the package and the film, under a generation
// prefix /v<gen>/ that the server ignores: the player re-imports the film and core from a fresh prefix on
// every change, so the browser's module map gives it a new graph (film, its own modules and core alike)
// with no page reload. Reads are limited to the package, the film's directory and the working directory.
// GET /__hdf/events is an SSE stream with one `change` event per burst of edits.
// The page also carries the asset store: window.HDF.catalogue is a record per id (a data payload inline, a
// raster's pixels left out) and window.HDF.assets points every raster and every sample at its blob under /v0/, which is what
// core/assets.web.js reads in place of the file system. The store is read fresh on every page load, and GET
// /__hdf/store hands the page the same again after a change (a player reloading after the store moved).
// --root <dir> serves another store (a copy to try the workbench on).
//
// The workbench (4.0 W2): GET /__hdf/puppet/<id> is a stored puppet's payload as the store holds it, with its
// entry; POST /__hdf/puppet/<id> ({ payload }) writes it to <store>/src/<id>.puppet.json and imports it over the
// entry (the checks `hdf import` runs, the entry's licence, credit, source, tags and desc kept), so the watcher
// sees the store change and the film reloads with it. A payload the checks refuse is a 422 naming them, and
// nothing is written.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync, watch, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { ASSET_ROOT, SCHEMAS, readCatalogue, recordOf } from '../core/assets.js';
import { putPayload } from './import.mjs';
import { marksFrom, UsageError } from './load.mjs';
import { ROOT, commonDir, posix, resolveSpec, rewrite, webSource, within } from './modules.mjs';

const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.html': 'text/html', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.wav': 'audio/wav' };
const WATCHED = /\.(m?js|json|png|jpe?g|webp|gif)$/i;
const IGNORED = /(^|[/\\])(node_modules|out|\.cache|goldens|\.git)([/\\]|$)/;

// The player page: the shell with its stylesheet and script pointed at the package, and window.HDF.
export function playerPage(config, { hdfUrl }) {
  return readFileSync(join(ROOT, 'player/player.html'), 'utf8')
    .replace('href="shell.css"', `href="${hdfUrl}player/shell.css"`)
    .replace('<script type="module" src="./player.js"></script>',
      `<script>window.HDF = ${JSON.stringify(config)};</script>\n<script type="module" src="${hdfUrl}player/player.js"></script>`);
}

// JSON for a person to read and diff: objects a key a line, but an array of numbers or strings (a path's
// points, a pivot) and anything short on one line.
export function pretty(v, pad = '') {
  const flat = JSON.stringify(v);
  if (v === null || typeof v !== 'object' || flat.length <= 72 || (Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object'))) return flat;
  const inner = `${pad}  `;
  if (Array.isArray(v)) return `[\n${v.map((x) => inner + pretty(x, inner)).join(',\n')}\n${pad}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined);
  return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${pretty(v[k], inner)}`).join(',\n')}\n${pad}}`;
}

// The whole store as the page reads it: { catalogue, assets }. A film names a handful of ids and the server
// cannot know which before the film is imported, so every entry goes; `hdf bundle` keeps only what was used.
export function storeState(rel, root = ASSET_ROOT) {
  const st = readCatalogue(root), catalogue = {}, assets = {};
  for (const id of st.ids) {
    const { src, ...rest } = recordOf(st, id);
    catalogue[id] = rest;
    if (['raster', 'audio'].includes(SCHEMAS[st.entry(id).kind].payload) && src) assets[id] = `/v0/${rel(src)}`;
  }
  return { catalogue, assets };
}

export function devServer(filmPath, { port = 4321, host = '127.0.0.1', look, marks, root, log = () => {} } = {}) {
  const film = resolve(filmPath);
  if (!existsSync(film)) throw new UsageError(`film not found: ${filmPath}`);
  const store = root ? resolve(root) : ASSET_ROOT;
  if (root && !existsSync(join(store, 'catalogue.json'))) throw new UsageError(`--root ${root}: no catalogue.json there`);
  const base = commonDir([ROOT, film, store]);
  const allowed = [ROOT, dirname(film), process.cwd(), store];
  const rel = (p) => posix(relative(base, p));
  const hdf = rel(ROOT) ? `${rel(ROOT)}/` : '';
  const config = { dev: true, film: rel(film), hdf, store: rel(store), ...(look ? { look } : {}), ...(marks ? { marks } : {}) };
  const clients = new Set();

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, body, type = 'text/plain') => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };
    if (url.pathname === '/') return send(200, playerPage({ ...config, ...storeState(rel, store) }, { hdfUrl: `/v0/${hdf}` }), 'text/html; charset=utf-8');
    if (url.pathname === '/__hdf/store') return send(200, JSON.stringify(storeState(rel, store)), 'application/json');
    const pup = url.pathname.match(/^\/__hdf\/puppet\/([^/]+)$/);
    if (pup) { workbench(req, decodeURIComponent(pup[1]), send); return; }
    if (url.pathname === '/__hdf/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': hdf dev\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    const m = url.pathname.match(/^\/v(\d+)\/(.*)$/);
    if (!m) return send(404, 'not found');
    let file;
    try { file = resolve(base, decodeURIComponent(m[2])); } catch { return send(400, 'bad path'); }
    if (!allowed.some((d) => within(d, file))) return send(403, `outside the package and the film's directory: ${file}`);
    if (!existsSync(file) || !statSync(file).isFile()) return send(404, `not found: ${file}`);
    const ext = extname(file).toLowerCase();
    if (ext !== '.js' && ext !== '.mjs') return send(200, readFileSync(file), TYPES[ext] ?? 'application/octet-stream');
    // Modules: the package's own name becomes a path under the same generation, so a film outside the
    // package that imports 'handdrawn' reloads with the rest.
    let src = webSource(file);
    try {
      src = rewrite(src, (s) => (s === 'handdrawn' || s.startsWith('handdrawn/') ? `/v${m[1]}/${rel(resolveSpec(s, file))}` : undefined));
    } catch (e) { return send(500, e.message); }
    send(200, src, 'text/javascript; charset=utf-8');
  });

  // The workbench's reads and writes of one stored puppet (see the top of this file).
  const workbench = (req, id, send) => {
    const json = (code, v) => send(code, JSON.stringify(v), 'application/json');
    const st = readCatalogue(store);
    if (!st.has(id) || st.entry(id).kind !== 'puppet' || id.startsWith('pack:')) return json(404, { error: `no puppet '${id}' in ${store}` });
    const e = st.entry(id);
    if (req.method === 'GET') return json(200, { id, entry: e, payload: st.json(e) });
    if (req.method !== 'POST') return json(405, { error: 'GET or POST' });
    // Only the page itself writes: a JSON body (another origin would need a preflight this server never answers)
    // from this origin.
    if (!/^application\/json\b/.test(req.headers['content-type'] ?? '')) return json(415, { error: 'send application/json' });
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(403, { error: `a write from ${req.headers.origin}` });
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      let payload;
      try { ({ payload } = JSON.parse(body)); } catch (err) { return json(400, { error: `not JSON: ${err.message}` }); }
      if (!payload || typeof payload !== 'object' || !payload.parts) return json(400, { error: 'send { payload } (a puppet payload)' });
      const file = join(store, 'src', `${id}.puppet.json`), text = `${pretty(payload)}\n`;
      const flags = { root: store, licence: e.licence, credit: e.credit, source: e.source, tags: (e.tags ?? []).join(','), ...(e.desc ? { desc: e.desc } : {}) };
      try {
        await putPayload({ kind: 'puppet', name: id, bytes: Buffer.from(text), abs: file, flags });
      } catch (err) { return json(422, { error: err.message }); }
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
      const now = readCatalogue(store).entry(id);
      log(`workbench: ${id} -> ${file} (${now.sha.slice(0, 8)})`);
      json(200, { id, file, sha: now.sha, changed: now.sha !== e.sha });
    });
  };

  // One event per burst: editors write a file in several steps.
  let pending = new Set(), timer = null;
  const fire = () => {
    const files = [...pending].sort();
    pending = new Set();
    timer = null;
    log(`changed: ${files.join(', ')}`);
    const msg = `event: change\ndata: ${JSON.stringify({ files })}\n\n`;
    for (const c of clients) c.write(msg);
  };
  // The film's directory only when the package does not already cover it (one event per edit, not two).
  const dirs = [ROOT, dirname(film), store].filter((d, i, all) => !all.some((o, j) => j < i && within(o, d)));
  const watchers = dirs.map((dir) => watch(dir, { recursive: true }, (_, name) => {
    if (!name || !WATCHED.test(name) || IGNORED.test(name)) return;
    pending.add(rel(join(dir, name)));
    clearTimeout(timer);
    timer = setTimeout(fire, 80);
  }));

  const ready = new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => ok(`http://${host}:${server.address().port}/`));
  });
  return {
    ready, config,
    close() {
      clearTimeout(timer);
      for (const w of watchers) w.close();
      for (const c of clients) c.end();
      server.closeAllConnections?.();
      return new Promise((ok) => server.close(() => ok()));
    },
  };
}

export async function run([path], flags) {
  if (!path) throw new UsageError('missing <film.js>');
  const dev = devServer(path, { port: flags.port ?? 4321, host: flags.host ?? '127.0.0.1', look: flags.look, marks: marksFrom(flags.cuesFrom, flags.at), root: flags.root, log: (s) => process.stdout.write(`${s}\n`) });
  const url = await dev.ready;
  process.stdout.write(`${basename(path)}: ${url}  (ctrl-c to stop)\n`);
  await new Promise((ok) => {
    const bye = () => { dev.close().then(ok); };
    process.once('SIGINT', bye);
    process.once('SIGTERM', bye);
  });
  return 0;
}
