// 4.0 W3: auto-rig a single drawing. The test figure (cli/sketch.mjs figureShapes: coloured in, then one pen line
// round the whole) is drawn by the package at a known pose, face on and in profile, as a PNG, a clear PNG and an
// SVG; the rig must find its limbs, cut it into the standard biped parts, stand it at rest and give the pose back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { actorOf, VOCABULARY } from '../core/actor.js';
import { autoRig, PARTS } from '../core/autorig.js';
import { bounds } from '../core/list.js';
import { lintPuppet } from '../core/lint.js';
import { puppet } from '../core/puppet.js';
import { graftFace } from '../core/stick.js';
import { drawingPlanes, drawnFigure, figureSvg } from '../cli/sketch.mjs';

const POSE = { 'arm-l': 40, 'arm-r': -40, 'fore-l': 20, 'fore-r': -20, 'leg-l': 12, 'leg-r': -12 };
const dir = mkdtempSync(join(tmpdir(), 'hdf-autorig-'));
const file = async (name, canvas) => { const f = join(dir, name); await canvas.toFile(f); return f; };
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('autorig: a drawing face on is cut into the fifteen biped parts, stood at rest, and its pose given back', async () => {
  const P = await drawingPlanes(await file('front.png', drawnFigure({ pose: POSE })));
  const { payload, found, copied, blank, table } = autoRig(P, { name: 'kid' });
  assert.deepEqual(found, ['arm-l', 'arm-r', 'leg-l', 'leg-r']);
  assert.deepEqual(copied, []);
  assert.deepEqual(blank, []);
  assert.deepEqual(payload.views, ['front']);
  assert.deepEqual(Object.keys(payload.parts).sort(), [...PARTS, 'hips'].sort());
  for (const [n, p] of Object.entries(payload.parts)) if (n !== 'hips') assert.ok(p.ops.length >= 2, `${n} draws (a paper back and its drawing)`);
  assert.equal(payload.parts.body.ops[0].role, 'paper', 'each piece has its silhouette under it, as cut paper');
  assert.ok(table.some((r) => r.role === 'ink'), 'the pen is ink');
  assert.deepEqual(lintPuppet(payload, 'kid'), []);
  // hdf sketch --auto --face stick (4.0 RE-3): the face sits on the head where it was drawn, the eyes either side.
  const g = graftFace(payload), hx = payload.skeleton.joints.head[0];
  assert.deepEqual(lintPuppet(g, 'kid'), []);
  const px = g.parts.pupil.ops.map((o) => { const xs = o.path.$p[0].filter((_, i) => i % 2 === 1); return xs.reduce((a, b) => a + b) / xs.length - hx; });
  assert.equal(px.length, 2);
  assert.ok(px[0] < 0 && px[1] > 0 && Math.abs(px[0] + px[1]) < 2, `pupils about the head: ${px}`);

  // The pose it was drawn at, as world angles (a forearm's is the arm's plus its own), to within the cut's roughness.
  const d = payload.poses.drawn, near = (got, want, tol, what) => assert.ok(Math.abs(got - want) <= tol, `${what}: ${got}, drawn at ${want}`);
  near(d['arm-l'] + d['fore-l'], 60, 10, 'left forearm');
  near(d['arm-r'] + d['fore-r'], -60, 10, 'right forearm');
  near(d['arm-l'], 40, 16, 'left arm');
  near(d['leg-l'], 12, 6, 'left thigh');
  near(d['leg-r'], -12, 6, 'right thigh');
  near(d['leg-l'] + d['shin-l'], 12, 6, 'left shin');
  near(d.body, 0, 4, 'body');
  // Left is the picture's left, and turning positive swings a -l limb out, as the vocabulary expects.
  assert.ok(payload.parts['arm-l'].pivot[0] < 0 && payload.parts['arm-r'].pivot[0] > 0);
  assert.ok(d['arm-l'] > 0 && d['arm-r'] < 0);

  // At rest the arms hang and the feet stand on the ground; the pose drawn is the drawing again, arms out.
  const p = puppet(payload), rest = bounds(p(p.rest).kids), drawn = bounds(p({ ...p.rest, ...d }).kids);
  assert.ok(Math.abs(rest[1] + rest[3]) < 2, `the sole on the ground (${rest[1] + rest[3]})`);
  assert.ok(drawn[2] > 1.4 * rest[2], `arms out (${drawn[2]}) wider than hanging (${rest[2]})`);
  const H = -rest[1];
  assert.ok(H > 280 && H < 320, `about RIG.units tall (${H})`);
  // Sockets in the hands; the skeleton in the stick's names.
  assert.deepEqual(Object.keys(payload.sockets).sort(), ['hand-l', 'hand-r']);
  for (const j of ['hip', 'chest', 'neck', 'head', 'shoulder-l', 'wrist-r', 'knee-l', 'toe-r']) assert.ok(payload.skeleton.joints[j], j);

  // The vocabulary walks it at full swing: its box holds every cycle.
  const A = actorOf(p);
  VOCABULARY.cycles.walk.frames.forEach((f, j) => {
    const got = A.cycle('walk', j / 12);
    for (const k of ['leg-l', 'leg-r', 'arm-r']) assert.equal(got[k], f[k], `walk ${j} ${k}`);
  });
});

