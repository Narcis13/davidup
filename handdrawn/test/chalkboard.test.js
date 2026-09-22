// 4.0 L2: the chalkboard look (slate stock, chalk as its pen with dust, the chalk finish), the ghost of the shot
// before (~ghost:<alpha>) and the chalk's taps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRenderer } from '../core/raster.js';
import { skiaCanvas } from '../cli/skia.mjs';
import { expand } from '../core/finish.js';
import { circle, fill, paper, poly, stroke, text, walk } from '../core/list.js';
import { LOOKS, ghostOf, hashLook, resolveLook, resolveRole, withLook } from '../core/looks.js';
import { WORDS } from '../core/lint.js';
import { cut, film, frame, hold, seq, shot } from '../core/tree.js';
import { strokeStarts, writing } from '../core/write.js';
import { chalkTaps } from '../recipes/sfx.js';
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
const ghosts = (list) => { let n = 0; walk(list, (op) => { if (op.name === 'ghost') n++; }); return n; };

test('chalkboard: slate stock, chalk finish, chalk as its pen with dust, white and coloured chalks', () => {
  const cb = LOOKS.chalkboard;
  assert.deepEqual([cb.paper, cb.finish, cb.penTool, cb.dust], ['slate', 'chalk', 'chalk', 1]);
  assert.deepEqual(cb.palette.inks, ['#eef0e6', '#f4d36b', '#f0a3b8', '#96cfe6']);
  assert.ok(!('dust' in LOOKS.blueprintNight) && !('ghost' in cb), 'no other preset sheds dust; the ghost is an option');
  assert.equal(WORDS.chalkboard, 12);
  assert.equal(toolFor('chalkboard'), 'chalk');
  assert.equal(toolFor('whiteboard'), 'marker');
});

test('the slate: haze and old lines that stay put across shots, a ledge with sticks and an eraser', () => {
  const a = named([paper({ seed: 3 })], 'chalkboard'), b = named([paper({ seed: 99 })], 'chalkboard');
  const names = new Set(a.map((o) => o.name));
  for (const n of ['stock', 'haze', 'scrawl', 'ledge', 'ledge-dust', 'chalk-stick', 'chalk-stick-2', 'eraser']) assert.ok(names.has(n), n);
  const fixed = (l) => JSON.stringify(l.filter((o) => o.name === 'haze' || o.name === 'scrawl'));
  assert.equal(fixed(a), fixed(b), 'the haze is the slate, not the shot');
  const ledge = (W, H) => named([paper()], 'chalkboard', { W, H }).find((o) => o.name === 'ledge').path.box;
  assert.ok(Math.abs(ledge(1080, 1920)[1] - (1920 - 30)) < 1e-9, 'a 9:16 slate has the same ledge');
  assert.ok(!named([{ op: 'night' }], 'chalkboard').some((o) => o.name === 'ledge'));
});

test('the chalk finish: the flat fill and broken chalk passes in a lighter tone', () => {
  const out = expand([fill(circle(100, 100, 80), 'fills.2', { finish: true, seed: 4 })], 'chalkboard');
  assert.deepEqual(out.map((o) => o.op), ['fill', 'clip']);
  const s = out[1].kids[0];
  assert.deepEqual([s.name, s.tool, s.wobble], ['rubbed', 'chalk', 0]);
  assert.deepEqual(s.role, { base: 'fills.2', tint: 0.35 });
  assert.equal(resolveRole(s.role, 'chalkboard').length, 7);
});

test('a pen stroke on the chalkboard is chalk, with dust off its sides; a ruled line sheds none', () => {
  const zig = (o, look = 'chalkboard') => px([stroke(poly([[20, 150], [100, 40], [180, 150]], false), 'ink', { w: 5, seed: 3, ...o })], look);
  const pen = zig();
  assert.equal(sha(pen), sha(zig()), 'deterministic');
  assert.notEqual(sha(pen), sha(zig({}, 'blueprintNight')));
  const dustless = withLook('chalkboard', { name: 'nodust', dust: 0 });
  assert.notEqual(sha(pen), sha(zig({}, dustless)), 'dust is drawn');
  assert.notEqual(sha(zig({}, 'chalkboard~hand:test')), sha(pen), 'the look\'s hand still pens a chalk line');
  // Blueprint's chalk strokes, which name the tool, are unchanged by the chalkboard's work (no dust field).
  assert.equal(sha(zig({ tool: 'chalk' }, 'blueprintNight')), sha(zig({ tool: 'chalk' }, 'blueprintNight')));
  // Dust sits outside the line: a ruled line (wobble 0) has none, so it matches the dustless look's.
  assert.equal(sha(zig({ wobble: 0 })), sha(zig({ wobble: 0 }, withLook(dustless, { dust: 0 }))));
});

