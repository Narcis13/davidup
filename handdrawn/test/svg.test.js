import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hashList, walk } from '../core/list.js';
import { lintPuppet } from '../core/lint.js';
import { puppet } from '../core/puppet.js';
import { SvgError, autoRoles, flattenD, parseTransform, parseXml, svgColours, svgMotif, svgPuppet } from '../core/svg.js';

const svg = (body, attrs = 'viewBox="0 0 100 100"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
// The one sub of a one-shape motif: [closed, ...pts] as the payload carries it.
const subsOf = (body, opts) => svgMotif(svg(body), opts).payload[0].path.$p;
// Distance from (x, y) to the nearest segment of a flat polyline.
function near(pts, x, y) {
  let d = Infinity;
  for (let i = 2; i < pts.length; i += 2) {
    const [ax, ay, bx, by] = pts.slice(i - 2, i + 2), L = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = L ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L)) : 0;
    d = Math.min(d, Math.hypot(ax + t * (bx - ax) - x, ay + t * (by - ay) - y));
  }
  return d;
}
// Largest distance of any point from the circle about (cx, cy) of radius r.
const offCircle = (pts, cx, cy, r) => { let d = 0; for (let i = 0; i < pts.length; i += 2) d = Math.max(d, Math.abs(Math.hypot(pts[i] - cx, pts[i + 1] - cy) - r)); return d; };

test('each element kind flattens to the polyline it should', () => {
  assert.deepEqual(subsOf('<rect x="10" y="20" width="30" height="40" fill="#e8734a"/>'), [[1, 10, 20, 40, 20, 40, 60, 10, 60]]);
  assert.deepEqual(subsOf('<polygon points="0,0 10,0 10,10" fill="#e8734a"/>'), [[1, 0, 0, 10, 0, 10, 10]]);
  assert.deepEqual(subsOf('<polyline points="0,0 10,0 10,10" fill="none" stroke="#000"/>'), [[0, 0, 0, 10, 0, 10, 10]]);
  assert.deepEqual(subsOf('<line x1="1" y1="2" x2="3" y2="4" stroke="#000"/>'), [[0, 1, 2, 3, 4]]);
  // Relative commands, H and V, implicit lines after a move, and Z back to the start.
  assert.deepEqual(subsOf('<path d="m10 10 20 0v20h-20z" fill="#e8734a"/>'), [[1, 10, 10, 30, 10, 30, 30, 10, 30]]);
  // Two subpaths in one d (a ring) stay two subs.
  assert.equal(subsOf('<path d="M0 0H50V50H0ZM10 10H40V40H10Z" fill="#e8734a"/>').length, 2);

  // Curves: every point on the curve, none further than `flatten` from it, and finer flatten means more points.
  const [[c, ...circ]] = subsOf('<circle cx="50" cy="50" r="40" fill="#e8734a"/>');
  assert.equal(c, 1);
  assert.ok(offCircle(circ, 50, 50, 40) < 0.05, 'on the circle (the cubic arcs are within 0.05 of it)');
  assert.ok(circ.length / 2 >= 12, `${circ.length / 2} points`);
  const fine = subsOf('<circle cx="50" cy="50" r="40" fill="#e8734a"/>', { flatten: 0.05 })[0];
  assert.ok(fine.length > circ.length + 1);
  const [[, ...ell]] = subsOf('<ellipse cx="0" cy="0" rx="40" ry="10" fill="#e8734a"/>');
  for (let i = 0; i < ell.length; i += 2) assert.ok(Math.abs((ell[i] / 40) ** 2 + (ell[i + 1] / 10) ** 2 - 1) < 0.01);
  const [[, ...rr]] = subsOf('<rect x="0" y="0" width="100" height="50" rx="10" fill="#e8734a"/>');
  assert.ok(rr.length / 2 > 8, 'rounded corners add points');
  assert.deepEqual([Math.min(...rr.filter((_, i) => i % 2 === 0)), Math.max(...rr.filter((_, i) => i % 2 === 1))], [0, 50]);

  // A cubic's midpoint and a quadratic's, and an arc that is a half circle.
  const cub = flattenD('M0 0C0 100 100 100 100 0', undefined, 0.1)[0].pts;
  assert.ok(near(cub, 50, 75) <= 0.1, 'the cubic passes within flatten of (50, 75)');
  assert.deepEqual([cub.slice(0, 2), cub.slice(-2)], [[0, 0], [100, 0]]);
  const quad = flattenD('M0 0Q50 100 100 0', undefined, 0.1)[0].pts;
  assert.ok(near(quad, 50, 50) <= 0.1, 'the quadratic passes within flatten of (50, 50)');
  const half = flattenD('M0 0A50 50 0 0 1 100 0', undefined, 0.1)[0].pts;
  assert.ok(offCircle(half, 50, 0, 50) < 0.05);
  assert.ok(Math.min(...half.filter((_, i) => i % 2 === 1)) < -49.9, 'sweep 1 turns clockwise on screen: over the top');
  // S reflects the last control point: a smooth S curve is symmetric about its middle.
  const s = flattenD('M0 0C0 50 50 50 50 0S100 -50 100 0', undefined, 0.1)[0].pts;
  assert.ok(Math.abs(Math.min(...s.filter((_, i) => i % 2 === 1)) + 37.5) < 1e-9);
});

