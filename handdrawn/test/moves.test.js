// 4.0 K1: part inputs beyond rotation -- slide, scale, and the `when` that shows a pupil with an open eye.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromStore } from '../core/assets.js';
import { actorOf, EMOTES } from '../core/actor.js';
import { lintPuppet, puppetCases } from '../core/lint.js';
import { circle, fill, group, hashList, line, mmul, rotate, scale, serialise, stroke, translate } from '../core/list.js';
import { cutoutOf, puppet } from '../core/puppet.js';
import { svgPuppet } from '../core/svg.js';
import { cel } from '../core/tree.js';

const ops = (list) => JSON.parse(serialise(list));
const BODY = [fill(circle(0, 0, 30), 'fills.0', { finish: true }), stroke(circle(0, 0, 30), 'ink')];
const DOT = [fill(circle(0, -10, 3), 'ink')];
const FACE = (extra = {}) => ({
  name: 'face', units: 100, box: [-50, -100, 100, 100],
  parts: {
    body: { pivot: [0, -40], ops: ops(BODY), ...extra.body },
    eye: { parent: 'body', variants: { open: [], shut: ops([stroke(line(-5, -10, 5, -10), 'ink')]) } },
    pupil: { parent: 'body', when: { eye: ['open'] }, slide: { x: [-4, 4, 1], y: [-3, 3, 1] }, ops: ops(DOT) },
    brow: { parent: 'body', pivot: [0, -58], slide: { y: [-6, 3, 1] }, ops: ops([stroke(line(-6, 0, 6, 0), 'ink')]) },
  },
});

test('slide and scale declare inputs on their step; the rest is 0 and 1', () => {
  const p = puppet(FACE({ body: { scale: { y: [0.8, 1.2, 0.05], keepArea: true } } }));
  assert.deepEqual(p.moves, { 'body.sy': [0.8, 1.2, 0.05], 'pupil.x': [-4, 4, 1], 'pupil.y': [-3, 3, 1], 'brow.y': [-6, 3, 1] });
  for (const [k, v] of Object.entries(p.moves)) assert.deepEqual(p.cel.inputs[k], v);
  assert.deepEqual([p.rest['body.sy'], p.rest['pupil.x'], p.rest['brow.y']], [1, 0, 0]);
  assert.deepEqual(p({ 'pupil.x': 3.4, 'brow.y': -9 }).inputs, { 'brow.y': -6, 'pupil.x': 3 }, 'quantised and clamped like a joint');
});

test('xf = translate(pivot) . translate(dx, dy) . rotate(a) . scale(sx, sy); keepArea makes the other axis the inverse', () => {
  const p = puppet(FACE({ body: { scale: { y: [0.8, 1.2, 0.05], keepArea: true } } }));
  const g = p({ 'body.sy': 1.25, brow: 10, 'brow.y': -2, 'pupil.x': 3 });
  const body = g.kids[0], [eye, pupil, brow] = ['eye', 'pupil', 'brow'].map((n) => body.kids.find((k) => k.name === n));
  assert.deepEqual(body.xf, mmul(translate(0, -40), scale(1 / 1.2, 1.2)));
  assert.equal(body.cache, 'never', 'a scaled part draws direct');
  assert.equal(eye.name, 'eye');
  assert.deepEqual(pupil.xf, mmul(translate(0, 0), translate(3, 0)));
  assert.equal(pupil.cache, undefined, 'a slid part stays a cacheable layer');
  assert.deepEqual(brow.xf, mmul(mmul(translate(0, -18), translate(0, -2)), rotate(10 * Math.PI / 180)));
});

test('at rest a part with moves draws what it drew without them', () => {
  const plain = FACE();
  for (const n of ['pupil', 'brow']) { delete plain.parts[n].slide; }
  delete plain.parts.pupil.when;
  const a = puppet(FACE()), b = puppet({ ...plain, name: 'plain' });
  assert.equal(hashList(a({}).kids), hashList(b({}).kids));
  // And a puppet that declares no moves is unchanged: the S4 one-part puppet still hashes as the code cel.
  const one = puppet({ name: 'blob', units: 100, box: [-50, -100, 100, 100], parts: { body: { pivot: [0, -50], ops: ops(BODY) } } });
  const code = cel('blob', () => [group({ name: 'body', xf: translate(0, -50) }, BODY)], { box: [-50, -100, 100, 100] });
  assert.equal(hashList([one({ body: 0 })]), hashList([code({ body: 0 })]));
  assert.deepEqual(one.moves, {});
});

test('when: the pupil shows with the open eye only', () => {
  const p = puppet(FACE());
  const names = (q) => p(q).kids[0].kids.map((k) => k.name ?? k.op);
  assert.deepEqual(names({}), ['fill', 'stroke', 'eye', 'pupil', 'brow']);
  assert.deepEqual(names({ eye: 'shut' }), ['fill', 'stroke', 'eye', 'brow']);
});

test('a puppet says what is wrong with a move', () => {
  const bad = (part, re) => assert.throws(() => puppet({ ...FACE(), name: `bad${Math.random()}`, parts: { ...FACE().parts, ...part } }), re);
  bad({ brow: { parent: 'body', slide: { y: [3, -3, 1] }, ops: [] } }, /slide.y takes \[min, max, step\]/);
  bad({ brow: { parent: 'body', slide: { y: [1, 5, 1] }, ops: [] } }, /does not hold its rest 0/);
  bad({ brow: { parent: 'body', slide: { z: [-1, 1, 1] }, ops: [] } }, /slide has 'z'/);
  bad({ brow: { parent: 'body', scale: { y: [0, 2, 0.5] }, ops: [] } }, /a scale stays above 0/);
  bad({ brow: { parent: 'body', scale: { x: [0.5, 1.5, 0.5], y: [0.5, 1.5, 0.5], keepArea: true }, ops: [] } }, /keeps its area with one axis; it names both/);
  bad({ pupil: { parent: 'body', when: { eye: ['wink'] }, ops: [] } }, /no variant for/);
  bad({ pupil: { parent: 'body', when: { body: ['open'] }, ops: [] } }, /'body' is not a part with variants/);
  assert.throws(() => puppet(FACE())({ 'pupil.x': 'left' }), /'pupil.x' takes a number/);
});

