import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ROOT, graph, rewrite, specifiers } from '../cli/modules.mjs';
import { bundle } from '../cli/bundle.mjs';
import { devServer } from '../cli/dev.mjs';
import { loadFilm } from '../cli/load.mjs';

test('specifiers: static, re-export, side-effect and dynamic imports; rewrite keeps the rest', () => {
  const src = [
    "import { a,\n  b } from './a.js';",
    "import x from \"../x.js\";",
    "export * from './star.js';",
    "export { c as d } from './c.js';",
    "import './side.js';",
    "const m = await import('./dyn.js');",
    "const s = 'import nothing';",
  ].join('\n');
  assert.deepEqual(specifiers(src), ['./a.js', '../x.js', './star.js', './c.js', './side.js', './dyn.js']);
  const out = rewrite(src, (s) => (s === '../x.js' ? 'k/x.js' : undefined));
  assert.match(out, /import x from "k\/x\.js";/);
  assert.match(out, /import \{ a,\n {2}b \} from '\.\/a\.js';/);
  assert.match(out, /'import nothing'/);
});

test('graph: the player and a film reach core through relative imports only', () => {
  const mods = graph([join(ROOT, 'player/player.js'), join(ROOT, 'player/deps.js'), join(ROOT, 'films/mini.js')]);
  assert.ok(mods.has(join(ROOT, 'core/raster.js')));
  assert.ok(mods.has(join(ROOT, 'core/index.js')));
  assert.ok(![...mods.keys()].some((f) => f.includes('node_modules') || f.includes('/cli/')));
});

test('bundle: one HTML whose import map closes over every module it imports', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-bundle-'));
  try {
    const r = await bundle('films/mini.js', { loadFilm, out: dir });
    const html = readFileSync(r.dest, 'utf8');
    const { imports } = JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/s)[1]);
    const config = JSON.parse(html.match(/window\.HDF = (.*?);<\/script>/s)[1]);
    assert.ok(imports[config.film], 'film key');
    assert.ok(imports[`${config.hdf}player/deps.js`], 'deps key');
    assert.ok(imports['hdf/player/player.js']);
    for (const [key, url] of Object.entries(imports)) {
      const src = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64').toString('utf8');
      for (const s of specifiers(src)) assert.ok(imports[s], `${key} imports '${s}', which is not in the map`);
    }
    const vocab = Object.entries(imports).find(([k]) => k.endsWith('packs/poses/biped.json'));
    assert.ok(vocab && vocab[1].startsWith('data:application/json;'), 'the pose vocabulary is a JSON module, typed as JSON (4.0 K3)');
    assert.doesNotMatch(html, /src="\.\/player\.js"|href="shell\.css"/);
    assert.match(html, /<style>/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('bundle: image assets named by path are inlined', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-bundle-img-'));
  try {
    // A 1x1 PNG next to a film that names it by path.
    writeFileSync(join(dir, 'dot.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
    // An absolute import, so Node can load the film from a temp directory too.
    writeFileSync(join(dir, 'pic.js'), readFileSync('films/mini.js', 'utf8')
      .replaceAll('../core/index.js', resolve('core/index.js'))
      .replace("score });", "score, assets: { dot: { src: 'dot.png' } } });"));
    const r = await bundle(join(dir, 'pic.js'), { loadFilm, out: dir });
    assert.equal(r.assets, 1);
    assert.match(readFileSync(r.dest, 'utf8'), /"dot":"data:image\/png;base64,/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('dev: page, versioned modules, the package name rewritten, reads fenced, SSE on change', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-dev-'));
  const film = join(dir, 'film.js');
  writeFileSync(film, readFileSync('films/mini.js', 'utf8').replaceAll('../core/index.js', 'handdrawn'));
  const dev = devServer(film, { port: 0 });
  try {
    const url = await dev.ready;
    const page = await (await fetch(url)).text();
    assert.match(page, /window\.HDF = \{"dev":true/);
    const { film: rel, hdf } = dev.config;
    const mod = await fetch(`${url}v7/${rel}`);
    assert.equal(mod.headers.get('cache-control'), 'no-store');
    assert.match(mod.headers.get('content-type'), /javascript/);
    assert.ok((await mod.text()).includes(`from '/v7/${hdf}core/index.js'`));
    assert.equal((await fetch(`${url}v7/${hdf}core/list.js`)).status, 200);
    assert.equal((await fetch(`${url}v0/etc/hosts`)).status, 403);   // served from /, but only the package and the film's dir
    assert.equal((await fetch(`${url}v0/${hdf}nope.js`)).status, 404);

    // SSE: one change event naming the film.
    const ctl = new AbortController();
    const res = await fetch(`${url}__hdf/events`, { signal: ctl.signal });
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '';
    const until = async (re) => {
      const deadline = Date.now() + 5000;
      while (!re.test(buf)) {
        if (Date.now() > deadline) throw new Error(`no ${re} in: ${buf}`);
        const { value, done } = await Promise.race([reader.read(), new Promise((_, no) => setTimeout(() => no(new Error(`no ${re} in: ${buf}`)), deadline - Date.now()))]);
        if (done) throw new Error('stream ended');
        buf += dec.decode(value);
      }
    };
    await until(/: hdf dev/);
    await new Promise((r) => setTimeout(r, 300));   // let late events from creating the file go by
    buf = '';
    writeFileSync(film, readFileSync(film, 'utf8').replace('CX - 400', 'CX - 380'));
    await until(/event: change\ndata: (.*)\n\n/);
    assert.ok(JSON.parse(buf.match(/data: (.*)\n/)[1]).files.some((f) => f.endsWith('film.js')));
    ctl.abort();
  } finally {
    await dev.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
