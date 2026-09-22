// 4.0 W1: the rig sheet. A child draws a character in the boxes; the sheet is photographed; the drawing becomes a
// puppet with the standard biped names that walks. The sheet is drawn in by the package (drawnRigSheet: flat colour
// fills under outlines by the house pen), then "photographed" in colour: keystoned onto a dark table, lit unevenly,
// grained.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { actorOf, VOCABULARY } from '../core/actor.js';
import { CODE, FRAME, MARK, PAGES, homography, readPage, frameMap } from '../core/handsheet.js';
import { lintPuppet } from '../core/lint.js';
import { puppet } from '../core/puppet.js';
import { rng } from '../core/rand.js';
import { retarget } from '../core/retarget.js';
import { RIGS } from '../core/rig.js';
import { K, PIECES, RIG, RIG_SHEETS, jointsIn, readRigSheet, rigBoxes, rigPuppet } from '../core/rigsheet.js';
import { stickMap } from '../core/stick.js';
import { drawnRigSheet, planesOf, rigTemplatePdf, TEST_FIGURE } from '../cli/sketch.mjs';
import { letterSheet, synthHand } from '../cli/hand.mjs';
import { poseJSON, walker } from './walker.js';

// A drawn canvas "photographed": each channel warped onto a W x H picture (the page's corners at quad), a table
// round it, light falling off to one side, grain. -> { img, rgb } as planesOf gives.
function photograph(canvas, quad, { W = 1700, H = 2300, seed = 5 } = {}) {
  const w = canvas.width, h = canvas.height, src = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const back = homography(quad, [[0, 0], [w, 0], [w, h], [0, h]]), r = rng(seed), out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [u, v] = back(x + 0.5, y + 0.5), light = 0.74 + 0.24 * x / W - 0.06 * y / H, noise = (r() - 0.5) * 10, o = 4 * (y * W + x);
    out[o + 3] = 255;
    if (u < 0 || v < 0 || u >= w - 1 || v >= h - 1) { out[o] = out[o + 1] = out[o + 2] = 50 + 20 * y / H + noise; continue; }
    const x0 = Math.floor(u), y0 = Math.floor(v), dx = u - x0, dy = v - y0, k = 4 * (y0 * w + x0);
    for (let c = 0; c < 3; c++) {
      const s = (src[k + c] * (1 - dx) + src[k + 4 + c] * dx) * (1 - dy) + (src[k + 4 * w + c] * (1 - dx) + src[k + 4 * w + 4 + c] * dx) * dy;
      out[o + c] = s * light + noise;
    }
  }
  return planesOf(out, W, H);
}
const QUAD = [[190, 150], [1520, 210], [1590, 2150], [120, 2220]];

const drawn = new Map();
const photo = (sheet = 'biped', skip = []) => {
  const key = `${sheet}:${skip}`;
  if (!drawn.has(key)) drawn.set(key, photograph(drawnRigSheet({ sheet, skip, dpi: 200 }), QUAD));
  return drawn.get(key);
};
const readOf = (sheet = 'biped', o = {}) => { const p = photo(sheet, o.skip); return readRigSheet(p.img, { rgb: p.rgb, ...o.read }); };
let sideRead;
const side = () => (sideRead ??= readOf('biped'));

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const area = (pts) => { let s = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]; return Math.abs(s / 2); };
const centroid = (pts) => {   // the area's centre
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const k = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    a += k; cx += (pts[j][0] + pts[i][0]) * k; cy += (pts[j][1] + pts[i][1]) * k;
  }
  return [cx / (3 * a), cy / (3 * a)];
};
// The mean distance from points to a polyline, mm.
const off = (pts, line) => pts.reduce((t, p) => {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L));
    best = Math.min(best, Math.hypot(p[0] - ax - u * dx, p[1] - ay - u * dy));
  }
  return t + best;
}, 0) / pts.length;

