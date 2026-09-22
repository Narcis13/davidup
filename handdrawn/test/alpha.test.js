// 4.0 D1: the alpha render. `~alpha` draws no stock, a wash brings its paper, `hdf render --alpha` encodes
// ProRes 4444 or VP9 with the transparency kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { circle, fill, fx, lookNode, night, paper, rect, stroke, line } from '../core/list.js';
import { expand } from '../core/finish.js';
import { createRenderer, draw } from '../core/raster.js';
import { skiaCanvas } from '../cli/skia.mjs';
import { hashLook, innerLook, resolveLook } from '../core/looks.js';
import { frame } from '../core/tree.js';
import { loadFilm } from '../cli/load.mjs';
import { ALPHA_CODECS, alphaArgs } from '../cli/ffmpeg.mjs';
import { alphaCodec } from '../cli/render.mjs';
import { variant } from '../cli/sheets.mjs';
import { goldenPath } from '../cli/golden.mjs';

const hdf = (...argv) => {
  const r = spawnSync(process.execPath, ['cli/hdf.mjs', ...argv], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
};
const pixels = (list, look, w = 40, h = 40) => {
  const c = skiaCanvas(w, h);
  createRenderer({ makeCanvas: skiaCanvas }).draw(c.getContext('2d'), list, { look, W: w, H: h });
  const buf = c.toBufferSync('raw');
  return (x, y) => [...buf.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];
};

test('~alpha: a look on no stock, one object per look, carried into looks nested in a list', () => {
  const a = resolveLook('paperInk~alpha');
  assert.equal(a.alpha, true);
  assert.equal(a.name, 'paperInk~alpha');
  assert.equal(resolveLook('paperInk~alpha'), a, 'memoised: one look, one hash, one cache');
  assert.notEqual(hashLook(a), hashLook('paperInk'));
  assert.equal(a.palette.paper, resolveLook('paperInk').palette.paper, 'the paper role keeps its colour');
  assert.equal(innerLook('risoPop', a).alpha, true);
  assert.equal(innerLook('risoPop', resolveLook('paperInk')).alpha, undefined);
  assert.throws(() => resolveLook('paperInk~bogus'), /expected from:<id>, hand:<id>, alpha/);
});

test('~alpha: paper() and night() expand to nothing, in a lookNode too; every other op is as before', () => {
  const dot = fill(circle(20, 20, 6), 'ink');
  assert.deepEqual(expand([paper(), dot], 'paperInk~alpha'), [dot]);
  assert.deepEqual(expand([night(), dot], 'paperInk~alpha'), [dot]);
  const nested = expand([lookNode('risoPop', [paper(), dot])], 'paperInk~alpha');
  assert.deepEqual(nested[0].kids, [dot]);
  assert.equal(expand([paper()], 'paperInk')[0].op, 'group', 'the stock still draws without it');
});

test('~alpha pixels: around the drawing is transparent, a wash is opaque on its paper, a shadow stays a shadow', () => {
  const list = [
    paper(),
    fill(rect(2, 30, 16, 8), 'shade', { alpha: 0.3 }),                     // a shadow: translucent, no blend
    stroke(line(22, 29, 36, 29), 'ink', { w: 2 }),                         // a line the wash then covers
    fill(rect(22, 22, 14, 14), 'fills.0', { alpha: 0.4, blend: 'wash' }),   // a watercolour body
  ];
  const on = pixels(list, 'doodlePastel'), off = pixels(list, 'doodlePastel~alpha');
  assert.equal(on(1, 1)[3], 255);
  assert.equal(off(1, 1)[3], 0, 'no stock');
  const shadow = off(10, 34)[3];
  assert.ok(shadow > 50 && shadow < 110, `shadow alpha ${shadow}`);
  assert.equal(off(28, 25)[3], 255, 'the wash is a body');
  // Its paper goes in behind what is drawn, so the wash and the line under it look as they do on the page.
  for (const [x, y] of [[28, 25], [29, 29]]) {
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(off(x, y)[k] - on(x, y)[k]) <= 1, `(${x}, ${y}) channel ${k}: ${off(x, y)} vs ${on(x, y)}`);
  }
  assert.ok(off(29, 29)[0] < off(28, 25)[0] - 60, 'the line shows through the wash');
});

