// Asset library I2: the two makers the house pack added to hdf's host (cli/makers.mjs), `paper` (a look's stock as
// a webp) and `synth sample` (a sound effect as a wav, a bed as a looping m4a). Each makes the same bytes from the
// same args, so `asset remake` on a house record is a no-op, and other args make other bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOUSE_ROOT, imageInfo, make, openLibrary } from '../../assetlib/index.js';
import { wavInfo } from '../../assetlib/probe.js';
import { bedSamples, makers, MAKER_VERSION, paperStock, sfxSample } from '../cli/makers.mjs';
import { SR } from '../core/synth.js';
import { readWav } from '../core/wav.js';
import { barOf, MOODS } from '../recipes/sfx.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const record = (id, tool, args) => ({ id, made: { tool, args } });

test('paper: a look\'s stock as a square webp, the same bytes each time; the look and the seed change them', async () => {
  const a = await paperStock({ look: 'paperInk', size: 256 });
  assert.deepEqual(imageInfo(a), { type: 'webp', w: 256, h: 256, alpha: false });
  assert.equal(sha(await paperStock({ look: 'paperInk', size: 256 })), sha(a));
  assert.notEqual(sha(await paperStock({ look: 'paperInk', size: 256, seed: 9 })), sha(a));
  assert.notEqual(sha(await paperStock({ look: 'cutout~sheet:sand', size: 256 })), sha(a), 'a modifier recolours the stock');
  await assert.rejects(paperStock({ size: 256 }), /made.args.look is missing/);
  await assert.rejects(paperStock({ look: 'paperInk', size: 3 }), /size is a whole number of px/);
  await assert.rejects(paperStock({ look: 'noSuchLook', size: 64 }), /noSuchLook/);
  const out = await makers.paper.make(record('paper-test', 'paper', { look: 'notebook', size: 128 }));
  assert.equal(out.file, 'paper-test.webp');
  assert.deepEqual(imageInfo(out.bytes).w, 128);
});

test('synth sample: an effect is a mono wav at the synth\'s rate, its peak at `peak`, its silence cut', async () => {
  const pop = await sfxSample({ sfx: 'pop' });
  assert.deepEqual([wavInfo(pop).rate, wavInfo(pop).channels], [SR, 1]);
  const x = readWav(pop), peak = Math.max(...x.data[0].map(Math.abs));
  assert.ok(Math.abs(peak - 0.5) < 1e-3, `peak ${peak}`);
  assert.ok(x.sec > 0.07 && x.sec < 0.5, `a pop is short (${x.sec} s)`);
  assert.equal(sha(await sfxSample({ sfx: 'pop' })), sha(pop), 'the same bytes each time');
  assert.notEqual(sha(await sfxSample({ sfx: 'pop', opts: { hz: 500 } })), sha(pop));
  const scrub = readWav(await sfxSample({ sfx: 'erase', dur: 0.5 }));
  assert.ok(scrub.sec > 0.45 && scrub.sec < 0.9, `a timed effect lasts its dur (${scrub.sec} s)`);
  await assert.rejects(sfxSample({ sfx: 'kazoo' }), /sfx 'kazoo' is not one of pop, boing/);
  const out = await makers['synth sample'].make(record('sfx-test', 'synth sample', { sfx: 'tick' }));
  assert.equal(out.file, 'sfx-test.wav');
  await assert.rejects(makers['synth sample'].make(record('x', 'synth sample', {})), /names no sfx and no bed/);
});

test('synth sample: a bed is whole chord loops that loop, the second of two passes', async () => {
  const x = await bedSamples({ bed: { mood: 'calm' }, bars: 4 });
  assert.equal(x.length, Math.round(4 * barOf(MOODS.calm.tempo).bar * SR));
  // What rings over the seam is there at the start: the first samples are not the silence a cold start has.
  assert.ok(Math.max(...x.subarray(0, 200).map(Math.abs)) > 1e-3, 'the loop starts under the last bar\'s tail');
  await assert.rejects(bedSamples({ bed: { mood: 'calm' }, bars: 3 }), /bars is a whole number of 4-bar chord loops/);
  await assert.rejects(bedSamples({ bed: { mood: 'sleepy' } }), /bed mood 'sleepy'/);
});

test('synth sample: a bed as an m4a, bit-exact, through make() onto a shelf with its probed duration', { skip: spawnSync(process.env.FFMPEG ?? 'ffmpeg', ['-version']).status !== 0 && 'no ffmpeg' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'hdf-pack-'));
  try {
    const lib = openLibrary({ shelves: [{ name: 'house', root }] });
    const recipe = { id: 'bed-test', kind: 'audio', name: 'Test bed', tags: ['music', 'bed', 'test'], licence: 'own', credit: '', source: '', made: { tool: 'synth sample', args: { bed: { mood: 'calm' }, bars: 4, kbps: 64 } } };
    const one = await make(lib, recipe, { makers, shelf: 'house' });
    assert.equal(one.entry.ext, 'm4a');
    assert.equal(one.entry.made.version, MAKER_VERSION);
    const again = await make(lib, recipe, { makers, shelf: 'house', replace: true });
    assert.deepEqual([again.sha, again.changed], [one.sha, false], 'a remake with the same ffmpeg is the same bytes');
    assert.ok(Math.abs(one.entry.sec - 4 * barOf(MOODS.calm.tempo).bar) < 0.1, `sec ${one.entry.sec}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// The house pack (I2) is committed with its recipes: each paper and sound effect there is what its made block
// makes today. (A bed goes through ffmpeg's AAC encoder, whose bytes are only the same on the same ffmpeg.)
test('I2: the house pack\'s papers and sound effects are what their recipes make', { timeout: 60_000 }, async () => {
  const house = openLibrary({ shelves: [{ name: 'house', root: HOUSE_ROOT }] }).shelf('house');
  const ids = house.ids.filter((id) => { const m = house.entry(id).made; return m?.tool === 'paper' || (m?.tool === 'synth sample' && !m.args?.bed); });
  assert.equal(ids.length, 18, '6 papers and 12 effects');
  for (const id of ids) {
    const e = house.entry(id), out = await makers[e.made.tool].make({ ...e, id });
    assert.equal(sha(out.bytes), e.sha, `${id}: ${e.made.tool} ${JSON.stringify(e.made.args)}`);
  }
});

// The house shelf now holds davidup's kinds too (images, an audio bed, fonts): hdf's store reads them by their
// media, so the dev server and fromStore see the whole shelf.
test('I2: hdf reads the pack\'s davidup kinds off the house store by their media', async () => {
  const { readCatalogue, recordOf } = await import('../core/assets.js');
  const st = readCatalogue(HOUSE_ROOT);
  assert.deepEqual(Object.keys(recordOf(st, 'fox-sprite')).sort(), ['colours', 'credit', 'h', 'licence', 'name', 'source', 'src', 'w']);
  assert.equal(recordOf(st, 'bed-calm').src, st.payloadPath(st.entry('bed-calm')));
  assert.ok(recordOf(st, 'bed-calm').sec > 13);
  assert.deepEqual(recordOf(st, 'hershey-script-font'), { name: 'hershey-script-font', credit: st.entry('hershey-script').credit, source: 'scripts.jhf', licence: 'PD', src: st.payloadPath(st.entry('hershey-script-font')) });
});
