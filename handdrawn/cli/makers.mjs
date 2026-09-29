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
// `film` is a path under this package (films/mini.js) or absolute. A render cut to a composition's marks
// (`cues: 'composition'`) is not remade: its marks are in the composition, not in the args.
// Bump MAKER_VERSION when what these makers do with the same args changes; a remade record carries it.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
};