test('transforms compose down the tree and scale the tolerance with them', () => {
  assert.deepEqual(parseTransform('translate(10 20) scale(2)'), [2, 0, 0, 2, 10, 20]);
  const r = parseTransform('rotate(90 10 10)');
  assert.deepEqual(r.map((v) => Math.round(v * 1e9) / 1e9 || 0), [0, 1, -1, 0, 20, 0]);
  assert.deepEqual(subsOf('<g transform="translate(100 0)"><rect transform="scale(2)" width="10" height="10" fill="#e8734a"/></g>'), [[1, 100, 0, 120, 0, 120, 20, 100, 20]]);
  assert.deepEqual(subsOf('<g transform="matrix(1 0 0 1 5 5)"><line x2="10" stroke="#000"/></g>'), [[0, 5, 5, 15, 5]]);
  // --units rescales the whole file; a stroke-width scales with it.
  const m = svgMotif(svg('<line x2="10" stroke="#000" stroke-width="2"/>', 'viewBox="0 0 100 100" data-units="100"'), { units: 300 });
  assert.deepEqual([m.payload[0].path.$p, m.payload[0].w], [[[0, 0, 0, 30, 0]], 6]);
  assert.throws(() => parseTransform('perspective(3)'), /cannot read/);
});

test('paint: style beats attributes, fills inherit, none draws nothing, opacity becomes alpha', () => {
  const ops = svgMotif(svg('<g fill="#e8734a" opacity="0.5"><rect width="10" height="10" style="fill:#2b2b2b"/><rect x="20" width="10" height="10"/></g>'
    + '<rect x="40" width="10" height="10" fill="none" stroke="rgb(43,43,43)"/>'), { roles: { '#e8734a': 'fills.0' } }).payload;
  assert.deepEqual(ops.map((o) => [o.op, o.role, o.alpha]), [['fill', 'ink', 0.5], ['fill', 'fills.0', 0.5], ['stroke', 'ink', undefined]]);
  assert.equal(ops[1].finish, true, 'a fill in fills.n gets the look\'s finish');
  assert.equal(ops[0].finish, undefined, 'an ink fill does not');
  const off = svgMotif(svg('<rect width="10" height="10" fill="#e8734a" data-finish="false"/>'), { roles: { '#e8734a': 'fills.0' } }).payload[0];
  assert.equal(off.finish, undefined);
  // A fill and a stroke on one element: fill first, then stroke, as SVG paints them.
  assert.deepEqual(svgMotif(svg('<circle r="5" fill="#e8734a" stroke="#000"/>')).payload.map((o) => o.op), ['fill', 'stroke']);
});

