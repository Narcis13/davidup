// A6: the `asset` CLI (asset-library plan §5 A6): each verb on temp shelves, and `asset check` on the house.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, addAsset, idOf, main, parseArgs, run as runVerb } from '../cli.js';
import { HOUSE_ROOT, decodePng, encodePng, imageType, isLegacySha, openLibrary, readShelf, sha } from '../index.js';
import { fontInfo, wavInfo } from '../probe.js';

const CLI = fileURLToPath(new URL('../cli.js', import.meta.url));
const INTER = fileURLToPath(new URL('../../fonts/Inter-Regular.ttf', import.meta.url));

// A w x h PNG in one colour (alpha 255 unless given).
const png = (w, h, [r, g, b, a = 255]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([r, g, b, a], i * 4);
  return encodePng({ data, width: w, height: h });
};
// A mono 16-bit PCM WAV of `sec` seconds of silence.
const wav = (sec, rate = 8000) => {
  const n = Math.round(sec * rate) * 2, b = Buffer.alloc(44 + n);
  b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8, 'latin1');
  b.write('fmt ', 12, 'latin1'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'latin1'); b.writeUInt32LE(n, 40);
  return b;
};

// Three empty shelves (project, user, house), some payloads to add, and `run(...argv)` -> { code, out, err }
// running the CLI in-process against them from `dir`.
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'asset-cli-'));
  const env = { DAVIDUP_ASSETS: join(dir, 'user'), DAVIDUP_HOUSE: join(dir, 'house') };
  mkdirSync(join(dir, 'in'));
  const file = (name, bytes) => { writeFileSync(join(dir, 'in', name), bytes); return join('in', name); };
  const run = async (...argv) => {
    let out = '', err = '';
    const code = await main(argv, { cwd: dir, env, thumbCache: join(dir, 'cache'), out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
    return { code, out, err };
  };
  const shelf = (name) => readShelf(join(dir, name === 'project' ? 'film/assets' : name));
  return { dir, env, file, run, shelf, done: () => rmSync(dir, { recursive: true, force: true }) };
}
const P = ['--project', 'film'];

test('parseArgs: a single dash is a tag, boolean flags take no value, --no- and = work', () => {
  assert.deepEqual(parseArgs(['fox', '+a', '-b', '--shelf', 'house']), { args: ['fox', '+a', '-b'], flags: { shelf: 'house' } });
  assert.deepEqual(parseArgs(['--alpha', 'fox', '--no-dark', '--min-w=1920', '--json']), { args: ['fox'], flags: { alpha: true, dark: false, minW: '1920', json: true } });
  assert.deepEqual(parseArgs(['--', '--literal']), { args: ['--literal'], flags: {} });
  assert.equal(idOf('Warm Paper, Kraft!'), 'warm-paper-kraft');
});

test('help, a verb\'s usage, an unknown verb and a usage error', async () => {
  const t = setup();
  const help = await t.run('help');
  assert.equal(help.code, 0);
  assert.match(help.out, /^asset: the asset library/);
  for (const v of ['find', 'show', 'add', 'tag', 'desc', 'rm', 'mv', 'gc', 'thumb', 'sheet', 'ls', 'check']) assert.match(help.out, new RegExp(`\\n  ${v} `));
  const one = await t.run('help', 'mv');
  assert.equal(one.out, '  mv      <id> --to <shelf> [--from <shelf>]   move blob, thumb and entry (the editor\'s promote)\n');
  assert.equal((await t.run('frob')).code, 2);
  const bad = await t.run('find');
  assert.equal(bad.code, 2);
  assert.match(bad.err, /find: need <words\.\.\.> or a filter[\s\S]*asset help find/);
  t.done();
});

test('add: hashes, derives and probes a stock, a sample and a font; the same bytes again are unchanged', async () => {
  const t = setup(), bytes = png(40, 20, [230, 200, 150]);
  const f = t.file('paper.png', bytes);
  const a = await t.run('add', f, '--kind', 'stock', '--name', 'Warm paper', '--licence', 'own', '--tags', 'paper,warm', '--desc', 'warm cream paper', ...P);
  assert.equal(a.code, 0, a.err);
  assert.equal(a.err, '');
  assert.match(a.out, new RegExp(`^warm-paper  stock  ${sha(bytes).slice(0, 12)}….png  own  on project \\(new\\)\\n`));
  // The PNG's pixels are decoded here for its colours, so `alpha` says whether any pixel uses it (none do).
  const e = t.shelf('project').entry('warm-paper');
  assert.deepEqual({ ...e, added: 'x' }, {
    kind: 'stock', name: 'Warm paper', file: 'paper.png', licence: 'own', credit: '', source: '', tags: ['paper', 'warm'], desc: 'warm cream paper',
    box: [0, 0, 40, 20], media: 'raster', sha: sha(bytes), ext: 'png', bytes: bytes.length, w: 40, h: 20, alpha: false,
    colours: [{ hex: '#e6c896', area: 1 }], added: 'x', by: 'asset add',
  });
  const again = await t.run('add', f, '--kind', 'stock', '--name', 'Warm paper', '--licence', 'own', ...P);
  assert.match(again.out, /on project \(unchanged bytes\)/);

  // No project open: the user's pool. A WAV's length from its header, with no ffprobe.
  const s = await t.run('add', t.file('line.wav', wav(1.5)), '--kind', 'sample', '--name', 'line', '--licence', 'own', '--json');
  assert.equal(s.code, 0, s.err);
  const sj = JSON.parse(s.out);
  assert.equal(sj.shelf, 'user');
  assert.equal(sj.entry.sec, 1.5);
  assert.equal(sj.created, true);

  // A font's family, weight, style and glyph count from its own tables.
  const ff = await t.run('add', INTER, '--kind', 'font', '--name', 'inter', '--licence', 'OFL', '--credit', 'Inter by Rasmus Andersson', '--json');
  assert.equal(ff.code, 0, ff.err);
  assert.deepEqual((({ family, weight, style, glyphs }) => ({ family, weight, style, glyphs }))(JSON.parse(ff.out).entry), { family: 'Inter', weight: 400, style: 'normal', glyphs: 549 });
  t.done();
});

test('add refuses before writing: a cutout with no silhouette (with the hint), a bad licence, a bad id', async () => {
  const t = setup(), f = t.file('cup.png', png(8, 8, [10, 10, 10, 0]));
  const cut = await t.run('add', f, '--kind', 'cutout', '--name', 'cup', '--licence', 'CC0');
  assert.equal(cut.code, 1);
  assert.match(cut.err, /asset 'cup' is not a valid cutout[\s\S]*sil: missing[\s\S]*hdf import --kind cutout/);
  assert.equal(existsSync(join(t.dir, 'user')), false, 'nothing written');
  assert.equal((await t.run('add', f, '--kind', 'image', '--name', 'cup', '--licence', 'mine')).code, 2);
  assert.equal((await t.run('add', f, '--kind', 'image', '--name', 'cup', '--id', 'Cup!')).code, 2);
  assert.equal((await t.run('add', f, '--kind', 'picture', '--name', 'cup')).code, 2);
  // --with gives what the CLI cannot derive; licence unknown is taken, with a warning.
  const sil = { sub: [{ pts: [0, 0, 8, 0, 8, 8, 0, 8], closed: true }], box: [0, 0, 8, 8] };
  const ok = await t.run('add', f, '--kind', 'cutout', '--name', 'cup', '--with', JSON.stringify({ sil }));
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.err, /warning: 'cup' has licence unknown/);
  assert.deepEqual(t.shelf('user').entry('cup').sil, sil);
  t.done();
});

