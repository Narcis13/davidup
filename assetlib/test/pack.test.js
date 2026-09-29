// I3: packs as tarballs (asset-library plan §9 I3): export a catalogue slice with its blobs and thumbs, import it
// onto another shelf merged by sha. Done when a round trip between two temp shelves is byte-identical and a
// conflicting id with other bytes is reported, not overwritten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { main } from '../cli.js';
import { PACK_VERSION, encodePng, exportPack, importPack, openLibrary, readPack, readShelf, readTar, sha, writeTar } from '../index.js';

const png = (w, h, [r, g, b, a = 255]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([r, g, b, a], i * 4);
  return encodePng({ data, width: w, height: h });
};
const wav = (sec, rate = 8000) => {
  const n = Math.round(sec * rate) * 2, b = Buffer.alloc(44 + n);
  b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8, 'latin1');
  b.write('fmt ', 12, 'latin1'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'latin1'); b.writeUInt32LE(n, 40);
  return b;
};

const RED = png(6, 4, [200, 40, 40]), BLUE = png(4, 4, [30, 60, 200]), GREEN = png(4, 4, [40, 200, 40]);
const base = { licence: 'own', credit: '', source: '', tags: ['test'] };

// Temp shelves project / user / house under one dir, and the library over them.
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'assetlib-pack-'));
  const shelves = ['project', 'user', 'house'].map((name) => ({ name, root: join(dir, name) }));
  const lib = () => openLibrary({ shelves, thumbCache: join(dir, 'cache') });
  const shelf = (name) => readShelf(join(dir, name), { name });
  return { dir, lib, shelf, done: () => rmSync(dir, { recursive: true, force: true }) };
}

// Every file under a directory, as { relative path: bytes }.
const tree = (root) => Object.fromEntries(readdirSync(root, { recursive: true }).map(String).sort()
  .filter((f) => statSync(join(root, f)).isFile()).map((f) => [f, readFileSync(join(root, f))]));

// A shelf with a raster (and its thumb), a second id on the same bytes, a CC-BY sample with credit, and a made
// record, written the way the library writes them.
function fill(s) {
  s.put({ id: 'red', kind: 'image', name: 'Red', desc: 'a red field', ...base }, RED, { by: 'test' });
  s.put({ id: 'red-too', kind: 'image', name: 'Red again', ...base }, RED, { by: 'test' });
  s.put({ id: 'hum', kind: 'sample', name: 'Hum', ...base, licence: 'CC-BY', credit: 'A. Person', source: 'https://example.org/hum' }, wav(0.25), { facts: { sec: 0.25 } });
  s.put({ id: 'blue-sprite', kind: 'image', name: 'Blue sprite', ...base, made: { tool: 'hdf sprite', from: ['red'], args: { states: 'idle' }, at: '2026-09-29T10:00:00.000Z', version: 1 } }, BLUE);
  mkdirSync(join(s.root, 'thumbs'), { recursive: true });
  writeFileSync(s.thumbPath('red'), png(3, 2, [1, 2, 3]));
  writeFileSync(s.thumbPath('hum'), png(3, 2, [4, 5, 6]));
}

test('tar: writeTar and readTar round-trip, deterministically; a non-tar is refused', () => {
  const files = [{ name: 'a.txt', bytes: Buffer.from('hello') }, { name: 'blobs/b.bin', bytes: Buffer.alloc(1025, 7) }, { name: 'empty', bytes: Buffer.alloc(0) }];
  const tar = writeTar(files);
  assert.equal(tar.length % 512, 0);
  assert.deepEqual(writeTar(files), tar, 'the same files give the same archive');
  const back = readTar(tar);
  assert.deepEqual([...back.keys()], ['a.txt', 'blobs/b.bin', 'empty']);
  for (const f of files) assert.deepEqual(back.get(f.name), f.bytes);
  assert.deepEqual(readTar(gzipSync(tar)), back, 'gzipped reads the same');
  assert.throws(() => readTar(Buffer.alloc(1024, 1)), /not a tar archive/);
});

