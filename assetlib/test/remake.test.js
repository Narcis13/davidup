// I1: `made` and `asset remake` (asset-library plan §9 I1). These makers are fixtures, so assetlib's suite needs no
// hdf; hdf's own makers (a real clip remade, then remade after its source changed) are tested in
// handdrawn/test/remake.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../cli.js';
import { check, encodePng, loadHosts, maker, openLibrary, recipeOf, remake, sha, validate } from '../index.js';

// A w x h PNG of one colour.
const png = (w, h, rgb) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
  return encodePng({ data, width: w, height: h });
};
const RED = png(8, 4, [200, 40, 40]), BLUE = png(6, 6, [30, 60, 200]);

const temp = () => mkdtempSync(join(tmpdir(), 'assetlib-remake-'));
const lib = (root) => openLibrary({ shelves: [{ name: 'user', root }] });
const MADE = { tool: 'paint', from: ['swatch'], args: { colour: 'red' }, at: '2026-09-01T10:00:00.000Z' };
const SPRITE = { id: 'sprite', kind: 'image', name: 'Sprite', tags: ['test'], licence: 'own', credit: '', source: '', sheet: { count: 1 }, made: MADE };
const SWATCH = { id: 'swatch', kind: 'image', name: 'Swatch', tags: ['test'], licence: 'own', credit: '', source: '' };

// A maker painting whatever `paint` holds now: what a tool reading a source that changed does.
function painter(v = 3) {
  const state = { bytes: RED, calls: 0 };
  return { state, m: { version: v, make: async (record, ctx) => { state.calls++; state.ctx = ctx; state.record = record; return { bytes: state.bytes, file: 'sprite.png', from: ['swatch'], fields: { sheet: { count: state.calls } } }; } } };
}

async function shelf() {
  const root = temp(), l = lib(root);
  await l.put('user', SWATCH, BLUE);
  await l.put('user', SPRITE, RED, { by: 'hdf sprite' });
  return { root, l };
}

test('made: validated on every kind; tool is required, from holds ids, at is a time, version an integer or a string', () => {
  const base = { name: 'x', licence: 'own', credit: '', source: '', tags: [], sha: sha('x') };
  const kinds = [['image', 'png'], ['video', 'mp4'], ['audio', 'wav'], ['sample', 'wav'], ['font', 'ttf', { family: 'F' }], ['stock', 'png', { w: 1, h: 1, box: [0, 0, 1, 1] }], ['puppet', 'json', { units: 1, box: [0, 0, 1, 1] }]];
  const WHY = 'made: { tool, from: [ids], args: {}, at: ISO time, version: an integer > 0 or a string }, or null';
  for (const [kind, ext, more] of kinds) {
    const e = { ...base, kind, ext, ...more };
    assert.deepEqual(validate('a', { ...e, made: { ...MADE, version: 2 } }), [], kind);
    assert.deepEqual(validate('a', { ...e, made: { tool: 'paint' } }), [], `${kind}: tool alone`);
    assert.deepEqual(validate('a', { ...e, made: { tool: 'paint', version: '4.0.1' } }), [], `${kind}: a version string`);
    assert.deepEqual(validate('a', { ...e, made: null }), [], `${kind}: null, nothing made it`);
    for (const bad of [{ from: ['x'] }, { tool: '' }, { tool: 'paint', from: ['Not An Id'] }, { tool: 'paint', from: 'x' }, { tool: 'paint', args: [] },
      { tool: 'paint', at: 'yesterday' }, { tool: 'paint', version: 0 }, { tool: 'paint', version: 1.5 }, { tool: 'paint', how: 'by hand' }, 'paint']) {
      assert.deepEqual(validate('a', { ...e, made: bad }), [WHY], `${kind}: ${JSON.stringify(bad)}`);
    }
  }
});

