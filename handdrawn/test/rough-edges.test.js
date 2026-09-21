// The rough edges the pink-octopus film found (docs/hand-drawn-film-v3-rough-edges.md, RE-1 to RE-11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { bounds, cut, film, paper, seq, shot } from '../core/index.js';
import { lint } from '../core/lint.js';

const hdf = (...argv) => { const r = spawnSync(process.execPath, ['cli/hdf.mjs', ...argv], { encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };
const tmp = (fn) => { const dir = mkdtempSync(join(tmpdir(), 'hdf-re-')); try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };

test('RE-1: a failed command ends on its message; only an unknown command prints USAGE', () => {
  const miss = hdf('svg');
  assert.equal(miss.code, 2);
  assert.equal(miss.out, 'hdf: svg: need <file.svg>\n(hdf help svg for its usage)\n');
  assert.doesNotMatch(hdf('find', '--kind', 'nope').out, /usage: hdf/);
  assert.match(hdf('improt').out, /usage: hdf <command>/);
  const one = hdf('help', 'svg');
  assert.equal(one.code, 0);
  assert.match(one.out, /^ {2}svg {5}<file\.svg>/);
  assert.doesNotMatch(one.out, /^ {2}render/m);
});

test('RE-2: hdf svg widens a puppet box that a pose swings past, and keeps the viewBox as frame', () => tmp((dir) => {
  const src = readFileSync('assets/src/octopus.svg', 'utf8').replace(/viewBox="[^"]*"/, 'viewBox="0 0 520 440"');
  const file = join(dir, 'octo.svg'), root = join(dir, 'store');
  writeFileSync(file, src);
  const r = hdf('svg', file, '--name', 'octo', '--licence', 'own', '--roles', 'assets/src/octopus.roles.json', '--root', root, '--no-sheet');
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^box -?\d+ -?\d+ \d+ \d+ \(the viewBox [\d. -]+ widened for pose 'wave'/m);
  const e = JSON.parse(readFileSync(join(root, 'catalogue.json'), 'utf8')).octo;
  const payload = JSON.parse(readFileSync(join(root, 'blobs', `${e.sha}.json`), 'utf8'));
  assert.ok(payload.frame, 'the viewBox is kept as frame');
  assert.deepEqual(e.box, payload.box);
}));

test('RE-6: a cut whose shots are not in the timeline is a cut-orphan finding', () => {
  const a = shot('a', 1, () => [paper()]), b = shot('b', 1, () => [paper()]);
  const orphans = (tl) => lint(film({ name: 're6', look: 'paperInk', timeline: tl })).filter((f) => f.rule === 'cut-orphan');
  assert.deepEqual(orphans(seq(a, cut('iris', 0.5, a, b), b)), []);
  const lone = orphans(seq(cut('iris', 0.5, a, b)));
  assert.equal(lone.length, 1);
  assert.match(lone[0].detail, /outgoing shot 'a' and the incoming shot 'b' never play/);
  assert.match(orphans(seq(a, cut('iris', 0.5, a, b)))[0].detail, /^the incoming shot 'b'/);
});

test('RE-7, RE-8: a motif gets a sheet; remove drops an entry, its sheet and its blob; gc finds orphans', () => tmp((dir) => {
  const file = join(dir, 'star.svg'), root = join(dir, 'store');
  writeFileSync(file, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 5 L95 38 L78 92 L22 92 L5 38 Z" fill="#f2c14e" stroke="#222222" stroke-width="3"/></svg>');
  const r = hdf('svg', file, '--name', 'star', '--kind', 'motif', '--licence', 'own', '--root', root);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /star\.jpg {2}7 looks x 3 scales$/m);
  assert.ok(existsSync(join(root, 'sheets', 'star.jpg')));

  // A replaced payload leaves its old blob: gc --dry lists it, gc deletes it.
  writeFileSync(file, readFileSync(file, 'utf8').replace('#f2c14e', '#4ea1f2'));
  assert.equal(hdf('svg', file, '--name', 'star', '--kind', 'motif', '--licence', 'own', '--root', root, '--no-sheet').code, 0);
  assert.match(hdf('gc', '--dry', '--root', root).out, /^1 orphan blob, \d+ KB \(dry run\)$/m);
  assert.match(hdf('gc', '--root', root).out, /^1 orphan blob/m);
  assert.match(hdf('gc', '--root', root).out, /^0 orphan blobs/m);

  const e = JSON.parse(readFileSync(join(root, 'catalogue.json'), 'utf8')).star;
  const rm = hdf('remove', 'star', '--root', root);
  assert.equal(rm.code, 0, rm.out);
  assert.equal(readFileSync(join(root, 'catalogue.json'), 'utf8'), '{\n}\n');
  assert.ok(!existsSync(join(root, 'blobs', `${e.sha}.json`)));
  assert.ok(!existsSync(join(root, 'sheets', 'star.jpg')));
  assert.equal(hdf('remove', 'star', '--root', root).code, 1, 'an unknown id is an error');
  assert.equal(hdf('remove', 'pack:boat', '--root', root).code, 2, 'a pack mirror needs --force');
}));

test('RE-9: an actor with h is fitted by its drawing, and A pushes in no further than keeps it in frame', async () => {
  const { fromStore } = await import('../core/assets.js');
  const { actorOf, puppet, frame } = await import('../core/index.js');
  const { actorFigure, establishing } = await import('../recipes/shots.js');
  fromStore(['octopus']);
  const O = actorOf(puppet('octopus'));
  const drawn = bounds([actorFigure(O, O.idle(0, 0), 300, 'drawn')]);
  assert.ok(Math.abs(drawn[3] - 300) < 1, `drawn ${drawn[3]} units tall`);
  assert.ok(bounds([actorFigure(O, O.idle(0, 0), 140)])[3] <= 141, 'without h: the box, as before');
  const f = film({ name: 're9', look: 'paperInk', timeline: seq(establishing({ actor: O, h: 300 })) });
  assert.deepEqual(lint(f).filter((x) => x.rule === 'subject-crop'), []);
  assert.ok(frame(f, f.n - 1).list.length);
});

test('RE-10: the model sheet draws rest first in the poses row', async () => {
  const { modelSheet } = await import('../cli/sheet.mjs');
  const { readCatalogue, ASSET_ROOT } = await import('../core/assets.js');
  const { puppet } = await import('../core/puppet.js');
  const { resolveLook } = await import('../core/looks.js');
  const st = readCatalogue(ASSET_ROOT), entry = st.entry('octopus');
  const make = puppet({ ...st.json(entry), name: 'octopus' });
  const page = modelSheet(make, { entry, look: resolveLook('doodlePastel') });
  const named = make.poses.filter((p) => p !== 'rest');
  assert.deepEqual(page.labels.poses, ['rest', ...named]);
});

test('RE-11: place(..., { shadow: true }) puts a shadow on the actor\'s floor; without it nothing changes', async () => {
  const { fromStore } = await import('../core/assets.js');
  const { actorOf, puppet, hashList } = await import('../core/index.js');
  fromStore(['fox']);
  const F = actorOf(puppet('fox'));
  const plain = F.place(400, 600, 140, F.idle(0)), grounded = F.place(400, 600, 140, { ...F.idle(0), shadow: true });
  assert.equal(hashList([plain]), hashList([F.place(400, 600, 140, F.idle(0))]));
  assert.equal(grounded.kids[0].name, 'shadow');
  assert.equal(hashList([grounded.kids[1]]), hashList([plain]), 'the figure itself is the same');
  const [, sy, , sh] = bounds([grounded.kids[0]]);
  assert.ok(Math.abs(sy + sh / 2 - (600 + 0.86 * 140)) < 1, 'centred on the feet line');
});
