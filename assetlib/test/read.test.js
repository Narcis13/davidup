// A1: read a shelf, open a library of shelves (asset-library plan §5 A1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOUSE_ROOT, KINDS, LICENCES, MEDIA, SHA256, isLegacySha, mediaOf, openLibrary, readShelf, sha, standardShelves, validate } from '../index.js';
import * as hdf from '../../handdrawn/core/assets.js';

const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const PROJECT = { name: 'project', root: join(FIX, 'project') };
const USER = { name: 'user', root: join(FIX, 'user') };
const HOUSE = { name: 'house', root: HOUSE_ROOT };
const FOX_SHA = 'cd7cd0d997478908af7d5f39aa4ea101fa526acc5ae70afb97714c4bd4f43b53';
const LOGO_SHA = '9985af57998c468939014af42a464d22a75e9204c7616e449fb1b733b1759612';

test('the house shelf is hdf\'s store, read unchanged', () => {
  const house = readShelf(HOUSE_ROOT, { name: 'house' });
  const raw = JSON.parse(readFileSync(join(HOUSE_ROOT, 'catalogue.json'), 'utf8'));
  assert.equal(house.name, 'house');
  assert.deepEqual(house.ids, Object.keys(raw).sort());
  assert.deepEqual(house.entry('teapot'), raw.teapot);
  assert.equal(house.blobPath('teapot'), hdf.readCatalogue().payloadPath('teapot'));
  assert.equal(house.thumbPath('teapot'), join(HOUSE_ROOT, 'thumbs', `${raw.teapot.sha}.png`));
  assert.ok(SHA256.test(raw.teapot.sha) && !isLegacySha(raw.teapot.sha), 'the house shelf is sha256 since H1');
  assert.deepEqual(house.orphans(), hdf.readCatalogue().orphans());
});

test('every house entry validates, and assetlib agrees with hdf on the kinds and licences they share', () => {
  const house = readShelf(HOUSE_ROOT);
  for (const id of house.ids) assert.deepEqual(validate(id, house.entry(id)), [], id);
  for (const k of hdf.KINDS) assert.ok(KINDS.includes(k), k);
  assert.deepEqual([...LICENCES], hdf.LICENCES);
});

test('kinds: eleven, each with one media', () => {
  assert.equal(KINDS.length, 11);
  assert.deepEqual(Object.fromEntries(KINDS.map((k) => [k, mediaOf(k)])), {
    image: 'raster', video: 'video', audio: 'audio', font: 'font',
    cutout: 'raster', clip: 'data', puppet: 'data', hand: 'data', stock: 'raster', motif: 'vector', sample: 'audio',
  });
  assert.deepEqual(new Set(KINDS.map(mediaOf)), new Set(MEDIA));
  assert.throws(() => mediaOf('sprite'), /kind 'sprite': expected image \| video/);
});

test('validate: the four davidup kinds, and what it refuses', () => {
  const base = { name: 'x', licence: 'CC0', credit: '', source: '', tags: [], sha: FOX_SHA };
  assert.deepEqual(validate('clip-1', { ...base, kind: 'video', ext: 'mp4', sec: 4, fps: 30, w: 1920, h: 1080, codec: 'h264', audio: true }), []);
  assert.deepEqual(validate('boom', { ...base, kind: 'audio', ext: 'mp3' }), []);
  assert.deepEqual(validate('inter', { ...base, kind: 'font', ext: 'woff2', family: 'Inter', weight: 700 }), []);
  assert.deepEqual(validate('logo', { ...base, kind: 'image', ext: 'svg' }), []);

  assert.deepEqual(validate('inter', { ...base, kind: 'font', ext: 'ttf' }), ['family: missing (the family name a composition asks for)']);
  assert.deepEqual(validate('Fox', { ...base, kind: 'image', ext: 'png' }), ["id 'Fox': lower-case letters, digits and dashes (a pack cel's mirror: pack:<cel>)"]);
  assert.deepEqual(validate('a', { ...base, kind: 'image', ext: 'mp4', media: 'video' }), ["media 'video': a image is raster", "ext 'mp4': a image payload is png, jpg, webp, gif, svg"]);
  assert.deepEqual(validate('a', { ...base, kind: 'audio', ext: 'wav', licence: 'MIT', sha: 'abc' }), ['sha: 64 hex (sha256) over the payload bytes', "licence 'MIT': expected CC0 | CC-BY | CC-BY-SA | OFL | PD | own | unknown"]);
  assert.deepEqual(validate('a', { ...base, kind: 'sprite' }), ["kind 'sprite': expected image | video | audio | font | cutout | clip | puppet | hand | stock | motif | sample"]);
  assert.deepEqual(validate('a', { ...base, kind: 'image', ext: 'png', made: { from: ['b'] } }), ['made: { tool, from: [ids], args, at }']);

  // A host that knows a field's exact shape passes its own check.
  const strict = { sample: { align: { opt: true, why: 'hdf word timing', ok: () => false } } };
  const voice = { ...base, kind: 'sample', ext: 'wav', align: { text: 'hi', by: 'json', words: [] } };
  assert.deepEqual(validate('v', voice), []);
  assert.deepEqual(validate('v', voice, { fields: strict }), ['align: hdf word timing']);
});