test('export then import: two temp shelves end byte-identical, and the pack of the copy is the same pack', () => {
  const t = setup();
  try {
    fill(t.shelf('user'));
    const a = exportPack(t.lib(), [], { shelf: 'user' });
    assert.deepEqual(a.ids, ['blue-sprite', 'hum', 'red', 'red-too']);
    assert.equal(a.blobs, 3, 'the shared bytes travel once');
    assert.equal(a.thumbs, 2);
    assert.deepEqual(a.warnings, [], 'blue-sprite was made from red, which is in the pack');

    const out = importPack(t.lib(), a.tgz, { shelf: 'project' });
    assert.deepEqual({ shelf: out.shelf, added: out.added, same: out.same, kept: out.kept, conflicts: out.conflicts }, { shelf: 'project', added: 4, same: 0, kept: 0, conflicts: 0 });
    assert.deepEqual(tree(join(t.dir, 'project')), tree(join(t.dir, 'user')), 'catalogue, blobs and thumbs byte for byte');
    // Provenance came across as it was: licence, credit, source, made, added, by.
    assert.deepEqual(t.shelf('project').entry('hum'), t.shelf('user').entry('hum'));
    assert.equal(t.shelf('project').entry('hum').credit, 'A. Person');
    assert.deepEqual(t.shelf('project').entry('blue-sprite').made, t.shelf('user').entry('blue-sprite').made);

    const b = exportPack(t.lib(), [], { shelf: 'project' });
    assert.deepEqual(b.tgz, a.tgz, 'exporting the copy gives the same bytes');
    // The records the project now shadows on the user's pool.
    assert.deepEqual(out.results.find((r) => r.id === 'red'), { id: 'red', kind: 'image', sha: sha(RED), blob: 'new', thumb: true, status: 'added', shadowedBy: null, shadows: ['user'] });
    assert.equal(out.results.find((r) => r.id === 'red-too').blob, 'had', 'the second id on the same bytes found its blob there');
  } finally { t.done(); }
});

test('a conflicting id with other bytes is reported, not overwritten; the rest of the pack comes in', () => {
  const t = setup();
  try {
    fill(t.shelf('user'));
    const { tgz } = exportPack(t.lib(), ['red', 'hum']);
    t.shelf('house').put({ id: 'red', kind: 'image', name: 'Green, called red', ...base }, GREEN);
    const before = tree(join(t.dir, 'house'));

    const dry = importPack(t.lib(), tgz, { shelf: 'house', dry: true });
    assert.deepEqual(tree(join(t.dir, 'house')), before, 'a dry run writes nothing');
    const out = importPack(t.lib(), tgz, { shelf: 'house' });
    assert.deepEqual(out.results.map((r) => r.status), dry.results.map((r) => r.status));
    const red = out.results.find((r) => r.id === 'red');
    assert.deepEqual({ status: red.status, ours: red.ours, sha: red.sha }, { status: 'conflict', ours: sha(GREEN), sha: sha(RED) });
    assert.equal(out.conflicts, 1);
    assert.equal(out.added, 1);
    const house = t.shelf('house');
    assert.equal(house.entry('red').sha, sha(GREEN), 'the shelf keeps its own red');
    assert.equal(existsSync(join(house.root, 'blobs', `${sha(RED)}.png`)), false, 'the conflicting blob is not written');
    assert.equal(house.entry('hum').credit, 'A. Person');
    assert.equal(out.results.find((r) => r.id === 'hum').shadowedBy, 'user', 'house hum is shadowed by the user pool');
  } finally { t.done(); }
});

test('same bytes: an identical record is same, a different one kept as the shelf has it; a missing thumb is filled', () => {
  const t = setup();
  try {
    fill(t.shelf('user'));
    const { tgz } = exportPack(t.lib(), ['red', 'hum'], { shelf: 'user' });
    const p = t.shelf('project');
    p.put({ id: 'red', kind: 'image', name: 'Red', desc: 'my own words', ...base }, RED);
    p.place('hum', t.shelf('user').entry('hum'), wav(0.25));
    const out = importPack(t.lib(), tgz, { shelf: 'project' });
    const by = Object.fromEntries(out.results.map((r) => [r.id, r]));
    assert.equal(by.hum.status, 'same');
    assert.equal(by.red.status, 'kept');
    assert.deepEqual(by.red.differs.sort(), ['by', 'desc'], "the pack's red came in by 'test' with another desc");
    assert.equal(t.shelf('project').entry('red').desc, 'my own words');
    assert.equal(by.red.thumb, true);
    assert.deepEqual(readFileSync(t.shelf('project').thumbPath('red')), readFileSync(t.shelf('user').thumbPath('red')));
  } finally { t.done(); }
});

test('a damaged pack writes nothing; a record that cannot travel is refused at export', () => {
  const t = setup();
  try {
    fill(t.shelf('user'));
    const files = readTar(exportPack(t.lib(), ['red', 'hum']).tgz);
    const blob = `blobs/${sha(RED)}.png`;
    const bad = writeTar([...files].map(([name, bytes]) => ({ name, bytes: name === blob ? Buffer.concat([bytes, Buffer.from('x')]) : bytes })));
    assert.throws(() => importPack(t.lib(), bad, { shelf: 'project' }), /damaged; nothing was imported[\s\S]*'red'/);
    const gone = writeTar([...files].filter(([name]) => name !== blob).map(([name, bytes]) => ({ name, bytes })));
    assert.throws(() => importPack(t.lib(), gone, { shelf: 'project' }), /'red': blobs\/.* is not in the pack/);
    assert.equal(existsSync(join(t.dir, 'project')), false, 'the project shelf was never touched');

    const newer = writeTar([{ name: 'pack.json', bytes: Buffer.from(JSON.stringify({ pack: 'assetlib', version: PACK_VERSION + 1 })) }, ...[...files].filter(([n]) => n !== 'pack.json').map(([name, bytes]) => ({ name, bytes }))]);
    assert.throws(() => readPack(newer), /this assetlib reads version 1/);
    assert.throws(() => readPack(writeTar([{ name: 'x', bytes: Buffer.from('y') }])), /no catalogue.json/);

    rmSync(t.shelf('user').blobPath('hum'));
    assert.throws(() => exportPack(t.lib(), ['hum', 'red']), /cannot pack a record:\n {2}'hum' on user: blob .* is missing/);
    const legacy = t.shelf('house');
    legacy.entries.set('old', { kind: 'image', name: 'Old', ...base, sha: 'a'.repeat(40), ext: 'png' });
    legacy.save();
    assert.throws(() => exportPack(t.lib(), [], { shelf: 'house' }), /sha1 entry \(asset migrate --sha256 house first\)/);
    assert.throws(() => exportPack(t.lib(), []), /name the ids to pack, or a shelf/);
  } finally { t.done(); }
});

