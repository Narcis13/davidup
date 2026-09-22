// 4.0 D4: cues both ways. Marks from outside (core/cuemarks.js), read from a davidup composition or a cue file,
// cut a film (films/on-beat.js); `hdf cues` writes a film's cues for davidup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atMark, marks, marksNamed, marksOf, onGrid, setMarks, trackMarkerTimes } from '../core/cuemarks.js';
import { cues, excerpt, localCues } from '../core/tree.js';
import { scoreEvents } from '../core/synth.js';
import { loadFilm } from '../cli/load.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const hdf = (...args) => spawnSync(process.execPath, ['cli/hdf.mjs', ...args], { cwd: ROOT, encoding: 'utf8' });
const tmp = () => mkdtempSync(join(tmpdir(), 'hdf-cues-'));

// A composition: 128 bpm beat markers on a 20 s music track, a drop on beat 12, the film's item two beats in.
const BEAT = 60 / 128;
const composition = (o = {}) => ({
  version: '0.1',
  composition: { width: 640, height: 640, fps: 30, duration: 14, background: '#fff', markers: [{ t: 2, name: 'intro' }, { t: 3, name: 'ch', source: 'hdf:film' }] },
  assets: [{ id: 'music', type: 'audio', src: 'music.wav', duration: 20 }],
  layers: [{ id: 'l', z: 0, opacity: 1, blendMode: 'normal', items: ['film', 'logo'] }],
  items: {
    film: { type: 'video', asset: 'clip', width: 640, height: 640, start: 2 * BEAT, ...o.film },
    logo: { type: 'shape', kind: 'rect', width: 10, height: 10, enter: 5, exit: 9 },
  },
  tweens: [],
  audio: [{ id: 'music', asset: 'music', start: 0, markers: [...Array.from({ length: 40 }, (_, k) => ({ t: k * BEAT, name: 'beat' })), { t: 12 * BEAT, name: 'drop' }], ...o.track }],
});

test('atMark and marksNamed: the marks set, on the grid, or the fallback', () => {
  const prev = setMarks([{ t: 1.03, name: 'drop' }, { t: 0.5, name: 'beat' }, { t: 1, name: 'beat', from: 'audio:x' }, { t: -1, name: 'beat' }]);
  try {
    assert.deepEqual(marks().map((m) => m.t), [-1, 0.5, 1, 1.03]);
    assert.equal(atMark('drop'), onGrid(1.03));
    assert.equal(atMark('drop'), 1);
    assert.equal(atMark('drop', { snap: false }), 1.03);
    assert.equal(atMark('beat', { nth: 1 }), 1);
    assert.equal(atMark('beat', { from: 'audio:x' }), 1);
    assert.deepEqual(marksNamed('beat'), [0.5, 1]);   // before the film's start: dropped
    assert.equal(atMark('nope', { or: 2.04 }), 2);
    assert.deepEqual(marksNamed('nope', { or: [0.51] }), [0.5]);
    assert.throws(() => atMark('nope'), /no mark 'nope' \(have: beat x3, drop\)/);
    assert.throws(() => setMarks([{ t: 'x', name: 'a' }]), /not \{ t, name \}/);
  } finally { setMarks(prev); }
});

test('marksOf a davidup composition: markers, beats, starts and ends, in the item\'s seconds', () => {
  const m = marksOf(composition(), { at: 'film' });
  const named = (n) => m.filter((x) => x.name === n).map((x) => x.t);
  assert.equal(named('beat')[0], 0);                         // beat 2 is the film's first frame
  assert.equal(named('beat').length, 38);
  assert.deepEqual(named('drop'), [+(10 * BEAT).toFixed(6)]);
  assert.deepEqual(named('intro'), [+(2 - 2 * BEAT).toFixed(6)]);
  assert.equal(m.find((x) => x.name === 'ch').from, 'hdf:film');
  assert.deepEqual(named('film.start'), [0]);
  assert.deepEqual(named('logo.start'), [+(5 - 2 * BEAT).toFixed(6)]);
  assert.deepEqual(named('logo.end'), [+(9 - 2 * BEAT).toFixed(6)]);
  assert.deepEqual(named('music.end'), [+(20 - 2 * BEAT).toFixed(6)]);
  assert.deepEqual(named('composition.end'), [+(14 - 2 * BEAT).toFixed(6)]);
  assert.ok(m.every((x, i) => i === 0 || m[i - 1].t <= x.t));
  // No --at: composition seconds. A number: those seconds are the film's 0. A video's trimIn moves its 0 back.
  assert.equal(marksOf(composition()).find((x) => x.name === 'drop').t, +(12 * BEAT).toFixed(6));
  assert.equal(marksOf(composition(), { at: 12 * BEAT }).find((x) => x.name === 'drop').t, 0);
  assert.equal(marksOf(composition({ film: { trimIn: 1 } }), { at: 'film' }).find((x) => x.name === 'drop').t, +(10 * BEAT + 1).toFixed(6));
  assert.throws(() => marksOf(composition(), { at: 'nope' }), /no item 'nope'/);
});

test('marksOf follows a track\'s trimIn and loop like davidup', () => {
  const m = marksOf(composition({ track: { trimIn: 4 * BEAT, loop: true, start: 1 }, film: { start: 0 } }), { at: 'film' });
  const drops = m.filter((x) => x.name === 'drop').map((x) => x.t);
  const period = 20 - 4 * BEAT;
  assert.deepEqual(drops, [+(1 + 8 * BEAT).toFixed(6)]);   // the next loop starts past the composition end
  assert.ok(period > 14);
  assert.deepEqual(trackMarkerTimes({ start: 0, loop: true, markers: [{ t: 1, name: 'x' }] }, { assetDuration: 4, compositionDuration: 10 }), [[1, 5, 9]]);
  assert.deepEqual(trackMarkerTimes({ start: 1, trimIn: 1.5, markers: [{ t: 1, name: 'a' }, { t: 2, name: 'b' }] }, { assetDuration: 4 }), [[], [1.5]]);
});