test('colours map to roles: darkest ink, lightest paper, the rest to the nearest house fill; --roles overrides', () => {
  const table = svgColours(svg('<rect width="80" height="80" fill="#e8734a"/><rect width="10" height="10" fill="#fdf8ee"/><rect width="5" height="5" fill="#101010"/><rect width="4" height="4" fill="#2b5fb8"/>'));
  assert.deepEqual(table.map((r) => [r.hex, r.area]), [['#e8734a', 6400], ['#fdf8ee', 100], ['#101010', 25], ['#2b5fb8', 16]]);
  const role = Object.fromEntries(table.map((r) => [r.hex, r.role]));
  assert.equal(role['#101010'], 'ink');
  assert.equal(role['#fdf8ee'], 'paper');
  assert.equal(role['#e8734a'], 'fills.0', 'orange is nearest the house orange');
  assert.match(role['#2b5fb8'], /^(fills|accents)\.\d$/);
  assert.notEqual(role['#2b5fb8'], role['#e8734a'], 'each colour its own role while there are roles left');
  const over = svgColours(svg('<rect width="8" height="8" fill="#e8734a"/>'), { roles: { '#E8734A': 'accents.2' } });
  assert.deepEqual(over.map((r) => [r.role, r.how]), [['accents.2', 'map']]);
  assert.throws(() => svgColours(svg('<rect width="8" height="8" fill="#e8734a"/>'), { roles: { '#e8734a': 'orange' } }), /roles: #e8734a -> "orange"/);
  assert.deepEqual(autoRoles([]), {});
});

test('refusals name the element (and its line) and say what to do', () => {
  const refused = [
    ['<use href="#a"/>', /<use> on line 1: refused: a <use> clone/],
    ['<defs><linearGradient id="g"/></defs>', /<linearGradient> id="g" on line 1: refused: a gradient/],
    ['<filter id="f"/>', /<filter> id="f".*blurs and shadows/],
    ['<text x="0" y="0">hi</text>', /<text>.*outline it/],
    ['<mask id="m"/>', /<mask> id="m".*refused/],
    ['<image href="x.png"/>', /<image>.*hdf photo/],
    ['<clipPath id="c"><rect/></clipPath>', /<clipPath>.*clip content/],
    ['<style>rect{fill:red}</style>', /<style>.*presentation attributes/],
    ['<rect width="5" height="5" fill="url(#g)"/>', /<rect> on line 1: fill="url\(#g\)" paints with a gradient/],
  ];
  for (const [body, re] of refused) assert.throws(() => svgMotif(svg(body)), (e) => e instanceof SvgError && re.test(e.message), body);
  assert.throws(() => svgMotif(svg('\n\n<g>\n<use/></g>')), /<use> on line 4/);
  assert.throws(() => parseXml('<svg><g></svg>'), /<\/svg> closes <g> from line 1/);
  assert.throws(() => parseXml('<g/>'), /no <svg> element/);
  assert.throws(() => svgPuppet(svg('<rect width="5" height="5"/>')), /<rect> on line 1: drawn outside any part/);
  // Comments, the xml prolog, a doctype, title and metadata are fine.
  assert.equal(svgMotif(`<?xml version="1.0"?><!DOCTYPE svg><!-- hi -->${svg('<title>t</title><metadata/><rect width="5" height="5"/>')}`).payload.length, 1);
});

const RIG = svg(`
  <g id="body"><circle id="pivot" cx="50" cy="60" r="2" fill="#00a0ff"/><rect x="30" y="40" width="40" height="40" fill="#e8734a"/></g>
  <g id="head" data-parent="body" data-pivot="50,40"><circle cx="50" cy="30" r="10" fill="#e8734a"/>
    <g id="eye" data-variants><g id="open"><circle cx="54" cy="28" r="2" fill="#101010"/></g><g id="shut"><line x1="52" y1="28" x2="56" y2="28" stroke="#101010"/></g></g>
  </g>
  <g id="arm"><circle id="pivot" cx="70" cy="45" r="2" fill="#00a0ff"/><rect x="70" y="45" width="5" height="20" fill="#e8734a"/>
    <g id="hand"><circle cx="72" cy="68" r="3" fill="#e8734a"/></g></g>
  <g id="mouth-0" data-parent="head"><line x1="46" y1="34" x2="54" y2="34" stroke="#101010"/></g>
  <g id="mouth-1" data-parent="head"><rect x="46" y="33" width="8" height="3" fill="#101010"/></g>
  <g id="pose:rest" data-joints="eye:open,mouth:0"/>
  <g id="pose:wave" data-joints="arm:-90, head:6, eye:shut, mouth:1"/>
  <g id="cycle:nod" data-fps="6"><g data-joints="head:0"/><g data-joints="head:4"/></g>
  <circle id="ground" cx="50" cy="80" r="2" fill="#00a0ff"/>`, 'viewBox="0 0 100 90" data-desc="a test rig"');

test('rig from ids: parts, pivots, parents, variants, steps, poses, cycles, ground', () => {
  const { payload: p } = svgPuppet(RIG, { name: 'rig' });
  assert.deepEqual(Object.keys(p.parts), ['body', 'head', 'eye', 'arm', 'hand', 'mouth']);
  assert.deepEqual([p.parts.body.pivot, p.parts.head.pivot, p.parts.arm.pivot], [[50, 60], [50, 40], [70, 45]]);
  assert.deepEqual([p.parts.head.parent, p.parts.eye.parent, p.parts.hand.parent, p.parts.mouth.parent, p.parts.body.parent], ['body', 'head', 'arm', 'head', undefined]);
  assert.deepEqual(Object.keys(p.parts.eye.variants), ['open', 'shut']);
  assert.equal(p.parts.eye.ops, undefined, 'a variant part with nothing of its own carries no ops');
  assert.deepEqual(Object.keys(p.parts.mouth.variants), ['0', '1']);
  assert.deepEqual(p.inputs, { eye: ['open', 'shut'], mouth: [0, 1, 1] });
  assert.deepEqual(p.poses, { rest: { eye: 'open', mouth: 0 }, wave: { arm: -90, head: 6, eye: 'shut', mouth: 1 } });
  assert.deepEqual(p.cycles, { nod: { fps: 6, n: 2, frames: [{ head: 0 }, { head: 4 }] } });
  assert.deepEqual([p.box, p.units, p.ground, p.desc], [[0, 0, 100, 90], 90, [50, 80], 'a test rig']);
  // Ops are in the part's own coordinates, pivot at the origin; the eye rides the head's pivot.
  assert.deepEqual(p.parts.body.ops[0].path.$p, [[1, -20, -20, 20, -20, 20, 20, -20, 20]]);
  assert.deepEqual(p.parts.eye.variants.shut[0].path.$p, [[0, 2, -12, 6, -12]]);
  assert.ok(!JSON.stringify(p.parts).includes('#00a0ff') && !Object.keys(p.roles).includes('#00a0ff'), 'pivots and the ground are read, not drawn');
  assert.deepEqual(lintPuppet(p), [], 'it passes the rules hdf import holds a puppet to');
  const rig = puppet(p);
  assert.notEqual(hashList([rig.pose('wave')]), hashList([rig(rig.rest)]));
  assert.equal(hashList([rig.cycle('nod', 0)]), hashList([rig(rig.rest)]));
  assert.notEqual(hashList([rig.cycle('nod', 1 / 6)]), hashList([rig(rig.rest)]), 'frame 1 at 6 fps');
});

test('rig errors name the part', () => {
  const bad = [
    [svg('<g id="a"><rect width="5" height="5"/></g><g id="a"><rect width="5" height="5"/></g>'), /part 'a' appears twice/],
    [svg('<g id="a" data-parent="zzz"><rect width="5" height="5"/></g>'), /id="a".*data-parent="zzz" names no part/],
    [svg('<g id="e" data-variants><rect width="5" height="5"/></g>'), /id="e".*no child <g id="..."> to be the variants/],
    [svg('<g id="m-0"><rect width="5" height="5"/></g><g id="m-2"><rect width="5" height="5"/></g>'), /steps of 'm' must run 0, 1, 2/],
    [svg('<g id="cycle:x"/>'), /cycle needs one <g data-joints/],
    [svg('<g id="pose:x" data-joints="arm"/>'), /data-joints: 'arm' is not part:value/],
    [svg(''), /no parts/],
  ];
  for (const [src, re] of bad) assert.throws(() => svgPuppet(src), re);
});

// A puppet with views as the one view it draws: every keyed ops, variant and pivot picked for that view.
function oneView(d, view) {
  const pick = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v[view] ?? v[d.views[0]] : v);
  const parts = Object.fromEntries(Object.entries(d.parts).map(([n, p]) => [n, {
    ...p, ...(p.ops ? { ops: pick(p.ops) } : {}), ...(p.pivot ? { pivot: pick(p.pivot) } : {}),
    ...(p.variants ? { variants: Object.fromEntries(Object.entries(p.variants).map(([k, v]) => [k, pick(v)])) } : {}),
  }]));
  const { views, sockets, ...rest } = d;
  const one = sockets && Object.fromEntries(Object.entries(sockets).map(([n, k]) => [n, Array.isArray(k) ? k : { ...k, at: pick(k.at), angle: pick(k.angle) }]));
  return { ...rest, parts, ...(one ? { sockets: one } : {}) };
}

