// hdf cues <film.js> [--out dir|file.json] (4.0 D4): the film's cues as JSON, for davidup and for any tool that
// wants to cut to a film. out/<film>-cues.json by default (a --out ending in .json is the file itself):
//
//   { kind: 'hdf-cues', version: 1, film, look, fps, end,
//     shots:    [{ name, t0, dur, hold?, cut? }]     every shot, hold and cut as the timeline plays them
//     cuts:     [t]                                  where one node of a seq gives way to the next
//     chapters: [{ n, title, t0, dur }]              every chapter() (4.0 E1)
//     notes:    [{ t, dur, type, hz? }]              the score's note onsets (not its voices)
//     words:    [{ text, t0, t1, voice }]            each voice's words as spoken (its alignment, 4.0 V2)
//     marks:    [{ t, name, from }] }                the marks it was cut to (--cues-from), as it read them
//
// Seconds from the film's first frame. The film is loaded exactly as `hdf render` loads it (--look, --alpha,
// --cues-from, --at), so the cues are the render's. scripts/davidup-hdf-clip.ts reads this file and writes the
// chapters into the composition's markers; `hdf render --cues-from <cues.json>` cuts another film to it.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cues } from '../core/tree.js';
import { FPS } from '../core/curves.js';
import { scoreEvents } from '../core/synth.js';
import { alignOf } from '../core/align.js';
import { outDir, variant } from './sheets.mjs';

const r6 = (t) => +(+t).toFixed(6);

// cueFile(film) => the object above. A voice whose sample has no copy to align gives no words (and a warning
// in `skipped`, which is not written).
export function cueFile(film) {
  const c = cues(film), s = scoreEvents(film), notes = [], words = [], skipped = [];
  for (const e of s?.events ?? []) {
    if (e.type === 'voice') {
      let A;
      try { A = alignOf(e.id); } catch (err) { skipped.push(`${e.id}: ${err.message}`); continue; }
      const cutAt = e.dur === undefined ? Infinity : e.t + e.dur;
      for (const w of A.words) if (e.t + w.t0 < cutAt) words.push({ text: w.text, t0: r6(e.t + w.t0), t1: r6(Math.min(cutAt, e.t + w.t1)), voice: e.id });
      continue;
    }
    notes.push({ t: r6(e.t), dur: r6(e.dur), type: e.type, ...(Number.isFinite(e.hz) ? { hz: r6(e.hz) } : {}) });
  }
  notes.sort((a, b) => a.t - b.t);
  words.sort((a, b) => a.t0 - b.t0);
  const file = {
    kind: 'hdf-cues',
    version: 1,
    film: film.name,
    look: film.look?.name ?? null,
    fps: FPS,
    end: r6(c.end),
    shots: c.shots.map((x) => ({ ...x, t0: r6(x.t0), dur: r6(x.dur) })),
    cuts: c.cuts.map(r6),
    chapters: c.chapters.map((x) => ({ ...x, t0: r6(x.t0), dur: r6(x.dur) })),
    notes,
    words,
    marks: c.marks.map((m) => ({ ...m })),
  };
  return { file, skipped };
}

export async function run([path], flags, { loadFilm }) {
  const film = await loadFilm(path);
  const { file, skipped } = cueFile(film);
  const out = typeof flags.out === 'string' && flags.out.endsWith('.json')
    ? flags.out
    : join(outDir(flags), `${variant(film, flags)}-cues.json`);
  writeFileSync(out, JSON.stringify(file, null, 2) + '\n');
  for (const w of skipped) process.stderr.write(`hdf cues: no words for ${w}\n`);
  const n = (k, one) => `${file[k].length} ${one}${file[k].length === 1 ? '' : 's'}`;
  process.stdout.write(`${out}  ${file.end.toFixed(2)}s  ${n('shots', 'shot')}  ${n('cuts', 'cut')}  ${n('chapters', 'chapter')}  ${n('notes', 'note')}  ${n('words', 'word')}  ${n('marks', 'mark')}\n`);
  return 0;
}
