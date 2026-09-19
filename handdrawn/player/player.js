// Player v0: loads a film module by ?film= (relative to this page), draws drawn frame ?frame=N at
// output width ?w= (and aspect ?ar=). Exposes window.__frame(i) and window.__NDRAW for drivers.
// The same core/raster.js the Node renderer uses, so the pixels are the same drawing.
import { outputSize, renderFrame } from '../core/raster.js';
import { format } from '../core/fit.js';

const q = new URLSearchParams(location.search);
const cv = document.getElementById('c'), info = document.getElementById('info');

async function main() {
  const src = q.get('film');
  if (!src) throw new Error('add ?film=../films/<name>.js');
  const film = (await import(new URL(src, location.href).href)).default;
  const ar = q.get('ar') || undefined, width = +q.get('w') || undefined;
  const size = outputSize(ar ? format(ar) : film.format, width);
  cv.width = size.outW;
  cv.height = size.outH;
  const ctx = cv.getContext('2d');
  window.__NDRAW = film.n;
  window.__frame = (i) => {
    const f = renderFrame(ctx, film, i, { ar, width });
    info.textContent = `${film.name}  draw ${String(i).padStart(3, '0')}/${film.n}  t=${(i / 12).toFixed(2)}s  ${f.shot}  ${size.outW}x${size.outH}`;
    return f.shot;
  };
  window.__frame(Math.min(film.n - 1, Math.max(0, +q.get('frame') || 0)));
}

main().catch((e) => { info.textContent = String(e.message ?? e); console.error(e); });
