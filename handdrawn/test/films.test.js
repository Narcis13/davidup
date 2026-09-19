// P8: every film in films/ lints clean and matches its golden (goldens are written with 1 worker, checked
// here with 4, so a worker split that changes a pixel fails too). A film is any films/*.js whose default
// export is a film; its golden is films/goldens/<name>.json. Run through the CLI, as a user would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

test('films/ holds the seven ported films, each with a golden', async () => {
  const all = await films();
  assert.deepEqual(all.map((f) => f.name).sort(), ['fly-style', 'four-looks', 'gallop', 'held-once', 'mini', 'moon-book', 'one-year']);
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