test('recipeOf keeps what the record says and drops what its bytes said', () => {
  const e = { kind: 'font', name: 'F', family: 'Hand', weight: 400, glyphs: 90, sha: 'x', ext: 'ttf', bytes: 3, media: 'font', made: MADE, desc: 'd', by: 'hdf' };
  assert.deepEqual(recipeOf(e), { kind: 'font', name: 'F', family: 'Hand', made: MADE, desc: 'd', by: 'hdf' });
  const s = { kind: 'stock', name: 'S', w: 2, h: 2, box: [0, 0, 2, 2], colours: [], dark: false, sheet: { count: 1 } };
  assert.deepEqual(recipeOf(s), { kind: 'stock', name: 'S', sheet: { count: 1 } });
});

test('remake: the same bytes again is the same sha, the entry kept, made stamped with when and the version', async () => {
  const { root, l } = await shelf();
  try {
    const was = l.shelf('user').entry('sprite'), { state, m } = painter();
    const out = await remake(l, 'sprite', { makers: { paint: m } });
    assert.equal(state.calls, 1);
    assert.equal(state.record.id, 'sprite');
    assert.deepEqual(state.record.made, MADE, 'the maker reads the recipe');
    assert.deepEqual(state.ctx, { lib: l, shelf: 'user', root: l.shelf('user').root });
    assert.deepEqual({ ...out, entry: undefined, path: undefined }, { id: 'sprite', shelf: 'user', tool: 'paint', was: was.sha, sha: was.sha, changed: false, entry: undefined, path: undefined, removed: [], warnings: [] });
    const now = l.shelf('user').entry('sprite');
    assert.equal(now.added, was.added);
    assert.equal(now.by, 'hdf sprite', 'the door it came in by stays its door');
    assert.deepEqual(now.sheet, { count: 1 }, "the maker's fields");
    assert.equal(now.made.version, 3);
    assert.ok(Date.parse(now.made.at) > Date.parse(MADE.at));
    assert.deepEqual({ ...now.made, at: MADE.at, version: undefined }, { ...MADE, version: undefined });
    assert.deepEqual([now.w, now.h], [was.w, was.h]);
    assert.equal(was.colours, undefined);
    assert.deepEqual(now.colours, [{ hex: '#c82828', area: 1 }], 'read off the bytes through the add side, where the bare put measured none');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('remake: new bytes are a new sha in place, their facts read off them, the old blob gone', async () => {
  const { root, l } = await shelf();
  try {
    const was = l.shelf('user').entry('sprite'), old = l.shelf('user').blobPath(was), { state, m } = painter();
    mkdirSync(join(root, 'thumbs'), { recursive: true });
    writeFileSync(l.shelf('user').thumbPath(was), 'thumb');
    state.bytes = png(12, 3, [10, 200, 10]);
    const out = await remake(l, 'sha:' + was.sha.slice(0, 12), { makers: { paint: m } });
    assert.equal(out.changed, true);
    assert.equal(out.was, was.sha);
    assert.equal(out.sha, sha(state.bytes));
    assert.deepEqual(out.removed, [old, join(root, 'thumbs', `${was.sha}.png`)]);
    assert.ok(!existsSync(old));
    assert.deepEqual(readFileSync(out.path), state.bytes);
    const now = l.get('sprite');
    assert.deepEqual([now.w, now.h, now.colours.map((c) => c.hex)], [12, 3, ['#0ac80a']], "the new bytes' facts, not the old");
    assert.equal(now.added, was.added);
    assert.deepEqual(l.gc({ dry: true }), [], 'nothing left behind');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('remake: the old blob stays while another entry holds it, and a made.from the maker names replaces the old', async () => {
  const { root, l } = await shelf();
  try {
    await l.put('user', { ...SWATCH, id: 'twin' }, RED);   // the sprite's bytes under another id
    const was = l.shelf('user').entry('sprite'), { state, m } = painter();
    await l.update('sprite', { made: { ...MADE, from: ['gone'] } });
    state.bytes = BLUE;
    const out = await remake(l, 'sprite', { makers: { paint: m } });
    assert.deepEqual(out.removed, []);
    assert.ok(existsSync(l.shelf('user').blobPath(was)));
    assert.deepEqual(l.get('sprite').made.from, ['swatch']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('remake refuses, the shelf untouched: nothing made it, no maker for its tool, the maker fails or makes nothing', async () => {
  const { root, l } = await shelf();
  const catalogue = () => readFileSync(join(root, 'catalogue.json'), 'utf8');
  try {
    const before = catalogue();
    await assert.rejects(remake(l, 'swatch', { makers: { paint: painter().m } }), /'swatch' on user was not made by a tool/);
    await assert.rejects(remake(l, 'sprite', { makers: { render: () => ({}), draw: () => ({}) } }), /no maker for 'paint' \(which made 'sprite'\); makers: draw, render/);
    await assert.rejects(remake(l, 'sprite'), /makers: none/);
    await assert.rejects(remake(l, 'sprite', { makers: { paint: async () => { throw new Error('no ink'); } } }), /paint could not remake 'sprite': no ink/);
    await assert.rejects(remake(l, 'sprite', { makers: { paint: async () => ({}) } }), /paint made nothing for 'sprite'/);
    await assert.rejects(remake(l, 'sprite', { makers: { paint: async () => ({ bytes: Buffer.from('not a png') }) } }), /not a valid image|cannot tell/);
    await assert.rejects(remake(l, 'nobody', { makers: {} }), /no asset 'nobody'/);
    assert.equal(catalogue(), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('maker: { version, make } or a function; anything else is refused', () => {
  const f = async () => ({});
  assert.deepEqual(maker(f), { version: undefined, make: f });
  assert.deepEqual(maker({ version: 'v2', make: f }), { version: 'v2', make: f });
  assert.throws(() => maker({ version: 1 }, 'paint'), /paint: a maker is \{ version, make\(record, ctx\) \} or a function/);
  assert.throws(() => maker({ version: 0, make: f }, 'paint'), /paint: a maker's version is an integer > 0 or a string/);
});

test('check: a made record whose made.from names an id on no shelf', async () => {
  const { root, l } = await shelf();
  try {
    const made = () => check(l).filter((f) => f.rule === 'made');
    assert.deepEqual(made(), []);
    l.remove('swatch');
    assert.deepEqual(made(), [{ level: 'warn', rule: 'made', shelf: 'user', id: 'sprite', detail: "made by paint from 'swatch', on no shelf" }]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('hosts register makers; a maker that is not one keeps its host out', async () => {
  const dir = temp();
  try {
    writeFileSync(join(dir, 'maker.mjs'), 'export default { name: "painter", makers: { paint: { version: 2, make: async () => ({ bytes: Buffer.alloc(0) }) } } };');
    writeFileSync(join(dir, 'bad.mjs'), 'export default { name: "bad", makers: { paint: 42 } };');
    const got = await loadHosts({ known: [join(dir, 'maker.mjs'), join(dir, 'bad.mjs')], env: {} });
    assert.deepEqual(got.hosts.map((h) => [h.name, h.makers]), [['painter', ['paint']]]);
    assert.deepEqual(Object.keys(got.makers), ['paint']);
    assert.equal(got.warnings.length, 1);
    assert.match(got.warnings[0], /bad\.mjs not loaded: makers\['paint'\]: a maker is/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('asset remake: one line an id, same bytes or changed; a record with no maker exits 1', async () => {
  const { root, l } = await shelf();
  const run = async (argv, makers) => {
    let out = '', err = '';
    const code = await main(argv, { env: { DAVIDUP_ASSETS: root, DAVIDUP_HOUSE: join(root, 'no-house') }, makers, out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
    return { code, out, err };
  };
  try {
    const was = l.shelf('user').entry('sprite').sha.slice(0, 12), { state, m } = painter();
    assert.deepEqual(await run(['remake', 'sprite'], { paint: m }), { code: 0, out: `sprite  user     paint        ${was}…  same bytes\n`, err: '' });
    state.bytes = BLUE;
    const r = await run(['remake', 'sprite', '--json'], { paint: m });
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.out).map((x) => [x.id, x.changed, x.was.slice(0, 12), x.sha]), [['sprite', true, was, sha(BLUE)]]);
    const none = await run(['remake', 'sprite'], {});
    assert.equal(none.code, 1);
    assert.match(none.err, /^asset: no maker for 'paint'/);
    assert.equal((await run(['remake'], {})).code, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
