// A5: the `use` block (asset-library plan §5 A5, §4.3): the result is the call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DAVIDUP_TYPE, HOUSE_ROOT, KINDS, assetSrc, encodePng, openLibrary, useOf } from '../index.js';

const SHA = 'ab12cd34ef56'.padEnd(64, '0');
const rec = (id, kind, more = {}) => ({ id, kind, name: id, tags: [], licence: 'own', credit: '', source: '', sha: SHA, ext: 'x', ...more });
const HERE = { root: '/shelves/house', store: '/shelves/house' };

// One record per kind, and the use each gets, on hdf's own store (no `from`).
const EACH = {
  image: [rec('logo', 'image'), { tool: 'register_asset', args: { id: 'logo', type: 'image', src: 'asset:logo@ab12cd34ef56', licence: 'own' } }, null],
  cutout: [rec('teapot', 'cutout', { licence: 'CC0', credit: 'Teapot, The Met' }),
    { tool: 'register_asset', args: { id: 'teapot', type: 'image', src: 'asset:teapot@ab12cd34ef56', credit: 'Teapot, The Met', licence: 'CC0' } },
    { assets: ['teapot'], code: "fromStore(['teapot'])", take: "photo(pin(fromStore(['teapot'])['teapot'], { x: 540, y: 540, h: 420 }))", look: 'doodlePastel~from:teapot' }],
  stock: [rec('paper-warm', 'stock'),
    { tool: 'register_asset', args: { id: 'paper-warm', type: 'image', src: 'asset:paper-warm@ab12cd34ef56', licence: 'own' } },
    { assets: ['paper-warm'], code: "fromStore(['paper-warm'])", take: "fromStore(['paper-warm'])['paper-warm']" }],
  video: [rec('clouds', 'video', { licence: 'CC-BY', credit: 'Clouds by A. N. Other' }),
    { tool: 'register_asset', args: { id: 'clouds', type: 'video', src: 'asset:clouds@ab12cd34ef56', credit: 'Clouds by A. N. Other', licence: 'CC-BY' } }, null],
  audio: [rec('bed', 'audio', { licence: 'CC0' }), { tool: 'register_asset', args: { id: 'bed', type: 'audio', src: 'asset:bed@ab12cd34ef56', licence: 'CC0' } }, null],
  sample: [rec('moon-look', 'sample'),
    { tool: 'register_asset', args: { id: 'moon-look', type: 'audio', src: 'asset:moon-look@ab12cd34ef56', licence: 'own' } },
    { assets: ['moon-look'], code: "fromStore(['moon-look'])", take: "voice('moon-look', 0)" }],
  font: [rec('caveat', 'font', { licence: 'OFL', credit: 'Caveat by Impallari Type', family: 'Caveat' }),
    { tool: 'register_asset', args: { id: 'caveat', type: 'font', src: 'asset:caveat@ab12cd34ef56', family: 'Caveat', credit: 'Caveat by Impallari Type', licence: 'OFL' } },
    { cli: "hdf hand --font /shelves/house/blobs/caveat.ttf --name caveat --licence OFL --credit 'Caveat by Impallari Type'" }],
  hand: [rec('hershey-script', 'hand', { licence: 'PD' }), null, { assets: ['hershey-script'], code: "fromStore(['hershey-script'])", look: 'paperInk~hand:hershey-script' }],
  puppet: [rec('fox', 'puppet'), null, { assets: ['fox'], code: "fromStore(['fox'])", take: "actorOf(puppet('fox'))" }],
  clip: [rec('horse', 'clip', { licence: 'PD' }), null, { assets: ['horse'], code: "fromStore(['horse'])", take: "clipFromStore('horse')" }],
  motif: [rec('star', 'motif'), null, { assets: ['star'], code: "fromStore(['star'])", take: "fromStore(['star'])['star']" }],
};

test('every kind has a davidup type or none, and the fixture covers them all', () => {
  assert.deepEqual(Object.keys(DAVIDUP_TYPE).sort(), [...KINDS].sort());
  assert.deepEqual(Object.keys(EACH).sort(), [...KINDS].sort());
});

