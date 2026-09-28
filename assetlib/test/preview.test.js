// A4: previews -- the thumb cache, host previewers, the fallback card, the contact sheet (asset-library plan §5 A4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import {
  CARD_H, CARD_W, KINDS, PREVIEW_VERSION, PREVIEW_WIDTH, card, cardKey, contactSheet, decodePng, encodePng, factsOf,
  fresh, lettering, mediaOf, openLibrary, pngText, readShelf, sha, tagOf, withText,
} from '../index.js';

const temp = () => mkdtempSync(join(tmpdir(), 'assetlib-preview-'));
const hexOf = (d, o) => '#' + [d[o], d[o + 1], d[o + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
const at = (px, x, y) => hexOf(px.data, (y * px.width + x) * 4);
const solid = (w, h, [r, g, b, a = 255]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([r, g, b, a], i * 4);
  return { data, width: w, height: h };
};
// How many pixels in a box differ from the colour at its top-left corner: lettering, if any.
const inked = (px, x0, y0, w, h) => {
  const bg = at(px, x0, y0);
  let n = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (at(px, x, y) !== bg) n++;
  return n;
};

// One record per kind, as a catalogue would hold it (no blobs: a card needs none).
const fake = (id) => sha(id);
const RECORDS = {
  image: { w: 1920, h: 1080, colours: [{ hex: '#1a2b3c', area: 0.7 }, { hex: '#f0e0d0', area: 0.3 }] },
  cutout: { w: 815, h: 739, alpha: true, box: [0, 0, 815, 739], sil: { sub: [{ pts: [0, 0, 1, 0, 1, 1, 0, 1] }], box: [0, 0, 1, 1] }, colours: [{ hex: '#dbdddf', area: 0.26 }] },
  stock: { w: 2048, h: 2048, box: [0, 0, 2048, 2048] },
  video: { sec: 12.5, fps: 30, w: 1280, h: 720, audio: true },
  audio: { sec: 3.25, rate: 44100, channels: 2 },
  sample: { sec: 4, align: { text: 'hi', by: 'x', words: [] } },
  font: { family: 'Inter', weight: 700 },
  motif: { box: [0, 0, 120, 80] },
  clip: { n: 24, fps: 12, box: [0, 0, 100, 200] },
  puppet: { units: 1, box: [0, 0, 300, 500] },
  hand: { glyphs: 62 },
};
const EXT = { image: 'png', cutout: 'webp', stock: 'webp', video: 'mp4', audio: 'mp3', sample: 'wav', font: 'ttf', motif: 'json', clip: 'json', puppet: 'json', hand: 'json' };
function kindShelf(root) {
  const lines = KINDS.map((kind) => {
    const id = `a-${kind}`;
    return [id, { kind, name: kind, tags: [], licence: 'own', credit: '', source: '', sha: fake(id), ext: EXT[kind], ...RECORDS[kind] }];
  });
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'catalogue.json'), JSON.stringify(Object.fromEntries(lines)));
  return lines.map(([id]) => id);
}

// A shelf with real PNG blobs, for previewers that read them.
function pngShelf(root, n) {
  const shelf = readShelf(root, { name: 'user' }), ids = [];
  for (let i = 0; i < n; i++) {
    const id = `tile-${String(i).padStart(2, '0')}`;
    shelf.put({ id, kind: 'image', name: `Tile ${i}`, tags: ['tile'], licence: 'CC0', credit: '', source: '' }, encodePng(solid(4, 3, [i * 20, 100, 200 - i * 10])));
    ids.push(id);
  }
  return ids;
}
// A previewer that paints the blob's first pixel over a 480 x 270 field, counting its calls.
function counting(name, version) {
  const calls = [];
  const render = (file, record, opts) => {
    calls.push({ file, id: record.id, opts });
    const px = decodePng(readFileSync(file));
    return encodePng(solid(PREVIEW_WIDTH, 270, [...px.data.subarray(0, 3)]));
  };
  return { calls, p: name ? { name, version, render } : render };
}

// ---------- PNG ----------

test('encodePng and decodePng round-trip RGBA pixels, alpha included', () => {
  const px = { data: new Uint8ClampedArray(7 * 5 * 4), width: 7, height: 5 };
  for (let i = 0; i < px.data.length; i++) px.data[i] = (i * 37 + (i >> 3) * 11) & 0xff;
  const png = encodePng(px, { text: { hello: 'world' } });
  assert.deepEqual(decodePng(png), px);
  assert.deepEqual(pngText(png), { hello: 'world' });
});

