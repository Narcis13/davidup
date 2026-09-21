import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromStore, validatePayload } from '../core/assets.js';
import { circle, fill, group, hashList, hashOp, parse, serialise, stroke, translate, walk } from '../core/list.js';
import { lintPuppet } from '../core/lint.js';
import { DIR, JOINT, puppet } from '../core/puppet.js';
import { cel } from '../core/tree.js';

// Ops as a payload carries them: plain data, paths as { $p }.
const ops = (list) => JSON.parse(serialise(list));

const BLOB = [fill(circle(0, 0, 40), 'fills.0', { finish: true }), stroke(circle(0, 0, 40), 'ink')];
const ONE = { name: 'blob', units: 100, box: [-50, -100, 100, 100], parts: { body: { pivot: [0, -50], ops: ops(BLOB) } } };

const POSED = {
  name: 'poser', units: 100, box: [-60, -120, 120, 120],
  parts: {
    body: { pivot: [0, -50], ops: ops(BLOB) },
    eye: { parent: 'body', variants: { open: ops([fill(circle(0, -20, 6), 'ink')]), shut: ops([stroke(circle(0, -20, 6), 'ink')]) } },
  },
  inputs: { eye: ['open', 'shut'] },
  poses: { rest: { body: 0, eye: 'open' }, tip: { body: 30, eye: 'shut' } },
};

const CYC = {
  name: 'nod', units: 100, box: [-50, -100, 100, 100],
  parts: { body: { pivot: [0, -50], ops: ops(BLOB) } },
  cycles: { bob: { fps: 12, n: 4, frames: [{ body: 0.4 }, { body: 10 }, { body: -0.4 }, { body: 10.6 }] } },
};

test('a one-part puppet draws, and hashes, exactly what the same cel draws in code', () => {
  const p = puppet(ONE);
  const code = cel('blob', () => [group({ name: 'body', xf: translate(0, -50) }, BLOB)], { box: [-50, -100, 100, 100] });
  assert.equal(hashList([p({})]), hashList([code({})]));
  assert.deepEqual(p.cel.inputs, { body: JOINT });
  assert.deepEqual([p.cel.box, p.units, p.ground], [[-50, -100, 100, 100], 100, [0, 0]]);
  assert.equal(p({}), p({}), 'memoised: the same inputs are the same frozen group');
  // A turned part draws direct, the way place() marks a rotation; a part at rest stays a cacheable layer.
  const turned = p({ body: 20 });
  assert.equal(turned.kids[0].cache, 'never');
  assert.equal(p({}).kids[0].cache, undefined);
  assert.notEqual(hashOp(turned), hashOp(p({})));
});

test('cycle frames whose joints quantise the same are one group, and the cycle wraps', () => {
  const p = puppet(CYC);
  assert.equal(p.cycle('bob', 0), p.cycle('bob', 2 / 12), '0.4 and -0.4 degrees both land on 0 of the 2 degree grid');
  assert.equal(p.cycle('bob', 1 / 12), p.cycle('bob', 3 / 12), '10 and 10.6 both land on 10');
  assert.notEqual(hashOp(p.cycle('bob', 0)), hashOp(p.cycle('bob', 1 / 12)));
  assert.equal(p.cycle('bob', 4 / 12), p.cycle('bob', 0), 'the cycle wraps');
  assert.equal(p.cycle('bob', -1 / 12), p.cycle('bob', 3 / 12), 'and wraps backwards');
  assert.equal(p.cycle('bob', 1.5 / 12), p.cycle('bob', 1 / 12), 'a time between frames holds the frame it is in');
  assert.throws(() => p.cycle('trot', 0), /no cycle 'trot'/);
});

test('pose lerps the joints and switches the variants at k = 0.5', () => {
  const p = puppet(POSED);
  assert.deepEqual(p.rest, { body: 0, eye: 'open' });
  assert.deepEqual(p.poseOf('tip', 1), { body: 30, eye: 'shut' });
  assert.deepEqual(p.poseOf('tip', 0.5), { body: 15, eye: 'shut' });
  const early = p.poseOf('tip', 0.4);
  assert.equal(early.eye, 'open');
  assert.ok(Math.abs(early.body - 12) < 1e-9);
  assert.equal(p.pose('tip', 1), p({ body: 30, eye: 'shut' }), 'a pose is the group its inputs stand for, so hashes agree');
  assert.equal(p.pose('rest', 1), p({ body: 0, eye: 'open' }));
  assert.throws(() => p.pose('nope'), /no pose 'nope'/);
});