test('~alpha: nightShot darkens the drawing, not the transparency around it', () => {
  const list = [paper(), fx('nightShot', { k: 0.9 }, [fill(circle(20, 20, 8), 'fills.0')])];
  const px = pixels(list, 'paperInk~alpha');
  assert.equal(px(1, 1)[3], 0);
  assert.equal(px(20, 20)[3], 255);
});

test('loadFilm({ alpha }): every look the film pins goes on no stock; frames hash as another look', async () => {
  const f = await loadFilm('films/fox-wave.js', { alpha: true });
  assert.equal(f.look.alpha, true);
  assert.match(f.look.name, /~alpha$/);
  const plain = await loadFilm('films/fox-wave.js');
  assert.deepEqual(frame(f, 12).list.map((o) => o.op), frame(plain, 12).list.map((o) => o.op), 'the list itself is unchanged');
  const px = (() => {
    const c = skiaCanvas(108, 108);
    draw(c.getContext('2d'), frame(f, 12).list, { look: f.look, S: 0.1 });
    return c.toBufferSync('raw');
  })();
  assert.equal(px[3], 0, 'corner transparent');
  const filled = [...Array(108 * 108).keys()].filter((i) => px[i * 4 + 3] === 255).length;
  assert.ok(filled > 300 && filled < 108 * 108 / 3, `the fox covers ${filled} px`);
});

test('alpha codecs: ProRes 4444 in a .mov, VP9 with an alpha plane in a .webm; --alpha is validated', () => {
  assert.deepEqual(ALPHA_CODECS, ['mov', 'webm']);
  const mov = alphaArgs('x.mov', { w: 8, h: 8 }), webm = alphaArgs('x.webm', { w: 8, h: 8, codec: 'webm' });
  assert.deepEqual(mov.slice(mov.indexOf('-c:v'), mov.indexOf('-c:v') + 8), ['-c:v', 'prores_ks', '-profile:v', '4444', '-vendor', 'apl0', '-pix_fmt', 'yuva444p10le']);
  assert.ok(webm.includes('libvpx-vp9') && webm.includes('yuva420p') && !webm.includes('-movflags'));
  assert.equal(mov[mov.indexOf('-pix_fmt') + 1], 'rgba', 'the input is straight RGBA, as skia exports it');
  assert.throws(() => alphaArgs('x.avi', { w: 8, h: 8, codec: 'avi' }), /unknown codec 'avi'/);
  assert.equal(alphaCodec(undefined), null);
  assert.equal(alphaCodec(true), 'mov');
  assert.equal(alphaCodec('webm'), 'webm');
  assert.throws(() => alphaCodec('films/mini.js'), /put the film before --alpha/);
  assert.equal(variant({ name: 'fox-wave' }, { alpha: 'webm' }), 'fox-wave-alpha');
  assert.match(goldenPath('films/fox-wave.js', { name: 'fox-wave' }, { alpha: true }), /goldens\/fox-wave-alpha\.json$/);
});

test('render --alpha: a .mov and a .webm that keep their alpha, sound muxed, a film swallowed by the flag is a usage error',
  { skip: spawnSync('ffmpeg', ['-version']).status !== 0 && 'no ffmpeg' }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'hdf-alpha-'));
    try {
      for (const [flag, file, fmt] of [[[], 'fox-wave-alpha-6f.mov', /yuva444p/], [['webm'], 'fox-wave-alpha-6f.webm', /alpha_mode=1/i]]) {
        const r = hdf('render', 'films/fox-wave.js', '--frames', '6', '--width', '216', '--workers', '1', '--out', dir, '--alpha', ...flag);
        assert.equal(r.code, 0, r.out);
        const ext = file.slice(file.lastIndexOf('.'));
        assert.ok(existsSync(join(dir, file)) && existsSync(join(dir, `fox-wave-alpha-6f-final${ext}`)), r.out);
        const probe = spawnSync(process.env.FFPROBE ?? 'ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt:stream_tags', '-of', 'default=nw=1', join(dir, `fox-wave-alpha-6f-final${ext}`)], { encoding: 'utf8' });
        if (probe.status === 0) assert.match(probe.stdout, fmt);
      }
      assert.ok(existsSync(join(dir, 'fox-wave-alpha-6f-sheet.jpg')));
      assert.equal(hdf('render', '--alpha', 'films/fox-wave.js', '--out', dir).code, 2);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