test('decodePng reads grey, palette, 16-bit and low-bit PNGs, and refuses interlaced ones', () => {
  const chunk = (name, data) => {
    const body = Buffer.concat([Buffer.from(name, 'latin1'), data]), len = Buffer.alloc(4), crc = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    crc.writeUInt32BE(0);   // decodePng does not check CRCs
    return Buffer.concat([len, body, crc]);
  };
  const png = (w, h, depth, type, rows, extra = [], interlace = 0) => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = depth; ihdr[9] = type; ihdr[12] = interlace;
    const raw = Buffer.concat(rows.map((r) => Buffer.from([0, ...r])));
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...extra, chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  };
  // 8-bit grey, 2 x 1.
  assert.deepEqual([...decodePng(png(2, 1, 8, 0, [[0, 200]])).data], [0, 0, 0, 255, 200, 200, 200, 255]);
  // 2-bit palette with tRNS, 3 x 1: indices 0 1 2 -> red (clear), green, blue.
  const plte = chunk('PLTE', Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255])), trns = chunk('tRNS', Buffer.from([0]));
  assert.deepEqual([...decodePng(png(3, 1, 2, 3, [[0b00011000]], [plte, trns])).data], [255, 0, 0, 0, 0, 255, 0, 255, 0, 0, 255, 255]);
  // 1-bit grey, 3 x 1: 1 0 1.
  assert.deepEqual([...decodePng(png(3, 1, 1, 0, [[0b10100000]])).data], [255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
  // 16-bit RGB with a tRNS colour key, 2 x 1: the second pixel is the key.
  const key = chunk('tRNS', Buffer.from([0, 1, 0, 2, 0, 3]));
  assert.deepEqual([...decodePng(png(2, 1, 16, 2, [[0xff, 0, 0x80, 0, 0x10, 0, 0, 1, 0, 2, 0, 3]], [key])).data], [255, 128, 16, 255, 0, 0, 0, 0]);
  // 8-bit grey + alpha.
  assert.deepEqual([...decodePng(png(1, 1, 8, 4, [[90, 40]])).data], [90, 90, 90, 40]);
  assert.throws(() => decodePng(png(1, 1, 8, 0, [[0]], [], 1)), /interlaced/);
  assert.throws(() => decodePng(Buffer.from('not a png at all')), /not a PNG/);
});

test('withText tags a PNG without touching its pixels, replacing a tag of the same keyword', () => {
  const px = solid(3, 2, [10, 20, 30, 128]), png = encodePng(px, { text: { assetlib: 'old', other: 'kept' } });
  const out = withText(png, { assetlib: 'preview 1 host' });
  assert.deepEqual(pngText(out), { assetlib: 'preview 1 host', other: 'kept' });
  assert.deepEqual(decodePng(out), px);
  assert.deepEqual(tagOf(out), { v: 1, by: 'host' });
  assert.equal(tagOf(png), null, 'a tag that is not a preview tag is no tag');
  assert.equal(tagOf(Buffer.from('nope')), null);
});

// ---------- the card ----------

test('the fallback card renders for every kind with no previewer, cached by sha and tagged as a card', async () => {
  const root = temp(), ids = kindShelf(root);
  const lib = openLibrary({ shelves: [{ name: 'house', root }], thumbCache: temp() });
  for (const id of ids) {
    const out = await lib.preview(id);
    const r = lib.get(id), px = decodePng(out.png);
    assert.equal(out.cached, false, id);
    assert.deepEqual(out.warnings, [], id);
    assert.equal(out.path, join(root, 'thumbs', `${r.sha}.png`), id);
    assert.deepEqual(readFileSync(out.path), out.png, id);
    assert.deepEqual([px.width, px.height], [CARD_W, CARD_H], id);
    assert.equal(out.by, cardKey(r), id);
    assert.deepEqual(tagOf(out.png), { v: PREVIEW_VERSION, by: cardKey(r) }, id);
    // The field is the record's first colour, else its media's; the kind and the id are lettered on it.
    if (r.colours) assert.equal(at(px, 2, 60), r.colours[0].hex, id);
    assert.ok(inked(px, 24, 24, 200, 21) > 50, `${id}: kind lettered`);
    assert.ok(inked(px, 24, 65, 432, 60) > 200, `${id}: id lettered`);
    assert.ok(inked(px, 24, 238, 432, 38) > 30, `${id}: facts and licence lettered`);
    // Asked again, the thumb answers.
    const again = await lib.preview(id);
    assert.equal(again.cached, true, id);
    assert.deepEqual(again.png, out.png, id);
  }
  // Every media got a different field, and every card is its own picture.
  const fields = new Set(ids.filter((id) => !lib.get(id).colours).map((id) => `${mediaOf(lib.get(id).kind)} ${at(decodePng(readFileSync(lib.locate(id).thumb)), 2, 60)}`));
  assert.equal(new Set([...fields].map((f) => f.split(' ')[1])).size, new Set([...fields].map((f) => f.split(' ')[0])).size);
  assert.equal(new Set(ids.map((id) => sha(readFileSync(lib.locate(id).thumb)))).size, ids.length);
  rmSync(root, { recursive: true });
});

