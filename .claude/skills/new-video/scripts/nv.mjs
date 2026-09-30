#!/usr/bin/env node
// nv: the new-video workflow in one command. Run from anywhere in the repo:
//   node .claude/skills/new-video/scripts/nv.mjs <command> ...
//
//   doctor                                      what is installed (bun, ffmpeg, skia, hdf) and what is missing
//   init <dir> [--ar 16:9|9:16|1:1] [--dur 20] [--fps 30] [--title "..."] [--force]
//                                               a video project: brief.md, build.mjs, assets/ shelf, refs/
//   refs <video...> [--into <dir>]              decompose references into <dir>/refs/<name>/ (sheet, rhythm,
//                                               palette, summary.md, decomposition.json)
//   study <video> --from a --to b [--n 10] [--into <dir>]   one moment of a reference, frame by frame + onion
//   beats <audio|video> [--into <dir>]          tempo, beat grid and rises of a music track (beats.json)
//   bed <dir> --mood bright|calm|mystery|march [--tempo 120] [--bars 8] [--key C]
//                                               a music bed made to measure on the project shelf, its beats known
//   find <words...> [--kind k] [--media m] ...  search the asset library (asset find)
//   assets <ids...>                             one contact sheet of library records (asset sheet)
//   build <dir> [--force]                       run build.mjs, resolve and render the hand accents, validate
//   sheet|frame|motion|rhythm|check|boxes|progress <dir> [flags]   look at the composition (look.ts)
//   accents <dir> [--force]                     re-render the hand accents only
//   render <dir> [--draft] [--from a --to b] [--out f.mp4] [--no-analyse]
//                                               the mp4 (renders/<dir>-vN.mp4), then its own decomposition
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(HERE, '..');
const REPO = resolve(HERE, '../../../..');
const LOOK = join(HERE, 'look.ts');

function parse(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}
const say = (s) => process.stdout.write(s.endsWith('\n') ? s : `${s}\n`);
const die = (s, code = 1) => { process.stderr.write(`nv: ${s}\n`); process.exit(code); };

function bun() {
  if (process.env.BUN) return process.env.BUN;
  if (spawnSync('bun', ['--version'], { encoding: 'utf8' }).status === 0) return 'bun';
  const home = join(homedir(), '.bun', 'bin', 'bun');
  if (existsSync(home)) return home;
  die('bun is needed for look/render (https://bun.sh; or set $BUN)');
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.error) die(`${cmd}: ${r.error.message}`);
  return r.status ?? 1;
}
const look = (args) => run(bun(), ['run', LOOK, ...args], { cwd: process.cwd() });

// ---------- init ----------

function init(dir, f) {
  if (!dir) die('init <dir>', 2);
  const d = resolve(dir);
  if (existsSync(join(d, 'build.mjs')) && !f.force) die(`${d} already has a build.mjs (--force to overwrite)`);
  const ar = f.ar ?? '16:9', [W, H] = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] }[ar] ?? die(`--ar ${ar}: 16:9, 9:16 or 1:1`);
  const dur = Number(f.dur ?? 20), fps = Number(f.fps ?? 30), title = f.title ?? basename(d);
  for (const sub of ['assets', 'refs', 'renders', 'hdf']) mkdirSync(join(d, sub), { recursive: true });
  if (!existsSync(join(d, 'assets', 'catalogue.json'))) writeFileSync(join(d, 'assets', 'catalogue.json'), '{}\n');
  const kit = relative(d, join(HERE, 'kit.mjs')).split('\\').join('/');
  const fill = (s) => s.replaceAll('{{KIT}}', kit.startsWith('.') ? kit : `./${kit}`).replaceAll('{{W}}', W).replaceAll('{{H}}', H)
    .replaceAll('{{FPS}}', fps).replaceAll('{{DUR}}', dur).replaceAll('{{TITLE}}', title).replaceAll('{{AR}}', ar)
    .replaceAll('{{DATE}}', new Date().toISOString().slice(0, 10));
  writeFileSync(join(d, 'build.mjs'), fill(readFileSync(join(SKILL, 'templates', 'build.mjs'), 'utf8')));
  if (!existsSync(join(d, 'brief.md')) || f.force) writeFileSync(join(d, 'brief.md'), fill(readFileSync(join(SKILL, 'templates', 'brief.md'), 'utf8')));
  writeFileSync(join(d, '.gitignore'), '.look/\nrenders/\nhdf/render/\nhdf/*.webm\nhdf/accents.hash\nrefs/*/keyframes/\nrefs/*/study-*/\n');
  say(`${d}\n  brief.md   fill it in first\n  build.mjs  the video, as a program (kit: ${kit})\n  assets/    this project's asset shelf\n  refs/      decomposed references\nnext: nv refs <video> --into ${dir}   |   nv build ${dir}   |   nv sheet ${dir}`);
}

// ---------- references and music ----------

