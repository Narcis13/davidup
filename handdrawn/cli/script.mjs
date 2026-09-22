// hdf script <brief.md> (4.0 E5): a brief written in a small dialect becomes the beat sheet the skill expects,
// plus a timeline stub at work/<film>/<film>.js with the recipes named. The skill writes the film; this tool
// does the arithmetic. No time in the sheet is estimated here: the stub is written first, loaded as a film,
// and the sheet is read off what that film plays. So every length comes from the same code that draws the
// shot: a recipe's own timing from its copy and the audience, a line of speech at the reading speed or the
// length of its recording, a narration from its sample's word timing, a chapter's card and hold.
//
// The dialect (a markdown file; <!-- comments --> are dropped):
//
//   film: moon                       header: `key: value` lines before the first beat or chapter
//   audience: kids-7                   (film, subject, audience, look, format, hand, cast, actor, bed; any
//   look: whiteboard                    other key is kept in the BRIEF comment); other lines are prose
//   cast: sam, kit (kid), fox          a store puppet by id, else a stick built in code (build in brackets)
//   actor: sam                         the teacher: every teaching recipe (AN to AY) and chapter card gets it
//   bed: calm                          a music bed under the whole film (sfx bed's mood)
//
//   # why does the moon change shape?     a chapter: its title card (AN), its beats, a hold
//   hand: true                             chapter options under the heading: hand, sub, look, card, hold
//   - voice: moon-para                     narration: the sample captioned, the teacher's mouth following it
//     by: none                               (sub-items: by <cast|none>, copy <text> for a sample not recorded)
//   - show: labelled({ subject: () => moon({}), labels: [...] })   a recipe by name (or letter) with its
//     voice: moon-2                          options as JS; an identifier nothing defines becomes a stub cel
//   - show: the moon rises                 a placeholder shot (dur: sub-item, else 2.5 s)
//   - text: look up tonight                lettering written by a hand at reading speed (AN, hand: true)
//   - fox says: de ce?                     speech; a run of lines is one exchange (AY), one speaker alone
//     emote: confused                        (sub-items: kind, emote, voice)
//   ---                                    ends the chapter
//   - sign: the moon                       the sign-off, always last
//
//   Every beat takes the sub-items name, dur, look, sound (the sheet's sound column) and what (its what).
//
// hdf script <brief.md> [--out <film.js>] [--dry] [--force]
//   prints the beat sheet; writes the stub when the film does not exist yet, otherwise replaces only the
//   beat-sheet comment in it (--force rewrites the whole stub); --dry writes nothing
// hdf script --check <film.js>
//   the round trip: the film's beat-sheet comment against what the film plays now; exits 1 on a difference
import { existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FPS } from '../core/curves.js';
import { chapters } from '../core/tree.js';
import { audienceOf, AUDIENCES } from '../core/audience.js';
import { readCatalogue } from '../core/assets.js';
import { BUILDS } from '../core/stick.js';
import * as CORE from '../core/index.js';
import * as SHOTS from '../recipes/shots.js';
import { UsageError } from './load.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HEADER_KEYS = ['film', 'subject', 'audience', 'look', 'format', 'hand', 'cast', 'actor', 'bed', 'anchor'];
const BEAT_KEYS = ['name', 'dur', 'look', 'sound', 'what', 'voice', 'by', 'copy', 'kind', 'emote'];
const CHAPTER_KEYS = ['hand', 'sub', 'look', 'card', 'hold'];
// A chapter heading also takes its title card's options (size, y, width, side, pose, ...: titleCard AN).
const CARD_KEYS = Object.keys(SHOTS.titleCard.defaults).filter((k) => !['dur', 'title', 'audience', 'actor', ...CHAPTER_KEYS].includes(k));
const LEAD = 0.5;           // a voice starts this far into its shot (films/narrated.js)
const PLACEHOLDER = 2.5;    // a placeholder shot with no dur: an establishing shot's length

// ---------- the dialect ----------

const scalar = (v) => {
  const s = v.trim();
  if (/^(true|false)$/.test(s)) return s === 'true';
  if (s !== '' && !isNaN(+s)) return +s;
  const q = /^(['"])(.*)\1$/.exec(s);
  return q ? q[2] : s;
};
// Brackets still open in a piece of JS, strings and comments skipped.
function depth(src) {
  let d = 0, q = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === '`') q = c;
    else if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) d--;
  }
  return d;
}

