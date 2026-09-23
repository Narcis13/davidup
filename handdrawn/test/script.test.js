// 4.0 E5: hdf script, a brief in the script dialect to the beat sheet and a timeline stub; the moon film's
// brief round-trips to the beat sheet it was built from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { FPS, actorOf, captions, film, puppet, seq, stickSource } from '../core/index.js';
import { frame } from '../core/tree.js';
import { walk } from '../core/list.js';
import { fromStore } from '../core/assets.js';
import { counting, dialogueShot, labelled, signOffShot, titleCard } from '../recipes/shots.js';
import { loadFilm } from '../cli/load.mjs';
import { parseBrief, readSheet, rowsOf, script, sheetDiff, withSheet } from '../cli/script.mjs';

const hdf = (...argv) => { const r = spawnSync(process.execPath, ['cli/hdf.mjs', ...argv], { encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };
const up = (s) => Math.ceil(s * FPS - 1e-6) / FPS;
const SAM = actorOf(puppet(stickSource({ name: 'sam' })));
const KIT = actorOf(puppet(stickSource({ name: 'kit', build: 'kid' })));

// A brief in a scratch directory, scripted with its stub beside it (never written unless asked).
async function scripted(text) {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-script-'));
  try {
    writeFileSync(join(dir, 'b.md'), text);
    return await script(join(dir, 'b.md'), { out: join(dir, 'b.js'), loadFilm });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const row = (r, name) => rowsOf(r.film).find((x) => x.shot === name);

test('parseBrief: header fields and prose, chapters with options, beats with sub-items, a call over several lines', () => {
  const b = parseBrief([
    'film: x', 'audience: kids-9', 'A line of prose.', '',
    '# one', 'hand: true', 'size: 80', '',
    '- show: labelled({', "    labels: [{ text: 'a', at: [1, 2] }],", '  })', '  what: labels',
    '- sam says: hi', '  emote: happy',
    '---',
    '- sign: the end',
  ].join('\n'), { file: 'x.md' });
  assert.equal(b.name, 'x');
  assert.deepEqual(b.fields, { film: 'x', audience: 'kids-9' });
  assert.deepEqual(b.prose, ['A line of prose.']);
  assert.equal(b.items.length, 2);
  const [ch, sign] = b.items;
  assert.deepEqual(ch.opts, { hand: true, size: 80 });
  assert.deepEqual(ch.beats.map((x) => x.kind), ['show', 'says']);
  assert.match(ch.beats[0].value, /^labelled\(\{\n[\s\S]*\}\)$/);
  assert.equal(ch.beats[0].sub.what, 'labels');
  assert.deepEqual([ch.beats[1].speaker, ch.beats[1].value, ch.beats[1].sub.emote], ['sam', 'hi', 'happy']);
  assert.deepEqual([sign.kind, sign.value], ['sign', 'the end']);
  assert.equal(parseBrief('- text: hi', { file: 'dir/lesson.brief.md' }).name, 'lesson');
  assert.throws(() => parseBrief('- dance: now'), /a beat is/);
  assert.throws(() => parseBrief('- text: a\n  colour: red'), /a beat takes .* not 'colour'/);
  assert.throws(() => parseBrief('- sign: a\n- text: b'), /the sign-off is the last beat/);
  assert.throws(() => parseBrief('- show: labelled({ x: 1'), /never close/);
  assert.throws(() => parseBrief('# empty\n'), /no beats/);
  assert.throws(() => parseBrief('# one\ncolour: red\n- text: a'), /a chapter takes/);
});

test('every length is the film\'s own: a recipe from its copy and audience, speech at reading speed, a card and a hold', async () => {
  const r = await scripted([
    'film: b', 'audience: kids-9', 'look: whiteboard', 'cast: sam, kit (kid)', 'actor: sam', '',
    '# parts', '- show: labelled', '- show: counting({ n: 3 })', '---',
    '- kit says: why?', '- sam says: because.', '- text: look up', '- show: the moon rises', '  dur: 3', '- sign: the end',
  ].join('\n'));
  const audience = 'kids-9';
  assert.equal(row(r, 'labelled').dur, labelled({ actor: SAM, audience }).dur);
  assert.equal(row(r, 'counting').dur, counting({ actor: SAM, audience, n: 3 }).dur);
  assert.equal(row(r, 'card: parts').dur, titleCard({ title: 'parts', actor: SAM, audience }).dur);
  const hold = rowsOf(r.film).find((x) => x.shot === 'hold');
  assert.equal(hold.of, 'counting');
  assert.equal(hold.dur, up(Math.max(0.9, 1.5)));   // kids-9: its dwell, at least its cut floor
  const talk = dialogueShot({ actor: SAM, other: KIT, audience, lines: [[1, 'why?'], [0, 'because.']] });
  assert.deepEqual([row(r, 'talk').recipe, row(r, 'talk').dur], ['AY', talk.dur]);
  assert.equal(row(r, 'text').dur, titleCard({ title: 'look up', hand: true, actor: SAM, audience }).dur);
  assert.deepEqual([row(r, 'the moon').dur, row(r, 'the moon').recipe], [3, '-']);
  assert.equal(row(r, 'sign').dur, signOffShot().dur);
  // The sheet: a chapter line, the columns, the cast and the what the brief gave.
  assert.match(r.sheet, /^\/\/ Beat sheet \(hdf script .*b\.md, kids-9, 1:1, [\d.]+ s, 1 chapter\)$/m);
  assert.match(r.sheet, /^\/\/ t +dur +shot +look +recipe +cast +sound +what$/m);
  assert.match(r.sheet, /^\/\/ chapter 1: parts \(0\.00 to [\d.]+\)$/m);
  assert.match(r.sheet, /^\/\/ [\d.]+ +[\d.]+ +talk +whiteboard +AY +sam kit +the lines +kit: why\? \/ sam: because\.$/m);
  // The stub names its recipes and plays its own sheet.
  assert.match(r.source, /import \{ [^}]*\bchapter\b[^}]*\bcounting\b[^}]*\} from '.*\/recipes\/shots\.js';/);
  assert.match(r.source, /const kit = actorOf\(puppet\(stickSource\(\{ name: 'kit', build: 'kid' \}\)\)\);/);
  assert.deepEqual(sheetDiff(readSheet(r.source).rows, r.film), []);
});

test('recordings: a narration lasts its captions, a voice under a shot stretches it, a voiced line, one speaker alone', async () => {
  fromStore(['mini-line', 'hello-there']);
  const r = await scripted([
    'film: v', 'audience: kids-7', 'look: whiteboard', 'cast: sam', 'actor: sam', '',
    '- voice: mini-line', '- show: counting({ n: 1, per: 0.5 })', '  voice: hello-there', '  name: count',
    '- sam says: hello there', '  voice: hello-there',
    '- voice: moon-9', '  copy: the moon is round', '  by: none',
  ].join('\n'));
  const caps = captions('mini-line', { t0: 0.5, audience: 'kids-7' });
  assert.equal(row(r, 'mini-line').dur, up(caps.until));
  // counting of one at 0.5 s is shorter than the voice, so the voice sets the length.
  const own = counting({ actor: SAM, audience: 'kids-7', n: 1, per: 0.5 }).dur;
  assert.ok(row(r, 'count').dur >= own);
  assert.match(r.source, /voice\('hello-there', at\('count'\) \+ LEAD\)/);
  assert.match(r.source, /other: false/);
  assert.match(r.source, /\[0, 'hello there', \{ voice: 'hello-there' \}\]/);
  // Not recorded: timed at reading speed from its copy, no voice in the score.
  assert.match(r.source, /moon-9 is not recorded yet/);
  assert.match(r.sheet, /moon-9 +whiteboard +- +- +\(moon-9 not recorded\)/);
  await assert.rejects(scripted('- voice: moon-9'), /no sample 'moon-9' in the store/);
  await assert.rejects(scripted('cast: sam\n- bob says: hi'), /'bob' is not in the cast/);
  await assert.rejects(scripted('- show: labeled({ n: 1 })'), /no recipe 'labeled'/);
});

test('a quiz scores its options, strikes and answer, voiced or not', async () => {
  fromStore(['hello-there']);
  const Q = "quiz({ question: 'which one flies?', options: ['fish', 'bird', 'cat'], answer: 1 })";
  for (const voiced of [false, true]) {
    const r = await scripted(['look: whiteboard', 'cast: sam', 'actor: sam', `- show: ${Q}`, voiced && '  voice: hello-there', '  name: quiz'].filter(Boolean).join('\n'));
    assert.match(r.source, /const quizShotT = quizTimes\(quizShotO\);/);
    assert.match(r.source, /\.\.\.quizShotT\.options\.flatMap\(\(t\) => pop\(at\('quiz'\) \+ t\)\)/);
    assert.match(r.source, /\.\.\.quizShotT\.ticks\.flatMap\(\(t\) => tick\(at\('quiz'\) \+ t\)\)/);
    assert.match(r.source, /\.\.\.ding\(at\('quiz'\) \+ quizShotT\.ding\)/);
    assert.equal(/voice\('hello-there', at\('quiz'\) \+ LEAD\)/.test(r.source), voiced);
    assert.match(r.sheet, new RegExp(`${voiced ? 'voice hello-there; ' : ''}a pop an option, a tick a wrong one, a ding`));
    assert.deepEqual(sheetDiff(readSheet(r.source).rows, r.film), []);
  }
});

test('an identifier nothing defines becomes a stub cel; recipes by letter; shot variables clear of imports', async () => {
  const r = await scripted("look: paperInk\n- show: AO({ subject: (ctx) => moon({}), labels: [{ text: 'lit', at: [600, 500] }] })\n- show: labelled");
  assert.match(r.source, /const moon = stub\('moon'\);/);
  assert.doesNotMatch(r.source, /stub\('ctx'\)|stub\('text'\)|stub\('at'\)/);
  assert.match(r.source, /const labelledShot = labelled\(\{ name: 'labelled'/);
  assert.match(r.source, /const labelled2 = labelled\(\{ name: 'labelled-2'/);
  assert.deepEqual(rowsOf(r.film).map((x) => x.recipe), ['AO', 'AO']);
});

test('dialogueShot other: false: one actor alone in the middle, every line its own', () => {
  const s = dialogueShot({ actor: SAM, other: false, lines: [[0, 'hello!'], ['left', 'look up.']] });
  const list = frame(film({ name: 'x', look: 'whiteboard', timeline: seq(s) }), 20).list, names = [];
  walk(list, (op) => { if (typeof op.name === 'string') names.push(op.name); });
  assert.ok(names.includes('actor:sam') && !names.includes('actor:kit'));
  assert.throws(() => dialogueShot({ actor: SAM, other: false, lines: [[1, 'who?']] }), /who is alone/);
});

test('the round trip: the moon film\'s brief makes the beat sheet the film carries, and the film plays it', async () => {
  const src = readFileSync('films/moon.js', 'utf8'), sheet = readSheet(src);
  assert.ok(sheet && sheet.rows.length > 10, 'moon.js carries a beat sheet');
  const r = await script('films/moon.md', { out: join(tmpdir(), `hdf-moon-${process.pid}`, 'moon.js'), loadFilm });
  const block = src.split('\n').slice(sheet.start, sheet.end).join('\n');
  assert.equal(r.sheet, block, 'hdf script films/moon.md prints the sheet moon.js was built from');
  assert.deepEqual(sheetDiff(sheet.rows, await loadFilm('films/moon.js')), []);
  // The four chapters the brief names and every recipe it shows: the first chapter opens on the title the hand
  // writes (card: false), the other three on their cards.
  assert.deepEqual(rowsOf(r.film).map((x) => x.recipe).filter((x) => x !== '-'), ['AN', 'AO', 'AN', 'AP', 'AN', 'AS', 'AY', 'AN', 'AW', 'S']);
  assert.equal(r.film.audience, 'kids-7');
  // A sheet that no longer matches the film is found, row by row.
  const moved = sheet.rows.map((x, k) => (k === 3 ? { ...x, dur: x.dur + 1 } : x));
  assert.equal(sheetDiff(moved, r.film).length, 1);
  assert.equal(withSheet(src, block), src, 'putting the same sheet back changes nothing');
});

test('hdf script --check exits 0 on the moon', () => {
  assert.equal(hdf('script', '--check', 'films/moon.js').code, 0);
});

test('hdf script: --check exits 1 on a film whose sheet is stale; a new stub is written, an old film keeps its code', () => {
  assert.match(hdf('help', 'script').out, /^ {2}script {2}<brief\.md>/m);
  const dir = mkdtempSync(join(tmpdir(), 'hdf-script-cli-'));
  try {
    writeFileSync(join(dir, 'b.md'), 'look: paperInk\n- show: the sea\n- sign: the sea');
    const out = join(dir, 'b.js');
    assert.equal(hdf('script', join(dir, 'b.md'), '--out', out, '--dry').code, 0);
    assert.ok(!existsSync(out), '--dry writes nothing');
    assert.equal(hdf('script', join(dir, 'b.md'), '--out', out).code, 0);
    const edited = readFileSync(out, 'utf8').replace("shot('the sea', 2.5", "shot('the sea', 3");
    writeFileSync(out, `${edited}// the author's own line\n`);
    const r = hdf('script', '--check', out);
    assert.equal(r.code, 1);
    assert.match(r.out, /row 1: the sheet says the sea 0\.00 \+2\.50 - paperInk, the film plays the sea 0\.00 \+3\.00/);
    // Scripting again replaces the sheet only: the edit and the author's line stay. With no --out the film is
    // the b.js beside the brief (as films/moon.md scripts films/moon.js).
    const s = hdf('script', join(dir, 'b.md'));
    assert.equal(s.code, 0, s.out);
    assert.match(s.out, /b\.js exists: replaced its beat sheet only/);
    const again = readFileSync(out, 'utf8');
    assert.match(again, /shot\('the sea', 3/);
    assert.match(again, /the author's own line/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
