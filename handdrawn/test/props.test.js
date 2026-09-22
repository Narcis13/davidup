// 4.0 K8: sockets, attach, held, propAt, heldTool, writer by an actor, SVG sockets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { actorOf, attach, held, heldTool, partAt, propAt, puppet, reach, socketAt, stickSource, writer, textBox } from '../core/index.js';
import { fromStore } from '../core/assets.js';
import { celOverflow, lintPuppet } from '../core/lint.js';
import { circle, fill, hashList, walk } from '../core/list.js';
import { cel } from '../core/tree.js';
import { svgPuppet } from '../core/svg.js';
import { CAST } from '../recipes/doodle.js';

fromStore(['fox']);
const SAM = actorOf(puppet(stickSource({ name: 'sam' })));
const AT = [300, 649, 420];
const near = (a, b, d, what) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) <= d, `${what}: ${a} vs ${b}`);
const DOT = fill(circle(0, 0, 6, 12), 'ink', { name: 'dot' });
const DOT_CEL = cel('dot', () => [DOT], { box: [-6, -6, 12, 12] });
const named = (list, name) => { const out = []; walk(list, (op) => { if (op.name === name) out.push(op); }); return out; };

const ARM = {
  name: 'arm', units: 100, box: [-60, -60, 120, 120],
  parts: {
    body: { pivot: [0, 0], ops: [{ op: 'stroke', role: 'ink', tool: 'pen', path: { $p: [[0, 0, 0, 0, -40]] } }] },
    'arm-r': { parent: 'body', pivot: [0, -30], ops: [{ op: 'stroke', role: 'ink', tool: 'pen', path: { $p: [[0, 0, 0, 0, 20]] } }] },
    'hand-r': { parent: 'arm-r', pivot: [0, -10], ops: [{ op: 'fill', role: 'ink', path: { $p: [[1, -2, -2, 2, -2, 2, 2, -2, 2]] } }] },
  },
};

test('sockets: array and object forms, keyed by view, and what a bad one says', () => {
  const p = puppet({ ...ARM, sockets: { 'hand-r': [0, 4, 90], pen: { part: 'arm-r', at: [2, 18] } } });
  assert.deepEqual(p.sockets, ['hand-r', 'pen']);
  assert.deepEqual(p.socketOf('hand-r'), { part: 'hand-r', at: [0, 4], angle: 90 });
  assert.deepEqual(p.socketOf('pen'), { part: 'arm-r', at: [2, 18], angle: 0 });
  // At rest the socket is the hand's pivot plus its offset, turned 90 degrees.
  const m = p.socketXf('hand-r');
  assert.deepEqual(m.map((v) => Math.round(v * 1e6) / 1e6), [0, 1, -1, 0, 0, -6]);
  // The arm turning moves the socket with it.
  const turned = p.socketXf('hand-r', { 'arm-r': 90 });
  assert.ok(Math.abs(turned[4] - -24) < 1e-6 && Math.abs(turned[5] - -30) < 1e-6, `${turned}`);
  const bad = [
    [{ 'hand-r': [0] }, /is \[x, y, angle\]/],
    [{ paw: [0, 0] }, /on part 'paw', which is not a part/],
    [{ 'hand-r': { at: [0, 'x'] } }, /at is \[x, y\]/],
    [{ 'hand-r': { at: { side: [0, 0] } } }, /keyed by view, but the puppet declares no views/],
  ];
  for (const [sockets, re] of bad) assert.throws(() => puppet({ ...ARM, sockets }), re);
  assert.throws(() => p.socketOf('nope'), /no socket 'nope' \(has hand-r, pen\)/);
});

test('a socket draws nothing: the fox with its sockets draws and hashes as the fox without', () => {
  const json = JSON.parse(readFileSync(new URL('../assets/src/fox.puppet.json', import.meta.url), 'utf8'));
  const { sockets, ...bare } = json;
  assert.ok(sockets, 'the JSON fox declares sockets');
  const a = puppet(json), b = puppet(bare);
  for (const q of [a.rest, a.poseOf('wave', 1), a.frameOf('walk', 0.25)]) assert.equal(hashList([a(q)]), hashList([b(q)]));
  assert.deepEqual(lintPuppet(json), []);
  assert.deepEqual(puppet('fox').sockets, ['hand-l', 'hand-r'], 'the store fox has a socket in each paw');
});