const TURN = svg(`
  <g id="view:side">
    <g id="body"><circle id="pivot" cx="50" cy="60" r="2" fill="#00a0ff"/><rect x="30" y="40" width="40" height="40" fill="#e8734a"/></g>
    <g id="head" data-parent="body"><circle id="pivot" cx="50" cy="40" r="2" fill="#00a0ff"/><rect x="50" y="20" width="30" height="20" fill="#e8734a"/>
      <g id="eye" data-variants><g id="open"><circle cx="70" cy="28" r="2" fill="#101010"/></g><g id="shut"><line x1="68" y1="28" x2="72" y2="28" stroke="#101010"/></g></g></g>
    <g id="tail" data-parent="body"><rect x="10" y="50" width="20" height="6" fill="#e8734a"/></g>
  </g>
  <g id="view:front">
    <g id="body"><circle id="pivot" cx="50" cy="60" r="2" fill="#00a0ff"/><rect x="30" y="40" width="40" height="40" fill="#e8734a"/></g>
    <g id="head" data-parent="body"><circle id="pivot" cx="50" cy="42" r="2" fill="#00a0ff"/><rect x="35" y="20" width="30" height="22" fill="#e8734a"/>
      <g id="eye" data-variants><g id="open"><circle cx="44" cy="28" r="2" fill="#101010"/><circle cx="56" cy="28" r="2" fill="#101010"/></g>
        <g id="shut"><line x1="42" y1="28" x2="58" y2="28" stroke="#101010"/></g></g></g>
  </g>
  <g id="pose:wink" data-joints="eye:shut,head:4"/>
  <circle id="ground" cx="50" cy="80" r="2" fill="#00a0ff"/>`, 'viewBox="0 0 100 90"');