test('marksOf a cue file and a plain list', () => {
  const file = { kind: 'hdf-cues', film: 'x', end: 5, cuts: [2], shots: [{ name: 'a', t0: 0, dur: 2 }, { name: 'b', t0: 2, dur: 3 }], chapters: [{ n: 1, title: 'one', t0: 0, dur: 5 }], notes: [{ t: 1 }], words: [{ text: 'hi', t0: 1.5, t1: 1.8 }] };
  const m = marksOf(file);
  assert.deepEqual(m.map((x) => x.name), ['shot:a', 'chapter', 'chapter:one', 'note', 'word', 'cut', 'shot:b', 'end']);
  assert.ok(m.every((x) => x.from === 'cues:x'));
  assert.deepEqual(marksOf(file, { at: 2 }).map((x) => x.name)[0], 'cut');
  assert.deepEqual(marksOf({ marks: [{ t: 1, name: 'a' }] }), [{ t: 1, name: 'a', from: 'given' }]);
  assert.throws(() => marksOf({ nope: 1 }), /expected a davidup composition/);
});

test('on-beat cuts on the composition\'s bars and turns on its drop; cues and the score carry the marks', async () => {
  const m = marksOf(composition(), { at: 'film' });
  const f = await loadFilm(join(ROOT, 'films/on-beat.js'), { marks: m });
  try {
    const c = cues(f), beats = m.filter((x) => x.name === 'beat').map((x) => x.t), drop = m.find((x) => x.name === 'drop').t;
    assert.equal(c.marks.length, m.length);
    // Every cut within half a drawn frame of a beat; the chapter 2 cut on the drop.
    for (const t of c.cuts) assert.ok(beats.some((b) => Math.abs(b - t) <= 1 / 24 + 1e-9), `cut ${t} is on no beat`);
    assert.deepEqual(c.cuts.slice(0, 2), [onGrid(4 * BEAT), onGrid(8 * BEAT)]);
    assert.equal(c.chapters[1].t0, onGrid(drop));
    // The score reads cues.marks: a tada at the drop's own time (not on the grid).
    const s = scoreEvents(f);
    assert.ok(s.events.some((e) => Math.abs(e.t - drop) < 1e-9));
    // An excerpt's cues shift the marks into its own time.
    const ex = excerpt(f, 24, 24), lc = localCues(ex);
    assert.ok(lc.marks.every((x) => x.t >= 0 && x.t < 2));
    assert.equal(lc.marks.length, m.filter((x) => x.t >= 2 && x.t < 4).length);
    // Loaded again with no marks it is its own fallback film again (a fresh module per set of marks).
    const g = await loadFilm(join(ROOT, 'films/on-beat.js'), { marks: [] });
    assert.deepEqual(cues(g).cuts, [29 / 12, 58 / 12]);
  } finally { setMarks([]); }
});

test('hdf cues writes the film\'s cues; --cues-from cuts it to a composition', () => {
  const dir = tmp(), comp = join(dir, 'composition.json');
  writeFileSync(comp, JSON.stringify(composition()));
  const r = hdf('cues', 'films/on-beat.js', '--out', join(dir, 'plain.json'));
  assert.equal(r.status, 0, r.stderr);
  const plain = JSON.parse(readFileSync(join(dir, 'plain.json'), 'utf8'));
  assert.equal(plain.kind, 'hdf-cues');
  assert.equal(plain.film, 'on-beat');
  assert.equal(plain.fps, 12);
  assert.deepEqual(Object.keys(plain), ['kind', 'version', 'film', 'look', 'fps', 'end', 'shots', 'cuts', 'chapters', 'notes', 'words', 'marks']);
  assert.deepEqual(plain.chapters.map((c) => c.title), ['count in', 'the drop']);
  assert.deepEqual(plain.marks, []);
  assert.ok(plain.notes.length > 0);

  const s = hdf('cues', 'films/on-beat.js', '--cues-from', comp, '--at', 'film', '--out', dir);
  assert.equal(s.status, 0, s.stderr);
  const cut = JSON.parse(readFileSync(join(dir, 'on-beat-cues.json'), 'utf8'));
  assert.equal(cut.chapters[1].t0, +onGrid(10 * BEAT).toFixed(6));
  assert.ok(cut.marks.length > 40);
  assert.notDeepEqual(cut.cuts, plain.cuts);

  const bad = hdf('cues', 'films/on-beat.js', '--cues-from', comp, '--at', 'nope');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /no item 'nope'/);
});

test('narration becomes words in the cue file', () => {
  const dir = tmp(), r = hdf('cues', 'films/narrated.js', '--out', join(dir, 'n.json'));
  assert.equal(r.status, 0, r.stderr);
  const c = JSON.parse(readFileSync(join(dir, 'n.json'), 'utf8'));
  assert.ok(c.words.length > 50);
  assert.deepEqual(Object.keys(c.words[0]), ['text', 't0', 't1', 'voice']);
  assert.ok(c.words.every((w, i) => w.t1 >= w.t0 && (i === 0 || c.words[i - 1].t0 <= w.t0)));
});
