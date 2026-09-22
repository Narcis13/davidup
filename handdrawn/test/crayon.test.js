// 4.0 L3: the crayon look (construction-paper stock, crayon as its pen with the paper's tooth, the wax finish),
// the sheets (~sheet:<name>) and kids-5 picking it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRenderer } from '../core/raster.js';
import { skiaCanvas } from '../cli/skia.mjs';
import { expand } from '../core/finish.js';
import { circle, fill, paper, poly, stroke, walk } from '../core/list.js';
import { LOOKS, SHEETS, PASTELS, hashLook, resolveLook, withLook } from '../core/looks.js';
import { AUDIENCES } from '../core/audience.js';
import { WORDS } from '../core/lint.js';
import { film, shot } from '../core/tree.js';
import '../core/assets.js';   // reads the store, for the test hand
import { toolFor } from '../packs/hands.js';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const R = createRenderer({ cacheMb: 0, dedup: false, makeCanvas: skiaCanvas });
const px = (list, look, W = 200, H = 200) => {
  const c = skiaCanvas(W, H);
  R.draw(c.getContext('2d'), list, { look, W, H });
  return c.toBufferSync('raw');
};
const named = (list, look, env) => { const out = []; walk(expand(list, look, env), (op) => { if (op.name) out.push(op); }); return out; };

test('crayon: construction stock, wax finish, crayon as its pen, thick, with a tooth', () => {
  const cr = LOOKS.crayon;
  assert.deepEqual([cr.paper, cr.finish, cr.penTool, cr.tooth, cr.thick], ['construction', 'wax', 'crayon', 1, 1.5]);
  assert.equal(cr.palette.paper, SHEETS.cream);
  assert.ok(cr.tools.crayon.w > 4, 'the crayon is wider than its default');
  for (const n of Object.keys(LOOKS).filter((k) => k !== 'crayon')) {
    assert.ok(!('tooth' in LOOKS[n]) && !('thick' in LOOKS[n]) && !('crayon' in LOOKS[n].tools), `${n} carries no crayon field, so its hash holds`);
  }
  assert.equal(WORDS.crayon, 6);
  assert.equal(toolFor('crayon'), 'crayon');
});

test('the sheet: a fade and fibres that stay put across shots, the tooth reseeded', () => {
  const a = named([paper({ seed: 3 })], 'crayon'), b = named([paper({ seed: 99 })], 'crayon');
  const names = new Set(a.map((o) => o.name));
  for (const n of ['stock', 'fade', 'fibres']) assert.ok(names.has(n), n);
  const fixed = (l) => JSON.stringify(l.filter((o) => o.name === 'fade' || o.name === 'fibres'));
  assert.equal(fixed(a), fixed(b), 'the fade is the sheet, not the shot');
  assert.notEqual(JSON.stringify(a), JSON.stringify(b));
  assert.ok(!named([{ op: 'night' }], 'crayon').some((o) => o.name === 'fibres'));
});

test('~sheet:<name>: another construction sheet, a pastel or any colour; bad ones refused', () => {
  assert.equal(resolveLook('crayon~sheet:sky').palette.paper, SHEETS.sky);
  assert.equal(resolveLook('crayon~sheet:rose').palette.paper, PASTELS.rose);
  assert.equal(resolveLook('crayon~sheet:#abcdef').palette.paper, '#abcdef');
  assert.equal(resolveLook('paperInk~sheet:mint').palette.paper, SHEETS.mint, 'any look takes a sheet');
  assert.notEqual(hashLook('crayon~sheet:sky'), hashLook('crayon'));
  assert.throws(() => resolveLook('crayon~sheet:plaid'), /sheet wants one of cream, sky/);
  assert.notEqual(sha(px([paper()], 'crayon~sheet:pink')), sha(px([paper()], 'crayon')));
});

test('the wax finish: a paler wash, then a crayon going back and forth and flecks of the sheet', () => {
  const out = expand([fill(circle(100, 100, 80), 'fills.1', { finish: true, seed: 4 })], 'crayon');
  assert.deepEqual(out.map((o) => o.op), ['fill', 'clip']);
  assert.equal(out[0].alpha, 0.3);
  const [s, g] = out[1].kids;
  assert.deepEqual([s.name, s.tool, s.role], ['scribble', 'crayon', 'fills.1']);
  assert.equal(s.path.sub.length, 1, 'one line, back and forth');
  assert.equal(g.role, 'paper');
  assert.equal(expand([fill(circle(100, 100, 80), 'fills.1', { finish: { base: 0.5 }, alpha: 0.8 })], 'crayon')[0].alpha, 0.4);
});

test('a pen stroke in crayon is wax with the tooth through it; a ruled line and a hairline have none', () => {
  const zig = (o, look = 'crayon') => px([stroke(poly([[20, 150], [100, 40], [180, 150]], false), 'ink', { w: 5, seed: 3, ...o })], look);
  const pen = zig();
  assert.equal(sha(pen), sha(zig()), 'deterministic');
  const toothless = withLook('crayon', { name: 'notooth', tooth: 0 });
  assert.notEqual(sha(pen), sha(zig({}, toothless)), 'the tooth is drawn');
  assert.notEqual(sha(pen), sha(zig({}, withLook('crayon', { name: 'thin', thick: 1 }))), 'thick widens the pen');
  assert.notEqual(sha(zig({}, 'crayon~hand:test')), sha(pen), 'the look\'s hand still pens a crayon line');
  assert.equal(sha(zig({ wobble: 0 })), sha(zig({ wobble: 0 }, toothless)));
  assert.equal(sha(zig({ w: 1 })), sha(zig({ w: 1 }, toothless)), 'a hairline shows no tooth');
  // A crayon stroke that names the tool, in another look, is drawn as before (no tooth, no thick).
  assert.equal(sha(zig({ tool: 'crayon' }, 'risoPop')), sha(zig({ tool: 'crayon' }, withLook('risoPop', { name: 'r2' }))));
});

test('kids-5 picks the crayon look; a look named wins; the others have none of their own', () => {
  const s = shot('s', 1, () => [paper()]);
  assert.equal(AUDIENCES['kids-5'].look, 'crayon');
  assert.equal(film({ name: 'x', timeline: [s], audience: 'kids-5' }).look.name, 'crayon');
  assert.equal(film({ name: 'x', look: 'whiteboard', timeline: [s], audience: 'kids-5' }).look.name, 'whiteboard');
  for (const a of ['general', 'beginner', 'kids-9', 'kids-7']) assert.equal(AUDIENCES[a].look, null, a);
  assert.throws(() => film({ name: 'x', timeline: [s], audience: 'kids-7' }), /film x: needs a look \(audience 'kids-7' has none of its own\)/);
  assert.throws(() => film({ name: 'x', timeline: [s] }), /film x: needs a look$/);
});
