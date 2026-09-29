// Asset library I1: hdf's makers (cli/makers.mjs), found by the `asset` bin through hdf's host. A 6-frame clip of a
// film that draws a cutout off a shelf is remade: the same sha (a render is deterministic); then the cutout is put
// again with other pixels and the remake is a new sha, in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addAsset } from '../../assetlib/add.js';
import { check, encodePng, openLibrary } from '../../assetlib/index.js';
import { makers, MAKER_VERSION } from '../cli/makers.mjs';

const ASSET = fileURLToPath(new URL('../../assetlib/cli.js', import.meta.url));
const hdf = (...argv) => spawnSync(process.execPath, ['cli/hdf.mjs', ...argv], { encoding: 'utf8' });

// 40 x 40, a filled square of `rgb` on a clear field: a cutout hdf traces.
const square = (rgb) => {
  const data = new Uint8ClampedArray(40 * 40 * 4);
  for (let y = 8; y < 32; y++) for (let x = 8; x < 32; x++) data.set([...rgb, 255], (y * 40 + x) * 4);
  return encodePng({ data, width: 40, height: 40 });
};

test('I1: asset remake runs hdf render again: the same sha, then a new one once its cutout changed', { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-remake-')), shelf = join(dir, 'shelf');
  try {
    const put = (rgb) => {
      writeFileSync(join(dir, 'dot.png'), square(rgb));
      const r = hdf('import', join(dir, 'dot.png'), '--kind', 'cutout', '--name', 'dot', '--root', shelf, '--licence', 'own');
      assert.equal(r.status, 0, r.stderr);
    };
    put([200, 40, 40]);
    const core = new URL('../core/index.js', import.meta.url).href, assets = new URL('../core/assets.js', import.meta.url).href;
    writeFileSync(join(dir, 'dotted.js'), `
      import { film, shot, paper, photo, pin } from ${JSON.stringify(core)};
      import { fromStore } from ${JSON.stringify(assets)};
      const P = fromStore(['dot'], { from: ${JSON.stringify(shelf)} });
      export default film({ name: 'dotted', look: 'doodlePastel', assets: [{ id: 'dot', from: 'shelf' }],
        timeline: shot('one', 1, ({ t, CX, CY }) => [paper(), photo(pin(P.dot, { x: CX + 200 * t, y: CY, h: 400 }), { shadow: 0 })]) });
    `);

    // The clip as davidup's render_hdf_clip puts it (src/mcp/hdf.ts clipDerived), on the same shelf as its cutout.
    const lib = openLibrary({ shelves: [{ name: 'user', root: shelf }] });
    const args = { film: join(dir, 'dotted.js'), frames: 6, width: 160 };
    const first = await makers['hdf render'].make({ id: 'clip', made: { tool: 'hdf render', args } });
    assert.deepEqual(first.from, ['dot'], 'the render names the store records the film read');
    const made = { tool: 'hdf render', from: first.from, args, at: new Date().toISOString() };
    const entry = { id: 'clip', kind: 'video', name: 'dotted (hand-drawn clip)', tags: ['hdf', 'clip'], licence: 'own', credit: '', source: '', made };
    const was = (await addAsset(lib, { bytes: first.bytes, file: first.file, entry }, { by: 'hdf render' })).entry;
    assert.deepEqual(check(lib).filter((f) => f.rule === 'made'), [], 'made.from is on the shelf');

    // The bin finds hdf's makers through its host, as `asset thumb` finds its previewers.
    const remake = () => {
      const r = spawnSync(process.execPath, [ASSET, 'remake', 'clip', '--json'], { encoding: 'utf8', env: { ...process.env, DAVIDUP_ASSETS: shelf, ASSETLIB_HOSTS: '' } });
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(r.stdout)[0];
    };
    const same = remake();
    assert.deepEqual([same.tool, same.changed, same.sha], ['hdf render', false, was.sha], 'the same film, args and cutout: the same bytes');
    const cat = () => JSON.parse(readFileSync(join(shelf, 'catalogue.json'), 'utf8'));
    assert.equal(cat().clip.made.version, MAKER_VERSION);
    assert.ok(Date.parse(cat().clip.made.at) >= Date.parse(made.at));

    put([30, 60, 200]);
    const next = remake();
    assert.equal(next.changed, true, 'the cutout it was made from changed');
    assert.equal(next.was, was.sha);
    assert.notEqual(next.sha, was.sha);
    assert.ok(!existsSync(join(shelf, 'blobs', `${was.sha}.mp4`)), 'the old clip went with its record');
    assert.ok(existsSync(join(shelf, 'blobs', `${next.sha}.mp4`)));
    assert.deepEqual({ ...cat().clip.made, at: undefined }, { ...made, version: MAKER_VERSION, at: undefined });
    assert.deepEqual([cat().clip.sec, cat().clip.w], [0.5, 160], 'its facts read off the new clip');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('I1: a render cut to a composition is not remade from its args; a maker with no args says what is missing', async () => {
  await assert.rejects(makers['hdf render'].make({ id: 'x', made: { tool: 'hdf render', args: { film: 'films/mini.js', cues: 'composition' } } }), /cut to a composition's marks/);
  await assert.rejects(makers['hdf sprite'].make({ id: 'x', made: { tool: 'hdf sprite', args: {} } }), /made\.args\.name is missing/);
  await assert.rejects(makers['hdf hand --export-ttf'].make({ id: 'x', made: { tool: 'hdf hand --export-ttf' } }), /made\.args\.hand is missing/);
  await assert.rejects(makers['hdf sheet store'].make({ id: 'x', made: { tool: 'hdf sheet store', args: {} } }), /made\.args\.puppet is missing/);
});
