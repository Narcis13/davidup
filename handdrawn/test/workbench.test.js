// 4.0 W2: the workbench -- the Rig tab's posing and editing (core/workbench.js) and the dev server writing a
// puppet back to the store (cli/dev.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASSET_ROOT, readCatalogue } from '../core/assets.js';
import { actorOf } from '../core/actor.js';
import { lintPuppet } from '../core/lint.js';
import { bounds, hashList, mapply } from '../core/list.js';
import { puppet } from '../core/puppet.js';
import { compileStick, stickSource } from '../core/stick.js';
import {
  cycleFps, dropFrame, dropPose, dropSocket, growBox, handles, movePivot, poseOf, recordFrame, recordPose, reachTo,
  setSocket, shiftOps, slideTo, turnTo, zeroOf,
} from '../core/workbench.js';
import { devServer, pretty } from '../cli/dev.mjs';

const FOX = readCatalogue(ASSET_ROOT).json('fox');
const SAM = JSON.parse(JSON.stringify(compileStick(stickSource({ name: 'sam' }))));
const build = (d, name = d.name) => puppet({ ...d, name });
const near = (a, b, tol, what) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol, `${what}: ${a.map((v) => v.toFixed(2))} is not within ${tol} of ${b.map((v) => v.toFixed(2))}`);
const origin = (m) => [m[4], m[5]];
const ink = (make, q) => bounds(make(q).kids).map((v) => +v.toFixed(3));

test('handles: turn grips at the one child or the drawing, slides apart from turns, reach diamonds with IK', () => {
  const fox = build(FOX), ids = (h) => h.map((x) => `${x.kind}:${x.part}`);
  const hs = handles(fox, fox.rest);
  for (const id of ['turn:arm-l', 'turn:head', 'turn:tail', 'slide:pupil', 'turn:brow-l', 'slide:brow-l']) assert.ok(ids(hs).includes(id), id);
  assert.ok(!ids(hs).some((i) => /:(eye|mouth)$/.test(i)), 'a part with variants is picked, not dragged');
  const bt = hs.find((x) => x.kind === 'turn' && x.part === 'brow-l'), bs = hs.find((x) => x.kind === 'slide' && x.part === 'brow-l');
  assert.ok(Math.hypot(bt.at[0] - bs.at[0], bt.at[1] - bs.at[1]) > 1, 'a brow turns and slides from two grips');
  const sam = build(SAM);
  const ik = ids(handles(sam, sam.rest)), fk = ids(handles(sam, sam.rest, { ik: false }));
  for (const s of ['l', 'r']) {
    assert.ok(ik.includes(`reach:hand-${s}`) && ik.includes(`reach:foot-${s}`) && !ik.includes(`turn:fore-${s}`) && !ik.includes(`turn:shin-${s}`));
    assert.ok(fk.includes(`turn:fore-${s}`) && !fk.some((i) => i.startsWith('reach:')));
    assert.ok(ik.includes(`turn:arm-${s}`), 'the upper arm still turns by its elbow');
  }
  // The elbow grip sits at the forearm's pivot.
  const arm = handles(sam, sam.rest).find((h) => h.kind === 'turn' && h.part === 'arm-r');
  near(arm.at, origin(sam.worldOf('fore-r', sam.rest)), 1e-9, 'the elbow grip');
});

test('turnTo: the grip follows the pointer round the pivot, both ways round, on the 2 degree grid', () => {
  const sam = build(SAM);
  for (const dir of [1, -1, 0.5, 0]) {
    const q = { ...sam.rest, dir }, h = handles(sam, q).find((x) => x.kind === 'turn' && x.part === 'arm-r');
    const r = Math.hypot(h.at[0] - h.pivot[0], h.at[1] - h.pivot[1]), a = Math.atan2(h.at[1] - h.pivot[1], h.at[0] - h.pivot[0]) + (50 * Math.PI) / 180;
    const to = [h.pivot[0] + r * Math.cos(a), h.pivot[1] + r * Math.sin(a)];
    const got = turnTo(sam, 'arm-r', h.at, q, to);
    assert.equal(Math.abs(got['arm-r'] % 2), 0);
    near(handles(sam, { ...q, ...got }).find((x) => x.kind === 'turn' && x.part === 'arm-r').at, to, r * 0.04, `dir ${dir}`);
  }
});

