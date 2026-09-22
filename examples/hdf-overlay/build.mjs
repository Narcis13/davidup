// handdrawn over davidup (hand-drawn film 4.0, D1) — 12 s, 1920×1080. A
// slideshow of your photos, each held 4 s with a slow push-in and a
// crossfade, and the fox from handdrawn/films/fox-wave.js standing in the
// lower right, waving on a loop. The fox is an alpha clip: drawn on no stock,
// so the photo shows all round it.
//
//   node examples/hdf-overlay/build.mjs <photo> <photo> <photo>
//   bun run scripts/davidup-hdf-clip.ts examples/hdf-overlay/composition.json fox --alpha
//   bun run src/cli/bin.ts render examples/hdf-overlay/composition.json -o examples/hdf-overlay/output/hdf-overlay.mp4
//
// The photos are copied to assets/photos/ and the clip lands in assets/hdf/;
// neither is committed (see .gitignore), nor is the composition that names
// them. `--alpha webm` makes a VP9 clip the editor's browser preview plays too.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadImage } from "skia-canvas";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 1920, H = 1080, HOLD = 4, FADE = 0.8;

const photos = process.argv.slice(2);
if (photos.length < 1 || photos.some((p) => !existsSync(p))) {
  process.stderr.write("usage: node examples/hdf-overlay/build.mjs <photo.jpg> [<photo.jpg> ...]\n");
  process.exit(2);
}
mkdirSync(join(HERE, "assets", "photos"), { recursive: true });

const T = (x, y, o = {}) => ({
  x, y, scaleX: o.s ?? 1, scaleY: o.s ?? 1, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: o.o ?? 1,
});
const assets = [], items = {}, tweens = [];
let n = 0;
const tw = (target, property, from, to, start, duration, easing = "linear") =>
  tweens.push({ id: `tw${n++}`, target, property, from, to, start, duration, easing });

const duration = photos.length * HOLD;
for (const [k, file] of photos.entries()) {
  const id = `photo${k + 1}`, src = `assets/photos/${id}${extname(file).toLowerCase()}`;
  copyFileSync(file, join(HERE, src));
  assets.push({ id, type: "image", src });
  // A sprite draws at the size it is given, so each photo is sized to cover the frame at its own aspect.
  const img = await loadImage(file), s = Math.max(W / img.width, H / img.height);
  items[id] = {
    type: "sprite", asset: id, width: Math.round(img.width * s), height: Math.round(img.height * s),
    name: basename(file), transform: T(W / 2, H / 2, { o: k ? 0 : 1 }),
  };
  const t0 = k * HOLD;
  tw(id, "transform.scaleX", 1, 1.08, t0, HOLD + FADE);
  tw(id, "transform.scaleY", 1, 1.08, t0, HOLD + FADE);
  if (k) tw(id, "transform.opacity", 0, 1, t0 - FADE / 2, FADE, "easeInOutCubic");
}

// The fox: a 3 s clip looped, its square frame in the lower right. The item
// names its film, so the bridge knows what to render into asset hdf-fox-wave.
items.fox = {
  type: "video", asset: "hdf-fox-wave", name: "hdf:fox-wave", width: 640, height: 640,
  start: 0.5, end: duration, fit: "contain", loop: true, transform: T(W - 380, H - 300),
};

const doc = {
  version: "0.1",
  composition: { width: W, height: H, fps: 30, duration, background: "#101010" },
  assets,
  layers: [
    { id: "photos", z: 0, opacity: 1, blendMode: "normal", items: photos.map((_, k) => `photo${k + 1}`) },
    { id: "fox", z: 10, opacity: 1, blendMode: "normal", items: ["fox"] },
  ],
  items,
  tweens,
};
writeFileSync(join(HERE, "composition.json"), JSON.stringify(doc, null, 1) + "\n");
process.stdout.write(`${join(HERE, "composition.json")}  ${photos.length} photos, ${duration}s\n`);