// A small library: a stock and a puppet on the house, an image made from the puppet on the user's shelf.
async function library(t) {
  const puppet = JSON.stringify({ name: 'fox', units: 300, box: [-100, -300, 200, 300], parts: {} });
  await t.run('add', t.file('paper.png', png(40, 20, [230, 200, 150])), '--kind', 'stock', '--name', 'paper-warm', '--licence', 'own', '--tags', 'paper,warm', '--shelf', 'house');
  await t.run('add', t.file('fox.json', puppet), '--kind', 'puppet', '--name', 'fox', '--licence', 'own', '--tags', 'cast', '--shelf', 'house');
  await t.run('add', t.file('sheet.png', png(64, 16, [200, 90, 30])), '--kind', 'image', '--name', 'fox-walk', '--licence', 'own', '--desc', 'the fox walking, a sprite sheet',
    '--with', JSON.stringify({ made: { tool: 'hdf sprite', from: ['fox'], args: { clip: 'walk' }, at: '2026-09-28' } }));
}

test('find: ranked hits with why, filters, --json, and what the library has when nothing matches', async () => {
  const t = setup();
  await library(t);
  const f = await t.run('find', 'fox');
  assert.equal(f.code, 0, f.err);
  const lines = f.out.split('\n');
  assert.match(lines[0], /^fox {10}puppet  house    own       200×300$/);
  assert.match(lines[1], /why: id: fox \(exact\)/);
  assert.match(f.out, /\nfox-walk {5}image   user     own       64×16\n/);
  assert.match(f.out, /\n2 of 3 · kind: image 1, puppet 1 · /);
  const j = JSON.parse((await t.run('find', 'fox', '--kind', 'image', '--json')).out);
  assert.deepEqual(j.hits.map((h) => h.id), ['fox-walk']);
  assert.equal(j.hits[0].use.davidup.args.src, `asset:fox-walk@${j.hits[0].record.sha.slice(0, 12)}`);
  const warm = JSON.parse((await t.run('find', '--hue', 'warm', '--media', 'raster', '--json')).out);
  assert.deepEqual(warm.hits.map((h) => h.id).sort(), ['fox-walk', 'paper-warm']);
  const none = await t.run('find', 'dragon');
  assert.equal(none.code, 1);
  assert.match(none.out, /^no asset matches "dragon" \(3 on shelves user, house\)\nthe library has kind: /);
  assert.equal((await t.run('find', 'fox', '--hue', 'mauve')).code, 2);
  t.done();
});

