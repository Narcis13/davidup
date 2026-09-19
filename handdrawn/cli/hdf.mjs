#!/usr/bin/env node
// hdf: command-line entry for handdrawn films.
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const USAGE = `usage: hdf <command> [args] [flags]

  render  <film.js> [--ar 1:1|16:9|9:16] [--width 1080] [--workers 4] [--out dir] [--disk-cache]
  grid    <film.js> [--n 24] [--width 480]
  only    <film.js> 0,37,74
  board   <film.js>                 storyboard cards
  sheet   <film.js> <cel>           cel at 3 scales x input extremes x every look
  lint    <film.js>
  changed <film.js>                 frames whose list hash moved since last render
  golden  <film.js> write|check
  dev     <film.js>                 player with hot reload on :4321
  bundle  <film.js>                 single HTML
  photo   <img> --name --credit     cutout + silhouette path + check sheet
  clip    <roto.py json> --name     convert a traced clip to the v2 format
  donate  <film.js> <cel...>        copy cels into a pack, regenerate manifest + sheets
`;

const COMMANDS = ['render', 'grid', 'only', 'board', 'sheet', 'lint', 'changed', 'golden',
  'dev', 'bundle', 'photo', 'clip', 'donate'];

export class UsageError extends Error {}

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

// Imports a film module and checks its default export has the shape film() produces.
export async function loadFilm(path) {
  if (!path) throw new UsageError('missing <film.js>');
  const abs = resolve(path);
  if (!existsSync(abs)) throw new UsageError(`film not found: ${path}`);
  const mod = await import(pathToFileURL(abs).href);
  const f = mod.default;
  if (!f || typeof f !== 'object') throw new Error(`${path}: default export must be film({...})`);
  if (typeof f.name !== 'string' || !f.name) throw new Error(`${path}: film has no name`);
  if (!f.look || typeof f.look !== 'object') throw new Error(`${path}: film has no look`);
  if (f.timeline == null) throw new Error(`${path}: film has no timeline`);
  return f;
}

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
  return (await run(args, flags, { loadFilm })) ?? 0;
}

// Run only when executed directly (also through the npm bin symlink), not when imported by tests.
const entry = process.argv[1] && existsSync(process.argv[1]) ? realpathSync(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => {
    process.stderr.write(`hdf: ${e instanceof UsageError ? e.message + '\n\n' + USAGE : (e.stack ?? e)}\n`);
    process.exitCode = e instanceof UsageError ? 2 : 1;
  });
}
