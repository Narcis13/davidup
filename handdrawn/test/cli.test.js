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

test('render --frames: the first N frames only, to their own files; a bad count is a usage error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-render-'));
  try {
    const { code, out } = await hdf('render', 'films/mini.js', '--frames', '6', '--out', dir, '--no-sound');
    assert.equal(code, 0, out);
    assert.match(out, /mini-6f\.mp4  6 frames/);
    assert.ok(existsSync(join(dir, 'mini-6f.mp4')) && !existsSync(join(dir, 'mini.mp4')));
    assert.equal(JSON.parse(readFileSync(join(dir, 'mini-6f.hashes.json'), 'utf8')).frames.length, 6);
    assert.equal((await hdf('render', 'films/mini.js', '--frames', '0', '--out', dir)).code, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('model sheet: the fox brief is one list that hashes the same every run, a row for each thing it has', async () => {
  const { modelSheet } = await import('../cli/sheet.mjs');
  const { readCatalogue, ASSET_ROOT } = await import('../core/assets.js');
  const { puppet } = await import('../core/puppet.js');
  const { hashList } = await import('../core/list.js');
  const { lintList } = await import('../core/lint.js');
  const { resolveLook } = await import('../core/looks.js');
  const st = readCatalogue(ASSET_ROOT), entry = st.entry('fox'), look = resolveLook('risoPop');
  // Two runs from two separately read payloads (nothing memoised between them).
  const run = () => modelSheet(puppet({ ...JSON.parse(JSON.stringify(st.json(entry))), name: 'fox' }), { entry, look });
  const a = run(), b = run();
  assert.equal(hashList(a.list), hashList(b.list));
  assert.equal(a.H, b.H);
  const fox = puppet(st.json(entry));
  // title, turnaround, expressions, hands and feet, poses, a strip per cycle, credits.
  assert.equal(a.rows.length, 1 + 1 + 1 + 1 + 1 + fox.cycles.length + 1);
  assert.deepEqual(a.rows, ['title', 'turnaround', 'expressions', 'hands and feet', 'poses', 'cycle walk', 'cycle run', 'cycle gallop', 'credits']);
  assert.deepEqual(lintList(a.list, look), [], 'role and cel-box hold over the page');
});

test('sheet store: a puppet in the store gets the check sheet hdf find points at', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-puppet-'));
  try {
    const root = join(dir, 'store'), file = join(dir, 'blob.puppet.json');
    writeFileSync(file, JSON.stringify({
      units: 100, box: [-60, -60, 120, 120],
      parts: { body: { pivot: [0, 0], ops: [{ op: 'fill', path: { $p: [[1, -40, -40, 40, -40, 40, 40, -40, 40]] }, role: 'fills.0', finish: true }] } },
      cycles: { bob: { n: 2, frames: [{ body: 0 }, { body: 20 }] } },
    }));
    assert.equal((await hdf('import', file, '--kind', 'puppet', '--name', 'blob', '--root', root, '--licence', 'own')).code, 0);
    const { code, out } = await hdf('sheet', 'store', 'blob', '--cycle', 'bob', '--root', root);
    assert.equal(code, 0, out);
    assert.match(out, /blob\.jpg {2}7 looks x 1 state x 3 scales \+ 2 frames of bob$/m);
    assert.ok(existsSync(join(root, 'sheets', 'blob.jpg')));
    // The model sheet of a puppet with no views, head, limbs or poses: what it has, and nothing empty.
    const model = await hdf('sheet', 'store', 'blob', '--poses', '--look', 'risoPop', '--root', root);
    assert.equal(model.code, 0, model.out);
    assert.match(model.out, /blob-model\.jpg {2}model sheet in risoPop, 4 rows: title, turnaround, cycle bob, credits/);
    assert.ok(existsSync(join(root, 'sheets', 'blob-model.jpg')));
    assert.match((await hdf('find', 'blob', '--root', root)).out, /sheets.blob\.jpg/, 'hdf find sends you to the sheet it just wrote');
    assert.equal((await hdf('sheet', 'store', 'nope', '--root', root)).code, 1);
    assert.equal((await hdf('sheet', 'store', 'blob', '--cycle', 'trot', '--root', root)).code, 2);
    // A payload that breaks a rule never reaches the store.
    writeFileSync(file, JSON.stringify({ units: 100, parts: { body: { pivot: [0, 0], ops: [] } }, poses: { rest: {}, tip: { body: 33 } } }));
    const bad = await hdf('import', file, '--kind', 'puppet', '--name', 'odd', '--root', root, '--licence', 'own');
    assert.equal(bad.code, 2);
    assert.match(bad.out, /does not pass lint[\s\S]*puppet-joint {2}pose 'tip' sets 'body' to 33 degrees, off the 2 degree grid/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('import and find are commands: usage lists them, a bad kind is a usage error', async () => {
  const usage = (await hdf('help')).out;
  assert.match(usage, /^ {2}import {2}<file> --kind cutout\|clip/m);
  assert.match(usage, /^ {2}find {4}<words\.\.\.> \[--kind\]/m);
  assert.match(usage, /^ {2}sheet {3}store <id>/m);
  const dir = mkdtempSync(join(tmpdir(), 'hdf-store-'));
  try {
    // The store the film assets of a 2.0 film do not need: an unknown verb is still an unknown verb.
    assert.equal((await hdf('improt', 'x')).code, 2);
    const bad = await hdf('import', 'films/mini.js', '--kind', 'film', '--name', 'mini', '--root', dir);
    assert.equal(bad.code, 2);
    assert.match(bad.out, /--kind film \(expected cutout \| clip \| puppet \| hand \| stock \| motif \| sample\)/);
    assert.equal((await hdf('find', '--root', dir)).code, 2);          // no words and no --kind
    assert.equal((await hdf('find', 'teapot', '--root', dir)).code, 1); // nothing in an empty store
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('svg: --roles ask writes the colour table, an import prints it, puts the puppet in the store and draws its sheet', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-svg-'));
  try {
    const root = join(dir, 'store'), file = join(dir, 'fox.svg');
    cpSync('assets/src/fox.svg', file);
    assert.match((await hdf('help')).out, /^ {2}svg {5}<file\.svg> --name <id>/m);

    const ask = await hdf('svg', file, '--name', 'fox', '--roles', 'ask', '--root', root);
    assert.equal(ask.code, 0, ask.out);
    assert.match(ask.out, /^#e8734a\s+75242\s+fills\.0\s+auto$/m);
    const table = JSON.parse(readFileSync(join(dir, 'fox.roles.json'), 'utf8'));
    assert.deepEqual(Object.keys(table), ['#e8734a', '#fff1d6', '#2b2b2b', '#5a3a28', '#c8473f'], 'largest area first');
    assert.ok(!existsSync(join(root, 'catalogue.json')), 'ask stops before the store');

    const { code, out } = await hdf('svg', file, '--name', 'fox', '--licence', 'own', '--roles', 'assets/src/fox.roles.json', '--root', root);
    assert.equal(code, 0, out);
    assert.match(out, /^#fff1d6\s+19439\s+light\s+map$/m);
    assert.match(out, /^fox {2}puppet {2}[0-9a-f]{40}\.json {2}own {2}\(new\)$/m);
    assert.match(out, /fox\.jpg {2}7 looks x 16 states x 3 scales \+ 8 frames of walk$/m);
    const cat = JSON.parse(readFileSync(join(root, 'catalogue.json'), 'utf8'));
    assert.deepEqual([cat.fox.kind, cat.fox.file, cat.fox.box], ['puppet', 'fox.svg', [-126, -314, 236, 324]]);
    // The house fox is the SVG plus the gallop `hdf retarget` wrote into the store; the SVG alone is the rest.
    const house = JSON.parse(readFileSync('assets/catalogue.json', 'utf8')).fox, housePath = join('assets/blobs', `${house.sha}.json`);
    const { gallop, ...drawn } = JSON.parse(readFileSync(housePath, 'utf8')).cycles;
    assert.ok(gallop?.from, 'the house fox has a retargeted gallop');
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'blobs', `${cat.fox.sha}.json`), 'utf8')), { ...JSON.parse(readFileSync(housePath, 'utf8')), cycles: drawn });
    // Re-importing the SVG over a fox that has it keeps the retargeted cycle: the payload is the house one.
    assert.equal((await hdf('import', housePath, '--kind', 'puppet', '--name', 'fox', '--licence', 'own', '--root', root)).code, 0);
    const again = await hdf('svg', file, '--name', 'fox', '--licence', 'own', '--roles', 'assets/src/fox.roles.json', '--root', root, '--no-sheet');
    assert.equal(again.code, 0, again.out);
    assert.match(again.out, /^keeps cycle gallop \(retargeted from horse\)$/m);
    assert.equal(JSON.parse(readFileSync(join(root, 'catalogue.json'), 'utf8')).fox.sha, house.sha, 'the same payload as the fox in the house store');

    // A refused element is a usage error that names it; nothing reaches the store.
    writeFileSync(file, '<svg viewBox="0 0 10 10"><g id="a"><text>hi</text></g></svg>');
    const bad = await hdf('svg', file, '--name', 'bad', '--root', root, '--no-sheet');
    assert.equal(bad.code, 2);
    assert.match(bad.out, /svg: fox\.svg: <text> on line 1: refused: live <text>/);
    assert.equal((await hdf('svg', file, '--name', 'bad', '--kind', 'cutout', '--root', root)).code, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("hand: --synth puts a hand in the store; --look 'x~hand:<id>' letters a film in it, an unknown hand is named", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-hand-'));
  try {
    assert.match(await hdf('help').then((r) => r.out), /^ {2}hand {4}--synth <id>/m);
    const r = await hdf('hand', '--synth', 'scribe', '--root', dir);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^scribe {2}hand {2}[0-9a-f]{40}\.json {2}own {2}\(new\)/m);
    const cat = JSON.parse(readFileSync(join(dir, 'catalogue.json'), 'utf8'));
    assert.equal(cat.scribe.kind, 'hand');
    assert.equal(cat.scribe.glyphs, 71);
    assert.match((await hdf('hand', '--synth', 'scribe', '--root', dir)).out, /\(unchanged\)/, 'deterministic');
    assert.equal((await hdf('hand', '--root', dir)).code, 2);

    const only = await hdf('only', 'films/mini.js', '53', '--look', 'paperInk~hand:test', '--out', dir);
    assert.equal(only.code, 0, only.out);
    assert.ok(existsSync(join(dir, 'mini-paperInk~hand:test-053.png')));
    const bad = await hdf('only', 'films/mini.js', '53', '--look', 'paperInk~hand:nobody', '--out', dir);
    assert.equal(bad.code, 1);
    assert.match(bad.out, /no hand 'nobody' in the store/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('hand: --template prints the sheet (PDF, or lettered by a stored hand), <sheet.jpg> --name reads one into the store', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-sheet-'));
  const raw = (...argv) => spawnSync(process.execPath, ['cli/hdf.mjs', ...argv], { encoding: 'buffer' });
  try {
    assert.match(await hdf('help').then((r) => r.out), /^ {2}hand {4}--template/m);
    for (const paper of ['a4', 'letter']) {
      const pdf = raw('hand', '--template', '--paper', paper);
      assert.equal(pdf.status, 0, pdf.stderr.toString());
      assert.equal(pdf.stdout.subarray(0, 5).toString(), '%PDF-');
    }
    assert.equal(raw('hand', '--template', '--paper', 'a3').status, 2);
    const jpg = raw('hand', '--template', '--letter', 'test');
    assert.equal(jpg.status, 0, jpg.stderr.toString());
    const file = join(dir, 'sheet.jpg');
    writeFileSync(file, jpg.stdout);

    const r = await hdf('hand', file, '--name', 'scribe', '--root', dir, '--out', dir);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^scribe {2}hand {2}[0-9a-f]{40}\.json {2}own {2}\(new\)/m);
    assert.match(r.out, /^62 of 62 glyphs traced$/m);
    assert.match(r.out, /^pen: wobble [\d.]+, overshoot [\d.]+, hook [\d.]+, pressure [\d.]+\/1\/[\d.]+, tremor [\d.]+, rounding [\d.]+, width [\d.]+ em {2}\(from 3 lines and the square\)$/m);
    assert.ok(existsSync(join(dir, 'hand-scribe-trace.jpg')));
    assert.ok(existsSync(join(dir, 'sheets', 'scribe.jpg')));
    const cat = JSON.parse(readFileSync(join(dir, 'catalogue.json'), 'utf8'));
    assert.deepEqual([cat.scribe.kind, cat.scribe.glyphs, cat.scribe.licence, cat.scribe.source], ['hand', 62, 'own', 'sheet.jpg']);

    const sheet = await hdf('sheet', '--hand', 'scribe', '--root', dir);
    assert.equal(sheet.code, 0, sheet.out);
    assert.match(sheet.out, /sheets\/scribe\.jpg {2}house \| scribe {2}\(the house draws \. , : ' - ! \? &\)/);
    assert.equal((await hdf('sheet', 'store', 'scribe', '--root', dir)).code, 0, 'a hand in the store gets the same page');

    assert.equal((await hdf('hand', file, '--root', dir)).code, 2, 'needs --name');
    assert.equal((await hdf('hand', file, '--name', 'house', '--root', dir)).code, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test("living packs: find lists a pack cel and its mirror, lint reads a pack, a film draws puppet('pack:teapot')", async () => {
  const found = await hdf('find', 'boat');
  assert.equal(found.code, 0, found.out);
  assert.match(found.out, /^boat {13}cel {5}own {7}note 0\.\.1, in packs\/objects\.js$/m);
  assert.match(found.out, /import \{ boat \} from 'packs\/objects\.js' or puppet\('pack:boat'\)/);
  assert.match(found.out, /^pack:boat {8}puppet {2}own {7}mirror of boat in packs\/objects\.js: note 0\.\.1 \(2 states\)$/m);
  assert.match((await hdf('find', '--kind', 'puppet')).out, /^12 of \d+ in assets$/m, 'the fox and eleven mirrors');
  assert.match(await hdf('help').then((r) => r.out), /donate {2}--export \[<cel\.\.\.>\]/);
  const lint = await hdf('lint', 'packs/objects.js');
  assert.equal(lint.code, 0, lint.out);
  assert.match(lint.out, /^objects: 4 cels, mirrors clean$/m);

  const dir = mkdtempSync(join(tmpdir(), 'hdf-pack-film-'));
  try {
    const core = (f) => new URL(`../core/${f}`, import.meta.url).href;
    writeFileSync(join(dir, 'tea.js'), `import { film, shot, seq, place, paper, meta, puppet, signOff, ramp } from '${core('index.js')}';
import { fromStore } from '${core('assets.js')}';
fromStore(['pack:teapot']);
const teapot = puppet('pack:teapot');
const brew = shot('brew', 1, ({ k, CX, CY }) => [paper(), meta('anchor', { cel: 'teapot' }), place(CX, CY + 100, teapot({ lid: k, steam: k > 0.5 ? 1 : 0 }))]);
const sign = shot('sign', 2.5, ({ t, CX, CY }) => [paper(), meta('anchor', { name: 'signOff' }), signOff('tea', 'time', { x: CX, y: CY, pA: ramp(0, 0.4, t), pB: ramp(0.4, 0.8, t) })]);
export default film({ name: 'tea', look: 'paperInk', timeline: seq(brew, sign) });
`);
    const l = await hdf('lint', join(dir, 'tea.js'));
    assert.equal(l.code, 0, l.out);
    const r = await hdf('only', join(dir, 'tea.js'), '11', '--out', dir, '--width', '240');
    assert.equal(r.code, 0, r.out);
    assert.ok(existsSync(join(dir, 'tea-011.png')), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('skeletons and retargeting: clip --store rigs a stored clip in place, retarget writes a cycle into a puppet', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-rig-'));
  try {
    const root = join(dir, 'store'), house = JSON.parse(readFileSync('assets/catalogue.json', 'utf8'));
    assert.match((await hdf('help')).out, /^ {2}retarget --clip <id> --to <puppet> --map <map\.json> --name <cycle>/m);
    // The horse without its skeleton, as it was before S14, and the fox as its SVG draws it.
    const bare = JSON.parse(readFileSync(join('assets/blobs', `${house.horse.sha}.json`), 'utf8'));
    for (const f of bare.frames) delete f.skel;
    delete bare.rig; delete bare.facing;
    writeFileSync(join(dir, 'horse.json'), JSON.stringify(bare));
    assert.equal((await hdf('import', join(dir, 'horse.json'), '--kind', 'clip', '--name', 'horse', '--licence', 'PD', '--root', root)).code, 0);
    assert.equal((await hdf('svg', 'assets/src/fox.svg', '--name', 'fox', '--licence', 'own', '--roles', 'assets/src/fox.roles.json', '--root', root, '--no-sheet')).code, 0);

    const early = await hdf('retarget', '--clip', 'horse', '--to', 'fox', '--map', 'horse-fox.json', '--name', 'gallop', '--root', root);
    assert.equal(early.code, 1);
    assert.match(early.out, /no skeleton in every frame \(hdf clip --store <id> --rig quadruped\)/);
    assert.equal((await hdf('clip', '--store', 'horse', '--root', root)).code, 2, 'which rig?');

    const rig = await hdf('clip', '--store', 'horse', '--rig', 'quadruped', '--root', root, '--out', dir);
    assert.equal(rig.code, 0, rig.out);
    assert.match(rig.out, /^horse {2}clip {2}[0-9a-f]{40}\.json {2}quadruped skeleton, 12 frames {2}\(replaces [0-9a-f]{8}\)$/m);
    assert.ok(existsSync(join(dir, 'clip-horse-skel.jpg')));
    const cat = () => JSON.parse(readFileSync(join(root, 'catalogue.json'), 'utf8'));
    assert.equal(cat().horse.sha, house.horse.sha, 'the same skeleton as the house horse');

    const dry = await hdf('retarget', '--clip', 'horse', '--to', 'fox', '--map', 'horse-fox.json', '--name', 'gallop', '--root', root, '--dry');
    assert.equal(dry.code, 0, dry.out);
    assert.match(dry.out, /^horse -> fox\.gallop: 12 frames at 12 fps, body head tail leg-l leg-r arm-l arm-r, lift x0\.\d+$/m);
    assert.match(dry.out, /^ {2}11 {2}body -?\d+ {2}head/m);
    const before = cat().fox.sha;
    const run = await hdf('retarget', '--clip', 'horse', '--to', 'fox', '--map', 'horse-fox.json', '--name', 'gallop', '--root', root);
    assert.equal(run.code, 0, run.out);
    assert.match(run.out, /^fox {2}puppet {2}[0-9a-f]{40}\.json {2}cycles: walk, run, gallop {2}\(replaces [0-9a-f]{8}\)$/m);
    assert.equal(cat().fox.sha, house.fox.sha, 'the same fox as the house store');
    assert.ok(!existsSync(join(root, 'blobs', `${before}.json`)), 'the old blob is dropped');
    const again = await hdf('retarget', '--clip', 'horse', '--to', 'fox', '--map', 'horse-fox.json', '--name', 'gallop', '--root', root);
    assert.match(again.out, /\(unchanged\)$/m);

    const bad = await hdf('retarget', '--clip', 'fox', '--to', 'fox', '--map', 'horse-fox.json', '--name', 'x', '--root', root);
    assert.equal(bad.code, 2);
    assert.match(bad.out, /--clip fox is a puppet, not a clip/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('motion from your phone: clip --kind pose explains itself without MediaPipe, makes a clip from landmarks, retarget walks the fox', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-pose-'));
  try {
    const root = join(dir, 'store');
    assert.match((await hdf('help')).out, /^ {2}clip {4}--kind pose <frames-dir\|landmarks\.json> --name <id>/m);
    // A folder of frames with no python that has MediaPipe: it says what to install, and how to go on without.
    const noPy = spawnSync(process.execPath, ['cli/hdf.mjs', 'clip', '--kind', 'pose', dir, '--name', 'me', '--root', root],
      { encoding: 'utf8', env: { ...process.env, HDF_PYTHON: join(dir, 'no-python') } });
    assert.equal(noPy.status, 1);
    assert.match(noPy.stderr, /needs MediaPipe, and there is no '.*no-python' to run/);
    assert.match(noPy.stderr, /python3 -m pip install mediapipe/);
    assert.match(noPy.stderr, /hdf clip --kind pose out\/pose-<name>\.json --name <id>/);
    assert.equal((await hdf('clip', '--kind', 'film', dir, '--name', 'me')).code, 2);

    // Landmarks as cli/pose.py writes them (a synthetic walker) -> a biped clip in the store.
    const { poseJSON } = await import('./walker.js');
    writeFileSync(join(dir, 'pose-me.json'), JSON.stringify(poseJSON()));
    const made = await hdf('clip', '--kind', 'pose', join(dir, 'pose-me.json'), '--name', 'me', '--root', root, '--out', dir);
    assert.equal(made.code, 0, made.out);
    assert.match(made.out, /^me {2}75 frames at 30 fps -> 12 at 12 fps, biped, facing 1, h \d+, loop of 12 from \d+ \(seam 0 h\)$/m);
    assert.match(made.out, /^me {2}clip {2}[0-9a-f]{40}\.json {2}own {2}\(new\)$/m);
    assert.ok(existsSync(join(dir, 'clip-me-skel.jpg')));
    assert.match(made.out, /^next: hdf retarget --clip me --to fox --map biped-fox\.json --name walk/m);

    // The fox as its SVG draws it, with the hand-authored walk; the filmed one replaces it.
    assert.equal((await hdf('svg', 'assets/src/fox.svg', '--name', 'fox', '--licence', 'own', '--roles', 'assets/src/fox.roles.json', '--root', root, '--no-sheet')).code, 0);
    const walk = await hdf('retarget', '--clip', 'me', '--to', 'fox', '--map', 'biped-fox.json', '--name', 'walk', '--root', root);
    assert.equal(walk.code, 0, walk.out);
    assert.match(walk.out, /^me -> fox\.walk: 12 frames at 12 fps, body head tail leg-l leg-r arm-l arm-r, lift x0\.\d+$/m);
    assert.match(walk.out, /^replaces cycle walk \(hand-authored\)$/m);
    const cat = JSON.parse(readFileSync(join(root, 'catalogue.json'), 'utf8'));
    const fox = JSON.parse(readFileSync(join(root, 'blobs', `${cat.fox.sha}.json`), 'utf8'));
    assert.deepEqual(fox.cycles.walk.from, { clip: 'me', sha: cat.me.sha, map: 'biped-fox.json' });
    assert.equal(fox.cycles.walk.n, 12);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