test('views: a <g id="view:..."> per view, keyed ops and variants, pivots only where they move, the rest shared', () => {
  const { payload: p } = svgPuppet(TURN, { name: 'turn' });
  assert.deepEqual(p.views, ['side', 'front']);
  assert.deepEqual(Object.keys(p.parts), ['body', 'head', 'eye', 'tail'], 'painter order is the first view\'s');
  assert.deepEqual(Object.keys(p.parts.body.ops), ['side', 'front']);
  assert.deepEqual(p.parts.body.pivot, [50, 60], 'the same pivot in every view stays one [x, y]');
  assert.deepEqual(p.parts.head.pivot, { side: [50, 40], front: [50, 42] });
  assert.deepEqual(Object.keys(p.parts.eye.variants), ['open', 'shut']);
  assert.deepEqual(Object.keys(p.parts.eye.variants.open), ['side', 'front']);
  assert.ok(Array.isArray(p.parts.tail.ops), 'drawn in the first view only: one op list, the same in every view');
  assert.deepEqual([p.poses, p.ground, p.inputs], [{ wink: { eye: 'shut', head: 4 } }, [50, 80], { eye: ['open', 'shut'] }]);
  assert.deepEqual(lintPuppet(p), []);
  // Each view is the rig its group alone would give.
  const alone = (id) => svg(TURN.match(new RegExp(`<g id="view:${id}">([\\s\\S]*?)\\n  </g>`))[1] + '<circle id="ground" cx="50" cy="80" r="2" fill="#00a0ff"/>', 'viewBox="0 0 100 90"');
  const turn = puppet(p), front = puppet(svgPuppet(alone('front'), { name: 'turn' }).payload);
  const part = (g, name) => { let hit = null; walk([g], (op) => { if (!hit && op.op === 'group' && op.name === name) hit = op; }); return hit; };
  assert.equal(hashList([part(turn({ dir: 0 }), 'head')]), hashList([part(front({}), 'head')]));
  assert.equal(hashList([part(turn({ dir: 0, eye: 'shut' }), 'head')]), hashList([part(front({ eye: 'shut' }), 'head')]));
  assert.equal(hashList([part(turn({ dir: 0 }), 'tail')]), hashList([part(turn({ dir: 1 }), 'tail')]), 'the tail falls back to the side view');
  assert.equal(hashList(turn({ dir: 1 }).kids), hashList(puppet(oneView(p, 'side'))({}).kids));
});

