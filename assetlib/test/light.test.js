// D6: palette and text-room facts -- `dark` and `room` at put, lib.refresh, and the filters that read them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DARK_LUMA, ROOM, ROOM_CELLS, ROOM_REGIONS, encodePng, lightFacts, meanLuma, openLibrary, parseQuery, roomOf, search, validate } from '../index.js';

function pixels(w, h, at) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(at(x, y), (y * w + x) * 4);
  return { data, width: w, height: h };
}
const grey = (v, a = 255) => [v, v, v, a];
const ZERO = Object.fromEntries(ROOM_CELLS.map((c) => [c, 0]));
const temp = () => mkdtempSync(join(tmpdir(), 'assetlib-light-'));
const OWN = { tags: [], licence: 'own', credit: '', source: '' };

test('dark: the mean luma counted by alpha is under 0.4', () => {
  assert.equal(DARK_LUMA, 0.4);
  const navy = pixels(4, 4, () => [0, 0, 128, 255]);
  assert.equal(lightFacts(navy).dark, true);
  assert.equal(lightFacts(pixels(4, 4, () => grey(200))).dark, false);
  // Half black, half white is 0.5: light. Transparent pixels do not count, half-transparent ones count half.
  assert.ok(Math.abs(meanLuma(pixels(4, 4, (x) => grey(x < 2 ? 0 : 255))) - 0.5) < 1e-9);
  assert.ok(Math.abs(meanLuma(pixels(4, 4, (x) => (x < 2 ? grey(0, 0) : grey(255)))) - 1) < 1e-9);
  assert.ok(Math.abs(meanLuma(pixels(2, 1, (x) => (x ? grey(255, 51) : grey(0)))) - 1 / 6) < 1e-9);
  // Nothing opaque at all: no `dark`, but a room grid (all quiet).
  assert.deepEqual(lightFacts(pixels(4, 4, () => grey(0, 0))), { room: ZERO });
});

test('room: edge density per third; flat is quiet, a busy corner is busy there only', () => {
  assert.deepEqual(roomOf(pixels(90, 60, () => [20, 30, 90, 255])), ZERO);
  // A checkerboard in the top-left third, flat grey elsewhere.
  const corner = roomOf(pixels(90, 90, (x, y) => (x < 30 && y < 30 ? grey(((x >> 1) + (y >> 1)) % 2 ? 255 : 0) : grey(128))));
  assert.ok(corner.tl > 0.9, `tl ${corner.tl}`);
  for (const c of ROOM_CELLS.filter((c) => c !== 'tl')) assert.ok(corner[c] < 0.1, `${c} ${corner[c]}`);
  // A cutout: an opaque disc on a clear field. Its outline is the only edge; the corners are room.
  const disc = roomOf(pixels(120, 120, (x, y) => (Math.hypot(x - 60, y - 60) < 25 ? grey(0) : grey(0, 0))));
  for (const c of ['tl', 'tr', 'bl', 'br']) assert.equal(disc[c], 0, c);
  assert.ok(disc.t > 0 && disc.c > 0, 'the outline');
  // Grain averages out: a large frame of ±6 noise is quiet everywhere.
  let seed = 7;
  const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 13) - 6; };
  assert.deepEqual(roomOf(pixels(1024, 640, () => grey(200 + noise()))), ZERO);
  // A frame smaller than the grid still gives nine cells.
  assert.deepEqual(Object.keys(roomOf(pixels(2, 1, () => grey(0)))), ROOM_CELLS);
});

test('dark and room are record fields a raster or a video may carry, checked', () => {
  const e = { kind: 'image', name: 'x', ...OWN, sha: 'a'.repeat(64), ext: 'png' };
  assert.deepEqual(validate('x', { ...e, dark: true, room: ZERO }), []);
  assert.deepEqual(validate('x', { ...e, dark: 'yes' }), ['dark: true or false']);
  assert.match(validate('x', { ...e, room: { ...ZERO, c: 2 } })[0], /^room: edge density 0..1 in each third/);
  assert.match(validate('x', { ...e, room: { tl: 0 } })[0], /^room: /);
});