test('the card letters what each kind has, in ink that reads on its field', () => {
  assert.equal(factsOf({ kind: 'cutout', w: 815, h: 739, alpha: true }), '815×739 · alpha');
  assert.equal(factsOf({ kind: 'stock', box: [0, 0, 2048, 1024] }), '2048×1024');
  assert.equal(factsOf({ kind: 'video', sec: 12.54, w: 1280, h: 720, fps: 29.97, audio: true }), '12.5 s · 1280×720 · 29.97 fps · sound');
  assert.equal(factsOf({ kind: 'audio', sec: 3, rate: 44100, channels: 2 }), '3 s · 44100 hz · 2 ch');
  assert.equal(factsOf({ kind: 'sample', sec: 4, align: {}, mouth: {} }), '4 s · words · mouth');
  assert.equal(factsOf({ kind: 'font', family: 'Inter', weight: 700, style: 'italic' }), 'Inter · 700 · italic');
  assert.equal(factsOf({ kind: 'clip', n: 24, fps: 12, track: 'face' }), '24 frames · 12 fps · face');
  assert.equal(factsOf({ kind: 'hand', glyphs: 62 }), '62 glyphs');
  assert.equal(factsOf({ kind: 'puppet', box: [0, 0, 300.4, 499.6] }), '300×500');
  assert.equal(factsOf({ kind: 'video' }), '', 'nothing known, nothing said');
  assert.equal(lettering('pack:fox-walk café ✓'), 'PACK:FOX-WALK CAFE ?');
  // Dark field, light ink; light field, dark ink.
  const dark = decodePng(card({ id: 'x', kind: 'image', licence: 'own', colours: [{ hex: '#101010', area: 1 }] }));
  const light = decodePng(card({ id: 'x', kind: 'image', licence: 'own', colours: [{ hex: '#f0f0f0', area: 1 }] }));
  const inkOf = (px) => { for (let x = 24; x < 60; x++) for (let y = 24; y < 45; y++) if (at(px, x, y) !== at(px, 2, 2)) return at(px, x, y); };
  assert.equal(inkOf(dark), '#f6f4ee');
  assert.equal(inkOf(light), '#1c1c1e');
  // The palette runs along the bottom by area.
  const pal = decodePng(card({ id: 'p', kind: 'image', licence: 'own', colours: [{ hex: '#ff0000', area: 0.75 }, { hex: '#0000ff', area: 0.25 }] }));
  assert.equal(at(pal, 10, CARD_H - 5), '#ff0000');
  assert.equal(at(pal, CARD_W - 10, CARD_H - 5), '#0000ff');
  assert.equal(at(pal, 359, CARD_H - 5), '#ff0000');
  assert.equal(at(pal, 361, CARD_H - 5), '#0000ff');
  // A long id wraps at its dashes, a longer one still fits by shrinking, an absurd one is cut, all on the card.
  for (const id of ['a-very-long-asset-id-that-wraps', 'x'.repeat(120), 'y'.repeat(2000)]) {
    const px = decodePng(card({ id, kind: 'puppet', licence: 'own', box: [0, 0, 1, 1] }));
    assert.deepEqual([px.width, px.height], [CARD_W, CARD_H]);
  }
});

