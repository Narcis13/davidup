// Player v0: loads a film module by ?film= (relative to this page), draws drawn frame ?frame=N at
// output width ?w= (and aspect ?ar=). Exposes window.__frame(i) and window.__NDRAW for drivers.
// The same core/raster.js the Node renderer uses, so the pixels are the same drawing. Space plays from
// the current frame with the score: the samples synth.js renders for the Node driver, through Web Audio.
import { createRenderer, outputSize } from '../core/raster.js';
import { format } from '../core/fit.js';
import { FPS } from '../core/curves.js';
import { SR, filmAudio } from '../core/synth.js';

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
  const images = new Map();
  for (const [id, a] of Object.entries(film.assets ?? {})) {
    if (typeof a?.src !== 'string' || !/^data:image\/|\.(png|jpe?g|webp|gif)$/i.test(a.src)) continue;
    const img = new Image();
    img.src = a.src.startsWith('data:') ? a.src : new URL(a.src, new URL(src, location.href)).href;
    await img.decode();
    images.set(id, img);
  }
  const ctx = cv.getContext('2d'), r = createRenderer({ images });
  let cur = 0;
  window.__NDRAW = film.n;
  window.__frame = (i) => {
    const f = r.renderFrame(ctx, film, i, { ar, width });
    cur = i;
    info.textContent = `${film.name}  draw ${String(i).padStart(3, '0')}/${film.n}  t=${(i / FPS).toFixed(2)}s  ${f.shot}  ${size.outW}x${size.outH}  [space: play]`;
    return f.shot;
  };
  window.__frame(Math.min(film.n - 1, Math.max(0, +q.get('frame') || 0)));

  let audio, ac, playing = null;
  const stop = () => { playing?.src?.stop(); playing = null; };
  const play = () => {
    audio ??= filmAudio(film);
    ac ??= new AudioContext();
    const from = cur >= film.n - 1 ? 0 : cur, t0 = ac.currentTime + 0.05;
    const p = { src: null };
    if (audio) {
      const buf = ac.createBuffer(1, audio.samples.length, SR);
      buf.copyToChannel(audio.samples, 0);
      p.src = ac.createBufferSource();
      p.src.buffer = buf;
      p.src.connect(ac.destination);
      p.src.start(t0, from / FPS);
    }
    playing = p;
    const tick = () => {
      if (playing !== p) return;
      const i = from + Math.floor(Math.max(0, ac.currentTime - t0) * FPS);
      if (i >= film.n) { stop(); window.__frame(film.n - 1); return; }
      if (i !== cur) window.__frame(i);
      requestAnimationFrame(tick);
    };
    tick();
  };
  addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    e.preventDefault();
    if (playing) stop(); else play();
  });
}

main().catch((e) => { info.textContent = String(e.message ?? e); console.error(e); });