test('put measures a raster; refresh fills a record that has none, and force measures again', async () => {
  const dir = temp();
  try {
    const lib = openLibrary({ shelves: [{ name: 'user', root: dir }] });
    const dusk = pixels(60, 60, (x, y) => (y < 24 ? [10, 10, 40, 255] : grey(((x >> 1) + (y >> 1)) % 2 ? 250 : 5)));
    const probes = { pixels: () => dusk };
    const put = await lib.put('user', { id: 'dusk', kind: 'image', name: 'Dusk', ...OWN }, encodePng(dusk), { probes });
    assert.deepEqual(put.warnings, []);
    assert.equal(put.entry.dark, true);
    assert.deepEqual([put.entry.room.tl, put.entry.room.t, put.entry.room.tr], [0, 0, 0], 'a flat sky');
    assert.ok(put.entry.room.c > 0.5, 'a busy middle');

    // A record from before D6: colours only. refresh reads the rest off the blob and keeps the palette.
    const { dark: _d, room: _r, ...old } = put.entry;
    lib.shelf('user').update('dusk', { dark: null, room: null, colours: [{ hex: '#123456', area: 1 }] });
    const fresh = await lib.refresh('dusk', { probes });
    assert.deepEqual(fresh.changed, ['dark', 'room']);
    assert.deepEqual(fresh.entry.colours, [{ hex: '#123456', area: 1 }]);
    assert.deepEqual({ ...lib.get('dusk'), id: undefined, shelf: undefined, media: undefined, shadowed: undefined }, { ...old, colours: [{ hex: '#123456', area: 1 }], dark: true, room: put.entry.room, id: undefined, shelf: undefined, media: undefined, shadowed: undefined });
    assert.deepEqual((await lib.refresh('dusk', { probes })).changed, [], 'nothing left to measure');
    assert.deepEqual((await lib.refresh('dusk', { probes, force: true })).changed, ['colours'], 'measured again, only the palette differs');
    // No probe: nothing changes, and the warning says what stays empty.
    lib.shelf('user').update('dusk', { room: null });
    const bare = await lib.refresh('dusk');
    assert.deepEqual([bare.changed, bare.warnings], [[], ['no pixels probe: room left empty']]);
    // Not a raster or a video: left as it is.
    await lib.put('user', { id: 'hum', kind: 'audio', name: 'Hum', ...OWN }, Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00'));
    assert.deepEqual((await lib.refresh('hum', { probes })).changed, []);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

// Records as search sees them: a raster and a video with room and dark, one with a palette only, one with neither.
const rec = (id, kind, extra) => ({ id, kind, shelf: 'user', name: id, ...OWN, ...extra });
const busy = (cells) => ({ ...ZERO, ...cells });
const RECORDS = [
  rec('navy', 'video', { dark: true, room: ZERO, colours: [{ hex: '#00007f', area: 1 }] }),
  rec('sky', 'image', { dark: false, room: busy({ b: 0.5, bl: 0.4, br: 0.3, c: 0.1, l: 0.1 }), colours: [{ hex: '#9ec8f0', area: 1 }] }),
  rec('ink', 'image', { dark: true, room: busy({ tl: 0.6, t: 0.15, tr: 0.19 }) }),
  rec('crowd', 'image', { dark: true, room: busy(Object.fromEntries(ROOM_CELLS.map((c) => [c, 0.7]))) }),
  rec('pale', 'stock', { colours: [{ hex: '#f0e8d8', area: 1 }], dark: true }),   // a stored `dark` wins over the palette
  rec('coal', 'stock', { colours: [{ hex: '#202020', area: 1 }] }),              // a palette only
  rec('bare', 'image', {}),
];
const ids = (out) => out.hits.map((h) => h.id);

test('room: every cell of every region named is quieter than 0.2; filters alone list the quietest first', () => {
  assert.equal(ROOM, 0.2);
  assert.deepEqual(Object.keys(ROOM_REGIONS), [...ROOM_CELLS, 'top', 'bottom', 'left', 'right']);
  const tl = search(RECORDS, { room: 'tl' });
  assert.deepEqual(ids(tl), ['sky', 'navy'], 'as quiet: by kind, then id');
  assert.deepEqual(tl.hits.map((h) => h.why), [['room: tl 0'], ['room: tl 0']]);
  // `top` is tl, t and tr: ink's top-left is busy.
  assert.deepEqual(ids(search(RECORDS, { room: 'top' })), ['sky', 'navy']);
  assert.deepEqual(ids(search(RECORDS, { room: 't' })), ['sky', 'navy', 'ink']);
  // Quietest first, summed over the cells asked for: sky's 0.1 before ink's 0.15.
  assert.deepEqual(ids(search(RECORDS, { room: ['t', 'c'] })), ['navy', 'sky', 'ink']);
  assert.deepEqual(search(RECORDS, { room: ['t', 'c'] }).hits.map((h) => h.why[0]), ['room: t 0, c 0', 'room: t 0, c 0.1', 'room: t 0.15, c 0']);
  assert.throws(() => parseQuery({ room: 'middle' }), /room 'middle': expected tl \| t \| tr \| l \| c \| r \| bl \| b \| br \| top \| bottom \| left \| right/);
  // With words, room is a filter and the score ranks.
  assert.deepEqual(ids(search(RECORDS, { q: 'sky', room: 'tl' })), ['sky']);
});

test('dark reads the record\'s own dark, else its palette; with room, the plan\'s query ranks the navy video first', () => {
  const dark = search(RECORDS, { dark: true });
  assert.deepEqual(ids(dark), ['crowd', 'ink', 'coal', 'pale', 'navy']);
  assert.deepEqual(Object.fromEntries(dark.hits.map((h) => [h.id, h.why])), {
    pale: ['dark: true'], coal: ['colours: dark (L* 12)'], crowd: ['dark: true'], ink: ['dark: true'], navy: ['dark: true'],
  });
  assert.deepEqual(ids(search(RECORDS, { dark: false })), ['sky']);
  const plan = search(RECORDS, { dark: true, room: 'tl' });
  assert.deepEqual([ids(plan), plan.hits[0].why], [['navy'], ['dark: true', 'room: tl 0']]);
});
