// H3: hosts -- the apps that draw a kind, found at run time (asset-library plan §7 H3). hdf's own host is
// tested in handdrawn/test/previews.test.js; these are fixture hosts, so assetlib's suite needs no hdf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { main } from '../cli.js';
import { KNOWN_HOSTS, encodePng, loadHosts, readShelf, tagOf } from '../index.js';

// A host module drawing `kinds` as a solid square of `rgb`, named `name`.
const hostModule = (name, kinds, rgb) => `
import { encodePng } from ${JSON.stringify(new URL('../index.js', import.meta.url).href)};
const px = (w, h) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) d.set([${rgb}, 255], i * 4); return { data: d, width: w, height: h }; };
const render = async (file, record, { width }) => encodePng(px(width, Math.round(width * 2 / 3)));
export default { name: '${name}', previewers: Object.fromEntries(${JSON.stringify(kinds)}.map((k) => [k, { name: '${name}', version: 3, render }])) };
`;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'assetlib-hosts-'));
  writeFileSync(join(dir, 'a.mjs'), hostModule('alpha', ['image', 'stock'], '200, 10, 10'));
  writeFileSync(join(dir, 'b.mjs'), hostModule('beta', ['stock'], '10, 10, 200'));
  writeFileSync(join(dir, 'broken.mjs'), 'export default { name: "broken", previewers: { image: 42 } };');
  writeFileSync(join(dir, 'throws.mjs'), 'throw new Error("no skia here");');
  return dir;
}

test('the known hosts are hdf, next to this package', () => {
  assert.equal(KNOWN_HOSTS.length, 1);
  assert.match(KNOWN_HOSTS[0], /handdrawn[/\\]cli[/\\]host\.mjs$/);
});

test('hosts load in order, a later one taking a kind; a known host not on disk is skipped quietly', async () => {
  const dir = fixture();
  try {
    const got = await loadHosts({ known: [join(dir, 'a.mjs'), join(dir, 'nowhere.mjs')], env: { ASSETLIB_HOSTS: 'b.mjs' }, cwd: dir });
    assert.deepEqual(got.warnings, []);
    assert.deepEqual(got.hosts.map((h) => [h.name, h.kinds]), [['alpha', ['image', 'stock']], ['beta', ['stock']]]);
    assert.equal(got.previewers.image.name, 'alpha');
    assert.equal(got.previewers.stock.name, 'beta');
    // '-' first: the known ones are left out.
    const only = await loadHosts({ known: [join(dir, 'a.mjs')], env: { ASSETLIB_HOSTS: ['-', join(dir, 'b.mjs')].join(delimiter) } });
    assert.deepEqual(only.hosts.map((h) => h.name), ['beta']);
    assert.deepEqual((await loadHosts({ known: [], env: {} })).hosts, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a host that fails to load or registers something that is not a previewer is a warning, and none of it is used', async () => {
  const dir = fixture();
  try {
    const got = await loadHosts({ known: [], env: { ASSETLIB_HOSTS: ['broken.mjs', 'throws.mjs', 'missing.mjs', 'a.mjs'].join(delimiter) }, cwd: dir });
    assert.deepEqual(got.hosts.map((h) => h.name), ['alpha']);
    assert.equal(got.warnings.length, 3);
    assert.match(got.warnings[0], /broken\.mjs not loaded: previewers\.image: a previewer is a function/);
    assert.match(got.warnings[1], /throws\.mjs not loaded: no skia here/);
    assert.match(got.warnings[2], /missing\.mjs not loaded/);
    assert.equal(got.previewers.image.name, 'alpha');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the bin (main with discover) draws thumbs with the hosts it finds', async () => {
  const dir = fixture();
  try {
    const shelf = readShelf(join(dir, 'user'), { name: 'user' });
    const d = new Uint8ClampedArray(4 * 3 * 4).fill(255);
    shelf.put({ id: 'plain', kind: 'image', name: 'Plain', tags: [], licence: 'own', credit: '', source: '' }, encodePng({ data: d, width: 4, height: 3 }));
    mkdirSync(join(dir, 'house'), { recursive: true });
    let out = '', err = '';
    const io = { out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } };
    const env = { DAVIDUP_ASSETS: join(dir, 'user'), DAVIDUP_HOUSE: join(dir, 'house'), ASSETLIB_HOSTS: ['-', 'a.mjs', 'throws.mjs'].join(delimiter) };
    assert.equal(await main(['thumb', 'plain', '--json'], { ...io, cwd: dir, env, discover: true }), 0);
    const [t] = JSON.parse(out);
    assert.equal(t.by, 'alpha@3');
    assert.equal(tagOf(readFileSync(t.path)).by, 'alpha@3');
    assert.match(err, /warning: host .*throws\.mjs not loaded/);
    // Without discover (a host that passes its own previewers, the tests), nothing is loaded: the thumb stays.
    out = '';
    assert.equal(await main(['thumb', 'plain', '--json'], { ...io, cwd: dir, env }), 0);
    assert.equal(JSON.parse(out)[0].cached, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