test('slideTo and reachTo: a pupil slides towards the pointer and stops at its range; a wrist lands on the point', () => {
  const fox = build(FOX), q = fox.rest, h = handles(fox, q).find((x) => x.kind === 'slide' && x.part === 'pupil');
  const got = slideTo(fox, 'pupil', h.at, q, [h.at[0] + 2, h.at[1] + 1.2]);
  assert.deepEqual(Object.keys(got).sort(), ['pupil.x', 'pupil.y']);
  const far = slideTo(fox, 'pupil', h.at, q, [h.at[0] + 500, h.at[1]]);
  assert.equal(far['pupil.x'], fox.moves['pupil.x'][1], 'clamped to its range');
  const sam = build(SAM);
  for (const dir of [1, -1]) {
    const s = { ...sam.rest, dir }, w = origin(sam.worldOf('hand-r', s)), to = [w[0] + (dir > 0 ? 30 : -30), w[1] - 40];
    const patch = reachTo(sam, 'hand-r', s, to);
    near(origin(sam.worldOf('hand-r', { ...s, ...patch })), to, 3, `the wrist, dir ${dir}`);
  }
});

test('poseOf and recordPose: a pose is what differs from rest; recorded, the puppet and the actor take it before the vocabulary', () => {
  const sam = build(SAM), st = { ...sam.rest, 'arm-r': -150, 'fore-r': -20, eye: 'happy', dir: -1 };
  const pose = poseOf(sam, st);
  assert.deepEqual(pose, { 'arm-r': -150, 'fore-r': -20, eye: 'happy' });
  const d = recordPose(SAM, 'cheer', pose);
  assert.ok(!SAM.poses.cheer, 'the payload given is left alone');
  assert.deepEqual(d.workbench, { poses: ['cheer'], cycles: [] });
  assert.deepEqual(lintPuppet(d, 'sam'), []);
  const A = actorOf(build(d));
  assert.equal(A.pose('cheer', 1)['arm-r'], -150, 'its own cheer wins over the vocabulary\'s');
  assert.equal(hashList([build(d).pose('cheer')]), hashList([sam({ ...sam.rest, ...pose })]));
  assert.throws(() => recordPose(SAM, 'two words', pose), /letters, digits and dashes/);
  const gone = dropPose(d, 'cheer');
  assert.ok(!gone.poses.cheer && !gone.workbench);
  assert.throws(() => dropPose(d, 'rest'), /rest pose stays/);
});

test('recordPose rest: every other pose and frame draws as it did', () => {
  const fox = build(FOX), before = Object.fromEntries(fox.poses.map((p) => [p, hashList([fox.pose(p)])]));
  const walk0 = hashList([fox.cycle('walk', 0)]);
  const d = recordPose(FOX, 'rest', poseOf(fox, { ...fox.rest, 'arm-r': 20, tail: 10, eye: 'wide' }), { rest: fox.rest });
  const f2 = build(d);
  assert.equal(f2.rest['arm-r'], 20);
  assert.equal(f2.rest.eye, 'wide');
  for (const p of fox.poses) if (p !== 'rest') assert.equal(hashList([f2.pose(p)]), before[p], `pose ${p}`);
  assert.equal(hashList([f2.cycle('walk', 0)]), walk0, 'a walk frame');
  assert.deepEqual(lintPuppet(d, 'fox'), []);
});

test('recordFrame, dropFrame, cycleFps: a cycle built frame by frame, n and a captured advance kept', () => {
  let d = recordFrame(SAM, 'hop', { 'leg-l': 20 }, { fps: 6 });
  d = recordFrame(d, 'hop', { 'leg-l': -20 });
  d = recordFrame(d, 'hop', { 'leg-l': 0, head: 4 }, { at: 1 });
  assert.deepEqual(d.cycles.hop, { fps: 6, n: 3, frames: [{ 'leg-l': 20 }, { 'leg-l': 0, head: 4 }, { 'leg-l': -20 }] });
  d = recordFrame(d, 'hop', { 'leg-l': 10 }, { at: 1, replace: true });
  assert.deepEqual(d.cycles.hop.frames[1], { 'leg-l': 10 });
  assert.deepEqual(lintPuppet(d, 'sam'), []);
  assert.equal(build(d).frameOf('hop', 1 / 6)['leg-l'], 10);
  assert.equal(cycleFps(d, 'hop', 12).cycles.hop.fps, 12);
  d = dropFrame(d, 'hop', 0);
  assert.equal(d.cycles.hop.n, 2);
  d = dropFrame(dropFrame(d, 'hop', 0), 'hop', 0);
  assert.ok(!d.cycles?.hop && !d.workbench, 'the last frame drops the cycle');
  // A captured stride (K7) stays a number a frame.
  const cap = { ...SAM, cycles: { run: { fps: 12, n: 2, frames: [{ 'leg-l': 10 }, { 'leg-l': -10 }], advance: [0.1, 0.2] } } };
  const more = recordFrame(cap, 'run', { 'leg-l': 0 }, { at: 1 });
  assert.deepEqual(more.cycles.run.advance, [0.1, 0.1, 0.2]);
  assert.deepEqual(dropFrame(more, 'run', 2).cycles.run.advance, [0.1, 0.1]);
  assert.deepEqual(lintPuppet(more, 'sam'), []);
});

