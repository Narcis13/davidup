// hdf render <film.js>: every drawn frame through skia into ffmpeg (workers, layer cache, frame dedup),
// the score rendered to WAV and muxed, and a contact sheet with cuts and note onsets.
//   out/<film>.mp4        picture only        out/<film>.wav        the score
//   out/<film>-final.mp4  picture + sound     out/<film>-sheet.jpg  two tiles per second
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { cues } from '../core/tree.js';
import { filmAudio, toWav16 } from '../core/synth.js';
import { ffmpegSink, h264Args } from './ffmpeg.mjs';
import { contactSheet, outDir } from './sheets.mjs';
import { defaultWorkers, produceFrames } from './frames.mjs';

function ffmpeg(args) {
  return new Promise((res, rej) => {
    const p = spawn(process.env.FFMPEG ?? 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (c) => { err = (err + c).slice(-4096); });
    p.on('error', rej);
    p.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited with code ${code}: ${err.trim()}`))));
  });
}

export async function run([path], flags, { loadFilm }) {
  const film = await loadFilm(path);
  const workers = flags.workers ?? defaultWorkers();
  const base = join(outDir(flags), `${film.name}${flags.ar ? '-' + flags.ar.replace(':', 'x') : ''}`);
  const opts = { ar: flags.ar, width: flags.width, workers, cacheMb: flags.cacheMb ?? 512, diskCache: flags.diskCache };
  const sheet = contactSheet(film, { ar: flags.ar, width: flags.width });
  const t0 = performance.now();
  let sink = null;
  let result;
  try {
    result = await produceFrames(path, film, opts, async (i, buf) => {
      sink ??= ffmpegSink(h264Args(`${base}.mp4`, { w: sheet.outW, h: sheet.outH }));
      sheet.add(i, buf);
      await sink.write(buf);
      if (process.stderr.isTTY) process.stderr.write(`\r${i + 1}/${film.n}`);
    });
  } catch (e) {
    sink?.kill();
    throw e;
  }
  await sink.end();
  if (process.stderr.isTTY) process.stderr.write('\r');
  const s = (performance.now() - t0) / 1000, { size, stats } = result;
  const lines = [`${base}.mp4  ${film.n} frames  ${size.outW}x${size.outH}  ${s.toFixed(1)}s (${(film.n / s).toFixed(1)} fps)  workers ${stats.workers}  dups ${stats.dups}`];

  const audio = flags.sound === false ? null : filmAudio(film);
  if (audio) {
    writeFileSync(`${base}.wav`, toWav16(audio.samples));
    await ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', `${base}.mp4`, '-i', `${base}.wav`,
      '-c:v', 'copy', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', `${base}-final.mp4`]);
    lines.push(`${base}.wav  ${audio.events.length} events`, `${base}-final.mp4`);
  }
  await sheet.write(`${base}-sheet.jpg`, { cues: cues(film), events: audio?.events ?? [] });
  lines.push(`${base}-sheet.jpg`);
  process.stdout.write(lines.join('\n') + '\n');
  return 0;
}
