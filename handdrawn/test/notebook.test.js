// 4.0 L4: the notebook look (ruled stock with a red margin and punched holes, a felt tip as its pen, the felt
// finish), the margin's motifs (coffeeRing, paperClip, marginDoodle) and the page-turn fx('flip').
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRenderer } from '../core/raster.js';
import { skiaCanvas } from '../cli/skia.mjs';
import { expand, RULED } from '../core/finish.js';
import { circle, fill, fx, group, paper, poly, rect, stroke, walk } from '../core/list.js';
import { LOOKS, withLook } from '../core/looks.js';
import { WORDS } from '../core/lint.js';
import { coffeeRing, margin, marginDoodle, MARGIN_DOODLES, paperClip } from '../core/marks.js';
import { cut, film, frame, seq, shot } from '../core/tree.js';
import '../core/assets.js';   // reads the store, for the test hand
import { toolFor } from '../packs/hands.js';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const R = createRenderer({ cacheMb: 0, dedup: false, makeCanvas: skiaCanvas });
const px = (list, look = 'notebook', W = 200, H = 200) => {
  const c = skiaCanvas(W, H);
  R.draw(c.getContext('2d'), list, { look, W, H });
  return c.toBufferSync('raw');
};
const named = (list, look, env) => { const out = []; walk(expand(list, look, env), (op) => { if (op.name) out.push(op); }); return out; };

test('notebook: ruled stock, felt finish, the felt tip as its pen', () => {
  const nb = LOOKS.notebook;
  assert.deepEqual([nb.paper, nb.finish, nb.penTool], ['ruled', 'felt', 'felt']);
  assert.deepEqual(nb.palette.inks, ['#1d2b53', '#d8342f', '#1f5fc9', '#23924a']);
  assert.ok(nb.tools.felt.w < LOOKS.whiteboard.tools.pen.w, 'a narrow tip, finer than the board marker');
  for (const n of Object.keys(LOOKS).filter((k) => k !== 'notebook')) assert.ok(!('felt' in LOOKS[n].tools), `${n} has no felt tool, so its hash holds`);
  assert.equal(WORDS.notebook, 12);
  assert.equal(toolFor('notebook'), 'pen');
});

test('the page: rules, a red margin and three holes that stay put across shots; the grain reseeded', () => {
  const a = named([paper({ seed: 3 })], 'notebook'), b = named([paper({ seed: 99 })], 'notebook');
  const names = new Set(a.map((o) => o.name));
  for (const n of ['stock', 'rules', 'margin', 'holes', 'hole-under', 'hole-rim']) assert.ok(names.has(n), n);
  const fixed = (l) => JSON.stringify(l.filter((o) => o.name !== 'paper' && o.op !== 'specks'));
  assert.equal(fixed(a), fixed(b), 'the page is the notebook\'s, not the shot\'s');
  assert.notEqual(JSON.stringify(a), JSON.stringify(b));
  const rules = a.find((o) => o.name === 'rules');
  assert.deepEqual([rules.role, rules.wobble], ['guide', 0]);
  assert.equal(rules.path.sub[0].pts[1], RULED.top);
  assert.equal(rules.path.sub[1].pts[1] - rules.path.sub[0].pts[1], RULED.gap);
  // A tall page has more lines at the same spacing, not wider ones; the margin is where margin() says.
  const tall = named([paper()], 'notebook', { W: 1080, H: 1920 }).find((o) => o.name === 'rules');
  assert.ok(tall.path.sub.length > rules.path.sub.length + 15);
  assert.equal(tall.path.sub[1].pts[1] - tall.path.sub[0].pts[1], RULED.gap);
  assert.equal(a.find((o) => o.name === 'margin').path.sub[0].pts[0], margin()[2]);
  assert.deepEqual(margin(1080, 1920), [0, 0, RULED.margin, 1920]);
  assert.deepEqual(margin(540, 960), [0, 0, RULED.margin / 2, 960]);
  assert.ok(!named([{ op: 'night' }], 'notebook').some((o) => o.name === 'rules'));
});

test('the felt finish: a paler wash, then close felt-tip lines at a slant', () => {
  const out = expand([fill(circle(100, 100, 80), 'fills.1', { finish: true, seed: 4 })], 'notebook');
  assert.deepEqual(out.map((o) => o.op), ['fill', 'clip']);
  assert.equal(out[0].alpha, 0.55);
  const [s] = out[1].kids;
  assert.deepEqual([s.name, s.tool, s.wobble], ['coloured', 'felt', 0]);
  assert.deepEqual(s.role, { base: 'fills.1', shade: 0.12 });
  assert.equal(expand([fill(circle(100, 100, 80), 'fills.1', { finish: { base: 1 } })], 'notebook')[0].alpha, undefined);
});

