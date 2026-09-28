// H3: hdf's previewers (asset-library plan §7 H3) -- a thumb for each of the seven kinds, found by assetlib
// through cli/host.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { addHost, decodePng, encodePng, loadHosts, openLibrary, tagOf } from '../../assetlib/index.js';
import { ASSET_ROOT, FIELDS, KINDS, readCatalogue } from '../core/assets.js';
import { circle, rect, stroke } from '../core/list.js';
import { KINDS as HOST_KINDS, PREVIEW_VERSION, previewers } from '../cli/host.mjs';
import { RENDERERS } from '../cli/previews.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'hdf-previews-'));

// How many distinct colours a preview has: a paper with nothing drawn on it has a handful.
function colourCount(png) {
  const { data } = decodePng(png), seen = new Set();
  for (let i = 0; i < data.length; i += 4 * 7) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
  return seen.size;
}

// An opaque RGBA texture: warm paper with a darker fibre every few pixels.
function paperPng(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = (x * 7 + y * 13) % 17 === 0 ? 30 : 0, o = (y * w + x) * 4;
    data.set([236 - d, 222 - d, 196 - d, 255], o);
  }
  return encodePng({ data, width: w, height: h });
}

// A shelf holding the kinds the house shelf has none of: a stock, a motif, a face track and a hands track.
function fixtureShelf(root) {
  const st = readCatalogue(root), own = { licence: 'own', credit: '', source: '', tags: [] };
  st.put({ ...own, kind: 'stock', name: 'paper-test', file: 'paper.png', w: 640, h: 400, box: [0, 0, 640, 400] }, paperPng(640, 400));
  const ops = [stroke(circle(0, 0, 40), 'ink'), stroke(rect(-60, -20, 120, 40), 'inks.1')];
  st.put({ ...own, kind: 'motif', name: 'ring', file: 'ring.svg', box: [-60, -40, 120, 80] }, JSON.stringify(ops));
  const face = { track: 'face', n: 4, fps: 12, keys: ['jaw', 'blink'], frames: [[0, 1], [0.4, 1], [1, 0], [0.2, 1]] };
  st.put({ ...own, kind: 'clip', name: 'face-test', file: 'face.mp4', track: 'face', n: 4, fps: 12, h: 1, box: [0, 0, 1, 1] }, JSON.stringify(face));
  const curl = (k) => [k, k, k, k, k];
  const hands = { track: 'hands', n: 3, fps: 12, frames: [{ l: curl(0), r: null }, { l: curl(0.5), r: curl(1) }, { l: curl(1), r: curl(0.2) }] };
  st.put({ ...own, kind: 'clip', name: 'hands-test', file: 'hands.mp4', track: 'hands', n: 3, fps: 12, h: 1, box: [0, 0, 1, 1] }, JSON.stringify(hands));
  return st;
}

test('hdf registers a previewer for each kind it draws, named hdf at one version', () => {
  assert.deepEqual(HOST_KINDS, KINDS);
  assert.deepEqual(Object.keys(RENDERERS).sort(), [...KINDS].sort());
  for (const k of KINDS) {
    assert.equal(previewers[k].name, 'hdf');
    assert.equal(previewers[k].version, PREVIEW_VERSION);
  }
});

test('assetlib finds hdf as a known host, and $ASSETLIB_HOSTS=- leaves it out', async () => {
  const found = await loadHosts({ env: {} });
  assert.deepEqual(found.warnings, []);
  const hdf = found.hosts.find((h) => h.name === 'hdf');
  assert.ok(hdf, 'hdf is next to assetlib in the repo');
  assert.equal(hdf.file, resolve('cli/host.mjs'));
  assert.deepEqual(hdf.kinds, KINDS);
  assert.deepEqual(hdf.adds, KINDS);
  assert.deepEqual(Object.keys(found.previewers), KINDS);
  // Its add side is `hdf import`'s (D3): a cutout's silhouette traced as hdf import traces it.
  const side = await addHost(found.adds, 'cutout');
  assert.equal(side.fields, FIELDS);
  const e = readCatalogue(ASSET_ROOT).entry('teapot');
  const got = await side.derive.cutout(readFileSync(readCatalogue(ASSET_ROOT).payloadPath(e)), { entry: { id: 'teapot' } });
  assert.deepEqual(got.sil, e.sil);
  const off = await loadHosts({ env: { ASSETLIB_HOSTS: '-' } });
  assert.deepEqual(off.hosts, []);
});

