// A2: write -- put, remove, gc, move (asset-library plan §5 A2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { HOUSE_ROOT, colours, imageInfo, isLegacySha, openLibrary, quantise, readShelf, sha, sniff } from '../index.js';

// A PNG of w x h RGBA pixels (filter 0, one IDAT), and the pixels themselves for a `pixels` probe.
function png(w, h, rgba) {
  const chunk = (name, data) => {
    const len = Buffer.alloc(4), crc = Buffer.alloc(4), body = Buffer.concat([Buffer.from(name, 'latin1'), data]);
    len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) Buffer.from(rgba.subarray(y * w * 4, (y + 1) * w * 4)).copy(rows, y * (1 + w * 4) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
function pixels(w, h, at) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(at(x, y), (y * w + x) * 4);
  return { data, width: w, height: h };
}
const RED = [200, 40, 40, 255], BLUE = [30, 60, 200, 255], CLEAR = [0, 0, 0, 0];
// 8 x 4: the left half red, the right half blue.
const HALVES = pixels(8, 4, (x) => (x < 4 ? RED : BLUE));
// 8 x 8: a red square on a clear field, and the square as a cutout's silhouette.
const SQUARE = pixels(8, 8, (x, y) => (x >= 2 && x < 6 && y >= 2 && y < 6 ? RED : CLEAR));
const SQ_SIL = { sub: [{ pts: [2, 2, 6, 2, 6, 6, 2, 6], closed: true }], box: [2, 2, 4, 4] };

const IMAGE = { id: 'halves', kind: 'image', name: 'Halves', desc: 'red and blue', tags: ['test'], licence: 'own', credit: '', source: '' };
const CUTOUT = { id: 'square', kind: 'cutout', name: 'Square', tags: ['test'], licence: 'CC0', credit: '', source: '', box: [0, 0, 8, 8], w: 8, h: 8, sil: SQ_SIL };

const temp = () => mkdtempSync(join(tmpdir(), 'assetlib-test-'));
const files = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).sort() : []);

