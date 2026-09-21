#!/usr/bin/env node
// hdf: command-line entry for handdrawn films.
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainThread } from 'node:worker_threads';
import { loadFilm, UsageError } from './load.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const USAGE = `usage: hdf <command> [args] [flags]

  every command that takes a film also takes [--look <preset>] (replaces the root look);
  a preset may carry modifiers: --look 'doodlePastel~from:teapot' paints it in that cutout's own colours,
  --look 'paperInk~hand:test' letters it (and draws its pens) in a hand from the store

  render  <film.js> [--ar 1:1|16:9|9:16] [--width 1080] [--workers 4] [--out dir]
                                    [--cache-mb 512] [--disk-cache] [--no-sound]
  grid    <film.js> [--n 24] [--width 480]
  only    <film.js> 0,37,74
  board   <film.js> [--cols 4]      tree as text + storyboard cards (out/<film>-board.jpg)
  sheet   <film.js> <cel>           cel at 3 scales x input extremes x every look, silhouette, 240 px
  sheet   store <id> [--pose p] [--cycle c]   a puppet in the store: every pose, every variant, the cycle as a strip
  sheet   store <id> --poses [--look risoPop]  the model sheet: turnaround, expressions, hands and feet, poses,
                                    cycles, credits on one page (assets/sheets/<id>-model.jpg)
  lint    <film.js>                 review checklist over lists; exits 1 on any finding
  changed <film.js> [--ar]          frames whose list hash moved since last render, before/after grid
  golden  <film.js> write|check [--workers N]   with --look: goldens/<film>-<look>.json
  dev     <film.js> [--port 4321]   player with hot reload (edits jump it to the first changed frame)
  bundle  <film.js> [--out dir]     single HTML that opens from disk and plays (out/<film>.html)
  photo   <img> --name <id> [--credit] [--source] [--js photos.js] [--flood|--keep] [--punch u,v;..]  cutout + sil + sheet
                                    --v1 <photos.js> converts a v1 module; --refresh <photos.js> adds a colours table to an existing one
  clip    <clips.js|clip.json> [--name id] [--js clips.js]   roto.py output -> a v2 clips module
  import  <file> --kind cutout|clip|puppet|hand|stock|motif|sample --name <id> [--credit] [--source] [--licence] [--tags]
                                    any payload into the asset store (assets/catalogue.json + assets/blobs)
                                    --v2 <photos.js|clips.js> migrates a 2.0 data module: one entry per record
  svg     <file.svg> --name <id> [--kind puppet|motif] [--roles map.json|ask] [--flatten 0.6] [--units 300]
                                    [--licence] [--credit] [--source] [--tags] [--no-sheet]
                                    an SVG into the store: parts from <g id>, pivots, variants, poses, cycles
                                    (rules in core/svg.js); prints the colour table, writes the sheet
  hand    --synth <id> [--root dir] a deterministic hand made from the house one, into the store (--look 'x~hand:<id>')
  find    <words...> [--kind]       search the store: id, kind, licence, what it takes, its sheet and credit
  donate  <module.js> <cel...> [--pack name] [--no-sheets]   copy cels (with their helpers) into packs/<name>.js,
                                    hash-check the copy, regenerate packs/manifest.json + packs/sheets/<cel>.jpg
  donate  --manifest [--all-sheets] regenerate the manifest and missing (or all) sheets from packs/*.js
`;

const COMMANDS = ['render', 'grid', 'only', 'board', 'sheet', 'lint', 'changed', 'golden',
  'dev', 'bundle', 'photo', 'clip', 'import', 'svg', 'hand', 'find', 'donate'];

export { loadFilm, UsageError };

// --key value, --key=value, --flag (boolean), -- ends flags. Numeric strings become numbers.
export function parseArgs(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { args.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith('--') || a.length === 2) { args.push(a); continue; }
    const eq = a.indexOf('=');
    let key, val;
    if (eq > 0) {
      key = a.slice(2, eq);
      val = a.slice(eq + 1);
    } else {
      key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { val = next; i++; } else val = true;
    }
    if (key.startsWith('no-') && val === true) { key = key.slice(3); val = false; }
    flags[camel(key)] = typeof val === 'string' && val !== '' && !isNaN(+val) ? +val : val;
  }
  return { args, flags };
}

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

export async function main(argv = process.argv.slice(2)) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (!COMMANDS.includes(cmd)) {
    process.stderr.write(`hdf: unknown command '${cmd}'\n\n${USAGE}`);
    return 2;
  }
  const { args, flags } = parseArgs(rest);
  // Commands live in cli/<cmd>.mjs and export run(args, flags); they land phase by phase.
  const file = join(HERE, `${cmd}.mjs`);
  if (!existsSync(file)) {
    process.stderr.write(`hdf: '${cmd}' is not implemented yet\n`);
    return 1;
  }
  const { run } = await import(pathToFileURL(file).href);
  const load = (path) => loadFilm(path, { look: flags.look });
  return (await run(args, flags, { loadFilm: load })) ?? 0;
}

// Run only when executed directly (also through the npm bin symlink), not when imported by tests.
const entry = process.argv[1] && existsSync(process.argv[1]) ? realpathSync(process.argv[1]) : '';
if (isMainThread && entry === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => {
    process.stderr.write(`hdf: ${e instanceof UsageError ? e.message + '\n\n' + USAGE : (e.stack ?? e)}\n`);
    process.exitCode = e instanceof UsageError ? 2 : 1;
  });
}
