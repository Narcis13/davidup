// H1: `asset migrate --sha256` (asset-library plan §7 H1): a shelf written with sha1, rehashed as sha256.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../cli.js';
import { HOUSE_ROOT, check, encodePng, isLegacySha, migrateSha256, openLibrary, readShelf, sha } from '../index.js';

const sha1 = (b) => createHash('sha1').update(b).digest('hex');
const files = (dir) => readdirSync(dir).sort();

// A shelf as hdf wrote it before H1: blobs named by sha1. A stock and a cutout share one PNG; a puppet's
// payload names the clip it was retargeted from by the clip's sha1; the stock has a thumb.
function legacyShelf() {
  const root = mkdtempSync(join(tmpdir(), 'asset-migrate-'));
  mkdirSync(join(root, 'blobs')); mkdirSync(join(root, 'thumbs'));
  const px = encodePng({ data: new Uint8ClampedArray(4 * 4 * 4).fill(200), width: 4, height: 4 });
  const clip = Buffer.from(JSON.stringify({ n: 1, fps: 12, h: 10, frames: [{ outer: {} }] }));
  const puppet = Buffer.from(JSON.stringify({ units: 10, parts: { body: { ops: [] } }, cycles: { run: { from: { clip: 'horse', sha: sha1(clip), map: 'm.json' } } } }), 'utf8');
  const blob = (bytes, ext) => { writeFileSync(join(root, 'blobs', `${sha1(bytes)}.${ext}`), bytes); return sha1(bytes); };
  const base = { licence: 'own', credit: '', source: '', tags: [] };
  const cat = {
    horse: { kind: 'clip', name: 'horse', file: 'h.js', ...base, n: 1, fps: 12, box: [0, 0, 1, 1], sha: blob(clip, 'json'), ext: 'json' },
    fox: { kind: 'puppet', name: 'fox', file: 'fox.svg', ...base, units: 10, box: [0, 0, 1, 1], sha: blob(puppet, 'json'), ext: 'json' },
    paper: { kind: 'stock', name: 'paper', file: 'p.png', ...base, w: 4, h: 4, box: [0, 0, 4, 4], sha: blob(px, 'png'), ext: 'png' },
    grey: { kind: 'cutout', name: 'grey', file: 'p.png', ...base, w: 4, h: 4, box: [0, 0, 4, 4], sil: { sub: [{ pts: [0, 0, 4, 0, 4, 4], closed: true }], box: [0, 0, 4, 4] }, sha: sha1(px), ext: 'png' },
  };
  writeFileSync(join(root, 'thumbs', `${sha1(px)}.png`), px);
  writeFileSync(join(root, 'catalogue.json'), `{\n${Object.entries(cat).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n}\n`);
  return { root, px, clip, puppet };
}

test('migrate renames every blob by its sha256, keeps the bytes, and rewrites a payload that names another', () => {
  const { root, px, clip, puppet } = legacyShelf();
  const before = readFileSync(join(root, 'catalogue.json'), 'utf8');

  const dry = migrateSha256(readShelf(root), { dry: true });
  assert.equal(readFileSync(join(root, 'catalogue.json'), 'utf8'), before, 'a dry run writes nothing');
  assert.equal(dry.blobs.length, 3, 'the stock and the cutout share one blob');

  const out = migrateSha256(readShelf(root));
  assert.deepEqual(out.map, dry.map, 'the dry run said what the run did');
  const shelf = readShelf(root), e = (id) => shelf.entry(id);
  assert.equal(e('paper').sha, sha(px));
  assert.equal(e('grey').sha, sha(px));
  assert.equal(e('horse').sha, sha(clip));
  assert.deepEqual(readFileSync(shelf.blobPath('paper')), px, 'renamed, not re-encoded');

  const fox = JSON.parse(readFileSync(shelf.blobPath('fox'), 'utf8'));
  assert.equal(fox.cycles.run.from.sha, sha(clip), "the puppet names the clip's sha256");
  assert.equal(readFileSync(shelf.blobPath('fox'), 'utf8'), puppet.toString('utf8').replace(sha1(clip), sha(clip)), 'and nothing else changed');
  assert.equal(e('fox').sha, sha(readFileSync(shelf.blobPath('fox'))), 'hashed after the rewrite');
  assert.deepEqual(out.blobs.find((b) => b.ids.includes('fox')).rewrote, [sha1(clip)]);

  assert.deepEqual(files(join(root, 'blobs')), [`${sha(clip)}.json`, `${e('fox').sha}.json`, `${sha(px)}.png`].sort(), 'the sha1 blobs are gone');
  assert.deepEqual(files(join(root, 'thumbs')), [`${sha(px)}.png`], 'the thumb follows its blob');
  const was = JSON.parse(before);
  for (const id of shelf.ids) assert.deepEqual({ ...e(id), sha: null }, { ...was[id], sha: null }, `${id}: only sha changes on the entry`);

  const lib = openLibrary({ shelves: [{ name: 'legacy', root }] });
  const findings = check(lib).filter((f) => ['sha1', 'sha', 'blob', 'invalid', 'orphan'].includes(f.rule));
  assert.deepEqual(findings, [], 'asset check: no sha1, every blob hashes to its entry, no orphan');
  assert.equal(migrateSha256(readShelf(root)).blobs.length, 0, 'a second run has nothing to do');
  rmSync(root, { recursive: true });
});

test('migrate refuses, writing nothing, when a blob does not hash to its sha1', () => {
  const { root } = legacyShelf();
  const shelf = readShelf(root), p = shelf.blobPath('paper');
  writeFileSync(p, Buffer.concat([readFileSync(p), Buffer.from('x')]));
  const before = [readFileSync(join(root, 'catalogue.json'), 'utf8'), files(join(root, 'blobs'))];
  assert.throws(() => migrateSha256(shelf), /not migrated, nothing written:\n {2}grey, paper: blob [0-9a-f]{40}\.png hashes to/);
  assert.deepEqual([readFileSync(join(root, 'catalogue.json'), 'utf8'), files(join(root, 'blobs'))], before);
  rmSync(root, { recursive: true });
});

test('asset migrate --sha256 takes a shelf name or a directory', async () => {
  const { root } = legacyShelf();
  const user = mkdtempSync(join(tmpdir(), 'asset-migrate-user-'));
  const run = async (...argv) => {
    let out = '', err = '';
    const code = await main(argv, { env: { DAVIDUP_ASSETS: user, DAVIDUP_HOUSE: root }, out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
    return { code, out, err };
  };
  assert.equal((await run('migrate', 'house')).code, 2, 'the migration is named');
  assert.match((await run('migrate', '--sha256', 'nowhere')).err, /neither a shelf \(user, house\) nor a directory/);
  const dry = await run('migrate', '--sha256', 'house', '--dry');
  assert.match(dry.out, /^3 blobs, 4 entries on house \(dry run: nothing written\)$/m);
  assert.match(dry.out, /names [0-9a-f]{12}…: rewritten/);
  const done = await run('migrate', '--sha256', root);
  assert.equal(done.code, 0);
  assert.match(done.out, /rehashed as sha256\n$/);
  assert.match((await run('migrate', '--sha256', 'house')).out, /no sha1 entry, nothing to migrate/);
  rmSync(root, { recursive: true }); rmSync(user, { recursive: true });
});

test('the house shelf is sha256 through and through', () => {
  const house = readShelf(HOUSE_ROOT);
  assert.deepEqual(house.ids.filter((id) => isLegacySha(house.entry(id).sha)), []);
  assert.equal(migrateSha256(house, { dry: true }).blobs.length, 0);
});
