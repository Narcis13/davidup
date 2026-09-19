// Disk tier for the layer cache (--disk-cache): .cache/engine-<salt>/<sha1(key)>_<lx>_<ly>.png. PNG stores
// straight alpha, so a translucent layer read back can differ from the one drawn by a rounding step; opaque
// layers (stock, backdrops) come back exact. The salt hashes the drawing code (core/, engines/), so a change
// to a tool, finish or glyph starts a fresh folder and the stale ones are removed.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Image } from 'skia-canvas';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
function engineSalt() {
  const h = createHash('sha1');
  for (const d of ['core', 'engines']) {
    for (const f of readdirSync(join(PKG, d)).filter((f) => f.endsWith('.js')).sort()) h.update(f).update(readFileSync(join(PKG, d, f)));
  }
  return h.digest('hex').slice(0, 12);
}

export function diskStore(root) {
  const salt = `engine-${engineSalt()}`, dir = join(root, salt);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(root)) if (f.startsWith('engine-') && f !== salt) rmSync(join(root, f), { recursive: true, force: true });
  const index = new Map();
  for (const f of readdirSync(dir)) {
    const m = /^([0-9a-f]{40})_(-?\d+)_(-?\d+)\.png$/.exec(f);
    if (m) index.set(m[1], { file: f, lx: +m[2], ly: +m[3] });
  }
  const id = (key) => createHash('sha1').update(key).digest('hex');
  return {
    get(key) {
      const hit = index.get(id(key));
      if (!hit) return null;
      const img = new Image();
      img.src = readFileSync(join(dir, hit.file));
      return { canvas: img, lx: hit.lx, ly: hit.ly };
    },
    put(key, { canvas, lx, ly }) {
      const h = id(key), file = `${h}_${lx}_${ly}.png`;
      writeFileSync(join(dir, file), canvas.toBufferSync('png'));
      index.set(h, { file, lx, ly });
    },
  };
}