test('a card is redrawn when the record would letter differently, and kept when it would not', async () => {
  const root = temp(), [id] = pngShelf(root, 1);
  const first = await openLibrary({ shelves: [{ name: 'user', root }] }).preview(id);
  assert.equal(first.cached, false);
  // Tags are not lettered: a new tag keeps the card.
  const e = readShelf(root).entry(id);
  readShelf(root).put({ ...e, id, tags: ['tile', 'blue'] }, readFileSync(join(root, 'blobs', `${e.sha}.png`)));
  assert.equal((await openLibrary({ shelves: [{ name: 'user', root }] }).preview(id)).cached, true);
  // A new licence is: the card is redrawn under a new key.
  readShelf(root).put({ ...e, id, licence: 'CC-BY', credit: 'Someone' }, readFileSync(join(root, 'blobs', `${e.sha}.png`)));
  const redrawn = await openLibrary({ shelves: [{ name: 'user', root }] }).preview(id);
  assert.equal(redrawn.cached, false);
  assert.notEqual(redrawn.by, first.by);
  assert.equal(redrawn.path, first.path, 'same sha, same thumb path');
  // force redraws whatever the tag says.
  assert.equal((await openLibrary({ shelves: [{ name: 'user', root }] }).preview(id, { force: true })).cached, false);
  rmSync(root, { recursive: true });
});

// ---------- host previewers ----------

test('a registered previewer is used, given the blob, the record and the width, and cached by sha', async () => {
  const root = temp(), [id] = pngShelf(root, 1), { calls, p } = counting('test', 1);
  const lib = openLibrary({ shelves: [{ name: 'user', root }], previewers: { image: p }, thumbCache: temp() });
  const out = await lib.preview(id);
  assert.deepEqual(calls, [{ file: lib.resolve(id), id, opts: { width: PREVIEW_WIDTH } }]);
  assert.equal(out.by, 'test@1');
  assert.equal(out.cached, false);
  assert.deepEqual(tagOf(readFileSync(out.path)), { v: PREVIEW_VERSION, by: 'test@1' });
  assert.deepEqual([decodePng(out.png).width, decodePng(out.png).height], [PREVIEW_WIDTH, 270]);
  assert.equal(at(decodePng(out.png), 0, 0), '#0064c8', 'the previewer drew the blob');
  // Again: the thumb, not the previewer.
  assert.equal((await lib.preview(id)).cached, true);
  assert.equal(calls.length, 1);
  // Another id with the same bytes on the shelf shares the thumb: cached by sha, not by id.
  const e = lib.shelf('user').entry(id);
  await lib.put('user', { ...e, id: 'twin', name: 'Twin' }, readFileSync(lib.resolve(id)));
  const twin = await lib.preview('twin');
  assert.equal(twin.cached, true);
  assert.equal(twin.path, out.path);
  assert.equal(calls.length, 1);
  // A new version of the same previewer redraws; the old one's thumb no longer answers.
  const v2 = counting('test', 2);
  assert.equal((await lib.preview(id, { previewers: { image: v2.p } })).by, 'test@2');
  assert.equal(v2.calls.length, 1);
  // Another host's previewer keeps this picture (two apps share shelves; they must not redraw each other's).
  const other = counting('other');
  assert.equal((await lib.preview(id, { previewers: { image: other.p } })).cached, true);
  assert.equal(other.calls.length, 0);
  // So does a host with no previewer at all: a picture beats a card.
  const bare = openLibrary({ shelves: [{ name: 'user', root }] });
  assert.equal((await bare.preview(id)).by, 'test@2');
  rmSync(root, { recursive: true });
});

test('a card gives way to a previewer registered later; a failing previewer gives the card and a warning', async () => {
  const root = temp(), [id] = pngShelf(root, 1), shelves = [{ name: 'user', root }];
  const bare = await openLibrary({ shelves }).preview(id);
  assert.match(bare.by, /^card:/);
  const { calls, p } = counting();
  const drawn = await openLibrary({ shelves, previewers: { image: p } }).preview(id);
  assert.equal(drawn.by, 'host');
  assert.equal(calls.length, 1);
  // Throws, or returns something that is not a PNG: the card, a warning, and the previewer is asked again next time.
  const boom = () => { throw new Error('no GPU'); };
  const jpeg = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  for (const [bad, why] of [[boom, /previewer host could not draw 'tile-00' \(image\): no GPU; drew its card/], [jpeg, /returned jpg, not a PNG/], [() => null, /returned nothing/]]) {
    const out = await openLibrary({ shelves, previewers: { image: bad } }).preview(id, { force: true });
    assert.match(out.by, /^card:/);
    assert.equal(out.warnings.length, 1);
    assert.match(out.warnings[0], why);
  }
  const retry = await openLibrary({ shelves, previewers: { image: p } }).preview(id);
  assert.equal(retry.cached, false, 'a card never answers while a previewer is registered');
  assert.equal(calls.length, 2);
  // An async previewer is awaited.
  const later = await openLibrary({ shelves, previewers: { image: { name: 'slow', render: async () => encodePng(solid(2, 2, [1, 2, 3])) } } }).preview(id, { force: true });
  assert.equal(later.by, 'slow');
  // A missing blob is not handed to a previewer.
  rmSync(readShelf(root).blobPath(id));
  const gone = await openLibrary({ shelves, previewers: { image: p } }).preview(id, { force: true });
  assert.match(gone.by, /^card:/);
  assert.match(gone.warnings[0], /not asked: blob .* is missing/);
  assert.equal(calls.length, 2);
  rmSync(root, { recursive: true });
});