test('movePivot: the part turns about the new point, the drawing stays, the other views untouched', () => {
  const sam = build(SAM), views = { side: 1, 'three-quarter': 0.5, front: 0 };
  const zero = (make, dir) => zeroOf(make, dir);
  const d = movePivot(SAM, 'fore-r', [14, -180], { view: 'side' }), s2 = build(d);
  assert.deepEqual(d.parts['fore-r'].pivot, { ...SAM.parts['fore-r'].pivot, side: [14, -180] });
  for (const [V, dir] of Object.entries(views)) {
    for (const q of [zero(sam, dir), { ...sam.rest, dir }]) assert.deepEqual(ink(s2, q), ink(sam, q), `the drawing in ${V}`);
    if (V !== 'side') assert.equal(hashList([s2({ ...sam.rest, dir })]), hashList([sam({ ...sam.rest, dir })]), `${V} is the same drawing`);
  }
  near(origin(s2.worldOf('fore-r', zero(s2, 1))), [14, -180], 1e-9, 'the new pivot');
  // The wrist hangs off the new pivot when the forearm turns: it moved relative to it.
  const bent = { ...sam.rest, dir: 1, 'fore-r': 90 };
  assert.notDeepEqual(ink(s2, bent), ink(sam, bent));
  // The fox's head: its eyes (drawn by view), pupil and mouth ride its pivot, so they move with it, in the side
  // view only; the head's shared pivot is spelt out view by view first.
  const fox = build(FOX), f = movePivot(FOX, 'head', [4, -190], { view: 'side' }), f2 = build(f);
  assert.deepEqual(f.parts.head.pivot, { side: [4, -190], 'three-quarter': [0, -196], front: [0, -196] });
  for (const dir of [1, 0.5, 0]) {
    for (const q of [zero(fox, dir), { ...fox.rest, dir }, { ...fox.rest, dir, eye: 'wide', 'pupil.x': 3 }]) assert.deepEqual(ink(f2, q), ink(fox, q), `dir ${dir}`);
  }
  near(origin(f2.worldOf('head', fox.rest)), [4, -190], 1e-9, 'the head turns about its new neck');
  assert.throws(() => movePivot(FOX, 'eye', [0, 0]), /no pivot of its own/);
  // Nothing drawn by view (or no views at all): the pivot moves for every view, and the parts riding it too.
  const PLAIN = { units: 100, parts: {
    body: { pivot: [0, -40], ops: [{ op: 'fill', path: { $p: [[1, -10, -20, 10, -20, 10, 40, -10, 40]] }, role: 'fills.0' }] },
    head: { parent: 'body', pivot: [0, -60], ops: [{ op: 'stroke', path: { $p: [[1, -8, -16, 8, -16, 8, 0, -8, 0]] }, role: 'ink' }] },
    eye: { parent: 'head', ops: [{ op: 'dots', path: { $p: [[1, 2, -10, 4, -10, 4, -8]] }, role: 'ink' }] },
  } };
  const pl = build(PLAIN, 'plain'), p2d = movePivot(PLAIN, 'head', [3, -62]), p2 = build(p2d, 'plain');
  assert.deepEqual(p2d.parts.head.pivot, [3, -62]);
  assert.deepEqual(p2d.parts.eye.ops[0].path.$p, [[1, -1, -8, 1, -8, 1, -6]]);
  for (const q of [pl.rest, { head: 0, body: 10 }]) assert.deepEqual(ink(p2, q), ink(pl, q));
  assert.throws(() => movePivot(SAM, 'head', [0, 0], { view: 'back' }), /no view 'back'/);
});