// parseBrief(text, { file }) => { name, fields, prose, items: [chapter | beat], beats }
//   chapter { kind: 'chapter', title, opts, beats: [beat] }
//   beat    { kind: 'show' | 'text' | 'voice' | 'says' | 'sign', value, speaker?, sub: { key: value }, line }
export function parseBrief(text, { file = 'brief.md' } = {}) {
  const lines = String(text).replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, '')).split('\n');
  const fields = {}, prose = [], items = [];
  let chapter = null, beat = null, started = false;
  const fail = (n, msg) => { throw new UsageError(`${file}:${n + 1}: ${msg}`); };
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n], line = raw.trimEnd();
    if (!line.trim()) { beat = beat && beat.open ? beat : null; continue; }
    // A beat's value still open (a recipe call over several lines) takes the line whole.
    if (beat?.open) {
      beat.value += `\n${line}`;
      beat.open = depth(beat.value) > 0;
      continue;
    }
    const heading = /^#{1,3}\s+(.+)$/.exec(line);
    if (heading) {
      chapter = { kind: 'chapter', title: heading[1].trim(), opts: {}, beats: [], line: n + 1 };
      items.push(chapter);
      started = true;
      beat = null;
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { chapter = null; beat = null; continue; }
    const sub = /^\s{2,}(?:-\s+)?([a-z][\w-]*):\s*(.*)$/.exec(line);
    if (sub && beat) {
      if (!BEAT_KEYS.includes(sub[1])) fail(n, `a beat takes ${BEAT_KEYS.join(', ')}, not '${sub[1]}'`);
      beat.sub[sub[1]] = scalar(sub[2]);
      continue;
    }
    const b = /^-\s+(.*)$/.exec(line);
    if (b) {
      const body = b[1];
      const says = /^([a-z][\w-]*)\s+says:\s*(.*)$/i.exec(body), kw = /^(show|text|voice|sign):\s*(.*)$/.exec(body);
      if (!says && !kw) fail(n, `a beat is '- show: ...', '- text: ...', '- voice: <id>', '- <name> says: ...' or '- sign: ...', got '- ${body}'`);
      beat = says
        ? { kind: 'says', speaker: says[1], value: says[2].trim(), sub: {}, line: n + 1 }
        : { kind: kw[1], value: kw[2].trim(), sub: {}, line: n + 1 };
      if (beat.kind === 'show') beat.open = depth(beat.value) > 0;
      if (!beat.value && beat.kind !== 'sign') fail(n, `'- ${beat.kind}:' needs something after it`);
      (chapter ? chapter.beats : items).push(beat);
      started = true;
      continue;
    }
    const field = /^([a-z][\w-]*):\s*(.*)$/.exec(line);
    if (field && chapter && !chapter.beats.length) {
      if (!CHAPTER_KEYS.includes(field[1]) && !CARD_KEYS.includes(field[1])) fail(n, `a chapter takes ${CHAPTER_KEYS.join(', ')} and its card's ${CARD_KEYS.join(', ')}, not '${field[1]}'`);
      chapter.opts[field[1]] = scalar(field[2]);
      continue;
    }
    if (field && !started) { fields[field[1]] = field[2].trim(); continue; }
    if (!started) prose.push(line.trim());
    beat = null;
  }
  const open = items.flatMap((it) => (it.kind === 'chapter' ? it.beats : [it])).find((x) => x.open);
  if (open) fail(open.line - 1, `the brackets of '- show: ${open.value.split('\n')[0]}' never close`);
  const beats = items.flatMap((it) => (it.kind === 'chapter' ? it.beats : [it]));
  if (!beats.length) throw new UsageError(`${file}: no beats (a beat is a line starting '- ')`);
  const signs = beats.filter((x) => x.kind === 'sign');
  if (signs.length > 1) fail(signs[1].line - 1, 'one sign-off a film');
  if (signs.length && beats.at(-1) !== signs[0]) fail(signs[0].line - 1, 'the sign-off is the last beat');
  for (const c of items) if (c.kind === 'chapter' && !c.beats.length) fail(c.line - 1, `chapter '${c.title}' has no beats`);
  const name = fields.film ?? basename(file).replace(/(\.brief)?\.md$/i, '');
  if (!/^[a-z0-9][\w-]*$/i.test(name)) throw new UsageError(`${file}: the film's name '${name}' is not a file name (film: <name>)`);
  return { name, fields, prose, items, beats };
}

// ---------- the stub ----------

// A brief's path as the sheet names it: from the package when it is inside it, else its own name.
const briefName = (abs) => { const r = relative(PKG, abs ?? 'brief.md').split('\\').join('/'); return r.startsWith('..') ? basename(abs) : r; };

const RECIPES = (() => {
  const byName = new Map(), byLetter = new Map();
  for (const [k, v] of Object.entries(SHOTS)) {
    if (typeof v !== 'function' || typeof v.recipe !== 'string') continue;
    byName.set(k, v);
    if (!byLetter.has(v.recipe)) byLetter.set(v.recipe, k);
  }
  return { byName, byLetter };
})();
// The stub's own names, which no shot's variable may take.
const RESERVED = new Set(['score', 'cast', 'stub', 'picture', 'stubPicture', 'at', 'up', 'said', 'LEAD', 'end', 'shots']);
const teaching = (R) => /^A[N-Z]$/.test(R.recipe);
const KNOWN = new Set([
  ...Object.keys(CORE), ...Object.keys(SHOTS), 'audience', 'AUD', 'Math', 'Number', 'String', 'Array', 'Object', 'JSON',
  'Infinity', 'NaN', 'undefined', 'null', 'true', 'false', 'new', 'typeof', 'of', 'in', 'const', 'let', 'return', 'function',
]);
const identOf = (s) => s.replace(/[^\w$]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^(\d)/, '_$1');
// A recipe's own shot name (labelled, cycle, quiz), else its export's.
const shotName = (exportName) => { try { return RECIPES.byName.get(exportName)({}).name; } catch { return exportName; } };
const js = (v) => JSON.stringify(v).replace(/'/g, "\\'").replace(/^"(.*)"$/s, "'$1'").replace(/\\"/g, '"');
const words = (s, n) => { const w = String(s).split(/\s+/).filter(Boolean); return w.slice(0, n).join(' ') + (w.length > n ? '...' : ''); };
const clip = (s, n = 64) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);