test('a previewer that is not one is refused when asked, naming the shape', async () => {
  const root = temp(), [id] = pngShelf(root, 1);
  const lib = openLibrary({ shelves: [{ name: 'user', root }], previewers: { image: { name: 'x' } } });
  await assert.rejects(lib.preview(id), /a previewer is a function \(file, record, \{ width \}\) -> PNG bytes/);
  await assert.rejects(lib.preview(id, { previewers: { image: { name: 'a b', render: () => null } } }), /letters, digits, dots, dashes/);
  rmSync(root, { recursive: true });
});

test('fresh(): the cache rule, case by case', () => {
  const r = { id: 'a', kind: 'image', licence: 'own' }, key = cardKey(r);
  const v = (by, ver = PREVIEW_VERSION) => ({ v: ver, by });
  const p = { name: 'davidup', by: 'davidup@3' };
  assert.equal(fresh(null, r, null), false);
  assert.equal(fresh(v(key, PREVIEW_VERSION + 1), r, null), false, 'another preview version');
  assert.equal(fresh(v(key), r, null), true);
  assert.equal(fresh(v(key), { ...r, licence: 'CC0' }, null), false, 'the record letters differently now');
  assert.equal(fresh(v(key), r, p), false, 'a previewer is registered');
  assert.equal(fresh(v('davidup@3'), r, p), true);
  assert.equal(fresh(v('davidup@2'), r, p), false, 'its own older version');
  assert.equal(fresh(v('hdf@1'), r, p), true, "another host's picture");
  assert.equal(fresh(v('hdf@1'), r, null), true);
});

test('a shelf that cannot be written keeps its thumbs in the thumb cache', { skip: process.getuid?.() === 0 && 'root writes anywhere' }, async () => {
  const root = temp(), cache = temp(), [id] = pngShelf(root, 1);
  mkdirSync(join(root, 'thumbs'));
  chmodSync(join(root, 'thumbs'), 0o555);
  try {
    const lib = openLibrary({ shelves: [{ name: 'house', root }], thumbCache: cache });
    const out = await lib.preview(id);
    assert.equal(out.path, join(cache, `${lib.get(id).sha}.png`));
    assert.deepEqual(out.warnings, []);
    assert.equal((await lib.preview(id)).cached, true);
    assert.equal(lib.search({ q: 'tile' }).hits[0].thumb, out.path);
  } finally {
    chmodSync(join(root, 'thumbs'), 0o755);
    rmSync(root, { recursive: true });
    rmSync(cache, { recursive: true });
  }
});

test('search hits carry the thumb once it is drawn', async () => {
  const root = temp(), [id] = pngShelf(root, 1), lib = openLibrary({ shelves: [{ name: 'user', root }], thumbCache: temp() });
  assert.equal(lib.search({ q: 'tile' }).hits[0].thumb, null);
  const out = await lib.preview(id);
  assert.equal(lib.search({ q: 'tile' }).hits[0].thumb, out.path);
  rmSync(root, { recursive: true });
});

// ---------- the contact sheet ----------