test('the fox in the store: painter order survives the nesting, every part turns about its pivot', () => {
  fromStore(['fox']);
  const fox = puppet('fox');
  assert.equal(puppet('fox'), fox, 'built once per payload: the ops are deserialised one time');
  assert.deepEqual(fox.parts, ['tail', 'arm-l', 'leg-l', 'leg-r', 'body', 'head', 'eye', 'mouth', 'arm-r']);
  assert.deepEqual(fox.poses, ['rest', 'wave', 'asleep']);
  assert.deepEqual(fox.cycles, ['walk', 'run']);
  assert.deepEqual(fox.cel.inputs.eye, ['open', 'happy', 'sleep', 'wide']);
  assert.deepEqual(fox.cel.inputs.mouth, [0, 3, 1]);
  assert.deepEqual(fox.cel.inputs['arm-l'], JOINT);

  // Everything hangs off the body, and the tail listed before it is still drawn before it.
  const g = fox.pose('rest');
  assert.deepEqual(g.kids.map((k) => k.name), ['body']);
  const order = [];
  walk(g.kids, (op) => { if (op.op === 'group' && op.name) order.push(op.name); });
  assert.deepEqual(order, ['body', 'tail', 'arm-l', 'leg-l', 'leg-r', 'head', 'eye', 'mouth', 'arm-r']);

  const head = g.kids[0].kids.find((k) => k.name === 'head');
  assert.deepEqual(head.xf, translate(0, -76), "a part's xf is its pivot taken relative to its parent's");
  assert.deepEqual(head.kids.find((k) => k.name === 'eye').xf, translate(0, 0), 'a part with no pivot rides its parent');
  // The eye is a variant part: it takes a key, not an angle, and the key picks one op list.
  assert.notEqual(hashOp(fox({ eye: 'sleep' })), hashOp(fox({ eye: 'open' })));
  assert.equal(hashList(fox({ eye: 'open' }).kids), hashList(fox({}).kids), 'open is the rest variant, so an empty call draws it');
});

test('the fox payload passes the rules `hdf import` runs over it', () => {
  const d = JSON.parse(readFileSync(new URL('../assets/src/fox.puppet.json', import.meta.url), 'utf8'));
  assert.deepEqual(lintPuppet(d), []);
  assert.equal(d.units, 300);
});

test('a puppet says what it cannot do', () => {
  assert.throws(() => puppet({ units: 10 }), /expected a puppet payload/);
  assert.throws(() => puppet({ name: 'x', parts: { a: { parent: 'b', ops: [] } } }), /part 'a' names parent 'b', which is not a part/);
  assert.throws(() => puppet({ name: 'x', parts: { a: { parent: 'b', ops: [] }, b: { parent: 'a', ops: [] } } }), /parent each other in a loop/);
  assert.throws(() => puppet(POSED)({ eye: 'wink' }), /part 'eye' has no variant 'wink'/);
  assert.throws(() => puppet(ONE)({ body: 'up' }), /joint 'body' takes degrees/);
});

// ---------- turnarounds ----------

// Two views of a head on a body: the side has a nose to the right, the front two eyes; the body is shared.
const HEAD_SIDE = ops([fill(circle(8, 0, 10), 'fills.0', { finish: true }), fill(circle(18, 0, 2), 'ink')]);
const HEAD_FRONT = ops([fill(circle(0, 0, 10), 'fills.0', { finish: true }), fill(circle(-4, -2, 1.5), 'ink'), fill(circle(4, -2, 1.5), 'ink')]);
const TURN = {
  name: 'turner', units: 100, box: [-40, -100, 80, 100], ground: [0, 0], views: ['side', 'three-quarter', 'front'],
  parts: {
    body: { pivot: [0, -40], ops: ops(BLOB) },
    head: { parent: 'body', pivot: { side: [6, -86], front: [0, -84] }, ops: { side: HEAD_SIDE, front: HEAD_FRONT } },
    eye: { parent: 'head', variants: { open: { side: ops([fill(circle(10, -3, 2), 'ink')]), front: [] }, shut: [] } },
  },
};