test('show: the record, blob, thumb, what it was made from and into, and its use', async () => {
  const t = setup();
  await library(t);
  const fox = await t.run('show', 'fox');
  assert.equal(fox.code, 0, fox.err);
  assert.match(fox.out, /^fox · puppet \(data\) · house\n/);
  assert.match(fox.out, /\n {2}made into fox-walk \(image, hdf sprite\)\n/);
  assert.match(fox.out, /\n {2}davidup {3}register_asset \{"id":"fox-walk","type":"image","src":"asset:fox-walk@[0-9a-f]{12}","licence":"own"\}\n {12}via fox-walk\n/);
  assert.match(fox.out, /\n {2}hdf {7}fromStore\(\['fox'\], \{ from: '.*house' \}\)\n {12}take {2}actorOf\(puppet\('fox'\)\)\n/);
  const walk = JSON.parse((await t.run('show', 'fox-walk', '--json')).out);
  assert.deepEqual(walk.made.from, [{ id: 'fox', kind: 'puppet', shelf: 'house' }]);
  assert.equal(walk.thumb, null);
  assert.ok(walk.blob.endsWith(`${walk.record.sha}.png`));
  assert.equal(walk.use.hdf, null);
  // By sha, and an unknown id naming the shelves searched.
  const bySha = await t.run('show', `sha:${walk.record.sha.slice(0, 12)}`);
  assert.match(bySha.out, /^fox-walk · image/);
  const none = await t.run('show', 'wolf');
  assert.equal(none.code, 1);
  assert.match(none.err, /no asset 'wolf' on shelves user \(.*\), house/);
  t.done();
});