test('one record per kind gets its expected use', () => {
  for (const [kind, [record, davidup, hdf]] of Object.entries(EACH)) {
    const path = kind === 'font' ? '/shelves/house/blobs/caveat.ttf' : undefined;
    assert.deepEqual(useOf(record, { ...HERE, path }), { davidup, hdf }, kind);
  }
});

test('the davidup args are register_asset input: provenance copied, empty credit left out, sprite sheet kept', () => {
  const sheet = { frameWidth: 64, frameHeight: 64, columns: 4, count: 8, fps: 12, cycles: { walk: { start: 0, count: 8 } } };
  const { davidup } = useOf(rec('fox-walk', 'image', { sheet, credit: '' }));
  assert.deepEqual(davidup.args, { id: 'fox-walk', type: 'image', src: 'asset:fox-walk@ab12cd34ef56', sheet, licence: 'own' });
  assert.equal(assetSrc(rec('x', 'image', { sha: 'f'.repeat(40) })), 'asset:x@ffffffffffff', 'a legacy sha1 pins its own first 12 hex');
});

test('a puppet with a made sprite sheet offers the sheet; a model sheet is the fallback; nothing made is null', () => {
  const fox = rec('fox', 'puppet');
  const walk = rec('fox-walk', 'image', { sheet: { frameWidth: 8, frameHeight: 8, columns: 1, count: 1, fps: 12 }, made: { tool: 'hdf sprite', from: ['fox'] }, added: '2026-09-20' });
  const model = rec('fox-model', 'image', { made: { tool: 'hdf sheet', from: ['fox'] }, added: '2026-09-28' });
  const clipVideo = rec('fox-film', 'video', { made: { tool: 'hdf render', from: ['fox'] } });
  const { davidup } = useOf(fox, { made: [model, clipVideo, walk] });
  assert.deepEqual(davidup, {
    tool: 'register_asset', via: 'fox-walk', also: ['fox-model'],
    args: { id: 'fox-walk', type: 'image', src: 'asset:fox-walk@ab12cd34ef56', sheet: walk.sheet, licence: 'own' },
  });
  assert.equal(useOf(fox, { made: [model] }).davidup.via, 'fox-model');
  assert.equal(useOf(fox, { made: [clipVideo] }).davidup, null, 'a video made from a puppet is not the puppet as a sprite');
  assert.equal(useOf(fox).davidup, null);
  // A hand through the font exported from it; a motif through an image of it; a clip never.
  const ttf = rec('script-ttf', 'font', { family: 'Hershey Script', made: { tool: 'hdf hand --export-ttf', from: ['hershey-script'] } });
  assert.equal(useOf(rec('hershey-script', 'hand'), { made: [ttf] }).davidup.args.family, 'Hershey Script');
  assert.equal(useOf(rec('star', 'motif'), { made: [rec('star-png', 'image')] }).davidup.via, 'star-png');
  assert.equal(useOf(rec('horse', 'clip'), { made: [rec('horse-png', 'image')] }).davidup, null);
});

test('hdf reads a record off its own store with { from }', () => {
  const hdf = useOf(rec('paper-warm', 'stock'), { root: "/p/it's/assets", store: '/repo/handdrawn/assets' }).hdf;
  assert.deepEqual(hdf, {
    assets: [{ id: 'paper-warm', from: "/p/it's/assets" }],
    code: "fromStore(['paper-warm'], { from: '/p/it\\'s/assets' })",
    take: "fromStore(['paper-warm'], { from: '/p/it\\'s/assets' })['paper-warm']",
  });
  assert.equal(useOf(rec('caveat', 'font')).hdf, null, 'a font with no blob path has no command');
});

// A 4 x 4 PNG of one colour.
const png = (rgb) => {
  const data = new Uint8ClampedArray(64);
  for (let i = 0; i < 16; i++) data.set([...rgb, 255], i * 4);
  return encodePng({ data, width: 4, height: 4 });
};

