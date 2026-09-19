// hdf render <film.js> [--ar] [--width] [--out dir]: every drawn frame through skia into ffmpeg.
// v0: one thread, no caching, no sound (workers, cache and the score land in P3).
import { join } from 'node:path';
import { ffmpegSink, h264Args } from './ffmpeg.mjs';
import { frameCanvas, outDir } from './sheets.mjs';

export async function run([path], flags, { loadFilm }) {
  const film = await loadFilm(path);
  const { canvas, size, draw } = frameCanvas(film, { ar: flags.ar, width: flags.width });
  const file = join(outDir(flags), `${film.name}${flags.ar ? '-' + flags.ar.replace(':', 'x') : ''}.mp4`);
  const sink = ffmpegSink(h264Args(file, { w: size.outW, h: size.outH }));
  const t0 = performance.now();
  try {
    for (let i = 0; i < film.n; i++) {
      draw(i);
      await sink.write(canvas.toBufferSync('raw'));
      if (process.stderr.isTTY) process.stderr.write(`\r${i + 1}/${film.n}`);
    }
  } catch (e) {
    sink.kill();
    throw e;
  }
  await sink.end();
  if (process.stderr.isTTY) process.stderr.write('\r');
  const s = (performance.now() - t0) / 1000;
  process.stdout.write(`${file}  ${film.n} frames  ${size.outW}x${size.outH}  ${s.toFixed(1)}s (${(film.n / s).toFixed(1)} fps)\n`);
  return 0;
}