async function refs(files, f) {
  if (!files.length) die('refs <video...> [--into <dir>]', 2);
  const { main } = await import(pathToFileURL(join(HERE, 'decompose.mjs')).href);
  for (const file of files) {
    const name = basename(file).replace(/\.\w+$/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    const out = join(resolve(f.into ?? '.'), 'refs', name);
    const code = await main([file, '--out', out, ...(f.fps ? ['--fps', String(f.fps)] : [])]);
    if (code) process.exit(code);
  }
}

async function study(file, f) {
  if (!file || f.from === undefined || f.to === undefined) die('study <video> --from a --to b [--n 10] [--into dir]', 2);
  const { main } = await import(pathToFileURL(join(HERE, 'decompose.mjs')).href);
  const name = basename(file).replace(/\.\w+$/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  process.exit(await main([file, '--study', `${f.from},${f.to}`, '--n', String(f.n ?? 10), '--out', join(resolve(f.into ?? '.'), 'refs', name)]));
}

async function beatsOf(file, f) {
  if (!file) die('beats <audio|video> [--into dir]', 2);
  const { main } = await import(pathToFileURL(join(HERE, 'decompose.mjs')).href);
  const name = basename(file).replace(/\.\w+$/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  process.exit(await main([file, '--audio', '--out', join(resolve(f.into ?? '.'), 'refs', name)]));
}

async function bed(dir, f) {
  if (!dir) die('bed <dir> --mood bright|calm|mystery|march [--tempo 120] [--bars 8] [--key C]', 2);
  const d = resolve(dir), mood = f.mood ?? 'bright', bars = Number(f.bars ?? 8);
  if (bars % 4) die('--bars is a whole number of 4-bar chord loops (4, 8, 12, 16 ...)');
  const { openLibrary, standardShelves, loadHosts, make } = await import(pathToFileURL(join(REPO, 'assetlib', 'index.js')).href);
  const { barOf, MOODS } = await import(pathToFileURL(join(REPO, 'handdrawn', 'recipes', 'sfx.js')).href);
  const tempo = Number(f.tempo ?? MOODS[mood]?.tempo ?? 112), B = barOf(tempo);
  const id = f.id ?? `bed-${mood}-${Math.round(B.tempo)}${f.key ? `-${String(f.key).toLowerCase()}` : ''}`;
  mkdirSync(join(d, 'assets'), { recursive: true });
  if (!existsSync(join(d, 'assets', 'catalogue.json'))) writeFileSync(join(d, 'assets', 'catalogue.json'), '{}\n');
  const lib = openLibrary({ shelves: standardShelves({ project: d }) });
  const { makers } = await loadHosts();
  const recipe = {
    id, kind: 'audio', name: `${mood} bed ${Math.round(B.tempo)} bpm`, desc: `A ${mood} music bed at ${B.tempo.toFixed(2)} bpm, ${bars} bars that loop (made for this video)`,
    tags: ['music', 'bed', 'loop', mood], licence: 'own', credit: '', source: '',
    made: { tool: 'synth sample', from: [], args: { bed: { mood, tempo, ...(f.key ? { key: String(f.key) } : {}) }, bars, peak: 0.5, kbps: 128 } },
  };
  const have = (() => { try { return lib.get(id); } catch { return null; } })();
  if (have?.shelf === 'project' && !f.force) say(`${id} is on the project shelf already (--force to make it again)`);
  else await make(lib, recipe, { makers, shelf: 'project' });
  const beat = B.bar / 4;
  say(`${id}: ${B.tempo.toFixed(2)} bpm, a beat every ${beat.toFixed(4)}s, a bar every ${B.bar.toFixed(4)}s, ${bars} bars = ${(bars * B.bar).toFixed(3)}s a loop`);
  say(`in build.mjs:  v.music('${id}');  const g = v.bedBeats('${id}');   // g.t(n), g.bar(b), g.snap(t), g.markers()`);
}

// ---------- the library ----------

function asset(args) {
  return run(process.execPath, [join(REPO, 'assetlib', 'cli.js'), ...args], { cwd: process.cwd() });
}

// ---------- build ----------

async function build(dir, f) {
  if (!dir) die('build <dir>', 2);
  const d = resolve(dir), b = join(d, 'build.mjs');
  if (!existsSync(b)) die(`${b} is missing (nv init ${dir})`);
  let code = run(process.execPath, [b], { cwd: d });
  if (code) die(`build.mjs failed (exit ${code})`);
  // validate first: a composition that does not compile has no boxes to put hand marks on
  code = run(bun(), ['run', join(HERE, 'validate.ts'), d]);
  if (code) process.exit(code);
  if (existsSync(join(d, 'hdf', 'accents.json'))) {
    code = look(['accents', d]);
    if (code) die('could not place the hand accents (see above)');
    const { buildAccents } = await import(pathToFileURL(join(HERE, 'accents.mjs')).href);
    try { buildAccents(d, { force: !!f.force }); } catch (e) { die(e.message); }
  }
}

// ---------- render ----------

async function render(dir, f) {
  if (!dir) die('render <dir> [--draft] [--from a --to b] [--out f.mp4]', 2);
  const d = resolve(dir), comp = join(d, 'composition.json');
  if (!existsSync(comp)) die(`${comp} is missing (nv build ${dir})`);
  mkdirSync(join(d, 'renders'), { recursive: true });
  let out = f.out ? resolve(f.out) : null;
  if (!out) {
    const n = readdirSync(join(d, 'renders')).filter((x) => /-v\d+(-draft)?\.mp4$/.test(x)).length + 1;
    out = join(d, 'renders', `${basename(d)}-v${n}${f.draft ? '-draft' : ''}.mp4`);
  }
  const args = ['run', join(REPO, 'src', 'cli', 'bin.ts'), 'render', comp, '-o', out, '--crf', f.draft ? '28' : String(f.crf ?? 18)];
  if (f.draft) args.push('--preset', 'veryfast');
  if (f.from !== undefined) args.push('--from', String(f.from));
  if (f.to !== undefined) args.push('--to', String(f.to));
  const t0 = Date.now(), code = run(bun(), args, { cwd: REPO });
  if (code) die(`render failed (exit ${code})`);
  say(`${out}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (existsSync(join(d, 'credits.json'))) {
    const cr = JSON.parse(readFileSync(join(d, 'credits.json'), 'utf8'));
    const named = cr.filter((c) => c.credit || !['own', 'CC0', 'PD'].includes(c.licence));
    say(`credits: ${named.length ? named.map((c) => `${c.id} (${c.licence})${c.credit ? `: ${c.credit}` : ''}`).join(' | ') : 'none owed (own, CC0 or PD)'}`);
  }
  if (!f['no-analyse']) {
    const { main } = await import(pathToFileURL(join(HERE, 'decompose.mjs')).href);
    await main([out, '--out', join(d, '.look', 'final'), '--name', basename(out).replace(/\.mp4$/, '')]);
  }
}

// ---------- doctor ----------

function doctor() {
  const rows = [];
  const check = (name, ok, fix) => rows.push(`${ok ? 'ok     ' : 'MISSING'} ${name}${ok ? '' : `  -> ${fix}`}`);
  let b = null;
  try { b = bun(); } catch { /* reported below */ }
  check('bun (look, validate, render)', !!b, 'curl -fsSL https://bun.sh/install | bash');
  const ff = spawnSync(process.env.FFMPEG ?? 'ffmpeg', ['-version'], { encoding: 'utf8' });
  check('ffmpeg (decompose, video frames)', ff.status === 0 || existsSync(join(REPO, 'node_modules', 'ffmpeg-static')), 'brew install ffmpeg, or bun install at the repo root');
  check('skia-canvas (root node_modules)', existsSync(join(REPO, 'node_modules', 'skia-canvas', 'lib', 'skia.node')), 'bun install at the repo root (see memory: native deps need their postinstall)');
  check('handdrawn deps (accents, beds)', existsSync(join(REPO, 'handdrawn', 'node_modules', 'skia-canvas')) || existsSync(join(REPO, 'node_modules', 'skia-canvas')), 'cd handdrawn && npm i');
  check('house asset shelf', existsSync(join(REPO, 'assets', 'catalogue.json')), 'the repo checkout is incomplete');
  check('library fonts (~/.davidup/library/fonts)', existsSync(join(homedir(), '.davidup', 'library', 'fonts')), 'bun run seed:library (optional: Anton, Bebas Neue, Playfair ...)');
  check('user asset shelf (~/.davidup/assets)', existsSync(join(homedir(), '.davidup', 'assets', 'catalogue.json')), 'bun run seed:library puts the library fonts there (optional)');
  say(rows.join('\n'));
}

// ---------- main ----------

const USAGE = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 24).map((l) => l.slice(3)).join('\n');

const { pos, flags } = parse(process.argv.slice(2));
const [cmd, ...rest] = pos;
switch (cmd) {
  case 'doctor': doctor(); break;
  case 'init': init(rest[0], flags); break;
  case 'refs': await refs(rest, flags); break;
  case 'study': await study(rest[0], flags); break;
  case 'beats': await beatsOf(rest[0], flags); break;
  case 'bed': await bed(rest[0], flags); break;
  case 'find': process.exit(asset(['find', ...process.argv.slice(3)]));
  case 'assets': process.exit(asset(['sheet', ...process.argv.slice(3)]));
  case 'build': await build(rest[0], flags); break;
  case 'accents': {
    const code = look(['accents', resolve(rest[0] ?? '.')]);
    if (code) process.exit(code);
    const { buildAccents } = await import(pathToFileURL(join(HERE, 'accents.mjs')).href);
    try { buildAccents(resolve(rest[0] ?? '.'), { force: !!flags.force }); } catch (e) { die(e.message); }
    break;
  }
  case 'look': case 'sheet': case 'frame': case 'motion': case 'rhythm': case 'check': case 'boxes': case 'progress':
    process.exit(look([cmd === 'look' ? 'sheet' : cmd, ...process.argv.slice(3)]));
  case 'render': await render(rest[0], flags); break;
  default: say(USAGE); process.exit(cmd ? 2 : 0);
}