test('lib.use and search hits carry the use block; a made sheet on another shelf is offered for a puppet', async () => {
  const user = mkdtempSync(join(tmpdir(), 'assetlib-use-')), project = mkdtempSync(join(tmpdir(), 'assetlib-use-'));
  try {
    const lib = openLibrary({ shelves: [{ name: 'project', root: project }, { name: 'user', root: user }] });
    const own = { tags: ['fox'], licence: 'own', credit: '', source: '' };
    const puppet = { units: 100, parts: { body: { d: [] } } };
    await lib.put('user', { ...own, id: 'fox', kind: 'puppet', name: 'Fox', box: [0, 0, 100, 100], units: 100 }, Buffer.from(JSON.stringify(puppet)));
    const sheet = { frameWidth: 4, frameHeight: 4, columns: 1, count: 1, fps: 12 };
    await lib.put('project', { ...own, id: 'fox-walk', kind: 'image', name: 'Fox walk', sheet, made: { tool: 'hdf sprite', from: ['fox'] } }, png([200, 90, 20]));
    assert.deepEqual(lib.made('fox').map((r) => [r.id, r.shelf]), [['fox-walk', 'project']]);
    const use = lib.use('fox');
    assert.equal(use.davidup.via, 'fox-walk');
    assert.equal(use.davidup.args.src, `asset:fox-walk@${lib.get('fox-walk').sha.slice(0, 12)}`);
    assert.deepEqual(use.hdf.assets, [{ id: 'fox', from: user }]);
    const hits = lib.search('fox').hits;
    assert.deepEqual(hits.map((h) => h.id), ['fox', 'fox-walk']);
    assert.deepEqual(hits[0].use, use);
    assert.deepEqual(hits[1].use.davidup.args, { id: 'fox-walk', type: 'image', src: use.davidup.args.src, sheet, licence: 'own' });
    assert.equal(hits[1].use.hdf, null, 'an image is not an hdf kind');
    // A write drops the made-from index with the rest.
    lib.remove('fox-walk');
    assert.equal(lib.use('fox').davidup, null);
  } finally {
    rmSync(user, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});

// The agent copies: on the house shelf, each hdf call runs in hdf as it is written.
test('the hdf calls for the house shelf run in hdf', async () => {
  const core = await import('../../handdrawn/core/index.js');
  const { fromStore } = await import('../../handdrawn/core/assets.js');
  const scope = { ...core, fromStore };
  const run = (expr) => new Function(...Object.keys(scope), `return (${expr});`)(...Object.values(scope));
  const lib = openLibrary({ shelves: [{ name: 'house', root: HOUSE_ROOT }] });
  for (const id of ['teapot', 'fox', 'horse', 'moon-look', 'test']) {
    const { hdf, davidup } = lib.use(id);
    assert.deepEqual(hdf.assets, [id], `${id} is read from hdf's own store`);
    assert.ok(run(hdf.code)[id], `${hdf.code} reads ${id}`);
    if (hdf.take) assert.ok(run(hdf.take), `${hdf.take} runs`);
    if (hdf.look) assert.equal(core.resolveLook(hdf.look).name, hdf.look);
    if (davidup) assert.equal(davidup.args.src, `asset:${id}@${lib.get(id).sha.slice(0, 12)}`);
  }
  assert.equal(lib.use('teapot').davidup.args.licence, 'CC0');
  assert.equal(lib.use('fox').davidup, null, 'the house fox has no made sheet yet (I2)');

  // Off hdf's store, the { from } form reads it.
  const user = mkdtempSync(join(tmpdir(), 'assetlib-use-'));
  try {
    const mine = openLibrary({ shelves: [{ name: 'user', root: user }] });
    await mine.put('user', { id: 'paper-warm', kind: 'stock', name: 'Warm paper', tags: [], licence: 'own', credit: '', source: '', box: [0, 0, 4, 4] }, png([234, 220, 192]));
    const { hdf } = mine.use('paper-warm');
    assert.deepEqual(run(hdf.take), { name: 'paper-warm', credit: '', source: '', licence: 'own', w: 4, h: 4, src: mine.resolve('paper-warm') });
  } finally {
    rmSync(user, { recursive: true, force: true });
  }
});