test('tag and desc change the entry in place: the blob and its sha do not move', async () => {
  const t = setup();
  await library(t);
  const before = t.shelf('house').entry('paper-warm'), blobs = readdirSync(join(t.dir, 'house', 'blobs'));
  const tg = await t.run('tag', 'paper-warm', '+kraft,texture', '-warm', 'stock', '+paper');
  assert.equal(tg.code, 0, tg.err);
  assert.equal(tg.out, 'paper-warm  tags: paper, kraft, texture, stock  on house (+kraft +texture +stock -warm)\n');
  const d = await t.run('desc', 'paper-warm', 'warm', 'kraft', 'paper, 40 px');
  assert.equal(d.out, 'paper-warm  desc: "warm kraft paper, 40 px"  on house\n');
  const after = t.shelf('house').entry('paper-warm');
  assert.deepEqual(after, { ...before, tags: ['paper', 'kraft', 'texture', 'stock'], desc: 'warm kraft paper, 40 px' });
  assert.deepEqual(readdirSync(join(t.dir, 'house', 'blobs')), blobs);
  assert.equal((await t.run('desc', 'paper-warm', '')).out, 'paper-warm  desc: (removed)  on house\n');
  assert.equal(t.shelf('house').entry('paper-warm').desc, undefined);
  assert.equal((await t.run('tag', 'paper-warm')).code, 2);
  assert.equal((await t.run('tag', 'nope', '+x')).code, 1);
  t.done();
});

test('mv, ls with shadows, rm uncovering the shadowed record', async () => {
  const t = setup();
  await library(t);
  const mv = await t.run('mv', 'paper-warm', '--to', 'user');
  assert.equal(mv.code, 0, mv.err);
  assert.match(mv.out, /^paper-warm {2}house -> user {2}[0-9a-f]{12}…\.png\n/);
  assert.equal(t.shelf('house').has('paper-warm'), false);
  // The same id on two shelves: ls says which shadows which.
  await t.run('add', t.file('fox2.png', png(4, 4, [1, 2, 3])), '--kind', 'image', '--name', 'fox', '--licence', 'own', ...P);
  const ls = await t.run('ls', ...P);
  assert.match(ls.out, /^project {2}film\/assets {2}1 asset\n {2}fox {10}image {3}own {7}4×4 {2}\(shadows house\)\n/);
  assert.match(ls.out, /\nhouse {2}house {2}1 asset\n {2}fox {10}puppet {2}own {7}200×300 {2}\(shadowed by project\)\n/);
  assert.match((await t.run('ls', '--kind', 'image', '--shelf', 'user')).out, /^user {2}user {2}1 asset \(image\)\n {2}fox-walk {5}image/);
  const rm = await t.run('rm', 'fox', ...P);
  assert.equal(rm.code, 0, rm.err);
  assert.match(rm.out, /^removed fox from project: film\/assets\/blobs\/[0-9a-f]{64}\.png\n {2}fox now resolves to house\n$/);
  assert.equal((await t.run('mv', 'fox-walk')).code, 2);
  t.done();
});

test('gc: --dry lists orphan blobs and stale thumbs, then gc deletes them', async () => {
  const t = setup();
  await library(t);
  writeFileSync(join(t.dir, 'house', 'blobs', `${'e'.repeat(64)}.png`), 'orphan');
  mkdirSync(join(t.dir, 'house', 'thumbs'));
  writeFileSync(join(t.dir, 'house', 'thumbs', `${'f'.repeat(64)}.png`), 'stale');
  const dry = await t.run('gc', '--dry');
  assert.match(dry.out, /^would delete {2}house {4}house\/blobs\/e{64}\.png {2}1 KB\nwould delete {2}house {4}house\/thumbs\/f{64}\.png {2}1 KB\n2 files, 1 KB \(dry run: nothing deleted\)\n$/);
  assert.ok(existsSync(join(t.dir, 'house', 'blobs', `${'e'.repeat(64)}.png`)));
  assert.match((await t.run('gc')).out, /^deleted /);
  assert.equal((await t.run('gc')).out, 'nothing to collect on user, house\n');
  t.done();
});