test('rig sheet: the template, its boxes inside the frame, each ring where the next piece is pinned, a code of its own', async () => {
  const pdf = await rigTemplatePdf('a4', ['biped', 'biped-front']);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length, 2);
  for (const sheet of Object.keys(RIG_SHEETS)) {
    const boxes = rigBoxes(sheet);
    assert.deepEqual(boxes.map((b) => b.piece), PIECES[sheet].map((p) => p.piece).filter((p) => boxes.some((b) => b.piece === p)));
    for (const b of boxes) {
      assert.ok(b.x >= 0 && b.x + b.w <= FRAME[0] && b.y > 26 && b.y + b.h + 4 < FRAME[1] - MARK.arm, `${sheet} ${b.piece}: ${b.x},${b.y} ${b.w}x${b.h}`);
      for (const [x, y] of [[b.px, b.py], ...Object.values(b.rings)]) assert.ok(x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h, `${b.piece}: a pin outside its box`);
      for (const c of boxes) if (c !== b) assert.ok(b.x + b.w <= c.x || c.x + c.w <= b.x || b.y + b.h + 4 <= c.y || c.y + c.h + 4 <= b.y, `${b.piece} overlaps ${c.piece}`);
    }
  }
  // Side on: a ring on a piece is the joint the piece below it is pinned at, as far from the pivot as the figure says.
  for (const b of rigBoxes('biped')) {
    for (const [joint, [x, y]] of Object.entries(b.rings)) {
      assert.ok(PIECES.biped.some((p) => p.pivot === joint), `${b.piece}: ring ${joint} pins nothing`);
      assert.deepEqual([x - b.px, y - b.py], [RIG.joints[joint][0] - RIG.joints[b.pivot][0], RIG.joints[joint][1] - RIG.joints[b.pivot][1]]);
    }
  }
  const codes = Object.values(RIG_SHEETS).map((s) => s.index);
  assert.equal(new Set([...codes, ...Object.values(PAGES).map((p) => p.index)]).size, codes.length + Object.keys(PAGES).length);
  for (const c of codes) assert.ok(c < 2 ** CODE.bits);
  assert.equal(K, RIG.units / RIG.height);
});

test('rig sheet: a keystoned colour photo reads every piece: fills where they were coloured, outlines on the lines, the eye a dot', () => {
  const read = side();
  assert.equal(read.sheet, 'biped', 'told by its code');
  assert.deepEqual(read.blank, []);
  assert.deepEqual(Object.keys(read.pieces).sort(), PIECES.biped.map((p) => p.piece).sort());
  const fig = TEST_FIGURE.biped;
  for (const [piece, f] of Object.entries(fig)) {
    const p = read.pieces[piece];
    // Each coloured-in area comes back once, near its own colour, about where it was drawn, about as big: the
    // pivots put it in the right place however the photo was keystoned.
    f.fills.forEach(([colour, pts], k) => {
      const want = hexRgb(colour), got = p.blobs.find((b) => Math.hypot(...b.rgb.map((v, i) => v - want[i])) < 0.15);
      assert.ok(got, `${piece}: no fill near ${colour} (${p.blobs.map((b) => b.rgb.map((v) => v.toFixed(2))).join(' | ')})`);
      if (k < f.fills.length - 1) return;   // the face under the hair: only what shows is read
      const sub = got.subs.reduce((a, s) => (area(s) > area(a) ? s : a)), c0 = centroid(pts), c1 = centroid(sub);
      assert.ok(Math.hypot(c0[0] - c1[0], c0[1] - c1[1]) < 1.6, `${piece} ${colour}: centre ${c1.map((v) => v.toFixed(1))} for ${c0.map((v) => v.toFixed(1))}`);
      const ratio = area(sub) / area(pts);
      assert.ok(ratio > 0.8 && ratio < 1.3, `${piece} ${colour}: area x${ratio.toFixed(2)}`);
    });
    // The outlines: every read line lies on a drawn one (the pen's wobble and width allowed).
    for (const l of p.lines) {
      const d = Math.min(...(f.lines ?? []).map((line) => off(l.pts, line)));
      assert.ok(d < 1.2, `${piece}: a line ${l.len.toFixed(1)} mm long lies ${d.toFixed(2)} mm off every drawn one`);
    }
    // And every drawn outline is read (as a line, or, for a shoe, the ink blob).
    for (const line of f.lines ?? []) {
      const along = line.slice(1).flatMap((q, i) => {   // a point every 0.5 mm
        const a = line[i], n = Math.max(1, Math.ceil(Math.hypot(q[0] - a[0], q[1] - a[1]) / 0.5));
        return Array.from({ length: n }, (_, k) => [a[0] + (q[0] - a[0]) * (k + 1) / n, a[1] + (q[1] - a[1]) * (k + 1) / n]);
      });
      const hit = along.filter((q) => p.lines.some((l) => off([q], l.pts) < 1.2)).length / along.length;
      assert.ok(hit > 0.9, `${piece}: ${(hit * 100).toFixed(0)}% of a drawn line read`);
    }
    assert.equal(p.dots.length, (f.dots ?? []).length, `${piece}: dots`);
    for (const [x, y] of f.dots ?? []) assert.ok(p.dots.some((d) => Math.hypot(d.c[0] - x, d.c[1] - y) < 0.8), `${piece}: the dot at ${x},${y}`);
  }
  // The printed pins under a coloured-in area are no holes in it.
  for (const piece of ['body', 'arm', 'fore', 'leg', 'shin']) assert.equal(read.pieces[piece].blobs[0].subs.length, 1, `${piece}: a hole in the fill`);
  // The shoe was coloured black: an ink blob.
  assert.ok(read.pieces.foot.blobs.some((b) => b.ink), 'the black shoe');
});