test('a fixture project shelf: blobs named by sha256, one orphan, a missing shelf reads empty', () => {
  const project = readShelf(PROJECT.root, { name: 'project' });
  assert.deepEqual(project.ids, ['fox', 'logo']);
  assert.equal(sha(readFileSync(project.blobPath('fox'))), FOX_SHA);
  for (const id of project.ids) assert.deepEqual(validate(id, project.entry(id)), [], id);
  assert.deepEqual(project.orphans().map((p) => p.slice(-68)), ['43739c566e26fd7cb88f69d3864ea34740372f5ee99acac169e090beffbce5c6.png']);
  assert.throws(() => project.entry('teapot'), /no asset 'teapot' on shelf project \(.*fixtures\/project; has fox, logo\)/);

  const none = readShelf(join(FIX, 'no-such-shelf'));
  assert.equal(none.name, 'no-such-shelf');
  assert.deepEqual(none.ids, []);
  assert.deepEqual(none.orphans(), []);
});

test('openLibrary: get(\'teapot\') is the hdf entry', () => {
  const lib = openLibrary({ shelves: [PROJECT, USER, HOUSE] });
  const { id, media, shelf, shadowed, ...entry } = lib.get('teapot');
  assert.deepEqual(entry, hdf.readCatalogue().entry('teapot'));
  assert.deepEqual({ id, media, shelf, shadowed }, { id: 'teapot', media: 'raster', shelf: 'house', shadowed: [] });
  assert.equal(lib.resolve('teapot'), hdf.readCatalogue().payloadPath('teapot'));
});

test('openLibrary: the earlier shelf wins and the record names the shelves it shadows', () => {
  const lib = openLibrary({ shelves: [PROJECT, USER, HOUSE] });
  // The project's fox (an image) shadows the house fox (a puppet).
  const fox = lib.locate('fox');
  assert.equal(fox.shelf, 'project');
  assert.deepEqual(fox.shadowed, ['house']);
  assert.equal(fox.entry.kind, 'image');
  assert.equal(fox.path, join(PROJECT.root, 'blobs', `${FOX_SHA}.png`));
  assert.equal(fox.thumb, join(PROJECT.root, 'thumbs', `${FOX_SHA}.png`));
  assert.equal(lib.get('fox').kind, 'image');
  assert.equal(lib.shelf('house').entry('fox').kind, 'puppet');
  // The logo is on the project and the user shelf.
  assert.deepEqual(lib.get('logo').shadowed, ['user']);
  // In the other order the house fox wins.
  assert.deepEqual(openLibrary({ shelves: [HOUSE, PROJECT] }).locate('fox').shelf, 'house');
  assert.ok(lib.ids.includes('studio-logo') && lib.ids.includes('fox') && lib.ids.includes('teapot'));
  assert.deepEqual(lib.ids, [...lib.ids].sort());
});

test('openLibrary: an unknown id errors naming the shelves searched', () => {
  const lib = openLibrary({ shelves: [PROJECT, USER, HOUSE] });
  assert.equal(lib.has('unicorn'), false);
  assert.throws(() => lib.get('unicorn'),
    (err) => /^no asset 'unicorn' on shelves project \(.*fixtures\/project\), user \(.*fixtures\/user\), house \(.*handdrawn\/assets\)$/.test(err.message));
  assert.throws(() => lib.shelf('attic'), /no shelf 'attic' \(shelves: project, user, house\)/);
  assert.throws(() => openLibrary({ shelves: [PROJECT, { name: 'project', root: USER.root }] }), /shelf 'project' is named twice/);
});

test('openLibrary: sha:<hex> names the bytes, on any shelf', () => {
  const lib = openLibrary({ shelves: [PROJECT, USER, HOUSE] });
  assert.equal(lib.has(`sha:${FOX_SHA.slice(0, 12)}`), true);
  assert.equal(lib.resolve(`sha:${FOX_SHA.slice(0, 12)}`), lib.resolve('fox'));
  const logo = lib.locate(`sha:${LOGO_SHA.slice(0, 16)}`);
  assert.deepEqual([logo.shelf, logo.id], ['project', 'logo']);
  assert.deepEqual(lib.holders(LOGO_SHA.slice(0, 12)), [{ shelf: 'project', id: 'logo' }, { shelf: 'user', id: 'logo' }, { shelf: 'user', id: 'studio-logo' }]);
  const teapotSha = hdf.readCatalogue().entry('teapot').sha;
  assert.equal(lib.get(`sha:${teapotSha.slice(0, 12)}`).id, 'teapot');
  assert.throws(() => lib.locate('sha:000000000000'), /no asset with sha 000000000000 on shelves project/);
  assert.equal(lib.has('sha:0000'), false, 'a prefix under 12 hex is not a sha ref');
});

test('standardShelves: project, user, house, with the env overrides', () => {
  assert.deepEqual(standardShelves({ env: {}, home: '/h' }), [
    { name: 'user', root: '/h/.davidup/assets' },
    { name: 'house', root: HOUSE_ROOT },
  ]);
  assert.deepEqual(standardShelves({ project: '/p/film', env: { DAVIDUP_ASSETS: '/pool', DAVIDUP_HOUSE: '/repo/assets' }, home: '/h' }), [
    { name: 'project', root: '/p/film/assets' },
    { name: 'user', root: '/pool' },
    { name: 'house', root: '/repo/assets' },
  ]);
});
