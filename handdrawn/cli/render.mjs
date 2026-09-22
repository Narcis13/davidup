// hdf render <film.js>: every drawn frame through skia into ffmpeg (workers, layer cache, frame dedup),
// the score rendered to WAV and muxed, and a contact sheet with cuts and note onsets.
//   out/<film>.mp4        picture only        out/<film>.wav        the score
//   out/<film>-final.mp4  picture + sound     out/<film>-sheet.jpg  two tiles per second
// It also records every frame's list hash and a thumbnail per hash, the baseline for `hdf changed`.
// --frames N renders the first N frames only, to out/<film>-<N>f.* so a full render's files are left alone.
// --chapter N (4.0 E1) renders chapter N only (chapters(film), from 1), to out/<film>-ch<N>.*: its frames are
//   the whole film's, its sound the whole score's stretch under it; with --frames, the chapter's first N frames.
// --alpha [mov|webm] (4.0 D1): no stock (paper() and night() draw nothing), encoded with its alpha as
//   out/<film>-alpha.mov (ProRes 4444, the default) or .webm (VP9), the sound muxed into -final.mov / .webm;
//   the contact sheet shows the frames on a checkerboard. The overlay clip for a davidup composition.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { excerpt, localCues } from '../core/tree.js';
import { filmAudio, toWav16 } from '../core/synth.js';
import { ALPHA_CODECS, alphaArgs, ffmpegSink, h264Args } from './ffmpeg.mjs';
import { chapterOf, contactSheet, outDir, variant } from './sheets.mjs';
import { defaultWorkers, produceFrames } from './frames.mjs';
import { tracker } from './changed.mjs';
import { UsageError } from './load.mjs';

function ffmpeg(args) {
  return new Promise((res, rej) => {
    const p = spawn(process.env.FFMPEG ?? 'ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (c) => { err = (err + c).slice(-4096); });
    p.on('error', rej);
    p.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited with code ${code}: ${err.trim()}`))));
  });
}

// --alpha alone is ProRes; --alpha webm is VP9. Anything else (a film path the flag swallowed) is a usage error.
export function alphaCodec(v) {
  if (v === undefined || v === false) return null;
  if (v === true) return 'mov';
  if (ALPHA_CODECS.includes(v)) return v;
  throw new UsageError(`render: --alpha takes ${ALPHA_CODECS.join(' or ')} (got '${v}'; put the film before --alpha)`);
}

export async function run([path], flags, { loadFilm }) {
  const codec = alphaCodec(flags.alpha), ext = codec ? `.${codec}` : '.mp4';
  let film = chapterOf(await loadFilm(path), flags.chapter);
  const cut = flags.frames;
  if (cut !== undefined && (!Number.isInteger(cut) || cut < 1)) throw new UsageError(`render: --frames takes a whole number of frames >= 1 (got ${cut})`);
  if (cut !== undefined && cut < film.n) film = excerpt(film, 0, cut);
  const workers = flags.workers ?? defaultWorkers();
  const base = join(outDir(flags), variant(film, flags) + (flags.chapter !== undefined ? `-ch${flags.chapter}` : '') + (cut !== undefined ? `-${film.n}f` : ''));
  const opts = { look: flags.look, alpha: !!codec, ar: flags.ar, width: flags.width, workers, cacheMb: flags.cacheMb ?? 512, diskCache: flags.diskCache };
  const sheet = contactSheet(film, { ar: flags.ar, width: flags.width, alpha: !!codec });
  const hashes = tracker(film, base, { ar: flags.ar, outW: sheet.outW, outH: sheet.outH });
  const t0 = performance.now();
  let sink = null;
  let result;
  try {
    result = await produceFrames(path, film, opts, async (i, buf) => {
      sink ??= ffmpegSink(codec ? alphaArgs(`${base}${ext}`, { w: sheet.outW, h: sheet.outH, codec }) : h264Args(`${base}.mp4`, { w: sheet.outW, h: sheet.outH }));
      sheet.add(i, buf);
      hashes.add(i, buf);
      await sink.write(buf);
      if (process.stderr.isTTY) process.stderr.write(`\r${i + 1}/${film.n}`);
    });
  } catch (e) {
    sink?.kill();
    throw e;
  }
  await sink.end();
  hashes.write();
  if (process.stderr.isTTY) process.stderr.write('\r');
  const s = (performance.now() - t0) / 1000, { size, stats } = result;
  const at = film.chapter ? `  chapter ${film.chapter.n} '${film.chapter.title}' from ${film.chapter.t0.toFixed(2)}s` : '';
  const lines = [`${base}${ext}  ${film.n} frames${at}  ${size.outW}x${size.outH}  ${s.toFixed(1)}s (${(film.n / s).toFixed(1)} fps)  workers ${stats.workers}  dups ${stats.dups}`];

  const audio = flags.sound === false ? null : filmAudio(film);
  if (audio) {
    writeFileSync(`${base}.wav`, toWav16(audio.samples));
    // WebM holds Opus, not AAC, and its muxer takes no -movflags.
    const mux = codec === 'webm' ? ['-c:a', 'libopus'] : ['-c:a', 'aac', '-movflags', '+faststart'];
    await ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', `${base}${ext}`, '-i', `${base}.wav`,
      '-c:v', 'copy', ...mux, '-shortest', `${base}-final${ext}`]);
    lines.push(`${base}.wav  ${audio.events.length} events`, `${base}-final${ext}`);
  }
  await sheet.write(`${base}-sheet.jpg`, { cues: localCues(film), events: audio?.events ?? [] });
  lines.push(`${base}-sheet.jpg`);
  process.stdout.write(lines.join('\n') + '\n');
  return 0;
}
