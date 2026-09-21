// P8: every film in films/ lints clean and matches its golden (goldens are written with 1 worker, checked
// here with 4, so a worker split that changes a pixel fails too). A film is any films/*.js whose default
// export is a film; its golden is films/goldens/<name>.json. Run through the CLI, as a user would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadFilm } from '../cli/load.mjs';
import { readCatalogue, recordOf } from '../core/assets.js';
import { frame } from '../core/tree.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILMS = join(ROOT, 'films');

async function films() {
  const out = [];
  for (const f of readdirSync(FILMS).filter((n) => n.endsWith('.js')).sort()) {
    const d = (await import(pathToFileURL(join(FILMS, f)).href)).default;
    if (d && typeof d === 'object' && d.timeline && typeof d.name === 'string') out.push({ file: `films/${f}`, name: d.name });
  }
  return out;
}
const hdf = (...args) => spawnSync(process.execPath, ['cli/hdf.mjs', ...args], { cwd: ROOT, encoding: 'utf8' });

test('films/ holds the seven ported films, fox-and-teapot and cutout-fox, each with a golden', async () => {
  const all = await films();
  assert.deepEqual(all.map((f) => f.name).sort(), ['cutout-fox', 'fly-style', 'four-looks', 'fox-and-teapot', 'gallop', 'held-once', 'mini', 'moon-book', 'one-year']);
  for (const f of all) assert.ok(existsSync(join(FILMS, 'goldens', `${f.name}.json`)), `no golden for ${f.name}; run hdf golden ${f.file} write --workers 1`);
});

test('every film lints clean', async () => {
  for (const f of await films()) {
    const r = hdf('lint', f.file);
    assert.equal(r.status, 0, `${f.file}\n${r.stdout}${r.stderr}`);
  }
});

test('every film matches its golden with 4 workers', { skip: process.platform !== 'darwin' && 'goldens are written on darwin-arm64' }, async () => {
  for (const f of await films()) {
    const r = hdf('golden', f.file, 'check', '--workers', '4');
    assert.equal(r.status, 0, `${f.file}\n${r.stdout}${r.stderr}`);
  }
});

// S11: mini lettered in the synthetic test hand is a golden of its own (goldens/mini-paperInk~hand:test.json).
test("mini under --look 'paperInk~hand:test' matches its own golden, and lints clean", { skip: process.platform !== 'darwin' && 'goldens are written on darwin-arm64' }, async () => {
  const look = 'paperInk~hand:test';
  assert.ok(existsSync(join(FILMS, 'goldens', `mini-${look}.json`)));
  const r = hdf('golden', 'films/mini.js', 'check', '--workers', '4', '--look', look);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const l = hdf('lint', 'films/mini.js', '--look', look);
  assert.equal(l.status, 0, l.stdout + l.stderr);
});

// S1: --look 'preset~from:<asset>' paints the film in a cutout's own colours. held-once pins a look per scene
// (a pastel sheet each), so this is also the check that a modifier reaches those and leaves their paper alone.
test("--look 'doodlePastel~from:teapot' repaints held-once in the teapot's colours", async () => {
  const path = join(FILMS, 'held-once.js');
  const plain = await loadFilm(path);
  const from = await loadFilm(path, { look: 'doodlePastel~from:teapot' });
  const teapot = recordOf(readCatalogue(), 'teapot');

  assert.equal(from.look.name, 'doodlePastel~from:teapot');
  assert.deepEqual(from.look.palette.fills, teapot.colours.map((c) => c.hex));
  const a = frame(plain, 24).look, b = frame(from, 24).look;
  assert.equal(b.name, `${a.name}~from:teapot`, 'the scene keeps its own sheet, repainted');
  assert.equal(b.palette.paper, a.palette.paper);
  assert.notDeepEqual(b.palette.fills, a.palette.fills);

  const r = hdf('grid', 'films/held-once.js', '--look', 'doodlePastel~from:teapot', '--n', '4', '--width', '160');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /held-once-doodlePastel~from:teapot-grid\.jpg/);

  const bad = hdf('grid', 'films/held-once.js', '--look', 'doodlePastel~from:nope', '--n', '2', '--width', '160');
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /no asset 'nope'/);
});
