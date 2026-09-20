import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromStore } from '../core/assets.js';
import { circle, fill, group, hashList, hashOp, serialise, stroke, translate, walk } from '../core/list.js';
import { lintPuppet } from '../core/lint.js';
import { JOINT, puppet } from '../core/puppet.js';
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
  assert.deepEqual(fox.cycles, ['walk']);
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
