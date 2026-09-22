// 4.0 D2: hdf sprite, a cast member as a sprite sheet for davidup's sprite item.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadImage } from 'skia-canvas';
import { actorOf } from '../core/actor.js';
import { puppet } from '../core/puppet.js';
import { stickSource } from '../core/stick.js';
import { LOOKS } from '../core/looks.js';
import { spriteActor, spriteSheet, spriteStates } from '../cli/sprite.mjs';
import { skiaCanvas } from '../cli/skia.mjs';

const hdf = (...argv) => {
  const r = spawnSync(process.execPath, ['cli/hdf.mjs', ...argv], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
};
const SAM = actorOf(puppet(stickSource({ name: 'sam' })));

test('states: idle for its seconds, a cycle for one loop at the sheet rate, a pose or expression one held frame', () => {
  const st = spriteStates(SAM, ['idle', 'walk', 'jump', 'point-r', 'happy'], { fps: 12, idle: 1 });
  assert.deepEqual(st.map((s) => [s.name, s.states.length, s.loop]), [['idle', 12, true], ['walk', 8, true], ['jump', 12, true], ['point-r', 1, false], ['happy', 1, false]]);
  // The vocabulary's jump is 6 frames at 6 fps: each drawn twice at 12.
  const jump = st[2].states;
  assert.deepEqual(jump[0], jump[1]);
  assert.notDeepEqual(jump[1], jump[2]);
  // A walk travels, so it stands on its planted foot and knows its stride; a jump does not.
  assert.ok(st[1].stride > 0 && st[1].states.every((q) => 'lift' in q));
  assert.equal(st[2].stride, undefined);
  // Every frame faces the way asked.
  assert.ok(spriteStates(SAM, ['walk', 'happy'], { dir: -1 }).every((s) => s.states.every((q) => q.dir === -1)));
  assert.throws(() => spriteStates(SAM, ['fly']), /sam has no state 'fly' \(idle; cycles walk, run.*; poses .*point-r.*; expressions .*happy/);
});

test('sheet: one cell size for every frame, runs back to back, the grid the frames say, feet at the anchor', () => {
  const st = spriteStates(SAM, ['walk', 'happy', 'shrug']);
  const { canvas, json } = spriteSheet(SAM, st, { look: LOOKS.whiteboard, h: 90, alpha: true });
  assert.equal(json.kind, 'hdf-sprite');
  assert.equal(json.look, 'whiteboard~alpha');
  assert.equal(json.frameHeight, 90);
  assert.equal(json.count, 10);
  assert.deepEqual(Object.fromEntries(Object.entries(json.cycles).map(([k, c]) => [k, [c.start, c.count, c.loop ?? true]])),
    { walk: [0, 8, true], happy: [8, 1, false], shrug: [9, 1, false] });
  assert.ok(json.cycles.walk.speed > 0 && json.cycles.happy.speed === undefined);
  const C = json.columns, rows = Math.ceil(json.count / C);
  assert.equal(canvas.width, C * json.frameWidth);
  assert.equal(canvas.height, rows * json.frameHeight);
  json.frames.forEach(([x, y, w, h], i) => assert.deepEqual([x, y, w, h], [(i % C) * json.frameWidth, Math.floor(i / C) * json.frameHeight, json.frameWidth, json.frameHeight]));
  assert.ok(json.anchor.x > 0.3 && json.anchor.x < 0.7, `feet near the middle, got ${json.anchor.x}`);
  assert.ok(json.anchor.y > 0.8 && json.anchor.y < 1, `feet near the bottom, got ${json.anchor.y}`);
  // On no stock the corners are clear and the figure is not.
  const g = canvas.getContext('2d'), px = g.getImageData(0, 0, canvas.width, canvas.height).data;
  assert.equal(px[3], 0);
  let ink = 0;
  for (let k = 3; k < px.length; k += 4) if (px[k] > 128) ink++;
  assert.ok(ink > 500, `the figure is drawn (${ink} px)`);
});

test('sheet: the same every run, the stock under every cell without --alpha, and the walk speed scales with h', async () => {
  const st = spriteStates(SAM, ['walk']);
  const a = spriteSheet(SAM, st, { look: 'paperInk', h: 60 }), b = spriteSheet(SAM, st, { look: 'paperInk', h: 60 });
  assert.ok(Buffer.from(await a.canvas.toBuffer('png')).equals(Buffer.from(await b.canvas.toBuffer('png'))));
  assert.equal(a.canvas.getContext('2d').getImageData(0, 0, 1, 1).data[3], 255, 'paper in the corner');
  const big = spriteSheet(SAM, st, { look: 'paperInk', h: 120, alpha: true });
  assert.ok(Math.abs(big.json.cycles.walk.speed / a.json.cycles.walk.speed - 2) < 0.03);
  // A walk's frames differ (the legs move), cell to cell.
  const cell = (c, i) => { const t = skiaCanvas(big.json.frameWidth, 120); t.getContext('2d').drawImage(c, -i * big.json.frameWidth, 0); return t.getContext('2d').getImageData(0, 0, t.width, 120).data.join(','); };
  assert.notEqual(cell(big.canvas, 0), cell(big.canvas, 2));
});

test('actor: stick:<name>[:<build>], a store puppet, a film cast member; a name that is none of them says so', async () => {
  assert.equal((await spriteActor('stick:sam')).actor.name, 'sam');
  assert.equal((await spriteActor('stick:kim:kid')).id, 'kim');
  await assert.rejects(spriteActor('stick:kim:giant'), /build 'giant'/);
  assert.equal((await spriteActor('fox')).actor.name, 'fox');
  await assert.rejects(spriteActor('teapot'), /'teapot' is a cutout, not a puppet/);
  await assert.rejects(spriteActor('nobody'), /no puppet 'nobody' in the store/);
});

test('hdf sprite: the PNG and its JSON, from the store or a film\'s cast; a bad state is a usage error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-sprite-'));
  try {
    const r = hdf('sprite', 'sam', '--film', 'films/walk-on.js', '--states', 'walk,wave', '--h', '64', '--alpha', '--out', dir);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /sam-sprite-alpha\.png {2}9 frames of \d+x64 in \d columns at 12 fps: walk 8 @[\d.]+px\/s, wave 1/);
    const json = JSON.parse(readFileSync(join(dir, 'sam-sprite-alpha.json'), 'utf8'));
    assert.equal(json.image, 'sam-sprite-alpha.png');
    assert.equal(json.look, 'whiteboard~alpha', 'the film\'s look');
    const img = await loadImage(join(dir, 'sam-sprite-alpha.png'));
    assert.deepEqual([img.width, img.height], [json.columns * json.frameWidth, Math.ceil(json.count / json.columns) * json.frameHeight]);

    assert.equal(hdf('sprite', 'fox', '--states', 'idle', '--idle', '0.5', '--h', '40', '--out', dir).code, 0);
    assert.ok(existsSync(join(dir, 'fox-sprite.png')));
    const bad = hdf('sprite', 'stick:sam', '--states', 'walk,fly', '--out', dir);
    assert.equal(bad.code, 2);
    assert.match(bad.out, /has no state 'fly'/);
    assert.match(hdf('sprite', 'bob', '--film', 'films/walk-on.js', '--out', dir).out, /'bob' is not in walk-on's cast \(has fox, sam\)/);
    assert.match(hdf('help', 'sprite').out, /^ {2}sprite {2}<puppet\|stick:<name>>/m);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