test('put: hashes with sha256, derives media, ext, bytes, added and header dims, writes blob and catalogue', () => {
  const root = temp(), shelf = readShelf(root, { name: 'user' }), bytes = png(8, 4, HALVES.data);
  const out = shelf.put(IMAGE, bytes, { by: 'test' });
  assert.equal(out.created, true);
  assert.equal(out.path, join(root, 'blobs', `${sha(bytes)}.png`));
  assert.deepEqual(readFileSync(out.path), bytes);
  const { added, ...rest } = out.entry;
  assert.match(added, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(rest, {
    kind: 'image', name: 'Halves', desc: 'red and blue', tags: ['test'], licence: 'own', credit: '', source: '',
    media: 'raster', sha: sha(bytes), ext: 'png', bytes: bytes.length, w: 8, h: 4, alpha: true, by: 'test',
  });
  // The catalogue is hdf's line format, and a fresh read sees the entry.
  assert.equal(readFileSync(join(root, 'catalogue.json'), 'utf8'), `{\n"halves": ${JSON.stringify(out.entry)}\n}\n`);
  assert.deepEqual(readShelf(root).entry('halves'), out.entry);
  assert.deepEqual(files(root), ['blobs', `blobs/${sha(bytes)}.png`, 'catalogue.json'], 'no temp files left behind');
  rmSync(root, { recursive: true });
});

test('put is idempotent: the same bytes are one blob, the entry is replaced, the catalogue does not move', () => {
  const root = temp(), shelf = readShelf(root), bytes = png(8, 4, HALVES.data);
  const first = shelf.put(IMAGE, bytes);
  const cat = readFileSync(shelf.file, 'utf8');
  const again = shelf.put(IMAGE, bytes);
  assert.equal(again.created, false);
  assert.deepEqual(again.entry, first.entry);
  assert.equal(readFileSync(shelf.file, 'utf8'), cat);
  // A record from the library puts back as the entry it came from (id, shelf and shadowed are not stored).
  const lib = openLibrary({ shelves: [{ name: 'user', root }] });
  shelf.put(lib.get('halves'), bytes);
  assert.equal(readFileSync(shelf.file, 'utf8'), cat);
  // Two ids, the same bytes: two entries, one blob.
  shelf.put({ ...IMAGE, id: 'halves-copy' }, bytes);
  assert.deepEqual(files(join(root, 'blobs')), [`${sha(bytes)}.png`]);
  // New bytes under the old id replace the entry and orphan the old blob, keeping the date it was added.
  const other = png(8, 4, SQUARE.data.subarray(0, 8 * 4 * 4));
  const replaced = shelf.put({ ...IMAGE, id: 'halves-copy', added: undefined }, other);
  assert.equal(replaced.entry.added, first.entry.added);
  assert.deepEqual(shelf.orphans(), []);            // halves still holds the first blob
  shelf.put({ ...IMAGE }, other);
  assert.deepEqual(shelf.orphans(), [join(root, 'blobs', `${sha(bytes)}.png`)]);
  rmSync(root, { recursive: true });
});

test('put refuses before any write: a bad licence, a missing kind field, bytes that are not the kind', () => {
  const root = join(temp(), 'shelf'), shelf = readShelf(root), bytes = png(8, 8, SQUARE.data);
  assert.throws(() => shelf.put({ ...IMAGE, licence: 'MIT' }, bytes), /asset 'halves' is not a valid image \(shelf shelf\):\n {2}licence 'MIT': expected CC0/);
  assert.throws(() => shelf.put({ ...CUTOUT, sil: undefined }, bytes), /not a valid cutout[^]*sil: missing/);
  assert.throws(() => shelf.put({ ...IMAGE, kind: 'sprite' }, bytes), /kind 'sprite': expected image \| video/);
  assert.throws(() => shelf.put({ ...IMAGE, id: 'Bad Id' }, bytes), /id 'Bad Id'/);
  assert.throws(() => shelf.put({ ...IMAGE, ext: 'jpg' }, bytes), /ext 'jpg': the bytes are png/);
  assert.throws(() => shelf.put({ ...IMAGE, kind: 'video' }, bytes), /ext 'png': a video payload is mp4/);
  assert.throws(() => shelf.put({ ...IMAGE, kind: 'puppet', box: [0, 0, 1, 1], units: 1 }, bytes), /a puppet payload must be JSON/);
  assert.throws(() => shelf.put({ ...IMAGE, kind: 'audio' }, Buffer.from('not audio')), /cannot tell what the audio payload is/);
  assert.equal(existsSync(root), false, 'nothing was written');
  rmSync(join(root, '..'), { recursive: true });
});

test('remove: the entry, then its blob and thumb when nothing else shares them', () => {
  const root = temp(), shelf = readShelf(root), bytes = png(8, 4, HALVES.data);
  shelf.put(IMAGE, bytes);
  shelf.put({ ...IMAGE, id: 'twin' }, bytes);
  mkdirSync(join(root, 'thumbs'));
  writeFileSync(shelf.thumbPath('halves'), 'thumb');
  assert.deepEqual(shelf.remove('twin'), []);
  assert.deepEqual(shelf.remove('halves'), [join(root, 'blobs', `${sha(bytes)}.png`), join(root, 'thumbs', `${sha(bytes)}.png`)]);
  assert.equal(readFileSync(shelf.file, 'utf8'), '{\n}\n');
  assert.throws(() => shelf.remove('halves'), /no asset 'halves' on shelf/);
  rmSync(root, { recursive: true });
});

test('gc: orphan blobs and stale thumbs, dry or not', () => {
  const root = temp(), shelf = readShelf(root);
  const a = png(8, 4, HALVES.data), b = png(8, 8, SQUARE.data);
  shelf.put(IMAGE, a);
  shelf.put(IMAGE, b);                                   // a is an orphan now
  mkdirSync(join(root, 'thumbs'));
  writeFileSync(join(root, 'thumbs', `${sha(a)}.png`), 'stale');
  writeFileSync(join(root, 'thumbs', `${sha(b)}.png`), 'fresh');
  writeFileSync(join(root, 'blobs', 'notes.txt'), 'not a blob');
  const dry = shelf.gc({ dry: true });
  assert.deepEqual(dry.map((g) => g.path), [join(root, 'blobs', `${sha(a)}.png`), join(root, 'thumbs', `${sha(a)}.png`)]);
  assert.deepEqual(dry.map((g) => g.bytes), [a.length, 5]);
  assert.ok(existsSync(dry[0].path));
  assert.deepEqual(shelf.gc(), dry);
  assert.deepEqual(shelf.gc(), []);
  assert.deepEqual(files(root), ['blobs', `blobs/${sha(b)}.png`, 'blobs/notes.txt', 'catalogue.json', 'thumbs', `thumbs/${sha(b)}.png`]);
  rmSync(root, { recursive: true });
});

test('move: a cutout round-trips between two shelves with its thumb, and gc finds nothing after', () => {
  const dir = temp(), A = { name: 'project', root: join(dir, 'a') }, B = { name: 'user', root: join(dir, 'b') };
  const lib = openLibrary({ shelves: [A, B] }), bytes = png(8, 8, SQUARE.data);
  const put = readShelf(A.root).put(CUTOUT, bytes);
  mkdirSync(join(A.root, 'thumbs'));
  writeFileSync(join(A.root, 'thumbs', `${put.entry.sha}.png`), 'thumb');

  const fresh = openLibrary({ shelves: [A, B] });
  const there = fresh.move('square', 'user');
  assert.deepEqual([there.from, there.to], ['project', 'user']);
  assert.deepEqual(there.entry, put.entry);
  assert.equal(fresh.locate('square').shelf, 'user');
  assert.deepEqual(files(A.root), ['blobs', 'catalogue.json', 'thumbs']);
  assert.deepEqual(files(B.root), ['blobs', `blobs/${put.entry.sha}.png`, 'catalogue.json', 'thumbs', `thumbs/${put.entry.sha}.png`]);

  const back = fresh.move('square', 'project');
  assert.deepEqual(back.entry, put.entry);
  assert.deepEqual(readFileSync(back.path), bytes);
  assert.equal(readFileSync(join(A.root, 'thumbs', `${put.entry.sha}.png`), 'utf8'), 'thumb');
  assert.deepEqual(fresh.gc(), []);
  assert.deepEqual(openLibrary({ shelves: [A, B] }).get('square'), { ...put.entry, id: 'square', shelf: 'project', shadowed: [] });
  assert.equal(lib.has('square'), false, 'a library reads its shelves once: one opened before the writes does not see them');
  rmSync(dir, { recursive: true });
});

test('move refuses a target holding the id with other bytes; with the same bytes it collapses the two', () => {
  const dir = temp(), A = { name: 'project', root: join(dir, 'a') }, B = { name: 'user', root: join(dir, 'b') };
  readShelf(A.root).put(IMAGE, png(8, 4, HALVES.data));
  readShelf(B.root).put(IMAGE, png(8, 8, SQUARE.data));
  const lib = openLibrary({ shelves: [A, B] });
  assert.throws(() => lib.move('halves', 'user'), /shelf user already has 'halves' with other bytes \([0-9a-f]{12}, not [0-9a-f]{12}\)/);
  assert.throws(() => lib.move('halves', 'project'), /'halves' is already on shelf project/);
  assert.equal(lib.get('halves').shelf, 'project', 'nothing moved');

  readShelf(B.root).put({ ...IMAGE, id: 'same', desc: 'the user copy' }, png(8, 4, HALVES.data));
  readShelf(A.root).put({ ...IMAGE, id: 'same', desc: 'the project copy' }, png(8, 4, HALVES.data));
  const lib2 = openLibrary({ shelves: [A, B] });
  assert.deepEqual(lib2.get('same').shadowed, ['user']);
  lib2.move('same', 'user');
  assert.deepEqual([lib2.get('same').shelf, lib2.get('same').desc, lib2.get('same').shadowed], ['user', 'the project copy', []]);
  rmSync(dir, { recursive: true });
});

test('move rehashes a legacy sha1 entry as sha256: the blob is renamed, not re-encoded', () => {
  const dir = temp(), legacy = join(dir, 'legacy'), user = join(dir, 'user');
  const house = readShelf(HOUSE_ROOT), e = house.entry('teapot');
  assert.ok(isLegacySha(e.sha));
  mkdirSync(join(legacy, 'blobs'), { recursive: true });
  cpSync(house.blobPath(e), readShelf(legacy).blobPath(e));
  writeFileSync(join(legacy, 'catalogue.json'), `{\n"teapot": ${JSON.stringify(e)}\n}\n`);

  const lib = openLibrary({ shelves: [{ name: 'user', root: user }, { name: 'legacy', root: legacy }] });
  const moved = lib.move('teapot', 'user');
  const bytes = readFileSync(house.blobPath(e));
  assert.equal(moved.entry.sha, sha(bytes));
  assert.deepEqual(readFileSync(moved.path), bytes);
  const { sha: _a, media, bytes: n, added, alpha, ...kept } = moved.entry, { sha: _b, ...was } = e;
  assert.deepEqual(kept, was, 'every field hdf wrote is kept');
  assert.deepEqual([media, n, alpha], ['raster', bytes.length, true], 'and the header fills in what hdf did not write');
  assert.deepEqual(files(legacy), ['blobs', 'catalogue.json']);
  rmSync(dir, { recursive: true });
});

test('lib.put runs the host\'s probes: davidup\'s ffprobe shape, pixels for colours, a warning for each gap', async () => {
  const dir = temp(), lib = openLibrary({ shelves: [{ name: 'project', root: join(dir, 'p') }, { name: 'user', root: join(dir, 'u') }] });
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(12)]);
  const VIDEO = { id: 'walk', kind: 'video', name: 'Walk', tags: [], licence: 'own', credit: '', source: '' };
  let seen;
  const probeVideo = async (file) => { seen = readFileSync(file); return { duration: 4.5, width: 1920, height: 1080, fps: 30, fpsRational: '30/1', hasAlpha: false, codec: 'h264', pixelFormat: 'yuv420p', hasAudio: true }; };
  const frame = () => pixels(4, 4, () => BLUE);
  const v = await lib.put(null, VIDEO, mp4, { probes: { probeVideo, pixels: frame } });
  assert.deepEqual(seen, mp4, 'the probe reads the payload from a file');
  assert.equal(v.shelf, 'project');
  assert.deepEqual(v.warnings, []);
  const { id: _id, ...fields } = VIDEO;
  assert.deepEqual({ ...v.entry, added: undefined }, {
    ...fields, media: 'video', sha: sha(mp4), ext: 'mp4', bytes: mp4.length, added: undefined,
    sec: 4.5, fps: 30, w: 1920, h: 1080, alpha: false, codec: 'h264', audio: true, colours: [{ hex: '#1e3cc8', area: 1 }],
  });
  assert.equal(lib.get('walk').sec, 4.5, 'the library sees the write');

  // No probe, or one that throws: the fields stay empty and the warning says which.
  const bare = await lib.put('user', { ...VIDEO, id: 'walk2' }, mp4);
  assert.deepEqual(bare.warnings, ['no probeVideo probe: sec, fps, w, h, alpha, codec, audio left empty', 'no pixels probe: colours left empty']);
  const boom = await lib.put('user', { ...VIDEO, id: 'walk3', colours: [] }, mp4, { probes: { probeVideo: () => { throw new Error('ffprobe not found'); } } });
  assert.deepEqual(boom.warnings, ['probeVideo could not read the video: ffprobe not found; sec, fps, w, h, alpha, codec, audio left empty']);
  assert.equal(boom.entry.sec, undefined);

  // Audio and sample kinds share probeAudio; a sample keeps only the fields it has.
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(8)]);
  const probeAudio = () => ({ duration: 2, sampleRate: 48000, channels: 2, codec: 'pcm_s16le' });
  const sfx = await lib.put(null, { ...VIDEO, id: 'boom', kind: 'audio' }, wav, { probes: { probeAudio } });
  assert.deepEqual([sfx.entry.ext, sfx.entry.sec, sfx.entry.rate, sfx.entry.channels, sfx.entry.codec], ['wav', 2, 48000, 2, 'pcm_s16le']);
  const line = await lib.put(null, { ...VIDEO, id: 'line', kind: 'sample' }, wav, { probes: { probeAudio } });
  assert.deepEqual([line.entry.sec, line.entry.rate, line.warnings], [2, undefined, []]);

  // A font needs its family: from fontMeta, or it refuses (and says why) before writing.
  const ttf = Buffer.from([0, 1, 0, 0, 0, 0, 0, 0]);
  const font = await lib.put(null, { ...VIDEO, id: 'inter', kind: 'font' }, ttf, { probes: { fontMeta: () => ({ family: 'Inter', weight: 400 }) } });
  assert.deepEqual([font.entry.ext, font.entry.family, font.entry.weight], ['ttf', 'Inter', 400]);
  await assert.rejects(lib.put(null, { ...VIDEO, id: 'nofam', kind: 'font' }, ttf), /family: missing/);
  assert.equal(lib.has('nofam'), false);

  // A raster's pixels give its colours and whether it really uses alpha; a cutout counts only its silhouette.
  const img = await lib.put(null, IMAGE, png(8, 4, HALVES.data), { probes: { pixels: () => HALVES } });
  assert.deepEqual([img.entry.alpha, img.entry.colours], [false, [{ hex: '#1e3cc8', area: 0.5 }, { hex: '#c82828', area: 0.5 }]]);
  const cut = await lib.put(null, CUTOUT, png(8, 8, SQUARE.data), { probes: { pixels: () => SQUARE } });
  assert.deepEqual([cut.entry.alpha, cut.entry.colours], [true, [{ hex: '#c82828', area: 1 }]]);

  await assert.rejects(openLibrary({ shelves: [{ name: 'house', root: dir }] }).put(null, IMAGE, Buffer.alloc(0)), /name a shelf to write to \(shelves: house\)/);
  await assert.rejects(lib.put('attic', IMAGE, Buffer.alloc(0)), /no shelf 'attic'/);
  rmSync(dir, { recursive: true });
});