test('SVG: socket circles become sockets in part coordinates, per view where they move, and do not draw', () => {
  const src = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100">${inner}</svg>`;
  const one = svgPuppet(src('<g id="arm"><circle id="pivot" cx="0" cy="-20" r="2" fill="#0af"/><rect x="-2" y="-20" width="4" height="30" fill="#e8734a"/><circle id="socket:hand-r" cx="0" cy="8" r="2" data-angle="90" fill="#0af"/></g>')).payload;
  assert.deepEqual(one.sockets, { 'hand-r': { part: 'arm', at: [0, 28], angle: 90 } });
  assert.deepEqual(Object.keys(one.roles).length, 1, 'the socket colour is a marker, not a role');
  const views = svgPuppet(src(`<g id="view:side"><g id="hand-r"><circle id="pivot" cx="0" cy="0" r="1"/><rect width="5" height="5"/><circle id="socket:hand-r" cx="2" cy="2" r="1"/></g></g>`
    + `<g id="view:front"><g id="hand-r"><circle id="pivot" cx="0" cy="0" r="1"/><rect width="5" height="5"/><circle id="socket:hand-r" cx="4" cy="2" r="1"/></g></g>`)).payload;
  assert.deepEqual(views.sockets, { 'hand-r': { part: 'hand-r', at: { side: [2, 2], front: [4, 2] }, angle: 0 } });
  const same = svgPuppet(src('<g id="hand-r"><rect width="5" height="5"/><circle id="socket:hand-r" cx="2" cy="2" r="1"/></g>')).payload;
  assert.deepEqual(same.sockets, { 'hand-r': [2, 2, 0] }, 'on the part of its name: the array form');
  assert.throws(() => svgPuppet(src('<circle id="socket:x" cx="0" cy="0" r="1"/><g id="a"><rect width="5" height="5"/></g>')), /socket 'x' outside any part/);
});

test('a stick has a socket in each hand, pointing along the forearm', () => {
  const p = SAM.puppet;
  assert.deepEqual(p.sockets, ['hand-l', 'hand-r']);
  const k = p.socketOf('hand-r', 1);
  assert.equal(k.part, 'hand-r');
  near(socketAt(SAM, 'hand-r', AT, { dir: 1 }), partAt(SAM, 'hand-r', AT, { dir: 1 }), 1e-6, 'a dot hand holds at the wrist');
  const mitts = puppet(stickSource({ name: 'm', hands: 'mitts' })), none = puppet(stickSource({ name: 'n', hands: 'none' }));
  assert.ok(Math.hypot(...mitts.socketOf('hand-r', 1).at) > 1, 'a mitt holds in its middle');
  assert.equal(none.socketOf('hand-r', 1).part, 'fore-r', 'no hand: the wrist, on the forearm');
});

