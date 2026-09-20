import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// The CLI in a child process (node --test reports through this process's stdout, so no capturing it).
async function hdf(...argv) {
  const r = spawnSync(process.execPath, ['cli/hdf.mjs', ...argv], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

test('lint: mini is clean (exit 0), a broken film exits 1 with file:shot:frame lines', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-lint-'));
  try {
    assert.equal((await hdf('lint', 'films/mini.js')).code, 0);
    const src = readFileSync('films/mini.js', 'utf8').replaceAll('../core/index.js', new URL('../core/index.js', import.meta.url).href)
      .replace("'fills.0', { finish: true }", "'#ff0000'");
    writeFileSync(join(dir, 'bad.js'), src);
    const { code, out } = await hdf('lint', join(dir, 'bad.js'));
    assert.equal(code, 1);
    assert.match(out, /^bad\.js:roll:0  role  fill: role '#ff0000'/m);
    assert.match(out, /^1 finding$/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('board, sheet and changed write their images', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-art-'));
  try {
    assert.equal((await hdf('board', 'films/mini.js', '--out', dir)).code, 0);
    assert.ok(existsSync(join(dir, 'mini-board.jpg')));
    assert.equal((await hdf('sheet', 'films/mini.js', 'ball', '--out', dir)).code, 0);
    assert.ok(existsSync(join(dir, 'mini-sheet-ball.jpg')));
    assert.match((await hdf('changed', 'films/mini.js', '--out', dir)).out, /baseline/);
    assert.match((await hdf('changed', 'films/mini.js', '--out', dir)).out, /no frames changed/);
    // Pretend frames 3 and 4 were rendered from other lists.
    const f = join(dir, 'mini.hashes.json'), st = JSON.parse(readFileSync(f, 'utf8'));
    st.frames[3] = st.frames[4] = 'x';
    writeFileSync(f, JSON.stringify(st));
    const { out } = await hdf('changed', 'films/mini.js', '--out', dir);
    assert.match(out, /2 of 54 frames changed: 3-4/);
    assert.ok(existsSync(join(dir, 'mini-changed.jpg')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('sheet store: a puppet in the store gets the check sheet hdf find points at', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-puppet-'));
  try {
    const root = join(dir, 'store'), file = join(dir, 'blob.puppet.json');
    writeFileSync(file, JSON.stringify({
      units: 100, box: [-60, -60, 120, 120],
      parts: { body: { pivot: [0, 0], ops: [{ op: 'fill', path: { $p: [[1, -40, -40, 40, -40, 40, 40, -40, 40]] }, role: 'fills.0', finish: true }] } },
      cycles: { bob: { n: 2, frames: [{ body: 0 }, { body: 20 }] } },
    }));
    assert.equal((await hdf('import', file, '--kind', 'puppet', '--name', 'blob', '--root', root, '--licence', 'own')).code, 0);
    const { code, out } = await hdf('sheet', 'store', 'blob', '--cycle', 'bob', '--root', root);
    assert.equal(code, 0, out);
    assert.match(out, /blob\.jpg {2}6 looks x 1 state x 3 scales \+ 2 frames of bob$/m);
    assert.ok(existsSync(join(root, 'sheets', 'blob.jpg')));
    assert.match((await hdf('find', 'blob', '--root', root)).out, /sheets.blob\.jpg/, 'hdf find sends you to the sheet it just wrote');
    assert.equal((await hdf('sheet', 'store', 'nope', '--root', root)).code, 1);
    assert.equal((await hdf('sheet', 'store', 'blob', '--cycle', 'trot', '--root', root)).code, 2);
    // A payload that breaks a rule never reaches the store.
    writeFileSync(file, JSON.stringify({ units: 100, parts: { body: { pivot: [0, 0], ops: [] } }, poses: { rest: {}, tip: { body: 33 } } }));
    const bad = await hdf('import', file, '--kind', 'puppet', '--name', 'odd', '--root', root, '--licence', 'own');
    assert.equal(bad.code, 2);
    assert.match(bad.out, /does not pass lint[\s\S]*puppet-joint {2}pose 'tip' sets 'body' to 33 degrees, off the 2 degree grid/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('import and find are commands: usage lists them, a bad kind is a usage error', async () => {
  const usage = (await hdf('help')).out;
  assert.match(usage, /^ {2}import {2}<file> --kind cutout\|clip/m);
  assert.match(usage, /^ {2}find {4}<words\.\.\.> \[--kind\]/m);
  assert.match(usage, /^ {2}sheet {3}store <id>/m);
  const dir = mkdtempSync(join(tmpdir(), 'hdf-store-'));
  try {
    // The store the film assets of a 2.0 film do not need: an unknown verb is still an unknown verb.
    assert.equal((await hdf('improt', 'x')).code, 2);
    const bad = await hdf('import', 'films/mini.js', '--kind', 'film', '--name', 'mini', '--root', dir);
    assert.equal(bad.code, 2);
    assert.match(bad.out, /--kind film \(expected cutout \| clip \| puppet \| hand \| stock \| motif \| sample\)/);
    assert.equal((await hdf('find', '--root', dir)).code, 2);          // no words and no --kind
    assert.equal((await hdf('find', 'teapot', '--root', dir)).code, 1); // nothing in an empty store
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