test('view errors name the part and the view', () => {
  const two = (a, b) => svg(`<g id="view:side">${a}</g><g id="view:front">${b}</g>`);
  const bad = [
    [svg('<g id="view:side"><g id="a"><rect width="5" height="5"/></g></g><g id="view:side"><g id="a"><rect width="5" height="5"/></g></g>'), /view 'side' appears twice/],
    [two('<g id="a"><rect width="5" height="5"/></g><g id="b" data-parent="a"><rect width="5" height="5"/></g>', '<g id="a"><rect width="5" height="5"/></g><g id="b"><rect width="5" height="5"/></g>'), /'b' has parent 'none' in view front and 'a' in view side/],
    [two('<g id="e" data-variants><g id="x"><rect width="5" height="5"/></g></g>', '<g id="e" data-variants><g id="y"><rect width="5" height="5"/></g></g>'), /'e' has variants y in view front and x in view side/],
    [svg('<g id="view:side"><g id="a"><rect width="5" height="5"/></g></g><g id="view:front"/>'), /id="view:front".*draws no parts/],
  ];
  for (const [src, re] of bad) assert.throws(() => svgPuppet(src), re);
});

test('the SVG fox is the S4 JSON fox from the side: same parts, same boxes, the same list in every state', () => {
  const json = JSON.parse(readFileSync(new URL('../assets/src/fox.puppet.json', import.meta.url), 'utf8'));
  const { payload: turned, table } = svgPuppet(readFileSync(new URL('../assets/src/fox.svg', import.meta.url), 'utf8'), {
    name: 'fox', roles: JSON.parse(readFileSync(new URL('../assets/src/fox.roles.json', import.meta.url), 'utf8')),
  });
  assert.ok(table.every((r) => r.how === 'map'), 'the checked-in roles table covers every colour');
  assert.deepEqual(turned.views, ['side', 'three-quarter', 'front']);
  assert.deepEqual(lintPuppet(turned), [], 'every view, both ways round, inside the box');
  const payload = oneView(turned, 'side');
  const a = puppet(json), b = puppet(payload);
  assert.deepEqual(b.parts, a.parts);
  assert.deepEqual(b.cel.box, a.cel.box);
  assert.deepEqual(b.cel.inputs, a.cel.inputs);
  assert.deepEqual([b.poses, b.cycles, b.ground, b.units], [a.poses, a.cycles, a.ground, a.units]);
  for (const n of a.parts) assert.deepEqual(payload.parts[n], json.parts[n], `part ${n}`);
  assert.deepEqual(payload.sockets, json.sockets, 'a socket in each paw, where the JSON fox has them');
  const states = [['rest', a.rest], ...a.poses.map((p) => [p, a.poseOf(p, 1)]), ...a.poses.map((p) => [`${p} 0.5`, a.poseOf(p, 0.5)])];
  for (const [cn, c] of Object.entries(json.cycles)) c.frames.forEach((_, j) => states.push([`${cn} ${j}`, a.frameOf(cn, j / c.fps)]));
  for (const [label, q] of states) assert.equal(hashList([b(q)]), hashList([a(q)]), label);
});