test('attach: the prop is drawn inside the hand, turns and mirrors with it, behind puts it first', () => {
  const pr = attach(SAM, 'hand-r', DOT, { name: 'ball' });
  const g = SAM.place(...AT, { dir: 1, props: [pr] });
  const hand = named([g], 'hand-r')[0];
  assert.equal(hand.kids.at(-1).name, 'prop:ball', 'in front of the hand, last in its group');
  const back = SAM.place(...AT, { dir: 1, props: [attach(SAM, 'hand-r', DOT, { name: 'ball', behind: true })] });
  assert.equal(named([back], 'hand-r')[0].kids[0].name, 'prop:ball', 'behind: first');
  // Without props the drawing is the plain one.
  assert.equal(hashList([SAM.place(...AT, { dir: 1, props: [] })]), hashList([SAM.place(...AT, { dir: 1 })]));
  // propAt follows the arm and the facing.
  for (const dir of [1, -1]) {
    const q = { dir, 'arm-r': -60 };
    near(propAt(SAM, pr, AT, q, [0, 0]), socketAt(SAM, 'hand-r', AT, q), 1e-6, `dir ${dir}`);
  }
  assert.ok(propAt(SAM, pr, AT, { dir: -1 }, [0, 0])[0] < AT[0], 'facing left, the hand is left of the hips');
  assert.throws(() => attach(SAM, 'paw', DOT), /no socket 'paw'/);
  assert.throws(() => SAM.place(...AT, { props: [DOT] }), /props are attach\(\)'s/);
  assert.throws(() => attach(CAST.FOX, 'hand-r', () => []), /must be a cel/);
  assert.throws(() => attach(actorOf(DOT_CEL), 'hand-r', DOT), /not a puppet/);
});

test('attach: level keeps the prop upright whatever the arm does; s takes stage units; the box grows', () => {
  const FOX = CAST.FOX, at = [700, 670, 150];
  const pot = attach(FOX, 'hand-r', fill(circle(40, 0, 30, 16), 'fills.0'), { s: 150, level: true, tip: [70, 0] });
  const dx = (q) => { const a = propAt(FOX, pot, at, q, [0, 0]), b = propAt(FOX, pot, at, q, [100, 0]); return [b[0] - a[0], b[1] - a[1]]; };
  for (const arm of [0, -40, -84]) {
    const [x, y] = dx({ ...FOX.look(1), 'arm-r': arm });
    assert.ok(Math.abs(y) < 1e-6 && Math.abs(x - 100) < 1e-6, `arm ${arm}: 100 stage units along +x, got ${x}, ${y}`);
  }
  const [mx] = dx({ ...FOX.look(-1), 'arm-r': -40 });
  assert.ok(Math.abs(mx + 100) < 1e-6, 'facing left, mirrored with the fox');
  const g = FOX.place(...at, { ...FOX.look(-1), 'arm-r': -84, props: [pot] });
  const cel = named([g], 'actor:fox')[0].kids[0];
  assert.equal(cel.cel, 'fox');
  assert.equal(celOverflow(cel), null, 'the grown box holds the pot');
});

test('reach with a tip, and held: the prop\'s tip lands on the point', () => {
  const chalk = attach(SAM, 'hand-r', heldTool({ tool: 'chalk' }), { scale: 0.45 });
  const q = { dir: 1 };
  const sh = partAt(SAM, 'arm-r', AT, q);
  for (const [dx, dy] of [[100, 40], [180, -60], [220, 80], [140, 120]]) {
    const T = [sh[0] + dx, sh[1] + dy], j = held(SAM, chalk, T, { at: AT, state: q });
    for (const v of Object.values(j)) assert.equal(Math.abs(v % 2), 0);
    near(propAt(SAM, chalk, AT, { ...q, ...j }), T, 5, `${dx}, ${dy}`);
  }
  // The same solve lands the wrist when there is no tip.
  const T = [sh[0] + 90, sh[1] + 60];
  near(partAt(SAM, 'hand-r', AT, { ...q, ...reach(SAM, 'hand-r', T, { at: AT, state: q }) }), T, 5, 'no tip');
  assert.throws(() => reach(SAM, 'hand-r', T, { at: AT, tip: { part: 'head', at: [0, 0] } }), /does not ride fore-r/);
  assert.throws(() => reach(SAM, 'hand-r', T, { at: AT, tip: [0, 0] }), /tip is \{ part, at/);
});

test('heldTool: every tool in its box, the point ahead of the grip', () => {
  for (const tool of ['pen', 'marker', 'chalk', 'crayon']) {
    const t = heldTool({ tool });
    assert.equal(celOverflow(t.node), null, tool);
    assert.ok(t.tip[0] > 0 && t.tip[1] === 0);
  }
  assert.throws(() => heldTool({ tool: 'brush' }), /not one of/);
});

test('writer by an actor: the chalk\'s tip on the pen, the actor there before and after', () => {
  const chalk = attach(SAM, 'hand-r', heldTool({ tool: 'chalk' }), { scale: 0.45 });
  const txt = textBox('1 + 2', [392, 470, 160, 90], { size: 72, align: 'left', ink2: null, role: 'ink', seed: 31 });
  const W = { at: 0.4, per: 'word', wps: 1.5 }, by = { actor: SAM, at: AT, state: { dir: 1 }, prop: chalk };
  const before = writer(txt, 0, { ...W, by }), after = writer(txt, 9, { ...W, by });
  for (const g of [before, after]) assert.equal(named([g], 'prop:chalk').length, 1, 'drawn, chalk in hand');
  assert.equal(writer(txt, 0, W), null, 'the drawn hand is not there before');
  assert.throws(() => writer(txt, 1, { ...W, by: { actor: SAM, at: AT } }), /needs \{ prop \}/);
});