test('movePivot: sockets on the part stay put, a rig sheet skeleton follows a side move', () => {
  const sk = { ...SAM, skeleton: { joints: { 'elbow-r': [6, -186], hip: [0, -120] }, bones: [] } };
  const sam = build(sk), before = sam.socketXf('hand-r', zeroOf(sam, 1));
  const d = movePivot(sk, 'hand-r', [10, -120], { view: 'side' }), s2 = build(d);
  near(origin(s2.socketXf('hand-r', zeroOf(s2, 1))), origin(before), 1e-6, 'the socket in the drawing');
  assert.notDeepEqual(d.sockets['hand-r'].at.side, SAM.sockets['hand-r'].at.side);
  assert.deepEqual(d.sockets['hand-r'].at.front, SAM.sockets['hand-r'].at.front);
  assert.deepEqual(movePivot(sk, 'fore-r', [8, -184], { view: 'side' }).skeleton.joints['elbow-r'], [8, -184]);
  assert.deepEqual(movePivot(sk, 'fore-r', [8, -184], { view: 'front' }).skeleton.joints['elbow-r'], [6, -186], 'a front move leaves the side skeleton');
});

test('shiftOps: paths, groups, text and clip children move; the JSON stays serialised', () => {
  const ops = [
    { op: 'stroke', path: { $p: [[0, 0, 0, 10, 5]] }, role: 'ink' },
    { op: 'group', xf: [0, 1, -1, 0, 3, 4], kids: [{ op: 'fill', path: { $p: [[1, 0, 0, 1, 0, 1, 1]] } }] },
    { op: 'text', str: 'a', x: 1, y: 2 },
    { op: 'clip', path: { $p: [[1, 0, 0, 2, 0, 2, 2]] }, kids: [{ op: 'dots', path: { $p: [[1, 1, 1, 2, 2]] } }] },
  ];
  const out = shiftOps(ops, 5, -1);
  assert.deepEqual(out[0].path.$p, [[0, 5, -1, 15, 4]]);
  assert.deepEqual(out[1].xf, [0, 1, -1, 0, 8, 3]);
  assert.deepEqual(out[1].kids, ops[1].kids, 'a group moves by its matrix, not its kids');
  assert.deepEqual([out[2].x, out[2].y], [6, 1]);
  assert.deepEqual(out[3].kids[0].path.$p, [[1, 6, 0, 7, 1]]);
  assert.deepEqual(ops[0].path.$p, [[0, 0, 0, 10, 5]], 'the ops given are left alone');
});

test('setSocket, dropSocket, growBox', () => {
  const fox = build(FOX);
  // The fox's paw sockets sit by view: setting one in the side view keeps the other views where they were.
  const d = setSocket(FOX, 'hand-r', { part: 'arm-r', at: [2, 40], angle: 30.4 }, { view: 'side' });
  assert.deepEqual(d.sockets['hand-r'], { part: 'arm-r', at: { ...FOX.sockets['hand-r'].at, side: [2, 40] }, angle: { side: 30, 'three-quarter': 0, front: 0 } });
  const m = build(d).socketXf('hand-r', fox.rest), w = fox.worldOf('arm-r', fox.rest);
  near(origin(m), mapply(w, 2, 40), 1e-9, 'the socket in the drawing');
  assert.deepEqual(build(d).socketXf('hand-r', { ...fox.rest, dir: 0 }), fox.socketXf('hand-r', { ...fox.rest, dir: 0 }), 'the front view as it was');
  assert.deepEqual(lintPuppet(d, 'fox'), []);
  const t = setSocket(FOX, 'tail-tip', { part: 'tail', at: [-60, 40], angle: 0 });
  assert.ok(t.sockets['tail-tip'] && build(t).sockets.includes('tail-tip'));
  assert.ok(!dropSocket(t, 'tail-tip').sockets['tail-tip']);
  // Keyed by view: only the view named moves.
  const s = setSocket(SAM, 'hand-r', { part: 'hand-r', at: [1, 2], angle: 45 }, { view: 'front' });
  assert.deepEqual(s.sockets['hand-r'].at, { ...SAM.sockets['hand-r'].at, front: [1, 2] });
  assert.deepEqual(s.sockets['hand-r'].angle, { ...SAM.sockets['hand-r'].angle, front: 45 });
  assert.deepEqual(lintPuppet(s, 'sam'), []);
  assert.deepEqual(growBox(FOX, [-200, -300, 50, 50]).box, [-200, -314, 310, 324]);
  assert.deepEqual(growBox(FOX, [0, 0, 1, 1]).box, FOX.box);
});