test('thumb draws cards and then answers from the cache; sheet tiles them with captions', async () => {
  const t = setup();
  await library(t);
  const first = await t.run('thumb', '--all');
  assert.equal(first.code, 0, first.err);
  assert.deepEqual(first.out.trim().split('\n').map((l) => l.split(/\s+/).slice(0, 2)), [['fox', 'drawn'], ['fox-walk', 'drawn'], ['paper-warm', 'drawn']]);
  assert.match(first.out, /card:[0-9a-f]+ +house\/thumbs\/[0-9a-f]{64}\.png/);
  const again = JSON.parse((await t.run('thumb', 'fox', '--json')).out);
  assert.equal(again[0].cached, true);
  assert.match((await t.run('show', 'fox')).out, /\n {2}thumb {5}house\/thumbs\/[0-9a-f]{64}\.png\n/);
  const sheet = await t.run('sheet', 'fox', 'fox-walk', 'paper-warm', '--cols', '2', '--cell', '120', '--out', 'out/c.png');
  assert.equal(sheet.code, 0, sheet.err);
  assert.match(sheet.out, /^out\/c\.png {2}\d+×\d+, 2 across, 2 down: fox, fox-walk, paper-warm\n$/);
  const bytes = readFileSync(join(t.dir, 'out', 'c.png'));
  assert.equal(imageType(bytes), 'png');
  assert.ok(decodePng(bytes).width > 240);
  assert.equal((await t.run('sheet', 'fox', 'wolf')).code, 1);
  assert.equal((await t.run('thumb')).code, 2);
  t.done();
});

test('check: every rule on broken temp shelves, errors exit 1', async () => {
  const t = setup();
  await library(t);
  const paper = readFileSync(join(t.dir, 'in', 'paper.png'));
  // The same bytes on the user shelf too, under another id, with licence unknown and CC-BY with no credit.
  await t.run('add', 'in/paper.png', '--kind', 'image', '--name', 'paper-copy');
  await t.run('add', t.file('by.png', png(2, 2, [9, 9, 9])), '--kind', 'image', '--name', 'by', '--licence', 'CC-BY', '--desc', 'x', '--tags', 'x');
  // A shadow, a blob gone, a blob changed, an orphan, and an id outside the rule written by hand.
  await t.run('add', t.file('fox3.png', png(3, 3, [5, 5, 5])), '--kind', 'image', '--name', 'fox', '--licence', 'own', '--tags', 'x', '--desc', 'x');
  const u = t.shelf('user');
  rmSync(u.blobPath(u.entry('fox-walk')));
  writeFileSync(u.blobPath(u.entry('by')), 'changed');
  writeFileSync(join(t.dir, 'house', 'blobs', `${'0'.repeat(64)}.png`), 'orphan');
  const cat = JSON.parse(readFileSync(join(t.dir, 'house', 'catalogue.json'), 'utf8'));
  cat.Bad_Id = { ...cat['paper-warm'] };
  writeFileSync(join(t.dir, 'house', 'catalogue.json'), JSON.stringify(cat));

  const out = JSON.parse((await t.run('check', '--json')).out);
  const got = out.findings.map((f) => `${f.level} ${f.rule} ${f.shelf} ${f.id ?? 'orphan'}`);
  for (const want of [
    'error id house Bad_Id', 'error blob user fox-walk', 'error sha user by',
    'warn licence user paper-copy', 'warn credit user by', 'warn duplicate user paper-copy', 'warn shadow house fox', 'warn orphan house orphan',
    'note thumb house fox', 'note desc house paper-warm', 'note tags user fox-walk',
  ]) assert.ok(got.includes(want), `${want} in:\n${got.join('\n')}`);
  assert.equal(got.filter((g) => g.startsWith('error')).length, 3);
  assert.equal(out.findings.find((f) => f.rule === 'duplicate').detail, 'same bytes as house:Bad_Id, house:paper-warm');
  assert.deepEqual(out.counts, { error: 3, warn: out.findings.filter((f) => f.level === 'warn').length, note: out.findings.filter((f) => f.level === 'note').length });
  const text = await t.run('check');
  assert.equal(text.code, 1);
  assert.match(text.out, /^error  id {9}house {5}Bad_Id: id 'Bad_Id': lower-case/);
  assert.match(text.out, /\n3 errors, \d+ warnings, \d+ notes on user \(4\), house \(3\)\n$/);
  assert.equal(sha(paper), t.shelf('user').entry('paper-copy').sha);
  // One shelf only; a clean shelf says so.
  assert.equal((await t.run('check', '--shelf', 'user', '--json')).code, 1);
  const clean = setup();
  assert.deepEqual(await clean.run('check'), { code: 0, out: 'clean: user (0), house (0)\n', err: '' });
  clean.done();
  t.done();
});

