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