test('~ghost:<alpha>: a look option read without resolving; bad alphas refused', () => {
  assert.equal(ghostOf('chalkboard'), 0);
  assert.equal(ghostOf('chalkboard~ghost:0.2'), 0.2);
  assert.equal(ghostOf({ name: 'chalkboard~ghost' }), 0.15);
  assert.equal(ghostOf(resolveLook('chalkboard~ghost:0.3')), 0.3);
  assert.equal(ghostOf(withLook('chalkboard', { ghost: 0.15 })), 0.15);
  assert.notEqual(hashLook('chalkboard~ghost:0.15'), hashLook('chalkboard'));
  assert.throws(() => resolveLook('chalkboard~ghost:2'), /ghost wants an alpha in \(0, 1\]/);
});

test('the ghost: each shot draws the one before, half erased, over its stock; cuts and holds pass it on', () => {
  const a = shot('a', 0.5, () => [paper(), fill(circle(540, 540, 200), 'fills.0')]);
  const b = shot('b', 0.5, () => [paper(), stroke(circle(540, 540, 100), 'inks.1', { w: 6 })]);
  const c = shot('c', 0.5, () => [paper(), stroke(circle(300, 300, 50), 'ink', { w: 6 })]);
  const tl = seq(a, cut('erase', 0.5, a, b), b, hold(0.5, b), c);
  const plain = film({ name: 'g', look: 'chalkboard', timeline: tl });
  const ghosted = film({ name: 'g', look: 'chalkboard~ghost:0.15', timeline: tl });
  for (let i = 0; i < plain.n; i++) assert.equal(ghosts(frame(plain, i).list), 0, 'no ghost without the option');
  assert.equal(ghosts(frame(ghosted, 0).list), 0, 'the first shot has none');
  const at = (i) => frame(ghosted, i).list;
  assert.equal(ghosts(at(8)), 1, 'the cut: b over a ghost of a');
  assert.equal(ghosts(at(13)), 1, 'b');
  assert.equal(ghosts(at(19)), 1, 'the hold of b keeps b\'s ghost (of a), not a ghost of itself');
  // c's ghost is b's last frame with no stock and no ghost of its own.
  const g = [];
  walk(at(25), (op) => { if (op.name === 'ghost') g.push(op); });
  assert.equal(g.length, 1);
  let stock = 0, inner = 0, ring = 0;
  walk(g[0].kids, (op) => { if (op.op === 'paper') stock++; if (op.name === 'ghost') inner++; if (op.role === 'inks.1') ring++; });
  assert.deepEqual([stock, inner, ring], [0, 0, 1]);
  const f = g[0].kids[0];
  assert.deepEqual([f.op, f.kind, f.args.mode, f.args.ghost, f.args.p], ['fx', 'erase', 'clear', 0.15, 1]);
  // The ghost lies just over the shot's stock: paper first, the ghost next.
  const top = at(25);
  assert.equal(top[0].op, 'paper');
  assert.equal(top[1].name, 'ghost');
});

test('strokeStarts and chalkTaps: a tap where the chalk comes down on each line, never two too close', () => {
  const t = text('chalk it', 100, 100, { size: 60 });
  const starts = strokeStarts(t, { wps: 2 }), plan = writing(t, { wps: 2 });
  assert.equal(starts[0], plan.start);
  assert.ok(starts.every((s, i) => !i || s - starts[i - 1] >= 0.08));
  assert.ok(starts.some((s) => s >= plan.units[1].t1 - 1e-9), 'the second word taps too');
  assert.ok(starts.at(-1) < plan.end);
  assert.ok(strokeStarts(t, { wps: 2, gap: 0 }).length > starts.length);
  const ev = chalkTaps(t, { t0: 2, wps: 2 });
  assert.equal(ev.length, starts.length * 3);
  assert.equal(ev[0].t, 2 + starts[0]);
  assert.deepEqual(chalkTaps(t, { t0: 2, wps: 2 }), ev, 'seeded');
});