test('lint: puppet-joint checks a move in a pose, a malformed spec; cel-box sees every move at its extremes', () => {
  const d = { ...FACE(), poses: { ok: { 'pupil.x': 2 }, far: { 'pupil.x': 9 }, off: { 'brow.y': 0.5 } } };
  const found = lintPuppet(d).filter((f) => f.rule === 'puppet-joint').map((f) => f.detail);
  assert.equal(found.length, 2);
  assert.match(found.join('\n'), /pose 'far' sets 'pupil.x' to 9, outside -4..4/);
  assert.match(found.join('\n'), /pose 'off' sets 'brow.y' to 0.5, off its 1 step/);
  const broken = FACE();
  broken.parts.brow.slide = { y: [1, 5, 1] };
  assert.ok(lintPuppet(broken).some((f) => f.rule === 'puppet-joint' && /does not hold its rest/.test(f.detail)));
  const labels = puppetCases(puppet(FACE()), FACE()).map(([l]) => l);
  for (const l of ['pupil.x = -4', 'pupil.x = 4', 'brow.y = -6', 'brow.y = 3']) assert.ok(labels.includes(l), l);
  const tight = { ...FACE(), name: 'tight', box: [-31, -71, 62, 62] };
  tight.parts.pupil.slide = { x: [-40, 40, 1] };
  assert.ok(lintPuppet(tight).some((f) => f.rule === 'cel-box' && /pupil.x = -?40 draws/.test(f.detail)));
});

test('a sliding part is printed on its card in the cut-out look', () => {
  const p = puppet({ ...FACE(), name: 'cutface' });
  const c = cutoutOf(p({}));
  assert.equal(c.kinds.brow, 'print', 'a brow slides: no fastener');
  assert.equal(c.kinds.body, 'card');
});

test('svg: data-slide, data-scale and data-when; a view may not disagree', () => {
  const src = (a, b = a) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <g id="view:side"><g id="body"><circle id="pivot" cx="50" cy="50" r="2" fill="#00a0ff"/><rect x="30" y="30" width="40" height="40" fill="#e8734a"/></g>
      <g id="eye" data-parent="body" data-variants><g id="open"/><g id="shut"><line x1="40" y1="40" x2="60" y2="40" stroke="#101010"/></g></g>
      <g id="pupil" data-parent="body" data-when="eye:open" ${a}><circle cx="50" cy="40" r="3" fill="#101010"/></g></g>
    <g id="view:front"><g id="body"><circle id="pivot" cx="50" cy="50" r="2" fill="#00a0ff"/><rect x="30" y="30" width="40" height="40" fill="#e8734a"/></g><g id="pupil" data-parent="body" data-when="eye:open" ${b}><circle cx="45" cy="40" r="3" fill="#101010"/></g></g></svg>`;
  const { payload } = svgPuppet(src('data-slide="x:-4..4:1,y:-3..3:1" data-scale="y:0.5..1.5:0.25,keep-area"'));
  assert.deepEqual(payload.parts.pupil.slide, { x: [-4, 4, 1], y: [-3, 3, 1] });
  assert.deepEqual(payload.parts.pupil.scale, { y: [0.5, 1.5, 0.25], keepArea: true });
  assert.deepEqual(payload.parts.pupil.when, { eye: ['open'] });
  assert.deepEqual(Object.keys(puppet(payload).moves), ['pupil.x', 'pupil.y', 'pupil.sy']);
  assert.throws(() => svgPuppet(src('data-slide="x:-4..4:1"', 'data-slide="x:-2..2:1"')), /'pupil' has slide .* in view front and .* in view side/);
  assert.throws(() => svgPuppet(src('data-slide="x:-4..4"')), /data-slide: 'x:-4..4' is not axis:min..max:step/);
});

test('the fox looks left and worried: FOX({ pupil.x: 4, brow-l: -12 }); emotes carry brows', () => {
  fromStore(['fox']);
  const FOX = puppet('fox');
  assert.deepEqual(FOX.moves, { 'pupil.x': [-4, 4, 1], 'pupil.y': [-3, 3, 1], 'brow-l.y': [-6, 3, 1], 'brow-r.y': [-6, 3, 1] });
  const find = (g, n) => { let hit; const go = (l) => l.forEach((o) => { if (o.op === 'group') { if (o.name === n) hit ??= o; go(o.kids); } }); go([g]); return hit; };
  const g = FOX({ 'pupil.x': 4, 'brow-l': -12 }), rest = FOX({});
  assert.deepEqual(find(g, 'pupil').xf, mmul(find(rest, 'pupil').xf, translate(4, 0)));
  const want = mmul(find(rest, 'brow-l').xf, rotate(-12 * Math.PI / 180));
  find(g, 'brow-l').xf.forEach((v, j) => assert.ok(Math.abs(v - want[j]) < 1e-12, `brow-l xf[${j}]`));
  assert.equal(find(FOX({ eye: 'happy' }), 'pupil'), undefined, 'no pupil over a happy eye');
  const A = actorOf(FOX);
  assert.deepEqual(A.emote('worried'), EMOTES.worried, 'the fox has every key of worried');
  assert.equal(A.emote('happy')['brow-l.y'], -2);
});