test('every entry on the house shelf previews at 480 x 320, drawn and not blank', async () => {
  const st = readCatalogue(ASSET_ROOT);
  assert.ok(st.ids.length > 30);
  for (const id of st.ids) {
    const e = st.entries.get(id);
    const png = await previewers[e.kind].render(st.payloadPath(e), { ...e, id }, { width: 480 });
    const { width, height } = decodePng(png);
    assert.deepEqual([width, height], [480, 320], id);
    assert.ok(colourCount(png) > 20, `${id} (${e.kind}) draws something: ${colourCount(png)} colours`);
  }
});

test('a preview is the same bytes each time, and `width` sets its size', async () => {
  const st = readCatalogue(ASSET_ROOT);
  for (const id of ['fox', 'teapot', 'horse', 'hershey-script', 'ai-again']) {
    const e = st.entries.get(id), args = [st.payloadPath(e), { ...e, id }];
    const a = await previewers[e.kind].render(...args, { width: 480 }), b = await previewers[e.kind].render(...args, { width: 480 });
    assert.ok(a.equals(b), `${id} is deterministic`);
    const small = decodePng(await previewers[e.kind].render(...args, { width: 240 }));
    assert.deepEqual([small.width, small.height], [240, 160], id);
  }
});

test('a stock, a motif and two tracks preview through the library, tagged hdf, then come from the cache', async () => {
  const root = tmp();
  try {
    fixtureShelf(root);
    const lib = openLibrary({ shelves: [{ name: 'project', root }], previewers });
    for (const id of ['paper-test', 'ring', 'face-test', 'hands-test']) {
      const pv = await lib.preview(id);
      assert.deepEqual(pv.warnings, [], id);
      assert.equal(pv.by, `hdf@${PREVIEW_VERSION}`, id);
      assert.equal(tagOf(pv.png).by, `hdf@${PREVIEW_VERSION}`);
      assert.ok(existsSync(pv.path) && pv.path.startsWith(join(root, 'thumbs')), id);
      assert.ok(colourCount(pv.png) > 5, `${id} draws something`);
      assert.equal((await lib.preview(id)).cached, true, `${id} is cached`);
    }
    // The paper at 1:1: its fibre shows in the middle of the thumb, not scaled away.
    const { data, width } = decodePng((await lib.preview('paper-test')).png), row = 20 * width * 4;
    let fibres = 0;
    for (let x = 0; x < width; x++) if (data[row + x * 4] < 220) fibres++;
    assert.ok(fibres > 10, `fibres on a row of the stock: ${fibres}`);
    const sheet = await lib.sheet(['paper-test', 'ring', 'face-test']);
    assert.deepEqual([sheet.cols, sheet.rows, sheet.warnings], [2, 2, []]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('with no host, the same library draws cards; with hdf registered, the cards are redrawn', async () => {
  const root = tmp();
  try {
    fixtureShelf(root);
    const bare = openLibrary({ shelves: [{ name: 'project', root }] });
    assert.match((await bare.preview('ring')).by, /^card:/);
    const withHdf = openLibrary({ shelves: [{ name: 'project', root }], previewers });
    const pv = await withHdf.preview('ring');
    assert.equal(pv.cached, false);
    assert.equal(pv.by, `hdf@${PREVIEW_VERSION}`);
    // And a host that draws no kind keeps hdf's picture rather than replacing it with a card.
    assert.equal((await bare.preview('ring')).by, `hdf@${PREVIEW_VERSION}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
