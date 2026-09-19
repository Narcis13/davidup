import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skiaCanvas } from '../cli/skia.mjs';
import { ellipse, walk } from '../core/list.js';
import { film, seq, frame, LOOKS } from '../core/index.js';
import { evalShot } from '../core/tree.js';
import { lint } from '../core/lint.js';
import * as D from '../recipes/doodle.js';

// A small synthetic cutout: an orange ellipse on transparency, its silhouette the same ellipse.
async function cutout(name, w = 300, h = 200) {
  const c = skiaCanvas(w, h), g = c.getContext('2d');
  g.fillStyle = '#d9822b';
  g.beginPath(); g.ellipse(w / 2, h / 2, w / 2 - 4, h / 2 - 4, 0, 0, Math.PI * 2); g.fill();
  return { name, credit: 'test', src: await c.toDataURL('png'), w, h, sil: ellipse(w / 2, h / 2, w / 2 - 4, h / 2 - 4, 48) };
}

const LETTERS = ['AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AK', 'AL', 'AM'];

async function build() {
  const wide = await cutout('thing'), tall = await cutout('tall', 160, 320);
  const shots = [
    D.becomesVehicle({ photo: wide }), D.livesInside({ photo: wide }), D.doesItsJob({ photo: wide }), D.timeOnIt({ photo: tall }),
    D.nightFalls({ photo: tall }), D.lightEscapes({ photo: tall }), D.alongTheEdge({ photo: wide }), D.insideTheTube({ photo: tall, rot: -Math.PI / 2 }),
    D.looksBack({ photo: tall }), D.getaway({ photo: tall }), D.caughtLetGo({ photo: tall }), D.sunrise({ photo: wide }),
  ];
  const end = D.printsOnALine({ prints: shots.slice(0, 5).map(D.lastFrame) });
  return { shots: [...shots, end], f: film({ name: 'doodle-test', look: LOOKS.doodlePastel, assets: { thing: wide, tall }, timeline: seq(...shots, end) }) };
}

test('doodle recipes: every letter is exported, carries its recipe label and sits on the grid', async () => {
  assert.deepEqual(Object.keys(D.DOODLE), LETTERS);
  const { shots } = await build();
  assert.deepEqual(shots.map((s) => s.recipe).sort(), [...LETTERS].sort());
  for (const s of shots) assert.ok(Math.abs(s.dur * 12 - Math.round(s.dur * 12)) < 1e-9, `${s.name} ${s.dur}`);
  const x = await cutout('x');
  assert.throws(() => D.becomesVehicle({}), /needs photo/);
  assert.throws(() => D.timeOnIt({ photo: x, dur: 1.01 }), /grid/);
});

test('doodle recipes: first, middle and last frame of every shot evaluate and start with paper', async () => {
  const { shots, f } = await build();
  let f0 = 0;
  for (const s of shots) {
    for (const k of [0, s.n >> 1, s.n - 1]) {
      const fr = frame(f, f0 + k);
      assert.equal(fr.shot, s.name);
      const ev = evalShot(f, s, k, { i: f0 + k });
      assert.equal(ev.list[0].op, 'paper', `${s.name}@${k}`);
      let anchor = 0;
      walk(ev.list, (op) => { if (op.op === 'meta' && op.tag === 'anchor') anchor++; });
      assert.equal(anchor, 1, `${s.name}@${k} anchor`);
    }
    f0 += s.n;
  }
});

test('doodle recipes: lint is clean on a film chaining all thirteen', async () => {
  const { f } = await build();
  assert.deepEqual(lint(f), []);
});

test('doodle recipes: dur stretches the timing; the sign-off still lands 1.5 s before the end', async () => {
  const wide = await cutout('thing');
  const a = D.becomesVehicle({ photo: wide, dur: 2 }), b = D.printsOnALine({ dur: 3, prints: [D.lastFrame(a)] });
  const f = film({ name: 'short', look: LOOKS.doodlePastel, assets: { thing: wide }, timeline: seq(a, b) });
  assert.equal(f.n, 60);
  assert.deepEqual(lint(f), []);
});

test('doodle recipes: a custom cast builder is used', async () => {
  const wide = await cutout('thing'), calls = [];
  const who = (d, x, y, s, o) => { calls.push(o); return d.fill(ellipse(x, y, s, s * 0.8)).line([[x - s, y], [x + s, y]]); };
  const s = D.livesInside({ photo: wide, who });
  const f = film({ name: 'who', look: LOOKS.doodlePastel, assets: { thing: wide }, timeline: seq(s) });
  frame(f, s.n - 1);
  assert.ok(calls.length >= 2 && calls.every((o) => 'dir' in o));
});
