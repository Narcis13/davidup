// hdf golden <film.js> write|check [--workers N] [--look L]: sha256 of every drawn frame's raw RGBA at 480 px
// wide (the film's own format) plus the score's WAV bytes, in films/goldens/<film>.json next to the film; a
// film under another look is a golden of its own, goldens/<film>-<look>.json (mini-paperInk~hand:test.json), and
// so is one on no stock, goldens/<film>-alpha.json (--alpha).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { filmAudio, toWav16 } from '../core/synth.js';
import { defaultWorkers, produceFrames } from './frames.mjs';
import { variant } from './sheets.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
export const GOLDEN_WIDTH = 480;

export const goldenPath = (path, film, { look, alpha } = {}) => join(dirname(resolve(path)), 'goldens', `${variant(film, { look, alpha })}.json`);

// { frames: { "0": sha256, ... }, wav: sha256 | null }
export async function goldenOf(path, film, { workers = defaultWorkers(), cacheMb = 512, look, alpha } = {}) {
  const frames = {};
  let prev = null;
  await produceFrames(path, film, { width: GOLDEN_WIDTH, workers, cacheMb, look, alpha }, (i, buf, dup) => {
    prev = dup ? prev : sha(buf);
    frames[i] = prev;
  });
  const audio = filmAudio(film);
  return { frames, wav: audio ? sha(toWav16(audio.samples)) : null };
}

export async function run([path, mode], flags, { loadFilm }) {
  if (mode !== 'write' && mode !== 'check') throw new Error('golden: say write or check');
  const film = await loadFilm(path);
  const alpha = !!flags.alpha;
  const file = goldenPath(path, film, { look: flags.look, alpha });
  const got = await goldenOf(path, film, { workers: flags.workers, cacheMb: flags.cacheMb, look: flags.look, alpha });
  if (mode === 'write') {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(got, null, 1) + '\n');
    process.stdout.write(`${file}  ${Object.keys(got.frames).length} frames${got.wav ? ' + wav' : ''}\n`);
    return 0;
  }
  if (!existsSync(file)) throw new Error(`golden: no ${file}; run 'hdf golden ${path} write${flags.look ? ` --look '${flags.look}'` : ''}${alpha ? ' --alpha' : ''}' first`);
  const want = JSON.parse(readFileSync(file, 'utf8'));
  const bad = [];
  const n = Math.max(Object.keys(want.frames).length, Object.keys(got.frames).length);
  for (let i = 0; i < n; i++) if (want.frames[i] !== got.frames[i]) bad.push(i);
  const wavBad = want.wav !== got.wav;
  if (!bad.length && !wavBad) { process.stdout.write(`golden ${film.name}: ${n} frames${got.wav ? ' + wav' : ''} match\n`); return 0; }
  if (bad.length) process.stdout.write(`golden ${film.name}: ${bad.length}/${n} frames differ: ${bad.slice(0, 40).join(',')}${bad.length > 40 ? ',...' : ''}\n`);
  if (wavBad) process.stdout.write(`golden ${film.name}: wav differs\n`);
  return 1;
}
