// hdf dev <film.js> [--port 4321]: the player with hot reload.
// Files are served from the deepest directory holding both the package and the film, under a generation
// prefix /v<gen>/ that the server ignores: the player re-imports the film and core from a fresh prefix on
// every change, so the browser's module map gives it a new graph (film, its own modules and core alike)
// with no page reload. Reads are limited to the package, the film's directory and the working directory.
// GET /__hdf/events is an SSE stream with one `change` event per burst of edits.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, watch } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { UsageError } from './load.mjs';
import { ROOT, commonDir, posix, resolveSpec, rewrite, within } from './modules.mjs';

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

export function devServer(filmPath, { port = 4321, host = '127.0.0.1', log = () => {} } = {}) {
  const film = resolve(filmPath);
  if (!existsSync(film)) throw new UsageError(`film not found: ${filmPath}`);
  const base = commonDir([ROOT, film]);
  const allowed = [ROOT, dirname(film), process.cwd()];
  const rel = (p) => posix(relative(base, p));
  const hdf = rel(ROOT) ? `${rel(ROOT)}/` : '';
  const config = { dev: true, film: rel(film), hdf };
  const clients = new Set();

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, body, type = 'text/plain') => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };
    if (url.pathname === '/') return send(200, playerPage(config, { hdfUrl: `/v0/${hdf}` }), 'text/html; charset=utf-8');
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
    let src = readFileSync(file, 'utf8');
    try {
      src = rewrite(src, (s) => (s === 'handdrawn' || s.startsWith('handdrawn/') ? `/v${m[1]}/${rel(resolveSpec(s, file))}` : undefined));
    } catch (e) { return send(500, e.message); }
    send(200, src, 'text/javascript; charset=utf-8');
  });

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
  const dirs = within(ROOT, dirname(film)) ? [ROOT] : [ROOT, dirname(film)];
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
  const dev = devServer(path, { port: flags.port ?? 4321, host: flags.host ?? '127.0.0.1', log: (s) => process.stdout.write(`${s}\n`) });
  const url = await dev.ready;
  process.stdout.write(`${basename(path)}: ${url}  (ctrl-c to stop)\n`);
  await new Promise((ok) => {
    const bye = () => { dev.close().then(ok); };
    process.once('SIGINT', bye);
    process.once('SIGTERM', bye);
  });
  return 0;
}