test('lib.remove and lib.gc across shelves', async () => {
  const dir = temp(), P = { name: 'project', root: join(dir, 'p') }, U = { name: 'user', root: join(dir, 'u') };
  const lib = openLibrary({ shelves: [P, U] }), bytes = png(8, 4, HALVES.data);
  await lib.put('project', IMAGE, bytes);
  await lib.put('user', IMAGE, bytes);
  assert.deepEqual(lib.remove('halves'), { id: 'halves', shelf: 'project', removed: [join(P.root, 'blobs', `${sha(bytes)}.png`)] });
  assert.deepEqual(lib.get('halves').shelf, 'user');
  await lib.put('user', IMAGE, png(8, 8, SQUARE.data));
  assert.deepEqual(lib.gc({ dry: true }).map((g) => [g.shelf, g.path]), [['user', join(U.root, 'blobs', `${sha(bytes)}.png`)]]);
  assert.equal(lib.gc({ shelf: 'project' }).length, 0);
  assert.equal(lib.gc().length, 1);
  assert.deepEqual(lib.gc(), []);
  assert.throws(() => lib.remove('nope'), /no asset 'nope' on shelves project/);
  rmSync(dir, { recursive: true });
});

test('sniff and imageInfo: magic and headers, no decoding', () => {
  const house = readShelf(HOUSE_ROOT);
  for (const id of house.ids) {
    const e = house.entry(id);
    if (e.kind !== 'cutout' && e.kind !== 'stock') continue;
    const b = readFileSync(house.blobPath(e));
    assert.deepEqual([sniff(b, e.kind), imageInfo(b)?.w, imageInfo(b)?.h], [e.ext, e.w, e.h], id);
  }
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 120, 0, 160, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(imageInfo(jpg), { type: 'jpg', w: 160, h: 120, alpha: false });
  const vp8x = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8X'), Buffer.from([10, 0, 0, 0, 0x10, 0, 0, 0, 0x7f, 0x07, 0, 0x37, 0x04, 0])]);
  assert.deepEqual(imageInfo(vp8x), { type: 'webp', w: 1920, h: 1080, alpha: true });
  assert.deepEqual(imageInfo(Buffer.from('GIF89a\x40\x01\xf0\x00', 'latin1')), { type: 'gif', w: 320, h: 240, alpha: false });
  assert.deepEqual(imageInfo(png(3, 2, new Uint8Array(24))), { type: 'png', w: 3, h: 2, alpha: true });
  assert.equal(imageInfo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);

  const ftyp = (brand) => Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from(`ftyp${brand}`), Buffer.alloc(8)]);
  const table = {
    svg: [Buffer.from('<?xml version="1.0"?>\n<svg/>'), 'image'], mov: [ftyp('qt  '), 'video'], mp4: [ftyp('isom'), 'video'],
    m4a: [ftyp('isom'), 'audio'], webm: [Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('....webm')]), 'video'],
    mkv: [Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0]), 'video'], mp3: [Buffer.from('ID3\x04'), 'audio'], aac: [Buffer.from([0xff, 0xf1, 0x50]), 'audio'],
    ogg: [Buffer.from('OggS\0'), 'audio'], flac: [Buffer.from('fLaC\0'), 'audio'], otf: [Buffer.from('OTTO\0'), 'font'],
    woff: [Buffer.from('wOFF\0'), 'font'], woff2: [Buffer.from('wOF2\0'), 'font'], ttf: [Buffer.from('true\0'), 'font'],
  };
  for (const [ext, [b, kind]] of Object.entries(table)) assert.equal(sniff(b, kind), ext, ext);
  assert.equal(sniff(Buffer.from('hello'), 'audio'), null);
});

test('colours: the quantiser hdf photo uses, and a silhouette counts only what it encloses (holes too)', () => {
  assert.deepEqual(quantise(HALVES.data), [{ hex: '#1e3cc8', area: 0.5 }, { hex: '#c82828', area: 0.5 }]);
  assert.deepEqual(quantise(new Uint8ClampedArray(16)), []);
  const full = pixels(8, 8, (x, y) => (x >= 3 && x < 5 && y >= 3 && y < 5 ? BLUE : RED));
  assert.deepEqual(colours(full, { sil: SQ_SIL }), [{ hex: '#c82828', area: 0.75 }, { hex: '#1e3cc8', area: 0.25 }]);
  const ring = { sub: [...SQ_SIL.sub, { pts: [3, 3, 5, 3, 5, 5, 3, 5], closed: true }], box: SQ_SIL.box };
  assert.deepEqual(colours(full, { sil: ring }), [{ hex: '#c82828', area: 1 }]);
  assert.deepEqual(colours(full), [{ hex: '#c82828', area: 0.9375 }, { hex: '#1e3cc8', area: 0.0625 }]);
});