test('autorig: in profile an arm hidden by the body is drawn from the one that shows', async () => {
  const pose = { 'arm-r': -50, 'fore-r': -30, 'leg-l': 20, 'leg-r': -20, 'shin-l': 10 };
  const P = await drawingPlanes(await file('side.png', drawnFigure({ view: 'side', pose })));
  const { payload, found, copied } = autoRig(P, { name: 'kid', view: 'side' });
  assert.deepEqual(payload.views, ['side']);
  assert.deepEqual(found, ['arm-r', 'leg-l', 'leg-r']);
  assert.deepEqual(copied, ['arm-l']);
  assert.deepEqual(payload.parts['arm-l'].ops, payload.parts['arm-r'].ops.map((o) => ({ ...o, name: o.name === 'arm-r' ? 'arm-l' : o.name })));
  assert.equal(payload.poses.drawn['arm-l'], payload.poses.drawn['arm-r']);
  assert.deepEqual(lintPuppet(payload, 'kid'), []);
});

test('autorig: a clear PNG and an SVG read as the same figure; a blank page and a lone blob say what is wrong', async () => {
  const flat = autoRig(await drawingPlanes(await file('front.png', drawnFigure({ pose: POSE }))), { name: 'a' });
  const clear = autoRig(await drawingPlanes(await file('clear.png', drawnFigure({ pose: POSE, alpha: true }))), { name: 'b' });
  const svg = join(dir, 'kid.svg');
  writeFileSync(svg, figureSvg({ pose: POSE }));
  const vec = autoRig(await drawingPlanes(svg), { name: 'c' });
  for (const g of [clear, vec]) {
    assert.deepEqual(g.found, flat.found);
    for (const k of ['arm-l', 'leg-r', 'body']) assert.ok(Math.abs(g.payload.poses.drawn[k] - flat.payload.poses.drawn[k]) <= 6, k);
  }
  const { skiaCanvas } = await import('../cli/skia.mjs');
  const empty = skiaCanvas(400, 400), g = empty.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 400);
  await assert.rejects(drawingPlanes(await file('empty.png', empty)), /nothing is drawn/);
  g.fillStyle = '#c33'; g.beginPath(); g.arc(200, 200, 90, 0, Math.PI * 2); g.fill();
  await assert.rejects(async () => autoRig(await drawingPlanes(await file('blob.png', empty)), {}), /autorig: (found no legs|found .* on the drawing's skeleton)/);
});

test('hdf sketch --auto: one drawing to a puppet walking in its own strip in one command', () => {
  const root = join(dir, 'store'), out = join(dir, 'out');
  const hdf = (...a) => { const r = spawnSync(process.execPath, ['cli/hdf.mjs', ...a], { encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };
  const svg = join(dir, 'kid.svg');
  writeFileSync(svg, figureSvg({ pose: POSE }));
  const made = hdf('sketch', svg, '--name', 'kid', '--root', root, '--out', out);
  assert.equal(made.code, 0, made.out);
  assert.match(made.out, /one drawing, front view; found arm-l, arm-r, leg-l, leg-r/);
  assert.match(made.out, /pose drawn: arm-l \d+/);
  assert.match(made.out, /\+ 8 frames of walk$/m, 'the sheet has the walk as its strip');
  assert.ok(existsSync(join(out, 'sketch-kid-rig.jpg')));
  assert.ok(existsSync(join(root, 'sheets', 'kid.jpg')));
  // A PNG that is no rig sheet says to try --auto; --view must be a view.
  const png = join(dir, 'front.png');
  assert.match(hdf('sketch', png, '--name', 'kid', '--root', root).out, /one drawing, not a rig sheet\? hdf sketch front\.png --auto --name kid/);
  assert.match(hdf('sketch', '--auto', png, '--view', 'back', '--name', 'kid', '--root', root).out, /--view back \(expected front \| side\)/);
});
