import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { KINDS, LICENCES, fromStore, readCatalogue, recordOf, sha, validate, validatePayload } from '../core/assets.js';
import { record, stored } from '../core/store.js';

// The CLI in a child process, as test/cli.test.js runs it.
const hdf = (...argv) => { const r = spawnSync(process.execPath, ['cli/hdf.mjs', ...argv], { encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };
const tmp = () => mkdtempSync(join(tmpdir(), 'hdf-assets-'));

// A 2x2 png: one red row, one blue pixel, one transparent pixel. Inline, so the fixture never moves.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAACXBIWXMAAAsSAAALEgHS3X78AAAAAXNS'
  + 'R0IArs4c6QAAAARzQklUCAgICHwIZIgAAAAaSURBVAiZYzzhbv+fgYGBgcG+/uJ/BgYGBgAy0QTdOsbKxQAAAABJRU5ErkJggg==', 'base64');

const SIL = { sub: [{ pts: [0, 0, 8, 0, 8, 8, 0, 8], closed: true }], box: [0, 0, 8, 8] };
const CUTOUT = {
  kind: 'cutout', name: 'teapot', sha: 'a'.repeat(40), ext: 'webp', file: 'teapot.png', tags: ['pot'],
  credit: 'The Met', source: 'https://example.org', licence: 'CC0',
  box: [0, 0, 8, 8], w: 8, h: 8, sil: SIL, colours: [{ hex: '#c8473f', area: 0.6 }],
};
const PUPPET = {
  units: 300, box: [-120, -300, 240, 310], ground: [0, 0],
  parts: {
    body: { pivot: [0, -120], ops: [] },
    head: { parent: 'body', pivot: [0, -230], ops: [] },
    eye: { parent: 'head', variants: { open: [], happy: [] } },
  },
  inputs: { eye: ['open', 'happy'] }, poses: { rest: {} },
};
const CLIP = { n: 2, fps: 12, h: 100, frames: [{ outer: { sub: [{ pts: [0, 0, 10, 0, 10, -100], closed: true }], box: [0, -100, 10, 100] } }, { outer: { sub: [{ pts: [2, 0, 12, 0, 12, -90], closed: true }], box: [2, -90, 10, 90] } }] };
const HAND = { glyphs: { a: { w: 44, s: [[[0, 0], [40, 0]]] } }, track: 6 };

test('every kind has a schema and a licence list that is closed', () => {
  assert.deepEqual(KINDS, ['cutout', 'clip', 'puppet', 'hand', 'stock', 'motif', 'sample']);
  assert.deepEqual(LICENCES, ['CC0', 'CC-BY', 'CC-BY-SA', 'PD', 'own', 'unknown']);
  assert.equal(sha('hello').length, 40);
  assert.equal(sha(Buffer.from('hello')), sha('hello'));
});

test('the validators accept the fixtures and refuse a bad licence and a missing box', () => {
  assert.deepEqual(validate('teapot', CUTOUT), []);
  assert.deepEqual(validate('teapot', { ...CUTOUT, licence: 'CC-NC' }), [`licence 'CC-NC': expected ${LICENCES.join(' | ')}`]);
  assert.deepEqual(validate('teapot', { ...CUTOUT, box: undefined }), ["box: [x, y, w, h] in the asset's own units"]);
  assert.match(validate('teapot', { ...CUTOUT, sil: undefined })[0], /^sil: missing/);
  assert.match(validate('teapot', { ...CUTOUT, w: 0 })[0], /^w: an integer > 0/);
  assert.match(validate('teapot', { ...CUTOUT, kind: 'sketch' })[0], /^kind 'sketch'/);
  assert.match(validate('tea pot', CUTOUT)[0], /^id 'tea pot'/);
  assert.match(validate('teapot', { ...CUTOUT, sha: 'abc' })[0], /^sha: 40 hex/);
  assert.match(validate('teapot', { ...CUTOUT, ext: 'json' })[0], /^ext 'json'/);
  // `colours` is the one optional cutout field: a module written before S1 still imports.
  assert.deepEqual(validate('teapot', { ...CUTOUT, colours: undefined }), []);
});

test('payload validators read the shapes of plan 1.2, 1.4 and the clip format', () => {
  assert.deepEqual(validatePayload('puppet', PUPPET), []);
  assert.deepEqual(validatePayload('clip', CLIP), []);
  assert.deepEqual(validatePayload('hand', HAND), []);
  assert.deepEqual(validatePayload('motif', [{ op: 'fill' }]), []);
  assert.deepEqual(validatePayload('puppet', { ...PUPPET, parts: { ...PUPPET.parts, tail: { parent: 'nose', ops: [] } } }), ["parts.tail.parent: no part 'nose'"]);
  assert.deepEqual(validatePayload('puppet', { ...PUPPET, parts: { body: { pivot: [0] } } }), ['parts.body: needs ops or variants', 'parts.body.pivot: [x, y]']);
  assert.deepEqual(validatePayload('clip', { ...CLIP, n: 3 }), ['frames: 2 of them, n says 3']);
  assert.deepEqual(validatePayload('hand', { glyphs: { a: { w: 44, s: [] } } }), ['glyphs.a.s: strokes, each [[x, y], ...]']);
  assert.deepEqual(validatePayload('motif', []), ['motif: a non-empty serialised op list']);
});

test('import: the payload lands in the store, the entry is the truth, and it is idempotent', async () => {
  const dir = tmp();
  try {
    const png = join(dir, 'some.png'), puppet = join(dir, 'fox.puppet.json'), root = join(dir, 'store');
    writeFileSync(png, PNG);
    writeFileSync(puppet, JSON.stringify(PUPPET));

    const first = hdf('import', png, '--kind', 'cutout', '--name', 'x', '--root', root, '--licence', 'CC0', '--tags', 'test,tiny');
    assert.equal(first.code, 0, first.out);
    assert.match(first.out, /^x +cutout +[0-9a-f]{40}\.png +CC0 +\(new\)$/m);

    const st = readCatalogue(root), e = st.entry('x');
    assert.equal(e.sha, sha(PNG));
    assert.deepEqual([e.kind, e.ext, e.w, e.h, e.licence, e.file], ['cutout', 'png', 2, 2, 'CC0', 'some.png']);
    assert.deepEqual(e.tags, ['test', 'tiny']);
    assert.deepEqual(validate('x', e), []);
    assert.ok(existsSync(st.payloadPath(e)));
    assert.deepEqual(readFileSync(st.payloadPath(e)), PNG, 'the blob is the bytes that came in');

    // The same bytes under a second name: one blob, two entries. The catalogue is stable byte for byte.
    const before = readFileSync(st.file, 'utf8');
    assert.equal(hdf('import', png, '--kind', 'cutout', '--name', 'x', '--root', root, '--licence', 'CC0', '--tags', 'test,tiny').code, 0);
    assert.equal(readFileSync(st.file, 'utf8'), before, 'importing the same file twice changes nothing');
    assert.equal(hdf('import', png, '--kind', 'cutout', '--name', 'y', '--root', root, '--licence', 'CC0').code, 0);
    assert.deepEqual(readdirSync(join(root, 'blobs')), [`${sha(PNG)}.png`]);
    assert.equal(readCatalogue(root).entry('y').sha, sha(PNG));

    // A data kind is validated before it is written, and its payload comes back as it went in.
    assert.equal(hdf('import', puppet, '--kind', 'puppet', '--name', 'fox', '--root', root, '--licence', 'own').code, 0);
    const st2 = readCatalogue(root);
    assert.deepEqual([st2.entry('fox').ext, st2.entry('fox').units, st2.entry('fox').box], ['json', 300, [-120, -300, 240, 310]]);
    assert.deepEqual(st2.json('fox'), PUPPET);
    assert.deepEqual(recordOf(st2, 'fox'), { name: 'fox', credit: '', source: '', licence: 'own', ...PUPPET });
    assert.equal(recordOf(st2, 'x').src, st2.payloadPath(st2.entry('x')));
    assert.deepEqual(recordOf(st2, 'x').sil.box, st2.entry('x').sil.box);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('import refuses an unknown kind, an unknown licence and a payload that fails its schema', async () => {
  const dir = tmp();
  try {
    const root = join(dir, 'store'), bad = join(dir, 'bad.json'), png = join(dir, 'some.png');
    writeFileSync(png, PNG);
    writeFileSync(bad, JSON.stringify({ ...PUPPET, parts: {} }));
    assert.match(hdf('import', png, '--kind', 'sketch', '--name', 'x', '--root', root).out, /--kind sketch \(expected cutout \| clip/);
    assert.match(hdf('import', png, '--kind', 'cutout', '--name', 'x', '--root', root, '--licence', 'CC-NC').out, /--licence CC-NC/);
    assert.match(hdf('import', bad, '--kind', 'puppet', '--name', 'fox', '--root', root).out, /not a valid puppet[\s\S]*parts: a non-empty object/);
    assert.match(hdf('import', png, '--kind', 'puppet', '--name', 'fox', '--root', root).out, /is not JSON/);
    assert.match(hdf('import', bad, '--kind', 'cutout', '--name', 'x', '--root', root).out, /must be a webp, png or jpeg/);
    assert.equal(existsSync(join(root, 'blobs')), false, 'nothing is written when validation fails');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('import --v2: a 2.0 data module becomes entries, and the records come back unchanged', async () => {
  const dir = tmp();
  try {
    const root = join(dir, 'store'), mod = join(dir, 'photos.js');
    const rec = { name: 'dot', credit: 'a test', source: 'https://example.org', src: `data:image/png;base64,${PNG.toString('base64')}`, w: 2, h: 2, sil: SIL, colours: [{ hex: '#c8473f', area: 0.6 }] };
    const clip = { n: 2, fps: 12, h: 100, credit: 'Muybridge', source: '', frames: CLIP.frames };
    writeFileSync(mod, `export default ${JSON.stringify({ dot: rec, trot: clip })};\n`);

    const r = hdf('import', '--v2', mod, '--root', root, '--licence', 'CC0', '--tags', 'test');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^dot +cutout +[0-9a-f]{40}\.png +CC0 +\d+ KB +\(new\)$/m);
    assert.match(r.out, /^ {2}assets: \['dot', 'trot'\],$/m);

    const st = readCatalogue(root);
    assert.deepEqual(readFileSync(st.payloadPath(st.entry('dot'))), PNG, 'the cutout keeps the bytes the module carried');
    assert.deepEqual(validate('dot', st.entry('dot')), []);
    // What a film sees is what the module gave it: the silhouette, the colours and the provenance, plus the licence.
    const got = recordOf(st, 'dot');
    assert.deepEqual([got.w, got.h, got.credit, got.source, got.licence], [2, 2, 'a test', 'https://example.org', 'CC0']);
    assert.deepEqual(got.colours, rec.colours);
    assert.deepEqual(got.sil.sub, SIL.sub);
    // A clip's payload is its poses; its credit moved to the entry, where `hdf find` can read it.
    assert.deepEqual(st.json('trot'), { n: 2, fps: 12, h: 100, frames: CLIP.frames });
    assert.deepEqual([st.entry('trot').credit, st.entry('trot').n, st.entry('trot').ext], ['Muybridge', 2, 'json']);

    // fromStore reads them by id and leaves them in the registry, which is what clipFromStore reads.
    const all = fromStore(['dot', 'trot'], { from: root });
    assert.deepEqual(Object.keys(all), ['dot', 'trot']);
    assert.equal(record('trot').frames.length, 2);
    assert.ok(stored().includes('dot'));

    assert.match(hdf('import', '--v2', mod, '--root', root).out, /unchanged/, 'the same module twice writes one blob');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('find: every word must match; --kind narrows; an empty store says so', async () => {
  const dir = tmp();
  try {
    const root = join(dir, 'store'), png = join(dir, 'some.png'), puppet = join(dir, 'fox.puppet.json');
    writeFileSync(png, PNG);
    writeFileSync(puppet, JSON.stringify(PUPPET));
    const missing = hdf('find', 'fox', '--root', join(dir, 'empty'));
    assert.equal(missing.code, 1);
    assert.match(missing.out, /no asset in .* matches fox/);

    hdf('import', png, '--kind', 'cutout', '--name', 'teapot', '--root', root, '--licence', 'CC0', '--credit', 'The Met', '--tags', 'kitchen');
    hdf('import', puppet, '--kind', 'puppet', '--name', 'fox', '--root', root, '--licence', 'own', '--tags', 'cast');

    const all = hdf('find', '--kind', 'puppet', '--root', root);
    assert.equal(all.code, 0);
    assert.match(all.out, /^fox +puppet +own +units 300, 3 parts \(body head eye\), inputs eye:open\|happy, poses rest$/m);
    assert.match(all.out, /^1 of 2 in /m);
    assert.match(hdf('find', 'met', 'kitchen', '--root', root).out, /^teapot +cutout +CC0 +2x2 px/m);
    assert.match(hdf('find', 'met', 'kitchen', '--root', root).out, /^ +The Met$/m);
    assert.equal(hdf('find', 'teapot', '--kind', 'puppet', '--root', root).code, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a film may name its assets by id, in the package store or one beside it', async () => {
  const dir = tmp();
  try {
    const root = join(dir, 'store'), png = join(dir, 'some.png');
    writeFileSync(png, PNG);
    assert.equal(hdf('import', png, '--kind', 'cutout', '--name', 'blob', '--root', root, '--licence', 'CC0').code, 0);
    const core = new URL('../core/index.js', import.meta.url).href;
    writeFileSync(join(dir, 'byid.js'), `
      import { film, cel, shot, paper, fill, circle, photo, pin } from ${JSON.stringify(core)};
      import { PHOTOS } from './by.js';
      const ball = cel('ball', () => [fill(circle(0, 0, 90), 'fills.0'), photo(pin(PHOTOS.blob, { x: 0, y: 0, h: 200 }), { shadow: 0 })], { box: [-100, -100, 200, 200] });
      export default film({ name: 'byid', look: 'doodlePastel', timeline: shot('one', 1, ({ CX, CY }) => [paper(), ball({})]), assets: [{ id: 'blob', from: 'store' }] });
    `);
    // The film reads the same records the loader resolved (what S3 rewrites the three big modules to).
    writeFileSync(join(dir, 'by.js'), `
      import { readCatalogue, recordOf } from ${JSON.stringify(new URL('../core/assets.js', import.meta.url).href)};
      const st = readCatalogue(new URL('./store', import.meta.url).pathname);
      export const PHOTOS = { blob: recordOf(st, 'blob') };
    `);
    const { loadFilm, assetsOf, imagesOf } = await import('../cli/load.mjs');
    const f = await loadFilm(join(dir, 'byid.js'));
    assert.deepEqual(Object.keys(assetsOf(f)), ['blob']);
    assert.equal(assetsOf(f).blob.w, 2);
    assert.equal(imagesOf(f).get('blob').width, 2, 'the blob was decoded like any other image asset');
    assert.equal(hdf('only', join(dir, 'byid.js'), '0', '--out', join(dir, 'out')).code, 0);
    assert.ok(existsSync(join(dir, 'out', 'byid-000.png')), 'a store-backed film renders through the CLI');

    // An id the store lacks names the film and the store.
    writeFileSync(join(dir, 'gone.js'), readFileSync(join(dir, 'byid.js'), 'utf8').replace("{ id: 'blob', from: 'store' }", "{ id: 'ghost', from: 'store' }"));
    await assert.rejects(loadFilm(join(dir, 'gone.js')), /film byid: no asset 'ghost'.*has blob/s);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