// The identifiers a piece of JS reads that nothing defines: object keys, members and arrow parameters are not
// reads, strings and comments are skipped.
function unknownsIn(src, known) {
  const code = src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ').replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
  const params = new Set();
  for (const m of code.matchAll(/\(([^()]*)\)\s*=>/g)) for (const p of m[1].split(',')) { const q = /^\s*\{?\s*([A-Za-z_$][\w$]*)/.exec(p); if (q) params.add(q[1]); }
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) params.add(m[1]);
  const out = [];
  for (const m of code.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const id = m[0], before = code.slice(0, m.index).trimEnd(), after = code.slice(m.index + id.length).trimStart();
    if (before.endsWith('.') || (after.startsWith(':') && !after.startsWith('::')) || /^\d/.test(id)) continue;
    if (known.has(id) || params.has(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}
const stringsIn = (src) => [...src.matchAll(/(['"])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2]).filter((s) => /[a-z]/i.test(s));
const optionIn = (src, key) => new RegExp(`\\b${key}\\s*:\\s*([A-Za-z_$][\\w$]*|false|null)`).exec(src)?.[1];

// stubOf(brief, { out, store }) => { source, plan }: the film module (its beat-sheet comment a marker line) and,
// for each shot name, what the sheet says about it that the film cannot (cast, sound, what).
export function stubOf(brief, { out, store = readCatalogue() } = {}) {
  const F = brief.fields, audience = F.audience ?? 'general';
  try { audienceOf(audience); } catch { throw new UsageError(`audience '${audience}': one of ${Object.keys(AUDIENCES).join(', ')}`); }
  // Inside the package the stub imports relatively, as the films do; anywhere else by the package's URL.
  const inside = !relative(PKG, out).startsWith('..');
  const rel = inside ? relative(dirname(out), PKG).split('\\').join('/') || '.' : pathToFileURL(PKG).href;
  const plan = new Map(), names = new Set(), core = new Set(['film', 'seq']), recipes = new Set(), storeIds = new Set();
  const uniq = (base) => { let n = base, k = 2; while (names.has(n)) n = `${base}-${k++}`; names.add(n); return n; };
  // A shot's variable: its name as an identifier, clear of everything imported or cast.
  const vars = new Map();
  const ident = (name) => {
    if (vars.has(name)) return vars.get(name);
    let v = identOf(name);
    const taken = () => KNOWN.has(v) || RESERVED.has(v) || /^chapter\d+$/.test(v) || [...cast.values()].some((c) => c.v === v) || [...vars.values()].includes(v) || stubs.includes(v);
    if (taken()) v = `${v}Shot`;
    for (let k = 2; taken(); k++) v = `${identOf(name)}Shot${k}`;
    vars.set(name, v);
    return v;
  };

  // The cast: a store puppet by id, else a stick built in code.
  const cast = new Map();
  for (const part of (F.cast ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^([a-z][\w-]*)(?:\s*\(([^)]*)\))?$/i.exec(part);
    if (!m) throw new UsageError(`cast: '${part}' is not a name (a store puppet's id, or a stick: sam, kit (kid))`);
    const [, id, build] = m, v = identOf(id);
    if (KNOWN.has(v)) throw new UsageError(`cast: '${id}' is also the name of something the package exports; call it something else`);
    if (store.has(id) && store.entry(id).kind === 'puppet') {
      storeIds.add(id);
      cast.set(id, { v, id, how: "the store's puppet", code: `actorOf(puppet(${js(id)}))` });
    } else {
      if (build && !Object.keys(BUILDS).includes(build)) throw new UsageError(`cast: ${id}'s build '${build}' is not one of ${Object.keys(BUILDS).join(', ')}`);
      cast.set(id, { v, id, how: `a stick${build ? ` (${build})` : ''}, built in code`, code: `actorOf(puppet(stickSource({ name: ${js(id)}${build ? `, build: ${js(build)}` : ''} })))` });
    }
    core.add('actorOf').add('puppet');
    if (!storeIds.has(id)) core.add('stickSource');
  }
  const castOf = (who, line) => {
    if (who === undefined || who === null || who === 'none') return null;
    if (!cast.has(who)) throw new UsageError(`line ${line}: '${who}' is not in the cast (cast: ${[...cast.keys()].join(', ') || 'none'})`);
    return cast.get(who);
  };
  const teacher = F.actor ? castOf(F.actor, 'actor:') : null;
  if (F.hand) storeIds.add(F.hand);
  const look = F.hand ? `${F.look ?? 'paperInk'}~hand:${F.hand}` : F.look ?? null;
  const known = new Set([...KNOWN, ...[...cast.values()].map((c) => c.v)]);
  const stubs = [];
  const sample = (id, line, copy) => {
    if (store.has(id)) {
      if (store.entry(id).kind !== 'sample') throw new UsageError(`line ${line}: '${id}' is a ${store.entry(id).kind} in the store, not a sample`);
      storeIds.add(id);
      return { id, recorded: true };
    }
    if (typeof copy !== 'string' || !copy.trim()) throw new UsageError(`line ${line}: no sample '${id}' in the store: record it and \`hdf import line.wav --kind sample --name ${id}\`, or give its copy (copy: ...) to time it at reading speed`);
    return { id, recorded: false, copy };
  };

  const blocks = [], scoreLines = [];
  let helpers = { up: false, said: false, aud: false, placeholder: false, figure: false };
  const at = (n) => `at(${js(n)})`;

  function beatCode(b) {
    const S = b.sub, sounds = [], lookOpt = S.look ? `, look: ${js(S.look)}` : '';
    const note = (name, row) => plan.set(name, { ...row, sound: [row.sound, S.sound].filter(Boolean).join('; ') || '-', what: S.what ?? row.what });
    if (b.kind === 'sign') {
      const [a, ...rest] = String(b.value || brief.name).split(/\s+/);
      const name = uniq(S.name ?? 'sign');
      recipes.add('signOffShot');
      note(name, { cast: '-', what: `sign-off: ${[a, ...rest].join(' ')}` });
      return { name, code: `const ${ident(name)} = signOffShot({ name: ${js(name)}, a: ${js(a)}, b: ${js(rest.join(' '))}${S.dur ? `, dur: ${S.dur}` : ''}${lookOpt} });` };
    }
    if (b.kind === 'text') {
      const name = uniq(S.name ?? 'text');
      recipes.add('titleCard');
      note(name, { cast: teacher?.id ?? '-', what: `"${clip(b.value, 48)}" written by a hand` });
      return { name, code: `const ${ident(name)} = titleCard({ name: ${js(name)}, title: ${js(b.value)}, hand: true${teacher ? `, actor: ${teacher.v}` : ''}, audience${S.dur ? `, dur: ${S.dur}` : ''}${lookOpt} });` };
    }
    if (b.kind === 'voice') {
      const V = sample(b.value, b.line, S.copy), by = S.by === undefined ? teacher : castOf(S.by, b.line);
      const name = uniq(S.name ?? b.value), v = ident(name);
      core.add('shot').add('paper').add('meta').add('captions');
      helpers.up = helpers.placeholder = true;
      const lines = [`const ${v}Caps = captions(${V.recorded ? js(V.id) : `[${js(V.copy)}]`}, { t0: LEAD, audience${V.recorded ? '' : `, name: ${js(V.id)}`} });`];
      if (!V.recorded) lines.unshift(`// ${V.id} is not recorded yet: timed at reading speed from its copy. Record it, hdf import it, run hdf script again.`);
      if (by && V.recorded) {
        lines.push(`const ${v}Line = ${by.v}.say(null, LEAD, { voice: ${js(V.id)}, bubble: false, audience });`);
        helpers.figure = true;
        recipes.add('actorFigure');
        core.add('place');
      }
      const dur = S.dur ?? `up(${v}Caps.until)`;
      const figure = by && V.recorded ? `\n  place(190, 600, actorFigure(${by.v}, { ...${by.v}.idle(ctx.t), ...${by.v}.look(0), ...${v}Line.state(ctx.t) }, 300, 'drawn')),` : '';
      lines.push(`const ${v} = shot(${js(name)}, ${dur}, (ctx) => [\n  ...stubPicture(ctx),${figure}\n  ${v}Caps.draw(ctx.t, ctx),\n]${lookOpt ? `, { ${lookOpt.slice(2)} }` : ''});`);
      if (V.recorded) { core.add('voice'); sounds.push(`voice(${js(V.id)}, ${at(name)} + LEAD)`); }
      scoreLines.push(...sounds);
      note(name, { cast: by?.id ?? '-', sound: V.recorded ? `voice ${V.id}` : `(${V.id} not recorded)`, what: `narration: "${words(V.recorded ? store.entry(V.id).desc ?? '' : V.copy, 6)}"${by ? `, ${by.id} speaks it` : ''}` });
      return { name, code: lines.join('\n') };
    }
    if (b.kind === 'says') throw new Error('says beats are grouped into runs');
    // show: a recipe call, or a placeholder.
    const call = /^([A-Za-z_$][\w$]*)\s*(?:\(([\s\S]*)\))?\s*$/.exec(b.value);
    const exportName = call && (RECIPES.byName.has(call[1]) ? call[1] : RECIPES.byLetter.get(call[1]));
    if (!exportName) {
      if (call && /^[A-Z]{1,2}$/.test(call[1])) throw new UsageError(`line ${b.line}: no recipe ${call[1]} (references/recipes.md lists them)`);
      if (call && call[2] !== undefined) throw new UsageError(`line ${b.line}: no recipe '${call[1]}' (references/recipes.md lists them; a placeholder is '- show: <what happens>')`);
      const name = uniq(S.name ?? b.value.split(/\s+/).slice(0, 2).join(' ').toLowerCase().replace(/[^\w -]/g, ''));
      core.add('shot').add('paper').add('meta');
      helpers.placeholder = true;
      note(name, { cast: '-', what: b.value });
      return { name, code: `const ${ident(name)} = shot(${js(name)}, ${S.dur ?? PLACEHOLDER}, (ctx) => stubPicture(ctx)${lookOpt ? `, { ${lookOpt.slice(2)} }` : ''});   // a placeholder: ${b.value}` };
    }
    const R = RECIPES.byName.get(exportName), args = (call[2] ?? '').trim();
    if (args && !/^\{[\s\S]*\}$/.test(args)) throw new UsageError(`line ${b.line}: ${exportName}'s options are one object literal, got (${clip(args, 40)})`);
    for (const id of unknownsIn(args, known)) { stubs.push(id); known.add(id); }
    recipes.add(exportName);
    const name = uniq(S.name ?? shotName(exportName)), v = ident(name);
    const pre = [`name: ${js(name)}`];
    if (teacher && teaching(R) && 'actor' in R.defaults) pre.push(`actor: ${teacher.v}`);
    if ('audience' in R.defaults) pre.push('audience');
    if (S.look) pre.push(`look: ${js(S.look)}`);
    const inner = args.replace(/^\{\s*|\s*\}$/g, '');
    // One line stays one line; options over several lines are laid out as a block under what the tool adds.
    const block = (keys) => {
      if (!inner.includes('\n')) return `{ ${[...keys, inner].filter(Boolean).join(', ')} }`;
      const ls = inner.split('\n'), pad = Math.min(...ls.slice(1).filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
      const body = [ls[0], ...ls.slice(1).map((l) => l.slice(pad))].map((l) => l.trim() && `  ${l.trimEnd()}`).filter(Boolean);
      if (!body.at(-1).endsWith(',')) body[body.length - 1] += ',';
      return `{\n  ${keys.join(', ')},\n${body.join('\n')}\n}`;
    };
    const opts = block(pre);
    const who = optionIn(args, 'actor') ?? teacher?.v ?? null;
    const other = optionIn(args, 'other');
    const castIds = [who, other].filter((x) => x && x !== 'null' && x !== 'false').map((x) => [...cast.values()].find((c) => c.v === x)?.id ?? x);
    const lines = [];
    let sound = '';
    if (S.voice !== undefined) {
      const V = sample(String(S.voice), b.line, S.copy);
      if (!V.recorded) throw new UsageError(`line ${b.line}: a voice under a shot must be recorded (no sample '${V.id}' in the store)`);
      helpers.up = helpers.said = helpers.aud = true;
      core.add('voice');
      lines.push(`const ${v}O = ${opts};`);
      lines.push(`const ${v} = ${exportName}({ ...${v}O, dur: ${S.dur ?? `up(Math.max(${exportName}(${v}O).dur, LEAD + said(${js(V.id)}) + AUD.dwell))`} });`);
      scoreLines.push(`voice(${js(V.id)}, ${at(name)} + LEAD)`);
      sound = `voice ${V.id}`;
    } else {
      const withDur = S.dur ? block([...pre, `dur: ${S.dur}`]) : opts;
      if (exportName === 'quiz') {
        lines.push(`const ${v}O = ${withDur};`, `const ${v} = quiz(${v}O);`, `const ${v}T = quizTimes(${v}O);`);
        recipes.add('quizTimes');
        core.add('tick').add('ding');
        scoreLines.push(`...${v}T.ticks.flatMap((t) => tick(${at(name)} + t))`, `...ding(${at(name)} + ${v}T.ding)`);
        sound = 'a tick a wrong one, a ding';
      } else if (exportName === 'dialogueShot') {
        lines.push(`const ${v}O = ${withDur};`, `const ${v} = dialogueShot(${v}O);`);
        recipes.add('dialogueOf');
        scoreLines.push(`...dialogueOf(${v}O).events(${at(name)})`);
        sound = 'the lines';
      } else lines.push(`const ${v} = ${exportName}(${withDur});`);
    }
    note(name, { cast: castIds.join(' ') || '-', sound, what: `${exportName}${stringsIn(args).length ? `: ${clip(stringsIn(args).join(', '), 56)}` : ''}` });
    return { name, code: lines.join('\n') };
  }

  // A run of says lines is one exchange: AY with the teacher (or the first to speak) on the left.
  function saysCode(run) {
    const speakers = [...new Set(run.map((b) => b.speaker))].map((s) => castOf(s, run.find((b) => b.speaker === s).line));
    if (speakers.length > 2) throw new UsageError(`line ${run[0].line}: an exchange is between two (${speakers.map((s) => s.id).join(', ')} speak in a row); put a beat between`);
    const left = speakers.includes(teacher) ? teacher : speakers[0], right = speakers.find((s) => s !== left) ?? null;
    const S = {};
    for (const b of run) for (const k of ['name', 'dur', 'look']) if (b.sub[k] !== undefined) S[k] ??= b.sub[k];
    const name = uniq(S.name ?? 'talk'), v = ident(name);
    const lines = run.map((b) => {
      const q = {};
      for (const k of ['kind', 'emote']) if (b.sub[k] !== undefined) q[k] = b.sub[k];
      if (b.sub.voice !== undefined) q.voice = sample(String(b.sub.voice), b.line).id;
      const qs = Object.entries(q).map(([k, x]) => `${k}: ${js(x)}`).join(', ');
      return `    [${castOf(b.speaker, b.line) === left ? 0 : 1}, ${js(b.value)}${qs ? `, { ${qs} }` : ''}],`;
    });
    recipes.add('dialogueShot').add('dialogueOf');
    const o = [`name: ${js(name)}`, `actor: ${left.v}`, `other: ${right ? right.v : 'false'}`, 'audience', S.dur ? `dur: ${S.dur}` : null, S.look ? `look: ${js(S.look)}` : null].filter(Boolean);
    scoreLines.push(`...dialogueOf(${v}O).events(${at(name)})`);
    const voiced = run.map((b) => b.sub.voice).filter((x) => x !== undefined);
    plan.set(name, {
      cast: [left, right].filter(Boolean).map((c) => c.id).join(' '),
      sound: [voiced.length ? `voice ${voiced.join(', ')}` : 'the lines', ...run.map((b) => b.sub.sound).filter(Boolean)].join('; '),
      what: run.map((b) => b.sub.what).filter(Boolean).join('; ') || clip(run.map((b) => `${b.speaker}: ${b.value}`).join(' / '), 72),
    });
    return { name, code: `const ${v}O = {\n  ${o.join(', ')},\n  lines: [\n${lines.join('\n')}\n  ],\n};\nconst ${v} = dialogueShot(${v}O);` };
  }

  // The beats of a list as shots (says runs grouped), in order.
  const shotsOf = (list) => {
    const out = [];
    for (let k = 0; k < list.length; k++) {
      if (list[k].kind !== 'says') { out.push(beatCode(list[k])); continue; }
      let j = k;
      while (j + 1 < list.length && list[j + 1].kind === 'says') j++;
      out.push(saysCode(list.slice(k, j + 1)));
      k = j;
    }
    return out;
  };

  const timeline = [];
  let chapterNo = 0;
  // Beats outside a chapter in runs (so a run of says lines is one exchange), chapters one at a time.
  const runs = [];
  for (const it of brief.items) {
    if (it.kind !== 'chapter' && runs.at(-1)?.kind === 'beats') runs.at(-1).beats.push(it);
    else runs.push(it.kind === 'chapter' ? it : { kind: 'beats', beats: [it] });
  }
  for (const it of runs) {
    if (it.kind !== 'chapter') {
      for (const s of shotsOf(it.beats)) {
        blocks.push(s.code);
        timeline.push(ident(s.name));
      }
      continue;
    }
    const shots = shotsOf(it.beats), o = it.opts, card = `card: ${it.title}`;
    names.add(card);
    recipes.add('chapter');
    const head = [`title: ${js(it.title)}`, teacher ? `actor: ${teacher.v}` : null, 'audience',
      o.hand ? 'hand: true' : null, o.sub ? `sub: ${js(String(o.sub))}` : null, o.card === false ? 'card: false' : null,
      o.hold !== undefined ? `hold: ${o.hold}` : null, ...Object.entries(o).filter(([k]) => CARD_KEYS.includes(k)).map(([k, x]) => `${k}: ${js(x)}`)].filter(Boolean);
    const v = `chapter${++chapterNo}`;
    blocks.push(`// ---------- ${chapterNo}. ${it.title} ----------\n\n${shots.map((s) => s.code).join('\n')}`);
    let node = `chapter({ ${head.join(', ')} }, ${shots.map((s) => ident(s.name)).join(', ')})`;
    if (o.look) { node = `lookOn(${js(o.look)}, ${node})`; core.add('lookOn'); }
    blocks.push(`const ${v} = ${node};`);
    timeline.push(v);
    if (o.card !== false) plan.set(card, { cast: teacher?.id ?? '-', sound: '-', what: `title "${clip(it.title, 44)}"${o.hand ? ' written by a hand' : ''}${teacher ? `; ${teacher.id} presents` : ''}` });
  }

  if (F.bed) { core.add('bed'); scoreLines.unshift(`bed({ mood: ${js(F.bed)}, to: end })`); }
  if (helpers.aud) core.add('audienceOf');
  if (helpers.said) core.add('alignOf');
  if (helpers.up) core.add('FPS');
  if (helpers.placeholder || stubs.length) core.add('cel').add('stroke').add('rect').add('line').add('group').add('place');
  if (helpers.placeholder) core.add('paper').add('meta');

  // ---------- the module ----------
  const src = [];
  src.push(`import { ${[...core].sort().join(', ')} } from '${rel}/core/index.js';`);
  if (recipes.size) src.push(`import { ${[...recipes].sort().join(', ')} } from '${rel}/recipes/shots.js';`);
  if (storeIds.size) src.push(`import { fromStore } from '${rel}/core/assets.js';`, '', `fromStore([${[...storeIds].map(js).join(', ')}]);`);
  src.push('', `const audience = ${js(audience)};`);
  if (helpers.aud) src.push('const AUD = audienceOf(audience);');
  if (helpers.up || scoreLines.some((l) => l.includes('LEAD'))) src.push(`const LEAD = ${LEAD};                                   // a voice starts this far into its shot`);
  if (helpers.up) src.push('const up = (s) => Math.ceil(s * FPS - 1e-6) / FPS;  // a length worked out, up to the next drawn frame');
  if (helpers.said) src.push("const said = (id) => alignOf(id).words.at(-1).t1;   // when a recording's last word ends");
  if (cast.size) {
    src.push('', '// ---------- cast ----------', '');
    for (const c of cast.values()) src.push(`const ${c.v} = ${c.code};`);
    src.push(`export const cast = { ${[...cast.values()].map((c) => (c.v === c.id ? c.v : `${js(c.id)}: ${c.v}`)).join(', ')} };`);
  }
  if (helpers.placeholder || stubs.length) {
    src.push('', '// ---------- stub cels: a dashed box where a new cel will go (draw it, then hdf sheet <film> <cel>) ----------', '');
    src.push("const stub = (name) => cel(name, () => [\n  stroke(rect(-120, -120, 240, 240), 'ink', { w: 3, wobble: 1, dash: [14, 10], name: 'box' }),\n  stroke(line(-120, -120, 120, 120), 'shade', { w: 2, name: 'x1' }), stroke(line(120, -120, -120, 120), 'shade', { w: 2, name: 'x2' }),\n], { box: [-126, -126, 252, 252], desc: `stub: ${name}` });");
    for (const id of stubs) src.push(`const ${id} = stub(${js(id)});`);
    if (helpers.placeholder) src.push("const picture = stub('picture');", "// What a placeholder shot and a narration draw until the film is written: paper and the stub, the anchor.", "const stubPicture = () => [paper(), meta('anchor', { name: 'stub' }), place(620, 420, group('stub', [picture({})]))];");
  }
  src.push('', ...blocks.flatMap((b) => [b, '']));
  src.push('const score = ({ shots, end }) => {');
  src.push("  const at = (name) => shots.find((s) => s.name === name && !s.hold && !s.cut).t0;");
  src.push('  return {', '    master: 0.5,', '    events: [');
  for (const l of scoreLines) src.push(`      ${l},`);
  src.push('    ],', '  };', '};', '');
  const filmOpts = [`name: ${js(brief.name)}`, look ? `look: ${js(look)}` : null, 'audience', F.format ? `format: ${js(F.format)}` : null, `timeline: seq(${timeline.join(', ')})`, 'score'].filter(Boolean);
  src.push(`export default film({ ${filmOpts.join(', ')} });`, '');

  // The BRIEF comment: the header fields in the template's order, the prose, what is a stub.
  const Fcap = (k) => k[0].toUpperCase() + k.slice(1);
  const head = [`// BRIEF (hdf script ${briefName(brief.file)}: the brief is the source of the timing; edit it and run again)`];
  for (const k of [...HEADER_KEYS, ...Object.keys(F).filter((k) => !HEADER_KEYS.includes(k))]) {
    if (F[k] === undefined || k === 'film') continue;
    const val = k === 'cast' ? [...cast.values()].map((c) => `${c.id} (${c.how})`).join(', ') : k === 'actor' ? `${F[k]} (the teacher: every teaching recipe and chapter card)` : F[k];
    head.push(`// ${Fcap(k)}: ${val}`);
  }
  for (const p of brief.prose) head.push(`// ${p}`);
  if (stubs.length || helpers.placeholder) head.push(`// Stub cels: ${[...stubs, ...(helpers.placeholder ? ['picture'] : [])].join(', ')} (a dashed box each, until drawn)`);
  head.push('//', SHEET_MARK, '//');
  return { source: `${head.join('\n')}\n${src.join('\n')}`, plan };
}

// ---------- the beat sheet ----------

const SHEET_MARK = '// Beat sheet';
const COLS = ['t', 'dur', 'shot', 'look', 'recipe', 'cast', 'sound', 'what'];
const f2 = (x) => x.toFixed(2);
const lookName = (l) => (l ? (typeof l === 'string' ? l : l.name ?? '(look)') : null);

// rowsOf(film) => [{ t0, dur, shot, look, recipe, chapter }]: every shot, hold and cut as the film plays them,
// with the look each is drawn in (the innermost wins) and the chapter it is in.
export function rowsOf(f) {
  const rows = [], ch = chapters(f);
  const visit = (node, f0, look) => {
    const t0 = f0 / FPS, dur = node.n / FPS, chapter = ch.find((c) => f0 >= c.f0 && f0 < c.f0 + c.frames)?.n ?? null;
    switch (node.kind) {
      case 'shot': rows.push({ t0, dur, shot: node.name, look: lookName(node.look) ?? look, recipe: node.recipe ?? '-', chapter }); break;
      case 'hold': rows.push({ t0, dur, shot: 'hold', of: node.child.name ?? node.child.kind, look, recipe: '-', chapter }); break;
      case 'cut': rows.push({ t0, dur, shot: node.name, look, recipe: `cut ${node.fx}`, chapter }); break;
      case 'seq': { let at = f0; for (const c of node.kids) { visit(c, at, look); at += c.n; } break; }
      case 'par': node.kids.forEach((c) => visit(c, f0, look)); break;
      case 'look': visit(node.child, f0, lookName(node.look) ?? look); break;
    }
  };
  visit(f.timeline, 0, lookName(f.look));
  return rows;
}

// formatSheet(film, plan, { from }) => the comment block (a string of '// ' lines), from the film's own times.
export function formatSheet(f, plan = new Map(), { from } = {}) {
  const rows = rowsOf(f), ch = chapters(f), last = new Map();
  const table = rows.map((r) => {
    const p = r.shot === 'hold' ? { cast: '-', sound: '-', what: `holds ${r.of}` } : plan.get(r.shot) ?? {};
    return [f2(r.t0), f2(r.dur), r.shot, r.look ?? '-', r.recipe, p.cast ?? '-', p.sound ?? '-', p.what ?? ''];
  });
  const W = COLS.map((c, j) => Math.max(c.length, ...table.map((r) => r[j].length)));
  const fmt = (cells) => `// ${cells.map((c, j) => (j === cells.length - 1 ? c : c.padEnd(W[j]))).join('  ')}`.trimEnd();
  const head = [`${SHEET_MARK} (${[from && `hdf script ${from}`, f.audience !== 'general' && f.audience, f.format.ar, `${f2(f.dur)} s`, ch.length && `${ch.length} chapter${ch.length === 1 ? '' : 's'}`].filter(Boolean).join(', ')})`];
  const out = [...head, fmt(COLS)];
  rows.forEach((r, k) => {
    if (r.chapter && !last.has(r.chapter)) {
      const c = ch[r.chapter - 1];
      last.set(r.chapter, true);
      out.push(`// chapter ${c.n}: ${c.title} (${f2(c.t0)} to ${f2(c.t0 + c.dur)})`);
    }
    out.push(fmt(table[k]));
  });
  return out.map((l) => (l.startsWith('//') ? l : `// ${l}`)).join('\n');
}

// readSheet(source) => { rows: [{ t0, dur, shot, look, recipe }], start, end } | null: a film's beat-sheet
// comment read back by the columns of its header line.
export function readSheet(source) {
  const lines = source.split('\n'), start = lines.findIndex((l) => l.startsWith(SHEET_MARK));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && /^\/\/ \S/.test(lines[end])) end++;
  const header = lines[start + 1] ?? '';
  const at = COLS.map((c) => header.search(new RegExp(`(?<=\\s|^//\\s)${c}\\b`)));
  if (at.some((x) => x < 0)) return { rows: [], start, end, bad: 'no column header under the beat-sheet line' };
  const rows = [];
  for (const l of lines.slice(start + 2, end)) {
    if (!/^\/\/ \d+\.\d\d\s/.test(l)) continue;
    const cell = (j) => l.slice(at[j], j + 1 < at.length ? at[j + 1] : undefined).trim();
    rows.push({ t0: +cell(0), dur: +cell(1), shot: cell(2), look: cell(3), recipe: cell(4) });
  }
  return { rows, start, end };
}

// The differences between a sheet's rows and a film's (empty when the film plays its sheet).
export function sheetDiff(sheet, f) {
  const now = rowsOf(f), out = [];
  const n = Math.max(sheet.length, now.length);
  for (let k = 0; k < n; k++) {
    const a = sheet[k], b = now[k];
    if (!a) { out.push(`row ${k + 1}: the film plays ${b.shot} at ${f2(b.t0)} +${f2(b.dur)}, the sheet has no row for it`); continue; }
    if (!b) { out.push(`row ${k + 1}: the sheet has ${a.shot} at ${f2(a.t0)} +${f2(a.dur)}, the film has nothing there`); continue; }
    const same = a.shot === b.shot && f2(a.t0) === f2(b.t0) && f2(a.dur) === f2(b.dur) && a.recipe === b.recipe && a.look === (b.look ?? '-');
    if (!same) out.push(`row ${k + 1}: the sheet says ${a.shot} ${f2(a.t0)} +${f2(a.dur)} ${a.recipe} ${a.look}, the film plays ${b.shot} ${f2(b.t0)} +${f2(b.dur)} ${b.recipe} ${b.look ?? '-'}`);
  }
  return out;
}

// The sheet put into a module's source in place of its old one (or of the bare marker line a stub carries).
export function withSheet(source, sheet) {
  const lines = source.split('\n'), start = lines.findIndex((l) => l.startsWith(SHEET_MARK));
  if (start < 0) throw new UsageError(`no '${SHEET_MARK}' comment in the film to replace (put a line '${SHEET_MARK}' where it goes)`);
  let end = start + 1;
  while (end < lines.length && /^\/\/ \S/.test(lines[end])) end++;
  return [...lines.slice(0, start), ...sheet.split('\n'), ...lines.slice(end)].join('\n');
}

// script(briefPath, { out, loadFilm, store }) => { brief, source, sheet, film, out }: the stub written to a
// scratch file beside where the film goes, loaded as a film, and the sheet read off it.
export async function script(briefPath, { out, loadFilm, store } = {}) {
  const abs = resolve(briefPath);
  if (!existsSync(abs)) throw new UsageError(`no brief ${briefPath}`);
  const brief = { ...parseBrief(readFileSync(abs, 'utf8'), { file: briefPath }), file: abs };
  const target = resolve(out ?? join(PKG, 'work', brief.name, `${brief.name}.js`));
  const { source, plan } = stubOf(brief, { out: target, store });
  const dir = dirname(target), made = !existsSync(dir);
  mkdirSync(dir, { recursive: true });
  const scratch = join(dir, `.${brief.name}.script-${process.pid}-${Date.now().toString(36)}.js`);
  writeFileSync(scratch, source);
  let film;
  try { film = await loadFilm(scratch); } catch (e) {
    throw new Error(`the stub the brief makes does not load (${e.message}); the brief's show: options are JS, check them`, { cause: e });
  } finally {
    unlinkSync(scratch);
    if (made && !readdirSync(dir).length) rmdirSync(dir);
  }
  const sheet = formatSheet(film, plan, { from: briefName(abs) });
  return { brief, source: withSheet(source, sheet), sheet, film, out: target, made };
}

export async function run(args, flags, { loadFilm }) {
  if (flags.check) {
    const path = typeof flags.check === 'string' ? flags.check : args[0];
    if (!path) throw new UsageError('script --check <film.js>');
    const sheet = readSheet(readFileSync(resolve(path), 'utf8'));
    if (!sheet) throw new UsageError(`${path}: no '${SHEET_MARK}' comment`);
    if (sheet.bad) throw new UsageError(`${path}: ${sheet.bad}`);
    const diffs = sheetDiff(sheet.rows, await loadFilm(path));
    if (diffs.length) {
      process.stdout.write(`${path}: the film does not play its beat sheet\n${diffs.map((d) => `  ${d}`).join('\n')}\n(edit the brief and run hdf script again, or fix the film)\n`);
      return 1;
    }
    process.stdout.write(`${path}: plays its beat sheet (${sheet.rows.length} rows)\n`);
    return 0;
  }
  const [briefPath] = args;
  if (!briefPath) throw new UsageError('script <brief.md> [--out film.js] [--dry] [--force] | script --check <film.js>');
  const r = await script(briefPath, { out: typeof flags.out === 'string' ? flags.out : undefined, loadFilm });
  process.stdout.write(`${r.sheet}\n`);
  if (flags.dry) return 0;
  const rel = relative(process.cwd(), r.out);
  if (!existsSync(r.out) || flags.force) {
    writeFileSync(r.out, r.source);
    process.stdout.write(`wrote ${rel} (the stub: ${r.film.n} frames; hdf board ${rel})\n`);
  } else {
    writeFileSync(r.out, withSheet(readFileSync(r.out, 'utf8'), r.sheet));
    process.stdout.write(`${rel} exists: replaced its beat sheet only (--force rewrites the stub; hdf script --check ${rel})\n`);
  }
  return 0;
}
