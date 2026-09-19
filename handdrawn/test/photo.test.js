import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { traceAlpha } from '../cli/trace.mjs';
import { skiaCanvas } from '../cli/skia.mjs';
import { inside, isPath } from '../core/list.js';

// An alpha plane: 255 where f(x, y) (pixel centres), 0 elsewhere.
function plane(w, h, f) {
  const a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = f(x + 0.5, y + 0.5) ? 255 : 0;
  return a;
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('traceAlpha: a disc is one closed sub with the disc box, inside at the centre, outside at the corner', () => {
  const w = 400, h = 300, cx = 200, cy = 150, r = 100;
  const sil = traceAlpha(plane(w, h, (x, y) => Math.hypot(x - cx, y - cy) < r), w, h);
  assert.ok(isPath(sil));
  assert.equal(sil.sub.length, 1);
  assert.equal(sil.sub[0].closed, true);
  const [x, y, bw, bh] = sil.box;
  near(x, cx - r, 3, 'x'); near(y, cy - r, 3, 'y'); near(bw, 2 * r, 5, 'w'); near(bh, 2 * r, 5, 'h');
  assert.ok(inside(sil, cx, cy));
  assert.ok(inside(sil, cx + r - 6, cy));
  assert.ok(!inside(sil, 5, 5));
  assert.ok(!inside(sil, cx + r + 6, cy));
  const n = sil.sub[0].pts.length / 2;
  assert.ok(n >= 12 && n <= 200, `simplified to ${n} points`);
  assert.ok(sil.sub[0].pts.every((v) => Math.round(v * 10) === v * 10), 'rounded to 0.1');
});

test('traceAlpha: a ring has an outer sub and a hole; the hole is outside, rgba input and specks', () => {
  const w = 300, h = 300, c = 150;
  const a = plane(w, h, (x, y) => { const d = Math.hypot(x - c, y - c); return (d < 120 && d > 60) || (x < 3 && y < 3); });
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = 200; rgba[i * 4 + 3] = a[i]; }
  const sil = traceAlpha(rgba, w, h);
  assert.equal(sil.sub.length, 2, 'outer + hole, the 3 px speck dropped');
  assert.ok(sil.sub.every((s) => s.closed));
  near(sil.box[0], 30, 3, 'x'); near(sil.box[2], 240, 5, 'w');
  assert.ok(!inside(sil, c, c), 'hole');
  assert.ok(inside(sil, c + 90, c), 'ring');
  assert.ok(!inside(sil, c + 130, c), 'outside');
  assert.deepEqual(traceAlpha(new Uint8Array(100), 10, 10), { sub: [], box: [0, 0, 0, 0] });
});

test('hdf photo: flood cut of a red disc on white, module replaces by name and keeps the others', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-photo-'));
  try {
    const c = skiaCanvas(400, 300), g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 400, 300);
    g.fillStyle = '#d02020'; g.beginPath(); g.arc(200, 150, 80, 0, Math.PI * 2); g.fill();
    const png = join(dir, 'disc.png');
    await c.toFile(png);
    const js = join(dir, 'photos.js');
    const hdf = (...a) => spawnSync(process.execPath, ['cli/hdf.mjs', 'photo', png, ...a, '--flood', '--js', js, '--out', dir], { encoding: 'utf8' });
    let r = hdf('--name', 'disc', '--credit', 'test disc');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const load = async () => (await import(`${pathToFileURL(js).href}?t=${Math.random()}`)).default;
    const { disc } = await load();
    assert.equal(disc.name, 'disc');
    assert.equal(disc.credit, 'test disc');
    assert.match(disc.src, /^data:image\/(webp|png);base64,/);
    near(disc.w, 166, 4, 'w'); near(disc.h, 166, 4, 'h');   // 160 px disc + 3 px pad each side
    const [x, y, bw, bh] = disc.sil.box;
    near(x, 3, 3, 'box x'); near(y, 3, 3, 'box y'); near(bw, 160, 5, 'box w'); near(bh, 160, 5, 'box h');
    assert.equal(disc.sil.sub.length, 1);
    assert.ok(inside(disc.sil, disc.w / 2, disc.h / 2));
    readFileSync(join(dir, 'photo-disc.jpg'));

    assert.equal(hdf('--name', 'disc2').status, 0);
    assert.equal(hdf('--name', 'disc', '--credit', 'again').status, 0);
    const text = readFileSync(js, 'utf8');
    assert.equal(text.split('\n').filter((l) => l.startsWith('PHOTOS[')).length, 2);
    const all = await load();
    assert.deepEqual(Object.keys(all), ['disc', 'disc2']);
    assert.equal(all.disc.credit, 'again');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