test('asset check on the house shelf prints its real findings', async () => {
  const user = mkdtempSync(join(tmpdir(), 'asset-cli-user-'));
  let out = '';
  const code = await main(['check', '--json'], { env: { DAVIDUP_ASSETS: user }, out: { write: (s) => { out += s; } }, err: { write: () => {} } });
  const { counts, findings } = JSON.parse(out);
  const house = readShelf(HOUSE_ROOT);
  assert.equal(code, 0, 'no errors on the house shelf');
  assert.equal(counts.error, 0);
  const of = (rule) => findings.filter((f) => f.rule === rule).map((f) => f.id).sort();
  assert.deepEqual(of('sha1'), [], 'no sha1 entry: H1 rehashed the house shelf');
  assert.ok(house.ids.every((id) => !isLegacySha(house.entry(id).sha)));
  assert.deepEqual(of('tags'), ['fox', 'octopus'], 'the two puppets with empty tags');
  assert.deepEqual(of('licence'), house.ids.filter((id) => house.entry(id).licence === 'unknown'));
  assert.deepEqual(of('desc'), house.ids.filter((id) => !house.entry(id).desc).sort());
  rmSync(user, { recursive: true });
});

test('check --legacy offers the files in davidup\'s old library that are on no shelf (D5)', async () => {
  const t = setup();
  try {
    const lib = join(t.dir, 'library');
    mkdirSync(join(lib, 'assets'), { recursive: true });
    mkdirSync(join(lib, 'fonts', 'more'), { recursive: true });
    writeFileSync(join(lib, 'assets', 'X_profile.png'), png(3, 3, [20, 40, 60]));
    writeFileSync(join(lib, 'assets', 'notes.txt'), 'not an asset');
    writeFileSync(join(lib, 'assets', '.DS_Store'), 'finder');
    writeFileSync(join(lib, 'fonts', 'brand.ttf'), readFileSync(INTER));
    writeFileSync(join(lib, 'fonts', 'more', 'seeded.woff2'), 'woff2 bytes already on a shelf');
    writeFileSync(join(lib, 'index.json'), JSON.stringify({ assets: [], fonts: [{ id: 'brand-sans', family: 'Brand Sans', src: 'global:fonts/brand.ttf' }] }));
    await t.run('add', t.file('seeded.woff2', 'woff2 bytes already on a shelf'), '--kind', 'font', '--name', 'seeded', '--family', 'Seeded', '--licence', 'OFL');

    // Without --legacy nothing looks there.
    t.env.DAVIDUP_LIBRARY = lib;
    assert.ok(!(await t.run('check')).out.includes('legacy'));

    const j = JSON.parse((await t.run('check', '--legacy', '--json')).out);
    const legacy = j.findings.filter((f) => f.rule === 'legacy');
    assert.deepEqual(legacy.map((f) => [f.level, f.shelf, f.id, f.kind]), [['note', 'library', null, null], ['note', 'library', null, 'image'], ['note', 'library', null, 'font']]);
    assert.deepEqual(legacy.map((f) => f.path), ['assets/notes.txt', 'assets/X_profile.png', 'fonts/brand.ttf'].map((p) => join(lib, p)));
    assert.equal(legacy[0].detail, 'assets/notes.txt is on no shelf, and .txt is no kind davidup takes');
    assert.equal(legacy[1].add, `asset add ${join(lib, 'assets', 'X_profile.png')} --kind image --name X_profile --licence unknown --shelf user`);
    // The font's id and family come from the index.json entry naming the file.
    assert.equal(legacy[2].add, `asset add ${join(lib, 'fonts', 'brand.ttf')} --kind font --name 'Brand Sans' --id brand-sans --family 'Brand Sans' --licence unknown --shelf user`);
    const text = (await t.run('check', '--legacy')).out;
    assert.match(text, /\nnote {3}legacy {5}library {3}assets\/X_profile\.png is on no shelf: asset add /);

    // The offered lines run as they are; then nothing is left to offer.
    for (const f of legacy.filter((x) => x.add)) {
      const argv = f.add.match(/'[^']*'|\S+/g).slice(1).map((a) => a.replace(/^'|'$/g, ''));
      assert.equal((await t.run(...argv)).code, 0);
    }
    assert.equal(t.shelf('user').entry('brand-sans').family, 'Brand Sans');
    assert.deepEqual(JSON.parse((await t.run('check', '--legacy', '--json')).out).findings.filter((f) => f.rule === 'legacy').map((f) => f.kind), [null]);

    // $DAVIDUP_LIBRARY unset: the library under the home directory.
    delete t.env.DAVIDUP_LIBRARY;
    let out = '';
    await main(['check', '--legacy', '--json'], { cwd: t.dir, env: t.env, home: join(t.dir, 'home'), out: { write: (x) => { out += x; } }, err: { write: () => {} } });
    assert.deepEqual(JSON.parse(out).findings.filter((f) => f.rule === 'legacy'), []);
  } finally {
    t.done();
  }
});

