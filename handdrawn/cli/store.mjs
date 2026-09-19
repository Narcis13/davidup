// Disk tier for the layer cache (--disk-cache): .cache/<sha1(key)>_<lx>_<ly>.png. PNG stores straight
// alpha, so a translucent layer read back can differ from the one drawn by a rounding step; opaque layers
// (stock, backdrops) come back exact.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Image } from 'skia-canvas';

export function diskStore(dir) {
  mkdirSync(dir, { recursive: true });
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