test('export warns about what a record was made from that the pack does not carry, and takes sha: refs', () => {
  const t = setup();
  try {
    fill(t.shelf('user'));
    const out = exportPack(t.lib(), [`sha:${sha(BLUE).slice(0, 12)}`]);
    assert.deepEqual(out.ids, ['blue-sprite']);
    assert.match(out.warnings[0], /'blue-sprite' was made from 'red', not in the pack/);
  } finally { t.done(); }
});

test('a shelf tarred by hand imports, and the system tar reads a pack', { skip: spawnSync('tar', ['--version']).status !== 0 && 'no tar' }, () => {
  const t = setup();
  try {
    fill(t.shelf('user'));
    const hand = join(t.dir, 'hand.tgz');
    const made = spawnSync('tar', ['czf', hand, '-C', join(t.dir, 'user'), '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
    assert.equal(made.status, 0, String(made.stderr));
    const out = importPack(t.lib(), readFileSync(hand), { shelf: 'project' });
    assert.equal(out.added, 4);
    assert.deepEqual(tree(join(t.dir, 'project')), tree(join(t.dir, 'user')));

    const pack = join(t.dir, 'pack.tgz');
    writeFileSync(pack, exportPack(t.lib(), [], { shelf: 'user' }).tgz);
    const list = spawnSync('tar', ['tzf', pack], { encoding: 'utf8' });
    assert.equal(list.status, 0, list.stderr);
    assert.deepEqual(list.stdout.trim().split('\n').slice(0, 2), ['pack.json', 'catalogue.json']);
    const x = join(t.dir, 'x');
    mkdirSync(x);
    assert.equal(spawnSync('tar', ['xzf', pack, '-C', x]).status, 0);
    assert.deepEqual(readShelf(x).ids, ['blue-sprite', 'hum', 'red', 'red-too'], 'an unpacked pack is a shelf');
  } finally { t.done(); }
});

test('asset export / asset import from the command line; a conflict exits 1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'asset-pack-cli-'));
  try {
    const env = { DAVIDUP_ASSETS: join(dir, 'user'), DAVIDUP_HOUSE: join(dir, 'house') };
    fill(readShelf(join(dir, 'house'), { name: 'house' }));
    const run = async (...argv) => {
      let out = '', err = '';
      const code = await main(argv, { cwd: dir, env, thumbCache: join(dir, 'cache'), out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
      return { code, out, err };
    };
    let r = await run('export', 'red', 'hum', '--out', 'kit.tgz');
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^kit\.tgz {2}2 assets, 2 blobs, 2 thumbs/);
    r = await run('import', 'kit.tgz', '--dry');
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /red +image +added +shadows house/);
    assert.match(r.out, /onto user: 2 added, 0 same, 0 kept, 0 conflicts \(dry run: nothing written\)/);
    assert.equal(existsSync(join(dir, 'user')), false);
    r = await run('import', 'kit.tgz', '--json');
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).added, 2);

    readShelf(join(dir, 'user'), { name: 'user' }).remove('red');
    readShelf(join(dir, 'user'), { name: 'user' }).put({ id: 'red', kind: 'image', name: 'Green', ...base }, GREEN);
    r = await run('import', 'kit.tgz');
    assert.equal(r.code, 1);
    assert.match(r.out, /red +image +CONFLICT user has [0-9a-f]{12}…, the pack [0-9a-f]{12}…: not overwritten/);
    assert.match(r.out, /hum +sample +same/);
    assert.equal(readShelf(join(dir, 'user')).entry('red').sha, sha(GREEN));

    r = await run('export', '--shelf', 'house');
    assert.equal(r.code, 0, r.err);
    assert.ok(existsSync(join(dir, 'house.tgz')), 'the pack is named after the shelf');
    assert.equal((await run('export')).code, 2);
    assert.equal((await run('import', 'nope.tgz')).code, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