test('the bin runs as a program, and the root package names it', () => {
  const r = spawnSync(process.execPath, [CLI, 'help', 'check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ {2}check /);
  assert.equal(spawnSync(process.execPath, [CLI, 'nope'], { encoding: 'utf8' }).status, 2);
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.bin.asset, 'assetlib/cli.js');
  assert.match(readFileSync(CLI, 'utf8'), /^#!\/usr\/bin\/env node\n/);
});

test('probes: a WAV header and a font\'s tables, read here', () => {
  assert.deepEqual(wavInfo(wav(0.25, 16000)), { codec: 'pcm', rate: 16000, channels: 1, bits: 16, sec: 0.25 });
  assert.throws(() => wavInfo(Buffer.from('not a wav')), /not a RIFF WAVE/);
  assert.deepEqual(fontInfo(readFileSync(INTER)), { family: 'Inter', weight: 400, style: 'normal', glyphs: 549 });
  assert.throws(() => fontInfo(Buffer.from('wOF2....')), /WOFF2/);
});

test('a host runs a verb on its own library and adds through addAsset with its own derive (hdf, H2)', async () => {
  const t = setup();
  try {
    // One directory as the only shelf, as hdf's --root opens it: add writes there without --shelf.
    const lib = openLibrary({ shelves: [{ root: join(t.dir, 'store') }] });
    const bytes = png(3, 2, [200, 60, 50]), sil = { sub: [{ pts: [0, 0, 3, 0, 3, 2, 0, 2], closed: true }], box: [0, 0, 3, 2] };
    const seen = [];
    const host = { derive: { cutout: (b, { file, entry }) => { seen.push([b.length, file, entry.id]); return { sil, box: [0, 0, 3, 2] }; } }, by: 'hdf import' };
    const entry = (id) => ({ id, kind: 'cutout', name: id, licence: 'own', credit: '', source: '', tags: [] });
    const out = await addAsset(lib, { bytes, file: '/x/dot.png', entry: entry('dot') }, host);
    assert.deepEqual(seen, [[bytes.length, '/x/dot.png', 'dot']], 'the host derives from the bytes it was handed');
    assert.deepEqual([out.shelf, out.replaced, out.entry.by, out.entry.sil], ['store', null, 'hdf import', sil]);
    const again = await addAsset(lib, { bytes, file: '/x/dot.png', entry: entry('dot') }, host);
    assert.equal(again.replaced.sha, out.entry.sha);

    // A refusal from a kind the host derives carries no hint about another tool.
    const refuse = { derive: { cutout: () => ({}) } };
    await assert.rejects(addAsset(lib, { bytes, entry: entry('bare') }, refuse), (e) => /sil/.test(e.message) && !/hdf import/.test(e.message));
    await assert.rejects(addAsset(lib, { bytes, entry: entry('bare') }), /hdf import --kind cutout/);

    // run() answers without printing: the data --json would print, on the library handed in.
    const found = await runVerb('find', ['dot'], { library: lib });
    assert.equal(found.code, 0);
    assert.deepEqual(found.data.hits.map((h) => [h.id, h.shelf]), [['dot', 'store']]);
    await assert.rejects(runVerb('find', [], { library: lib }), UsageError);
    await assert.rejects(runVerb('nope', []), /unknown verb 'nope'/);
  } finally { t.done(); }
});