test('a pen stroke in felt tip wicks and pools; a ruled or dashed line does neither', () => {
  const zig = (o, look = 'notebook') => px([stroke(poly([[20, 150], [100, 40], [180, 150]], false), 'ink', { w: 3, seed: 3, ...o })], look);
  const pen = zig(), plainPen = withLook('notebook', { name: 'nofelt', penTool: null });
  assert.equal(sha(pen), sha(zig()), 'deterministic');
  assert.notEqual(sha(pen), sha(zig({}, plainPen)), 'the felt tip is not the pen');
  assert.notEqual(sha(zig({}, 'notebook~hand:test')), sha(pen), 'the look\'s hand still pens a felt line');
  // A felt stroke that names the tool is the same in any look.
  assert.equal(sha(zig({ tool: 'felt' }, 'risoPop')), sha(zig({ tool: 'felt' }, withLook('risoPop', { name: 'r2' }))));
  // Ruled or dashed: one nearly opaque pass and nothing else, the pen's line at 0.94.
  assert.equal(sha(zig({ wobble: 0 })), sha(zig({ wobble: 0, alpha: 0.94 }, plainPen)));
  assert.equal(sha(zig({ dash: [8, 6] })), sha(zig({ dash: [8, 6], alpha: 0.94 }, plainPen)));
});

test('margin motifs: a coffee ring, a paper clip, and the doodles', () => {
  const ring = coffeeRing(100, 100, 60, 3);
  assert.equal(ring.name, 'coffeeRing');
  assert.deepEqual(ring.kids.map((k) => k.name), ['stain', 'pool', 'rim', 'rim', 'rim']);
  assert.equal(coffeeRing(100, 100, 60, 3, { twice: false }).kids.length, 4);
  assert.deepEqual(ring, coffeeRing(100, 100, 60, 3), 'a mark changes only with its arguments');
  const clip = paperClip(100, 20, 120, 1.2, 2);
  assert.equal(clip.name, 'paperClip');
  const wire = clip.kids.find((k) => k.name === 'wire');
  assert.deepEqual([wire.path.sub.length, wire.path.sub[0].closed], [1, false], 'one bent wire');
  assert.deepEqual(MARGIN_DOODLES, ['spiral', 'star', 'cube', 'heart', 'flower', 'zigzag']);
  for (const k of MARGIN_DOODLES) {
    const d = marginDoodle(k, 75, 300, 70, 1);
    assert.deepEqual([d.op, d.name, d.tool], ['stroke', `doodle:${k}`, 'pen'], k);
    const [x, y, w, h] = d.path.box;
    assert.ok(x >= 75 - 40 && x + w <= 75 + 40 && y >= 300 - 45 && y + h <= 300 + 45, `${k} stays about its size: ${d.path.box}`);
  }
  assert.throws(() => marginDoodle('rocket', 0, 0, 10), /marginDoodle: unknown kind 'rocket' \(expected spiral, star/);
  // In every look: they are roles, not colours.
  for (const look of ['notebook', 'paperInk', 'chalkboard']) assert.equal(px([paper(), ring, clip, marginDoodle('star', 75, 75, 60)], look).length, 200 * 200 * 4);
});

test("fx('flip'): nothing of the kids at 0, all of them at 1, a page part-turned between", () => {
  const a = [paper(), fill(circle(100, 100, 60), 'fills.1')], b = [paper({ seed: 8 }), fill(rect(40, 40, 120, 120), 'fills.2')];
  const at = (p, o = {}) => sha(px([group('a', a), fx('flip', { p, ...o }, b)]));
  assert.equal(at(0), sha(px([group('a', a)])));
  assert.equal(at(1), sha(px([group('a', a), group('b', b)])));
  const mid = at(0.5);
  assert.equal(mid, at(0.5), 'deterministic');
  assert.notEqual(mid, at(0));
  assert.notEqual(mid, at(1));
  assert.notEqual(mid, at(0.5, { dir: 'up' }));
  assert.notEqual(mid, at(0.5, { tilt: 0 }));
  assert.notEqual(mid, at(0.5, { dir: 'right' }));
  assert.throws(() => at(0.5, { dir: 'sideways' }), /fx flip: unknown dir 'sideways' \(expected left, right, up, down\)/);
  // A flip works in any look (it draws with the paper, ink, light and shade roles).
  assert.notEqual(sha(px([group('a', a), fx('flip', { p: 0.5 }, b)], 'chalkboard')), mid);
});

test("cut('flip', ...) turns one page of a film to the next", () => {
  const s1 = shot('one', 1, () => [paper(), fill(circle(540, 540, 200), 'fills.0')]);
  const s2 = shot('two', 1, () => [paper(), fill(rect(340, 340, 400, 400), 'fills.2')]);
  const f = film({ name: 'pages', look: 'notebook', timeline: seq(s1, cut('flip', 0.5, s1, s2), s2) });
  const fr = frame(f, 15);
  assert.equal(fr.shot, 'flip:one>two');
  const kinds = [];
  walk(fr.list, (op) => { if (op.op === 'fx') kinds.push(op.kind); });
  assert.deepEqual(kinds, ['flip']);
  assert.equal(px(fr.list, 'notebook', 1080, 1080).length, 1080 * 1080 * 4);
});