test('rig sheet: the puppet has the standard biped names, stands on its pins, and walks the vocabulary at full swing', () => {
  const { payload, table, blank } = rigPuppet(side(), { name: 'mia' });
  assert.deepEqual(blank, []);
  assert.deepEqual(Object.keys(payload.parts), ['arm-l', 'fore-l', 'hand-l', 'leg-l', 'shin-l', 'foot-l', 'leg-r', 'shin-r', 'foot-r', 'hips', 'body', 'head', 'arm-r', 'fore-r', 'hand-r']);
  for (const n of Object.keys(payload.parts)) if (n !== 'hips') assert.ok(VOCABULARY.names.includes(n), n);
  assert.deepEqual(payload.views, ['side']);
  assert.deepEqual(payload.parts.hips.ops, []);
  assert.deepEqual(lintPuppet(payload, 'mia'), []);
  // Roles: the pen is ink; skin, top, jeans and hair four roles of their own, none of them ink.
  assert.equal(table.filter((r) => r.role === 'ink').length, 1);
  const role = (hex) => table.reduce((b, r) => (Math.hypot(...hexRgb(r.hex).map((v, i) => v - hexRgb(hex)[i])) < Math.hypot(...hexRgb(b.hex).map((v, i) => v - hexRgb(hex)[i])) ? r : b)).role;
  const roles = ['#f0c39b', '#d8433b', '#3d64b0', '#6e3f1c'].map(role);
  assert.equal(new Set(roles).size, 4, roles.join());
  assert.ok(!roles.includes('ink'));
  assert.equal(role('#26221f'), 'ink', 'the black shoe');
  for (const op of payload.parts.body.ops) if (op.op === 'fill' && op.role !== 'ink') assert.equal(op.finish, true);

  // Assembled at rest: each part's pivot the joint its box pinned it at.
  const p = puppet(payload), at = jointsIn('side');
  for (const [n, joint] of [['head', 'neck'], ['arm-r', 'shoulder-r'], ['fore-r', 'elbow-r'], ['hand-r', 'wrist-r'], ['leg-l', 'hip-l'], ['shin-l', 'knee-l'], ['foot-l', 'ankle-l']]) {
    const m = p.worldOf(n);
    assert.ok(Math.hypot(m[4] - at[joint][0] * K, m[5] - at[joint][1] * K) < 0.02, `${n} pinned at ${joint}`);
  }
  // The shoe stands on the ground; the head is on top.
  const foot = p.inkOf('foot-r'), head = p.inkOf('head');
  assert.ok(Math.abs(foot[1] + foot[3]) < 4, `the shoe's sole at ${foot[1] + foot[3]}`);
  assert.ok(head[1] < -RIG.units * 0.9, `the head's top at ${head[1]}`);

  // The vocabulary: it walks untempered (its box holds every cycle), cheers and bows.
  const A = actorOf(p);
  for (const c of ['walk', 'run', 'jump']) assert.ok(A.vocabulary.cycles.includes(c), c);
  VOCABULARY.cycles.walk.frames.forEach((f, j) => {
    const got = A.cycle('walk', j / 12);
    for (const k of ['leg-l', 'leg-r', 'shin-l', 'arm-r']) assert.equal(got[k], f[k], `walk ${j} ${k}`);
  });
  assert.equal(A.pose('cheer')['arm-l'], VOCABULARY.poses.cheer['arm-l']);
  assert.notEqual(A.pose('bow').body ?? 0, 0, 'the body bows over the hips');

  // Retargeting needs no map: the skeleton is the stick's, and a filmed walk swings its legs.
  const map = stickMap({ ...payload, name: 'mia' });
  assert.deepEqual(map.parts['leg-l'].chain, ['hip', 'knee-1']);
  for (const m of Object.values(map.parts)) for (const j of m.chain) assert.ok(RIGS.biped.joints.includes(j), j);
  const frame = (joints) => ({ outer: { sub: [{ pts: [-60, 0, 60, 0, 60, -300, -60, -300], closed: true }] }, lines: [], skel: { joints, chains: RIGS.biped.chains.map((c) => [...c]) } });
  const walk = Array.from({ length: 12 }, (_, k) => {
    const { P } = walker(k / 12);
    return frame({ head: P.head, shoulder: P.shoulder, hip: P.hip, 'elbow-1': P.elbowL, 'wrist-1': P.wristL, 'elbow-2': P.elbowR, 'wrist-2': P.wristR,
      'knee-1': P.kneeL, 'ankle-1': P.ankleL, 'knee-2': P.kneeR, 'ankle-2': P.ankleR });
  });
  const got = retarget({ n: 12, fps: 12, h: 200, rig: 'biped', facing: 1, frames: walk }, payload, map).cycle;
  assert.ok(got.frames.some((f) => f['leg-l'] > 10 && f['leg-r'] < -10));
  assert.deepEqual(lintPuppet({ ...payload, cycles: { walk: got } }, 'mia'), []);
});

