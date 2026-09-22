// 4.0 E1: chapters. chapter(title, ...nodes) is a seq with a title card and a hold that carries its title;
// chapters(film) finds them, an excerpt is a chapter as a film of its own (frames and sound the whole film's),
// and the board, grid, render and lint take a film a chapter at a time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { FPS, film, par, seq, shot, paper, meta, fill, circle } from '../core/index.js';
import { hashList } from '../core/list.js';
import { chapterReport, formatChapter, lintAll, warnLength } from '../core/lint.js';
import { filmAudio } from '../core/synth.js';
import { chapterAt, chapterFilm, chapterSeq, chapters, cues, describe, excerpt, frame, localCues } from '../core/tree.js';
import { AUDIENCES, chapter, signOffShot, titleCard } from '../recipes/shots.js';

const hdf = (...argv) => { const r = spawnSync(process.execPath, ['cli/hdf.mjs', ...argv], { encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };
const dot = (name, dur, x = 540) => shot(name, dur, ({ t }) => [paper(), fill(circle(x + 100 * t, 540, 60), 'ink', { name: 'dot' }), meta('anchor', { name: 'dot' })]);
const titleCardOf = (title) => titleCard({ name: `own: ${title}`, title });
const make = (timeline, o = {}) => film({ name: 'ch', look: 'paperInk', timeline, ...o });

test('chapterSeq: a seq with its card first and a hold last, that draws what the plain seq draws', () => {
  const a = dot('a', 1), b = dot('b', 1.5), card = dot('card', 0.5, 200);
  const c = chapterSeq('one', [a, b], { card, hold: 0.5 });
  assert.equal(c.kind, 'seq');
  assert.deepEqual(c.chapter, { title: 'one', card: 'card', hold: 0.5 });
  assert.deepEqual(c.kids.map((k) => k.kind), ['shot', 'shot', 'shot', 'hold']);
  assert.equal(c.n, (0.5 + 1 + 1.5 + 0.5) * FPS);
  const plain = make(seq(card, a, b, dot('b', 1.5))), marked = make(seq(c));
  for (let i = 0; i < c.n - 6; i++) assert.equal(hashList(frame(marked, i).list), hashList(frame(plain, i).list));
  assert.equal(chapterSeq('bare', [a]).kids.length, 1);
  assert.throws(() => chapterSeq('', [a]), /needs a title/);
  assert.throws(() => chapterSeq('outer', [seq(a, chapterSeq('inner', [b]))]), /do not nest \('inner'/);
});

test('chapters(film): each chapter where it plays, numbered from 1; none in a film without them', () => {
  const one = chapterSeq('one', [dot('a', 1)]), two = chapterSeq('two', [dot('b', 2)]);
  const f = make(seq(dot('intro', 0.5), one, two, dot('end', 1)));
  const got = chapters(f).map(({ n, title, f0, frames, t0, dur }) => ({ n, title, f0, frames, t0, dur }));
  assert.deepEqual(got, [
    { n: 1, title: 'one', f0: 6, frames: 12, t0: 0.5, dur: 1 },
    { n: 2, title: 'two', f0: 18, frames: 24, t0: 1.5, dur: 2 },
  ]);
  assert.equal(chapterAt(f, 0), null);
  assert.equal(chapterAt(f, 17).title, 'one');
  assert.equal(chapterAt(f, 18).title, 'two');
  assert.equal(chapterAt(f, 42), null);
  assert.deepEqual(chapters(make(seq(dot('a', 1)))), []);
  // Inside a par, a chapter starts where the par does.
  assert.equal(chapters(make(par(dot('bg', 3), seq(dot('x', 1), two))))[0].f0, 12);
  assert.deepEqual(cues(f).chapters, [{ n: 1, title: 'one', t0: 0.5, dur: 1 }, { n: 2, title: 'two', t0: 1.5, dur: 2 }]);
  assert.match(describe(f), /seq {3}2\.00s {2}24f {2}\[1\.50-3\.50\] {2}chapter 2 'two'/);
});

test('an excerpt draws the whole film\'s frames, its cues shifted into it; chapterFilm names the chapter', () => {
  const f = make(seq(dot('intro', 0.5), chapterSeq('one', [dot('a', 1)]), chapterSeq('two', [dot('b', 1), dot('c', 1)]), dot('end', 1)));
  const e = chapterFilm(f, 2);
  assert.equal(e.n, 24);
  assert.equal(e.from, 18);
  assert.equal(e.whole, f);
  assert.equal(e.chapter.title, 'two');
  for (let j = 0; j < e.n; j++) assert.equal(hashList(frame(e, j).list), hashList(frame(f, 18 + j).list));
  assert.equal(frame(e, 0).shot, 'b');
  assert.throws(() => frame(e, 24), /outside 0\.\.23/);
  const lc = localCues(e);
  assert.deepEqual(lc.shots.map((s) => [s.name, s.t0]), [['b', 0], ['c', 1]]);
  assert.deepEqual(lc.cuts, [1]);
  assert.equal(lc.end, 2);
  assert.deepEqual(cues(e), cues(f));   // the score is the whole film's
  // An excerpt of an excerpt is still the whole film's.
  const ee = excerpt(e, 12, 6);
  assert.equal(ee.from, 30);
  assert.equal(ee.whole, f);
  assert.throws(() => chapterFilm(f, 3), /chapters 1\.\.2, not 3/);
  assert.throws(() => chapterFilm(make(seq(dot('a', 1))), 1), /no chapters/);
  assert.throws(() => excerpt(f, 50, 12), /outside/);
});

test("an excerpt's sound is its stretch of the whole score, the events shifted into it", () => {
  const score = ({ chapters: cs }) => cs.map((c) => ({ t: c.t0 + 0.25, dur: 0.5, hz: 440, type: 'sine' }));
  const f = make(seq(chapterSeq('one', [dot('a', 1)]), chapterSeq('two', [dot('b', 1)])), { score });
  const whole = filmAudio(f), e = filmAudio(chapterFilm(f, 2));
  assert.equal(e.samples.length, 44100);
  assert.deepEqual([...e.samples], [...whole.samples.slice(44100, 88200)]);
  assert.deepEqual(e.events.map((x) => x.t), [0.25]);
});

test('chapter(): titleCard first, named by the title; the hold from the audience; card and hold overridable', () => {
  const body = dot('body', 2);
  const c = chapter('the moon', body);
  assert.equal(c.chapter.title, 'the moon');
  assert.equal(c.kids[0].name, 'card: the moon');
  assert.equal(c.kids[0].recipe, 'AN');
  assert.equal(c.chapter.hold, 0.5);
  const k = chapter({ title: 'phases', audience: 'kids-9', sub: 'part two' }, body);
  assert.equal(k.chapter.hold, Math.max(AUDIENCES['kids-9'].dwell, AUDIENCES['kids-9'].cutFloor));
  assert.ok(k.kids[0].dur > c.kids[0].dur, 'a card for kids-9 with a sub takes longer');
  assert.deepEqual(chapter({ title: 'plain', card: false, hold: 0 }, body).kids, [body]);
  const own = dot('own', 1);
  assert.equal(chapter({ title: 'mine', card: own }, body).kids[0], own);
  assert.throws(() => chapter({}, body), /needs a title/);
});

test('lint: a line per chapter (shots, cuts with holds not counted, recipes, findings); length warnings', () => {
  const f = make(seq(chapter('one', dot('a', 1), dot('b', 1)), chapter('two', dot('c', 2)), signOffShot({ name: 'sign' })));
  const { findings, warnings } = lintAll(f);
  assert.deepEqual(findings, []);
  assert.deepEqual(warnings, []);
  // The title cards' words are their own allowance: paperInk allows none, the same words in a shot fail.
  const plain = make(seq(chapter({ title: 'one', card: titleCardOf('one') }, dot('a', 1)), signOffShot({ name: 'sign' })));
  assert.deepEqual(lintAll(plain).findings, []);
  assert.deepEqual(lintAll(make(seq(titleCardOf('one'), signOffShot({ name: 'sign' })))).findings.map((x) => x.rule), ['words']);
  const r = chapterReport(f, findings);
  assert.deepEqual(r.map((x) => [x.n, x.shots, x.cuts, x.recipes.join(' '), x.findings]), [[1, 3, 2, 'AN', 0], [2, 2, 1, 'AN', 0]]);
  assert.match(formatChapter(r[0]), /^chapter 1 'one' {2}0\.00-\d+\.\d\ds {2}\d+\.\d\ds {2}3 shots {2}2 cuts {2}AN {2}lint clean$/);
  assert.equal(formatChapter({ ...r[1], findings: 2 }).split('  ').at(-1), '2 findings');
  // A finding on a chapter's frame counts for that chapter.
  assert.equal(chapterReport(f, [{ frame: r[1].f0 + 1 }])[1].findings, 1);
  const long = (dur) => dot('long', dur);
  assert.match(warnLength(make(seq(long(41)))).map((w) => w.detail).join(), /in no chapters/);
  assert.match(warnLength(make(seq(chapterSeq('big', [long(41)])))).map((w) => w.detail).join(), /chapter 1 'big' runs 41\.00 s/);
  assert.match(warnLength(make(seq(...Array.from({ length: 5 }, (_, j) => chapterSeq(`c${j}`, [long(37)]))))).map((w) => w.detail).join(), /runs 185\.00 s \(at most 180 s\)/);
  assert.deepEqual(warnLength(make(seq(long(40)))), []);
});

test('hdf: board gives a card per chapter, grid and render take --chapter, a missing chapter is a usage error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-chapters-'));
  try {
    const b = hdf('board', 'films/chapters.js', '--out', dir);
    assert.equal(b.code, 0, b.out);
    assert.equal(b.out.match(/^chapter \d '/gm).length, 3);
    assert.ok(existsSync(join(dir, 'chapters-board.jpg')));
    assert.equal(hdf('board', 'films/chapters.js', '--chapter', '2', '--out', dir).code, 0);
    assert.ok(existsSync(join(dir, 'chapters-board-ch2.jpg')));
    const g = hdf('grid', 'films/chapters.js', '--chapter', '3', '--n', '4', '--width', '120', '--out', dir);
    assert.equal(g.code, 0, g.out);
    assert.ok(existsSync(join(dir, 'chapters-ch3-grid.jpg')));
    const r = hdf('render', 'films/chapters.js', '--chapter', '2', '--frames', '6', '--width', '240', '--out', dir);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /chapters-ch2-6f\.mp4 {2}6 frames {2}chapter 2 'counting' from \d+\.\d\ds/);
    assert.ok(existsSync(join(dir, 'chapters-ch2-6f-final.mp4')));
    assert.equal(JSON.parse(readFileSync(join(dir, 'chapters-ch2-6f.hashes.json'), 'utf8')).frames.length, 6);
    const l = hdf('lint', 'films/chapters.js');
    assert.equal(l.code, 0, l.out);
    assert.match(l.out, /^chapter 3 'more or less' .* lint clean$/m);
    for (const cmd of ['render', 'grid']) {
      const bad = hdf(cmd, 'films/chapters.js', '--chapter', '4', '--out', dir);
      assert.equal(bad.code, 2, bad.out);
      assert.match(bad.out, /--chapter: film chapters has chapters 1\.\.3, not 4/);
    }
    assert.equal(hdf('render', 'films/mini.js', '--chapter', '1', '--out', dir).code, 2);
    assert.equal(hdf('board', 'films/mini.js', '--chapter', '1', '--out', dir).code, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
