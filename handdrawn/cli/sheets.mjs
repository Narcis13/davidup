// Stills through skia: `hdf only` writes PNGs of chosen frames, `hdf grid` a JPEG contact sheet.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Canvas } from 'skia-canvas';
import { FPS } from '../core/curves.js';
import { format } from '../core/fit.js';
import { outputSize, renderFrame } from '../core/raster.js';

// A canvas sized for the film at an output width, and a function drawing frame i on it.
export function frameCanvas(film, { ar, width } = {}) {
  const size = outputSize(ar ? format(ar) : film.format, width);
  const canvas = new Canvas(size.outW, size.outH), ctx = canvas.getContext('2d');
  return { canvas, size, draw: (i) => renderFrame(ctx, film, i, { ar, width }) };
}

export const outDir = (flags) => { const d = resolve(flags.out ?? 'out'); mkdirSync(d, { recursive: true }); return d; };

function parseFrames(spec, n) {
  if (spec === undefined) throw new Error('only: missing frame list, e.g. 0,12,35');
  return String(spec).split(',').filter(Boolean).map((s) => {
    const i = Number(s);
    if (!Number.isInteger(i) || i < 0 || i >= n) throw new Error(`only: frame '${s}' outside 0..${n - 1}`);
    return i;
  });
}

export async function only([path, list], flags, { loadFilm }) {
  const film = await loadFilm(path);
  const { canvas, draw } = frameCanvas(film, { ar: flags.ar, width: flags.width });
  const dir = outDir(flags);
  for (const i of parseFrames(list, film.n)) {
    draw(i);
    const file = join(dir, `${film.name}-${String(i).padStart(3, '0')}.png`);
    await canvas.toFile(file);
    process.stdout.write(`${file}\n`);
  }
  return 0;
}

// n frames spread evenly over the film (first and last included), six to a row, each with a label bar.
export async function grid([path], flags, { loadFilm }) {
  const film = await loadFilm(path);
  const n = Math.min(flags.n ?? 24, film.n), tileW = flags.width ?? 480, bar = Math.round(tileW * 0.075);
  const { canvas: tile, size, draw } = frameCanvas(film, { ar: flags.ar, width: tileW });
  const cols = Math.min(6, n), rows = Math.ceil(n / cols), th = size.outH + bar;
  const sheet = new Canvas(cols * size.outW, rows * th), g = sheet.getContext('2d');
  g.fillStyle = '#141414';
  g.fillRect(0, 0, sheet.width, sheet.height);
  g.font = `${Math.round(bar * 0.62)}px Menlo, monospace`;
  g.textBaseline = 'middle';
  for (let j = 0; j < n; j++) {
    const i = n === 1 ? 0 : Math.round(j * (film.n - 1) / (n - 1));
    const f = draw(i), x = (j % cols) * size.outW, y = Math.floor(j / cols) * th;
    g.drawImage(tile, x, y);
    g.fillStyle = '#f0f0f0';
    g.fillText(`${String(i).padStart(3, '0')}  ${(i / FPS).toFixed(2)}s  ${f.shot}`, x + 5, y + size.outH + bar / 2);
  }
  const file = join(outDir(flags), `${film.name}-grid.jpg`);
  await sheet.toFile(file, { quality: 0.9 });
  process.stdout.write(`${file}\n`);
  return 0;
}