test('rig sheet: the face-on sheet adds the front view; the limbs hang from its shoulders and hips, the -l ones mirrored', () => {
  const front = readOf('biped-front');
  assert.equal(front.sheet, 'biped-front');
  assert.deepEqual(Object.keys(front.pieces).sort(), ['body', 'foot', 'head']);
  assert.equal(front.pieces.head.dots.length, 2, 'two eyes face on');
  const { payload } = rigPuppet([side(), front], { name: 'mia' });
  assert.deepEqual(payload.views, ['side', 'front']);
  assert.deepEqual(payload.parts['arm-l'].pivot.front, [-RIG.spread.shoulder * K, RIG.joints.shoulder[1] * K].map((v) => Math.round(v * 100) / 100));
  assert.deepEqual(payload.parts['leg-r'].pivot.front, [RIG.spread.hip * K, RIG.joints.hip[1] * K].map((v) => Math.round(v * 100) / 100));
  // An -l limb face on is the side drawing mirrored; an -r one the side drawing.
  const xs = (ops) => ops.flatMap((o) => o.path?.$p?.[0]?.filter((_, i) => i % 2 === 1) ?? []);
  const sideX = xs(payload.parts['arm-l'].ops.side), frontX = xs(payload.parts['arm-l'].ops.front);
  assert.deepEqual(frontX, sideX.map((v) => (v === 0 ? 0 : -v)));
  assert.deepEqual(payload.parts['arm-r'].ops.front, payload.parts['arm-r'].ops.side);
  assert.deepEqual(lintPuppet(payload, 'mia'), []);
  const p = puppet(payload);
  assert.equal(p.viewOf(0), 'front');
  assert.equal(p.viewOf(0.5), 'side', 'no three-quarter: the side stands in');
  const m = p.worldOf('arm-l', { ...p.rest, dir: 0 });
  assert.ok(Math.abs(m[4] + RIG.spread.shoulder * K) < 0.02);
});

