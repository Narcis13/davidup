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
  --look 'paperInk~hand:test' letters it (and draws its pens) in a hand from the store,
  --look 'paperInk~alpha' draws it on no stock

  render  <film.js> [--ar 1:1|16:9|9:16] [--width 1080] [--workers 4] [--out dir] [--frames N]
                                    [--cache-mb 512] [--disk-cache] [--no-sound]
                                    [--alpha [mov|webm]]   no stock, transparency kept: <film>-alpha.mov (ProRes 4444)
                                    or .webm (VP9), an overlay clip for davidup (scripts/davidup-hdf-clip.ts --alpha)
                                    [--chapter N]   chapter N only (from 1), to <film>-ch<N>.*, with its stretch of the score
  grid    <film.js> [--n 24] [--width 480] [--chapter N]
  only    <film.js> 0,37,74
  board   <film.js> [--cols 4]      tree as text + storyboard cards (out/<film>-board.jpg): a card per shot,
                                    or per chapter in a film with chapters ([--chapter N] its shots, [--shots] every shot)
  sheet   <film.js> <cel>           cel at 3 scales x input extremes x every look, silhouette, 240 px
  sheet   store <id> [--pose p] [--cycle c]   a puppet in the store: every pose, every variant, the cycle as a strip
                                    (a motif: the drawing at 3 scales in every look)
  sheet   store <id> --poses [--look risoPop]  the model sheet: turnaround, expressions, hands and feet, poses,
                                    cycles, credits on one page (assets/sheets/<id>-model.jpg)
  sheet   store <id> --vocabulary [--look]   the biped vocabulary's poses, expressions and cycles that apply to it
                                    (packs/poses/biped.json; assets/sheets/<id>-vocabulary.jpg)
  lint    <film.js>                 review checklist over lists; exits 1 on any finding (a line per chapter after)
          [--audience <name>]       check against another audience's profile (general, beginner, kids-9, kids-7, kids-5)
  changed <film.js> [--ar]          frames whose list hash moved since last render, before/after grid
  golden  <film.js> write|check [--workers N]   with --look: goldens/<film>-<look>.json; --alpha: <film>-alpha.json
  dev     <film.js> [--port 4321]   player with hot reload (edits jump it to the first changed frame)
  bundle  <film.js> [--out dir]     single HTML that opens from disk and plays (out/<film>.html)
  photo   <img> --name <id> [--credit] [--source] [--js photos.js] [--flood|--keep] [--punch u,v;..]  cutout + sil + sheet
                                    --v1 <photos.js> converts a v1 module; --refresh <photos.js> adds a colours table to an existing one
  clip    <clips.js|clip.json> [--name id] [--js clips.js] [--rig quadruped|biped] [--facing -1]
                                    roto.py output -> a v2 clips module; a rig labels a skeleton per frame
                                    (skel: joints, chains) and writes out/clip-<name>-skel.jpg
  clip    --store <id> --rig quadruped|biped   the same for a clip in the asset store, in place
  clip    --kind pose <frames-dir|landmarks.json> --name <id> [--fps 30] [--model f.task] [--no-loop]
                                    your own motion: MediaPipe's pose landmarker (python, $HDF_PYTHON) per frame
                                    -> a biped clip in the store at 12 fps, cut to its best loop
  retarget --clip <id> --to <puppet> --map <map.json> --name <cycle> [--dry]   a clip's skeleton as a
                                    puppet cycle in the store (maps in assets/src/): joints on 2 degrees, a lift
                                    (--clip me --map biped-fox.json --name walk: the fox walks like you;
                                    a stick puppet needs no --map)
  stick   --name <id> [--h 300] [--build kid|adult|tall|round] [--style line|tube] [--hands dots|mitts|none]
                                    [--no-face] [--root dir] [--no-sheet]   a stick puppet: joints and bones compiled
                                    to parts in three views, a face, standard biped names; writes src/<id>.stick.json
                                    and imports it (then hdf retarget --clip me --to <id> --name walk, no map)
  align   <id> [--text "..."] [--json words.json] [--estimate] [--show] [--model base] [--lang en] [--root dir]
                                    word timing for a sample, stored on its entry: a transcriber (faster-whisper or
                                    whisper-timestamped under $HDF_PYTHON) laid onto the copy, any tool's words
                                    (--json), or the estimate; captions(id) and say(..., { voice: id }) read it
          <id> --mouth [--json cues.json] [--estimate] [--show] [--recognizer phonetic]
                                    the mouth track: Rhubarb (on PATH or $RHUBARB), a tool's cues, or the energy
                                    track; a voiced say and actor.mouth(id, t) read it
  import  <file> --kind cutout|clip|puppet|hand|stock|motif|sample --name <id> [--credit] [--source] [--licence] [--tags]
                                    any payload into the asset store (assets/catalogue.json + assets/blobs)
                                    --v2 <photos.js|clips.js> migrates a 2.0 data module: one entry per record
  svg     <file.svg> --name <id> [--kind puppet|motif] [--roles map.json|ask] [--flatten 0.6] [--units 300]
                                    [--licence] [--credit] [--source] [--tags] [--no-sheet]
                                    an SVG into the store: parts from <g id>, pivots, variants, poses, cycles
                                    (rules in core/svg.js); prints the colour table, writes the sheet
  hand    --template [--paper a4|letter] [--pages latin,symbols,marks] > out/hand-template.pdf   the hand sheet
                                    to print and fill in, all three pages unless --pages says (--letter <hand>: a page
                                    filled in by a stored hand, as a JPEG; the latin one unless --pages says)
  hand    <page.jpg ...> --name <id> [--thr 0.6] [--credit] [--root dir] [--no-sheet]   photos of filled-in pages
                                    into the store as a hand: glyphs traced, pen fitted from the latin page's last
                                    row; writes out/hand-<id>-trace[-<page>].jpg and assets/sheets/<id>.jpg
                                    (then --look 'x~hand:<id>')
  hand    --synth <id> [--root dir] a deterministic hand made from the house one, into the store
  sheet   --hand <id>               a hand's page beside the house's: every glyph (house fallbacks marked), pangrams, its pen
  find    <words...> [--kind]       search the store: id, kind, licence, what it takes, its sheet and credit
  remove  <id...> [--root dir]      drop entries from the store, with their sheets and any blob no other entry shares
  gc      [--dry] [--root dir]      delete the blobs no catalogue entry points at
  donate  <module.js> <cel...> [--pack name] [--no-sheets]   copy cels (with their helpers) into packs/<name>.js,
                                    hash-check the copy, regenerate packs/manifest.json + packs/sheets/<cel>.jpg
  donate  --manifest [--all-sheets] regenerate the manifest and missing (or all) sheets from packs/*.js,
                                    and every cel's mirror in the store (pack:<cel>, a puppet: puppet('pack:boat'))
  donate  --export [<cel...>]       write the store mirror of the named pack cels (all when none is named)
  lint    packs/<pack>.js           a pack: pack-mirror findings, one per cel whose mirror is missing or stale
`;

const COMMANDS = ['render', 'grid', 'only', 'board', 'sheet', 'lint', 'changed', 'golden',
  'dev', 'bundle', 'photo', 'clip', 'retarget', 'stick', 'align', 'import', 'svg', 'hand', 'find', 'remove', 'gc', 'donate'];

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

// The USAGE lines of one command: its own lines and their indented continuations.
export function usageOf(cmd) {
  const out = [];
  let mine = false;
  for (const line of USAGE.split('\n')) {
    const head = /^ {2}(\S+)/.exec(line);
    if (head) mine = head[1] === cmd;
    else if (!/^ {4,}\S/.test(line)) mine = false;
    if (mine) out.push(line);
  }
  return `${out.join('\n')}\n`;
}

// What a failed command prints: the whole USAGE only for an unknown command (main does that); a usage error
// is its message and a pointer to the command's own lines, anything else its stack, so the line that matters
// (a lint finding, a missing id) is the last thing on screen.
export function failure(e, cmd) {
  if (e instanceof UsageError) return `hdf: ${e.message}\n${COMMANDS.includes(cmd) ? `(hdf help ${cmd} for its usage)\n` : ''}`;
  return `hdf: ${e?.stack ?? e}\n`;
}

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

export async function main(argv = process.argv.slice(2)) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    const only = cmd === 'help' && rest[0];
    if (only && !COMMANDS.includes(only)) {
      process.stderr.write(`hdf: unknown command '${only}'\n\n${USAGE}`);
      return 2;
    }
    process.stdout.write(only ? usageOf(only) : USAGE);
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
  const load = (path) => loadFilm(path, { look: flags.look, alpha: !!flags.alpha });
  return (await run(args, flags, { loadFilm: load })) ?? 0;
}

// Run only when executed directly (also through the npm bin symlink), not when imported by tests.
const entry = process.argv[1] && existsSync(process.argv[1]) ? realpathSync(process.argv[1]) : '';
if (isMainThread && entry === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (e) => {
    process.stderr.write(failure(e, process.argv[2]));
    process.exitCode = e instanceof UsageError ? 2 : 1;
  });
}