test('a 12-id contact sheet is 3 x 4 with captions', async () => {
  const root = temp(), ids = pngShelf(root, 12), { calls, p } = counting('test', 1);
  const lib = openLibrary({ shelves: [{ name: 'user', root }], previewers: { image: p }, thumbCache: temp() });
  const out = await lib.sheet(ids, { out: join(root, 'sheet.png') });
  assert.equal(out.cols, 4);
  assert.equal(out.rows, 3);
  assert.equal(out.cells.length, 12);
  assert.deepEqual(out.warnings, []);
  assert.equal(calls.length, 12);
  assert.deepEqual(readFileSync(out.path), out.png);
  const px = decodePng(out.png);
  assert.deepEqual([px.width, px.height], [out.width, out.height]);
  // Cells run left to right, then down, in the order asked; 3 distinct rows of 4 distinct columns.
  assert.deepEqual(out.cells.map((c) => c.id), ids);
  assert.equal(new Set(out.cells.map((c) => c.x)).size, 4);
  assert.equal(new Set(out.cells.map((c) => c.y)).size, 3);
  for (let i = 0; i < 12; i++) {
    const c = out.cells[i];
    assert.equal(c.x, out.cells[i % 4].x);
    assert.equal(c.y, out.cells[Math.floor(i / 4) * 4].y);
    assert.equal(c.shelf, 'user');
    // The picture is the previewer's colour at the cell's centre; the caption strip under it is lettered,
    // and each caption is its own id's.
    const want = `#${[i * 20, 100, 200 - i * 10].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    assert.equal(at(px, c.x + (c.w >> 1), c.y + (c.h >> 1)), want, c.id);
    assert.ok(inked(px, c.x, c.y + c.h, c.w, 28) > 60, `${c.id}: captioned`);
  }
  const caption = (c) => sha(Buffer.from(Array.from({ length: 28 }, (_, y) => Array.from({ length: c.w }, (_, x) => at(px, c.x + x, c.y + c.h + y)).join('')).join('|')));
  assert.equal(new Set(out.cells.map(caption)).size, 12, 'twelve different captions');
  // Previews made for the sheet are cached like any other.
  await lib.sheet(ids.slice(0, 3));
  assert.equal(calls.length, 12);
  rmSync(root, { recursive: true });
});

test('the sheet takes cols, mixes pictures and cards, checkers alpha, and refuses unknown ids', async () => {
  const root = temp(), kinds = temp(), ids = pngShelf(root, 3), kindIds = kindShelf(kinds);
  const lib = openLibrary({ shelves: [{ name: 'user', root }, { name: 'house', root: kinds }], thumbCache: temp() });
  const out = await lib.sheet([...ids, ...kindIds.slice(0, 2)], { cols: 2, cell: 180 });
  assert.deepEqual([out.cols, out.rows], [2, 3]);
  assert.deepEqual(out.cells.map((c) => [c.w, c.h]), Array(5).fill([180, 120]));
  assert.deepEqual(out.cells.map((c) => c.shelf), ['user', 'user', 'user', 'house', 'house']);
  // A single id is a one-cell sheet; cols never exceeds the ids.
  const one = await lib.sheet(ids[0], { cols: 6 });
  assert.deepEqual([one.cols, one.rows, one.cells.length], [1, 1, 1]);
  await assert.rejects(lib.sheet(['tile-00', 'nope', 'nada']), /no asset 'nope', 'nada' on shelves user .*, house/);
  await assert.rejects(lib.sheet([]), /at least one/);
  // A square picture in a 60 x 40 cell sits at x 10..50. A clear pixel shows the checkerboard (8 px squares
  // from the cell's corner); a half-clear one blends over it.
  const clear = decodePng(contactSheet([{ id: 'c', pixels: solid(4, 4, [255, 0, 0, 0]) }], { cell: 60, gap: 0 }).png);
  assert.equal(at(clear, 5, 2), '#28282e', 'the cell, beside the picture');
  assert.deepEqual([at(clear, 12, 2), at(clear, 20, 2), at(clear, 28, 2)], ['#404046', '#34343a', '#404046']);
  const half = decodePng(contactSheet([{ id: 'h', pixels: solid(4, 4, [255, 0, 0, 128]) }], { cell: 60, gap: 0 }).png);
  assert.deepEqual([at(half, 12, 2), at(half, 20, 2)], ['#a02023', '#9a1a1d'], 'half red over each grey');
  rmSync(root, { recursive: true });
  rmSync(kinds, { recursive: true });
});

test('a preview that cannot be read goes on the sheet as its card, with a warning', async () => {
  const root = temp(), [id] = pngShelf(root, 1);
  // A host PNG this reader refuses (interlaced): the thumb is kept as drawn, the sheet shows the card.
  const interlaced = () => {
    const png = encodePng(solid(2, 2, [9, 9, 9]));
    const b = Buffer.from(png);
    b[8 + 8 + 12] = 1;   // IHDR's interlace byte (the CRC is not checked here)
    return b;
  };
  const lib = openLibrary({ shelves: [{ name: 'user', root }], previewers: { image: { name: 'adam7', render: interlaced } }, thumbCache: temp() });
  const out = await lib.sheet([id]);
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /preview of 'tile-00' could not be read \(interlaced PNG/);
  rmSync(root, { recursive: true });
});
