// skia-canvas on the CPU. v3 defaults to the GPU (Metal, Vulkan) where there is one, and GPU raster is
// neither bit-exact across canvas sizes nor across machines, so every canvas a film is drawn on is CPU.
import { Canvas } from 'skia-canvas';

export function skiaCanvas(w, h) {
  const c = new Canvas(w, h);
  c.gpu = false;
  return c;
}

// A canvas's pixels on a fresh canvas. skia-canvas records drawing commands and replays them whenever the
// canvas is drawn, so a layer cache of unbaked canvases saves nothing; a baked one blits as a bitmap.
export function skiaBake(canvas, w = canvas.width, h = canvas.height) {
  const out = skiaCanvas(w, h);
  out.getContext('2d').putImageData(canvas.getContext('2d').getImageData(0, 0, w, h), 0, 0);
  return out;
}