test('rig sheet: blank boxes, a missing body, the wrong sheet and a hand sheet each say what they are', () => {
  const noHand = readOf('biped', { skip: ['hand'] });
  assert.deepEqual(noHand.blank, ['hand']);
  const { payload, blank } = rigPuppet(noHand, { name: 'x' });
  assert.deepEqual(blank, ['hand']);
  assert.deepEqual(payload.parts['hand-r'].ops, []);
  assert.throws(() => readOf('biped', { skip: ['body'] }), /nothing is drawn in the body box/);
  assert.throws(() => readOf('biped', { read: { sheet: 'biped-front' } }), /the photo is the biped sheet, not biped-front/);
  assert.throws(() => rigPuppet(readOf('biped-front'), { name: 'x' }), /the side sheet \(biped\) is needed/);
  const c = letterSheet(synthHand('test'), { dpi: 120 }), latin = planesOf(c.getContext('2d').getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  assert.throws(() => readRigSheet(latin.img, { rgb: latin.rgb }), /a page of the hand sheet \(hdf hand reads it\)/);
  const rig = photo('biped');
  assert.throws(() => readPage(rig.img, frameMap(rig.img).at), /it is a rig sheet \(hdf sketch reads it\)/);
});

test('hdf hand --template --rig, hdf sketch: one command from a photographed sheet to a puppet walking in its own strip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-sketch-'));
  const hdf = (...a) => { const r = spawnSync(process.execPath, ['cli/hdf.mjs', ...a], { encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };
  try {
    const pdf = spawnSync(process.execPath, ['cli/hdf.mjs', 'hand', '--template', '--rig', 'biped,biped-front']);
    assert.equal(pdf.status, 0, String(pdf.stderr));
    assert.equal(pdf.stdout.subarray(0, 5).toString(), '%PDF-');
    const jpg = spawnSync(process.execPath, ['cli/hdf.mjs', 'hand', '--template', '--rig', 'biped', '--drawn']);
    assert.equal(jpg.status, 0, String(jpg.stderr));
    const file = join(dir, 'mia.jpg'), root = join(dir, 'store');
    writeFileSync(file, jpg.stdout);
    assert.equal(hdf('hand', '--template', '--rig', 'quadruped').code, 2);

    const made = hdf('sketch', file, '--sheet', 'biped', '--name', 'mia', '--root', root, '--out', dir);
    assert.equal(made.code, 0, made.out);
    assert.match(made.out, /^mia\.jpg: the biped sheet, 8 of 8 pieces drawn$/m);
    assert.match(made.out, /^mia {2}puppet {2}[0-9a-f]{40}\.json {2}own {2}\(new\)$/m);
    assert.match(made.out, /parts: arm-l fore-l hand-l leg-l shin-l foot-l leg-r shin-r foot-r hips body head arm-r fore-r hand-r/);
    assert.match(made.out, /\+ 8 frames of walk$/m, 'the sheet has the walk as its strip');
    assert.ok(existsSync(join(root, 'sheets', 'mia.jpg')));
    assert.ok(existsSync(join(dir, 'sketch-mia-trace.jpg')));
    const cat = JSON.parse(readFileSync(join(root, 'catalogue.json'), 'utf8'));
    assert.deepEqual(cat.mia.tags, ['puppet', 'sketch', 'biped']);

    // A filmed walk retargets with no map, and a second read of the sheet keeps it.
    writeFileSync(join(dir, 'pose-me.json'), JSON.stringify(poseJSON()));
    assert.equal(hdf('clip', '--kind', 'pose', join(dir, 'pose-me.json'), '--name', 'me', '--root', root, '--out', dir).code, 0);
    const walk = hdf('retarget', '--clip', 'me', '--to', 'mia', '--name', 'walk', '--root', root);
    assert.equal(walk.code, 0, walk.out);
    assert.match(walk.out, /^me -> mia\.walk: 12 frames at 12 fps, .*, map from the rig sheet$/m);
    const again = hdf('sketch', file, '--name', 'mia', '--root', root, '--out', dir, '--no-sheet');
    assert.equal(again.code, 0, again.out);
    assert.match(again.out, /keeps cycle walk \(retargeted from me\)/);

    assert.match(hdf('sketch', file, '--sheet', 'biped-front', '--name', 'x', '--root', root).out, /the photo is the biped sheet, not biped-front/);
    assert.equal(hdf('sketch', file, '--root', root).code, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
