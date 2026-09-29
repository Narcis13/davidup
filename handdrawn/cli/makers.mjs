// hdf's makers (asset-library plan I1): how `asset remake` makes again what hdf made. Each is registered under
// the `made.tool` davidup writes when it puts something hdf made in the library (src/mcp/hdf.ts, D4), and runs
// the same command line again from the record's `made.args`, as a subprocess (hdf needs node, skia and ffmpeg,
// and a film is imported fresh each time):
//
//   hdf render              { film, look, ar, width, frames, alpha }   the clip: with sound when the film has a score
//   hdf sprite              { name, film, look, states, h }            the sprite sheet PNG and its `sheet`
//   hdf hand --export-ttf   { hand }                                   the hand as a TrueType font
//   hdf sheet store         { puppet }                                 the puppet's model sheet (--poses)
//
// and two that make what nothing else did (I2, the house pack), in this process:
//
//   paper                   { look, size, quality, seed }              a look's paper stock (core/finish.js) as a webp
//   synth sample            { sfx, dur, opts, peak }                   a sound effect of recipes/sfx.js as a wav
//                           { bed: { mood, key, tempo, gain }, bars, peak, kbps }   a music bed, looping, as an m4a
//
// `film` is a path under this package (films/mini.js) or absolute. A render cut to a composition's marks
// (`cues: 'composition'`) is not remade: its marks are in the composition, not in the args.
// Bump MAKER_VERSION when what these makers do with the same args changes; a remade record carries it.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAKER_VERSION = 1;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Runs `hdf <args>` under node in this package; resolves to its stdout.
function hdf(args) {
  return new Promise((res, rej) => {
    // Under bun, process.execPath is bun: hdf needs node (skia-canvas, worker threads).
    const p = spawn(process.env.NODE ?? 'node', [join(ROOT, 'cli', 'hdf.mjs'), ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (c) => { out += c; });
    p.stderr.on('data', (c) => { err = (err + c).slice(-4096); });
    p.on('error', (e) => rej(new Error(`could not run hdf (${e.message}); is node on PATH?`)));
    p.on('close', (code) => {
      if (code === 0) return res(out);
      const why = err.trim().split('\n').filter(Boolean).slice(-3).join('; ');
      rej(new Error(`hdf ${args[0]} exited with code ${code}${why ? `: ${why}` : ''}`));
    });
  });
}

// The last file a command printed with this extension (hdf prints `<path>  <what>` lines).
function printed(out, ext) {
  const last = out.split('\n').map((l) => l.trim().split(/\s+/)[0] ?? '').filter((f) => f.endsWith(ext)).at(-1);
  if (!last) throw new Error(`hdf printed no ${ext} file:\n${out}`);
  return last;
}

// `--key value` for each arg that is set.
const flags = (pairs) => pairs.flatMap(([k, v]) => (v === undefined || v === null || v === false ? [] : [`--${k}`, String(v)]));

// The bytes of `file` and its name, for remake.
const take = (file) => ({ bytes: readFileSync(file), file: basename(file) });

// fn(dir) with a temp directory for hdf's --out, gone after.
async function inTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-remake-'));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

const need = (args, key, tool) => {
  const v = args?.[key];
  if (typeof v !== 'string' || !v) throw new Error(`${tool}: made.args.${key} is missing, so there is nothing to run`);
  return v;
};

// The store ids a render says the film read (its `store  <id> ...` line), sorted.
export const storeRead = (out) => {
  const line = out.split('\n').map((l) => l.trim()).find((l) => /^store\s/.test(l));
  return line ? line.split(/\s+/).slice(1).filter(Boolean).sort() : [];
};

// ---------- paper (I2) ----------

// A look's paper stock, size x size px: the paper() op drawn alone in that look (a modifier too:
// 'cutout~sheet:sand'), the way a film's first op lays it down, as a webp at `quality`. Seeded (the grain) by
// `seed`, else the op's own; the fixed parts of a board, a slate or a page are the look's.
export async function paperStock({ look, size = 2048, quality = 0.9, seed } = {}) {
  if (typeof look !== 'string' || !look) throw new Error('paper: made.args.look is missing, so there is no stock to draw');
  if (!(Number.isInteger(size) && size >= 16 && size <= 8192)) throw new Error(`paper: size is a whole number of px, 16 to 8192 (got ${size})`);
  const [{ paint }, { paper }] = await Promise.all([import('./sheets.mjs'), import('../core/list.js')]);
  const canvas = paint([paper(seed === undefined ? {} : { seed })], { look, W: size, H: size });
  return canvas.toBuffer('webp', { quality });
}

// ---------- synth sample (I2) ----------

// The sound effects a `synth sample` can make, by name (recipes/sfx.js). Two take a duration as their
// second argument; the rest their options.
const TIMED = new Set(['erase', 'pencilScratch']);
const SFX = ['pop', 'boing', 'whoosh', 'ding', 'tada', 'tick', 'squeak', 'flip', 'erase', 'pencilScratch', 'chalkTap'];

// Samples scaled so the loudest is `peak` (a library's effects sit at one level; a film's score sets its own).
function normalise(x, peak) {
  let top = 0;
  for (let i = 0; i < x.length; i++) top = Math.max(top, Math.abs(x[i]));
  if (!(top > 0)) throw new Error('synth sample: the sound is silent');
  const k = peak / top;
  for (let i = 0; i < x.length; i++) x[i] *= k;
  return x;
}

// Without the tail a 16-bit wav would write as zeros.
function trimmed(x) {
  let n = x.length;
  while (n > 1 && Math.abs(x[n - 1]) < 0.5 / 32767) n--;
  return x.subarray(0, n);
}

// A sound effect as mono 16-bit wav bytes at the synth's rate: `sfx` a name of SFX, `opts` its options, `dur`
// the length of a timed one (erase, pencilScratch), starting at 0 and ending when its last note has rung out
// (0.35 s after the last event ends, the silence then cut), its peak at `peak`.
export async function sfxSample({ sfx, dur = 0.6, opts = {}, peak = 0.5 } = {}) {
  if (!SFX.includes(sfx)) throw new Error(`synth sample: sfx '${sfx}' is not one of ${SFX.join(', ')}`);
  const [fx, { renderScore, toWav16 }] = await Promise.all([import('../recipes/sfx.js'), import('../core/synth.js')]);
  const events = (TIMED.has(sfx) ? fx[sfx](0, dur, opts) : fx[sfx](0, opts)).flat(Infinity);
  const end = Math.max(...events.map((e) => e.t + (e.dur ?? 0))) + 0.35;
  return toWav16(trimmed(normalise(renderScore(events, end, { master: 0.6 }), peak)));
}

// A music bed (recipes/sfx.js bed()) `bars` long, as mono samples that loop: two passes are played and the
// second kept, so what rings over from the last bar is already under the first. `bars` is a whole number of
// the mood's chord loops (4 chords) or the seam is heard.
export async function bedSamples({ bed: o = {}, bars = 4, peak = 0.5 } = {}) {
  const [fx, { renderScore, SR }] = await Promise.all([import('../recipes/sfx.js'), import('../core/synth.js')]);
  if (!fx.MOODS[o.mood ?? 'bright']) throw new Error(`synth sample: bed mood '${o.mood}' is not one of ${Object.keys(fx.MOODS).join(', ')}`);
  if (!(Number.isInteger(bars) && bars > 0 && bars % 4 === 0)) throw new Error(`synth sample: bars is a whole number of 4-bar chord loops (got ${bars})`);
  const { bar } = fx.barOf(o.tempo ?? fx.MOODS[o.mood ?? 'bright'].tempo), L = bars * bar;
  const all = renderScore(fx.bed({ ...o, from: 0, to: 2 * L }), 2 * L, { master: 0.6 });
  const a = Math.round(L * SR);
  return normalise(all.slice(a, a + Math.round(L * SR)), peak);
}

// A bed as AAC in an m4a (a wav of a bed is megabytes), bit-exact so a remake with the same ffmpeg is the same
// bytes: the samples go in as a wav in a temp directory.
export async function bedM4a(args = {}) {
  const { toWav16 } = await import('../core/synth.js');
  const samples = await bedSamples(args), kbps = args.kbps ?? 96;
  return inTemp(async (dir) => {
    const wav = join(dir, 'bed.wav'), out = join(dir, 'bed.m4a');
    writeFileSync(wav, toWav16(samples));
    const r = spawnSync(process.env.FFMPEG ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-map_metadata', '-1',
      '-c:a', 'aac', '-b:a', `${kbps}k`, '-fflags', '+bitexact', '-flags:a', '+bitexact', out]);
    if (r.error) throw new Error(`synth sample: could not run ffmpeg (${r.error.message})`);
    if (r.status !== 0) throw new Error(`synth sample: ffmpeg exited with code ${r.status}: ${String(r.stderr).trim().split('\n').at(-1)}`);
    return readFileSync(out);
  });
}

