// skia-canvas on the CPU. v3 defaults to the GPU (Metal, Vulkan) where there is one, and GPU raster is
// neither bit-exact across canvas sizes nor across machines, so every canvas a film is drawn on is CPU.
import { Canvas } from 'skia-canvas';

export function skiaCanvas(w, h) {
  const c = new Canvas(w, h);
  c.gpu = false;
  return c;
}