test('pretty: readable JSON that parses back to the payload', () => {
  const text = pretty(SAM);
  assert.deepEqual(JSON.parse(text), SAM);
  assert.match(text, /"\$p": \[\[0,0,0,6,48\]\]|"\$p": \[\n/);
  assert.ok(!text.split('\n').some((l) => /^\s*-?[\d.]+,?$/.test(l)), 'a path is a line, not a number a line');
});

test('keepRetargeted: poses and cycles the workbench recorded survive a source re-imported over them', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hdf-wb-keep-'));
  const { run } = await import('../cli/stick.mjs');
  const quiet = process.stdout.write;
  process.stdout.write = () => true;
  try {
    await run([], { name: 'tim', root, sheet: false });
    const st = readCatalogue(root), d = st.json('tim');
    let e = recordPose(d, 'cheer', { 'arm-r': -150 });
    e = recordFrame(e, 'hop', { 'leg-l': 20 });
    st.put({ ...st.entry('tim'), sha: undefined }, Buffer.from(JSON.stringify(e)));
    await run([], { name: 'tim', root, sheet: false });
    const again = readCatalogue(root).json('tim');
    assert.deepEqual(again.poses.cheer, { 'arm-r': -150 });
    assert.deepEqual(again.cycles.hop.frames, [{ 'leg-l': 20 }]);
    assert.deepEqual(again.workbench, { poses: ['cheer'], cycles: ['hop'] });
  } finally {
    process.stdout.write = quiet;
    rmSync(root, { recursive: true, force: true });
  }
});

test('dev: the workbench reads a stored puppet and writes it back through the import checks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-wb-dev-')), store = join(dir, 'store');
  mkdirSync(join(store, 'blobs'), { recursive: true });
  const st0 = readCatalogue(ASSET_ROOT), e0 = st0.entry('fox');
  writeFileSync(join(store, 'catalogue.json'), `{\n"fox": ${JSON.stringify(e0)}\n}\n`);
  cpSync(st0.payloadPath(e0), join(store, 'blobs', `${e0.sha}.json`));
  const film = join(dir, 'film.js');
  writeFileSync(film, readFileSync('films/fox-wave.js', 'utf8').replaceAll("'../core/", "'handdrawn/core/"));
  const dev = devServer(film, { port: 0, root: store });
  const quiet = process.stdout.write;
  try {
    const url = await dev.ready;
    const page = await (await fetch(url)).text();
    assert.match(page, /"store":"[^"]*store"/);
    const got = await (await fetch(`${url}__hdf/puppet/fox`)).json();
    assert.deepEqual(got.payload, st0.json(e0));
    assert.equal((await fetch(`${url}__hdf/puppet/nope`)).status, 404);
    const post = (payload, headers = {}) => fetch(`${url}__hdf/puppet/fox`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ payload }) });
    process.stdout.write = () => true;
    assert.equal((await fetch(`${url}__hdf/puppet/fox`, { method: 'POST', body: '{}' })).status, 415);
    assert.equal((await post(got.payload, { origin: 'http://elsewhere.example' })).status, 403);
    // Off the joint grid: refused by the import's lint, and nothing written.
    const bad = await post(recordPose(got.payload, 'wobbly', { 'arm-l': 33 }));
    assert.equal(bad.status, 422);
    assert.match((await bad.json()).error, /off the 2 degree grid/);
    assert.ok(!existsSync(join(store, 'src', 'fox.puppet.json')));
    assert.equal(readCatalogue(store).entry('fox').sha, e0.sha);
    // A pose recorded: the source written, the store entry replaced, its licence and credit kept.
    const ok = await post(recordPose(got.payload, 'cheer', { 'arm-l': 120, 'arm-r': -120 }));
    assert.equal(ok.status, 200);
    const r = await ok.json();
    assert.equal(r.changed, true);
    const e = readCatalogue(store).entry('fox');
    assert.equal(e.file, 'fox.puppet.json');
    assert.equal(e.licence, e0.licence);
    assert.equal(e.sha, r.sha);
    const src = readFileSync(join(store, 'src', 'fox.puppet.json'), 'utf8');
    assert.deepEqual(JSON.parse(src).poses.cheer, { 'arm-l': 120, 'arm-r': -120 });
    const state = await (await fetch(`${url}__hdf/store`)).json();
    assert.deepEqual(state.catalogue.fox.poses.cheer, { 'arm-l': 120, 'arm-r': -120 });
    assert.ok(build(readCatalogue(store).json('fox'), 'fox').poses.includes('cheer'));
  } finally {
    process.stdout.write = quiet;
    await dev.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