export const makers = {
  'hdf render': {
    version: MAKER_VERSION,
    async make(record) {
      const a = record.made.args ?? {}, film = need(a, 'film', 'hdf render');
      if (a.cues) throw new Error(`'${record.id}' was cut to a composition's marks (cues: ${a.cues}); render it again from that composition (render_hdf_clip)`);
      return inTemp(async (dir) => {
        const out = await hdf(['render', film, '--out', dir, ...flags([['look', a.look], ['ar', a.ar], ['width', a.width], ['frames', a.frames], ['alpha', a.alpha]])]);
        return { ...take(printed(out, a.alpha ? `.${a.alpha}` : '.mp4')), from: storeRead(out) };
      });
    },
  },
  'hdf sprite': {
    version: MAKER_VERSION,
    async make(record) {
      const a = record.made.args ?? {}, name = need(a, 'name', 'hdf sprite');
      return inTemp(async (dir) => {
        const out = await hdf(['sprite', name, '--alpha', '--out', dir, ...flags([['film', a.film], ['look', a.look], ['states', a.states], ['h', a.h]])]);
        // davidup's `sheet`: the JSON without hdf's own fields (src/mcp/hdf.ts sheetOf).
        const { frameWidth, frameHeight, columns, count, fps, cycles, anchor } = JSON.parse(readFileSync(printed(out, '.json'), 'utf8'));
        const sheet = { frameWidth, frameHeight, columns, count, fps, ...(cycles ? { cycles } : {}), ...(anchor ? { anchor } : {}) };
        return { ...take(printed(out, '.png')), fields: { sheet } };
      });
    },
  },
  'hdf hand --export-ttf': {
    version: MAKER_VERSION,
    async make(record) {
      const hand = need(record.made.args, 'hand', 'hdf hand --export-ttf');
      return inTemp(async (dir) => take(printed(await hdf(['hand', '--export-ttf', hand, '--out', dir]), '.ttf')));
    },
  },
  'hdf sheet store': {
    version: MAKER_VERSION,
    async make(record) {
      const puppet = need(record.made.args, 'puppet', 'hdf sheet store');
      // The sheet lands where hdf keeps a puppet's sheets (<store>/sheets, git-ignored), as it did the first time.
      return take(printed(await hdf(['sheet', 'store', puppet, '--poses']), '.jpg'));
    },
  },
  paper: {
    version: MAKER_VERSION,
    async make(record) {
      return { bytes: await paperStock(record.made.args ?? {}), file: `${record.id}.webp` };
    },
  },
  'synth sample': {
    version: MAKER_VERSION,
    async make(record) {
      const a = record.made.args ?? {};
      if (a.bed) return { bytes: await bedM4a(a), file: `${record.id}.m4a` };
      if (!a.sfx) throw new Error('synth sample: made.args names no sfx and no bed, so there is nothing to play');
      return { bytes: await sfxSample(a), file: `${record.id}.wav` };
    },
  },
};