test('views: dir picks the view, a missing view falls back to the first, a negative dir mirrors about the ground', () => {
  const p = puppet(TURN);
  assert.deepEqual(p.views, ['side', 'three-quarter', 'front']);
  assert.deepEqual(p.cel.inputs.dir, DIR);
  assert.equal(p.rest.dir, 1, 'at rest a turnaround shows its side, facing right');
  assert.deepEqual([1, 0.5, 0, -0.5, -1, 0.3, 0.2].map((d) => p.viewOf(d)), ['side', 'three-quarter', 'front', 'three-quarter', 'side', 'three-quarter', 'front']);
  const headOf = (g) => { let hit = null; walk([g], (op) => { if (!hit && op.op === 'group' && op.name === 'head') hit = op; }); return hit; };
  const side = p({ dir: 1 }), front = p({ dir: 0 }), tq = p({ dir: 0.5 });
  assert.equal(hashList(headOf(front).kids.slice(0, 3)), hashList(parse(JSON.stringify(HEAD_FRONT))));
  assert.notEqual(hashOp(side), hashOp(front));
  // three-quarter is declared but draws nothing of its own: every part falls back to the side.
  assert.equal(hashList(tq.kids), hashList(side.kids));
  // The pivot follows the view: the front head sits at (0, -84) relative to the body's (0, -40).
  assert.deepEqual([headOf(side).xf[4], headOf(side).xf[5]], [6, -46]);
  assert.deepEqual([headOf(front).xf[4], headOf(front).xf[5]], [0, -44]);
  // Mirrored: one cacheable group that flips about the ground point, the side drawing inside it.
  const back = p({ dir: -1 });
  assert.equal(back.kids.length, 1);
  assert.deepEqual([back.kids[0].name, back.kids[0].xf, back.kids[0].cache], ['mirror', [-1, 0, 0, 1, 0, 0], undefined]);
  assert.equal(hashList(back.kids[0].kids), hashList(side.kids));
  assert.equal(p({ dir: 0.9 }), p({ dir: 1 }), 'dir quantises to the half step');
  // The box holds the drawing both ways round.
  assert.deepEqual(p.cel.box, [-40, -100, 80, 100]);
  assert.deepEqual(puppet({ ...TURN, box: [-30, -100, 90, 100] }).cel.box, [-60, -100, 120, 100]);
  assert.deepEqual(lintPuppet(TURN), []);
  assert.deepEqual(validatePayload('puppet', TURN), []);
});

test('views: keyed data without views, or naming a view that is not declared, is refused', () => {
  const { views, ...flat } = TURN;
  assert.throws(() => puppet(flat), /part 'head' ops is keyed by view, but the puppet declares no views/);
  assert.throws(() => puppet({ ...TURN, views: ['side'] }), /part 'head' ops names view 'front' \(views: side\)/);
  assert.deepEqual(validatePayload('puppet', { ...flat, units: 100 }).filter((b) => /head/.test(b)), ['parts.head: needs ops or variants', 'parts.head.pivot: [x, y]']);
  assert.equal(validatePayload('puppet', { ...TURN, views: [] })[0], "views: view names, the first the one a part falls back to (['side', 'three-quarter', 'front'])");
  // roles-raw looks inside every view.
  const raw = { ...TURN, parts: { ...TURN.parts, head: { ...TURN.parts.head, ops: { ...TURN.parts.head.ops, front: ops([fill(circle(0, 0, 10), '#ff0000')]) } } } };
  assert.deepEqual(lintPuppet(raw).map((f) => f.detail), ["part 'head' ops in view front paints #ff0000; name a palette role (ink, fills.0, light, ...)"]);
});

test('the fox in the store turns: three views, and every one both ways round inside its box', () => {
  fromStore(['fox']);
  const fox = puppet('fox');
  assert.deepEqual(fox.views, ['side', 'three-quarter', 'front']);
  const hashes = [1, 0.5, 0, -0.5, -1].map((dir) => hashOp(fox({ dir })));
  assert.equal(new Set(hashes).size, 5, 'five different drawings');
  assert.deepEqual(fox.cel.box, [-126, -314, 252, 324]);
});

test('lint: cel-box looks at every view both ways round', () => {
  // A front head drawn far to the right, past the box: only the front view shows it.
  const wide = { ...TURN, parts: { ...TURN.parts, head: { ...TURN.parts.head, ops: { ...TURN.parts.head.ops, front: ops([fill(circle(60, 0, 10), 'fills.0')]) } } } };
  const found = lintPuppet(wide).filter((f) => f.rule === 'cel-box');
  assert.equal(found.length, 1);
  assert.match(found[0].detail, /^view front draws .* outside the declared box/);
});
