// 4.0 V2: word timing and captions. The estimate (the speech grid over the voiced part, pauses snapped to the
// silences), another tool's words laid onto the copy, the alignment stored on the sample's entry by
// `hdf align`, captions that letter the words as spoken and underline the one being said, a voiced say, and
// lint's caption-sync warning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { alignOf, alignSpan, checkAlign, checkFitted, clearAligns, estimateAlign, fitWords, packAlign, spokenOf, trimGhosts, unpackAlign, wordsOf } from '../core/align.js';
import { captions } from '../core/captions.js';
import { SR, setPcm, toWav16 } from '../core/synth.js';
import { decodeWav, voicedSpan } from '../core/wav.js';
import { register } from '../core/store.js';
import { film, seq, shot } from '../core/tree.js';
import { paper, meta, walk } from '../core/list.js';
import { signOff } from '../core/text.js';
import { lintAll } from '../core/lint.js';
import { fromStore, readCatalogue } from '../core/assets.js';
import { CAST } from '../recipes/doodle.js';

fromStore(['fox']);   // CAST.FOX is the store's fox

const ROOT = new URL('..', import.meta.url).pathname;
const hdf = (...args) => { const r = spawnSync(process.execPath, ['cli/hdf.mjs', ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, HDF_PYTHON: '/nonexistent/python' } }); return { code: r.status, out: r.stdout + r.stderr }; };

// Speech by hand: a tone per [t0, t1] span, silence elsewhere, `sec` long at the synth rate.
function spoken(spans, sec) {
  const x = new Float32Array(Math.round(sec * SR));
  for (const [a, b] of spans) for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) x[i] = 0.4 * Math.sin(2 * Math.PI * 180 * i / SR);
  return x;
}

test('wordsOf keeps punctuation on its word; fitWords lays a transcriber\'s words onto the copy', () => {
  assert.deepEqual(wordsOf(' Hello, there  moon.').map((w) => [w.text, w.from, w.to]), [['Hello,', 1, 7], ['there', 8, 13], ['moon.', 15, 20]]);
  // The tool spells differently, hears 'uh' where the copy says 'the' (it takes that time), and misses one.
  const A = fitWords('Hello, Ştefan: the moon is up.', [
    { text: 'hello', t0: 0.1, t1: 0.4 }, { text: 'stefan', t0: 0.5, t1: 0.9 }, { text: 'uh', t0: 0.95, t1: 1 },
    { text: 'moon', t0: 1.3, t1: 1.6 }, { text: 'is', t0: 1.7, t1: 1.8 }, { word: 'up', start: 1.9, end: 2.2 },
  ], 'whisper');
  // A copy word the tool missed shares the time between its neighbours.
  assert.deepEqual(fitWords('one two three', [{ text: 'one', t0: 0, t1: 0.2 }, { text: 'three', t0: 1, t1: 1.2 }]).words.map((w) => [w.t0, w.t1]), [[0, 0.2], [0.2, 1], [1, 1.2]]);
  assert.equal(A.by, 'whisper');
  assert.deepEqual(A.words.map((w) => w.text), ['Hello,', 'Ştefan:', 'the', 'moon', 'is', 'up.']);
  assert.deepEqual(A.words.map((w) => [w.t0, w.t1]), [[0.1, 0.4], [0.5, 0.9], [0.95, 1], [1.3, 1.6], [1.7, 1.8], [1.9, 2.2]]);
  // No copy: the tool's words are the copy.
  assert.equal(fitWords(null, [{ text: 'hi', t0: 0, t1: 0.2 }]).text, 'hi');
});

test('estimateAlign: the grid over the voiced part, each pause pinned to the silence it lands near', () => {
  // "One two three. Four five six." spoken as two phrases with a long silence between, off the linear grid.
  const x = spoken([[0.3, 1.2], [2.4, 3.3]], 4);
  const A = estimateAlign('One two three. Four five six.', x);
  assert.equal(A.by, 'estimate');
  const [one, , three, four, , six] = A.words;
  assert.ok(Math.abs(one.t0 - 0.3) < 0.03, `one at ${one.t0}`);
  assert.ok(Math.abs(three.t1 - 1.2) < 0.03, `three ends ${three.t1}`);
  assert.ok(Math.abs(four.t0 - 2.4) < 0.03, `four at ${four.t0}`);
  assert.ok(Math.abs(six.t1 - 3.3) < 0.03, `six ends ${six.t1}`);
  A.words.forEach((w, k) => { assert.ok(w.t1 >= w.t0); if (k) assert.ok(w.t0 >= A.words[k - 1].t0); });
  // A take that pauses where the copy does not is left on the linear stretch.
  const B = estimateAlign('one two three four', spoken([[0, 0.5], [2.5, 3]], 3));
  assert.equal(B.words[0].t0, 0);
  assert.equal(B.words[3].t1, 3);
});

test('the stored form round-trips and validates; alignOf prefers a stored alignment whose copy matches', () => {
  const A = fitWords('The moon.', [{ text: 'the', t0: 0.2, t1: 0.3 }, { text: 'moon', t0: 0.35, t1: 0.8 }], 'whisper');
  assert.deepEqual(checkAlign(packAlign(A)), []);
  assert.deepEqual(unpackAlign(packAlign(A)), A);
  assert.match(checkAlign({ text: 'a b', by: 'estimate', words: [['a', 0, 1]] }).join(), /1 of them, the copy has 2/);
  assert.match(checkAlign({ text: 'a', by: 'guess', words: [['a', 1, 0]] }).join(), /align.by.*align.words/s);

  clearAligns();
  setPcm('t-align', spoken([[0.5, 1.5]], 2));
  register({ 't-align': { name: 't-align', desc: 'The moon.', align: packAlign(A) } });
  // Same words, other punctuation and case: the stored timing, the copy's own spelling.
  const got = alignOf('t-align', { text: 'the MOON' });
  assert.equal(got.by, 'whisper');
  assert.deepEqual(got.words.map((w) => [w.text, w.t0]), [['the', 0.2], ['MOON', 0.35]]);
  assert.equal(alignOf('t-align').text, 'The moon.');
  // Another copy: the estimate over the wav.
  const est = alignOf('t-align', { text: 'Hello there' });
  assert.equal(est.by, 'estimate');
  assert.ok(Math.abs(est.words[0].t0 - 0.5) < 0.03 && Math.abs(est.words[1].t1 - 1.5) < 0.03);
  register({ 't-bare': { name: 't-bare' } });
  assert.throws(() => alignOf('t-bare'), /no copy to align/);
});

const ALIGN = { text: 'The moon does not make its own light.', by: 'json', words: [
  { text: 'The', t0: 0.2, t1: 0.35 }, { text: 'moon', t0: 0.4, t1: 0.8 }, { text: 'does', t0: 0.9, t1: 1.1 }, { text: 'not', t0: 1.2, t1: 1.5 },
  { text: 'make', t0: 1.6, t1: 1.9 }, { text: 'its', t0: 2.0, t1: 2.1 }, { text: 'own', t0: 2.2, t1: 2.5 }, { text: 'light.', t0: 2.6, t1: 3.0 },
] };

// The glyph strokes and underlines a captions group draws, with the underline's x span.
function drawn(g) {
  const out = { glyphs: 0, lines: [], under: [] };
  walk([g], (op) => {
    if (op.op === 'stroke' && /^g\d+\./.test(op.name ?? '')) out.glyphs++;
    if (op.op === 'stroke' && /^underline/.test(op.name ?? '')) { const p = op.path.sub[0].pts; out.under.push({ k: +op.name.slice(9), x0: p[0], x1: p[p.length - 2] }); }
    if (op.op === 'group' && /^text:/.test(op.name ?? '')) out.lines.push(op.name.slice(5));
  });
  return out;
}

test('captions letter the words as spoken, underline the one being said, page by page', () => {
  const C = captions(ALIGN, { t0: 1, size: 60, lines: 1, box: [40, 900, 600, 120], hold: 0.5 });
  assert.equal(C.draw(1.1), null);                      // before the first word
  assert.equal(C.until, 1 + 3.0 + 0.5);
  assert.equal(C.draw(4.6), null);                      // after the hold
  // At 1.5 s (0.5 s into the recording) 'The' and 'moon' are said, 'moon' is being said.
  const a = drawn(C.draw(1.5));
  assert.equal(C.current(1.5), 1);
  assert.deepEqual(a.under.map((u) => u.k), [1]);
  // Later on the same page: more glyphs, the underline moved right onto 'not'.
  const b = drawn(C.draw(2.4));
  assert.ok(b.glyphs > a.glyphs);
  assert.deepEqual(b.under.map((u) => u.k), [3]);
  assert.ok(b.under[0].x0 > a.under[0].x1);
  // After the last word, past the grace, still on screen: nothing underlined.
  assert.equal(C.current(1 + 3.2), -1);
  assert.deepEqual(drawn(C.draw(1 + 3.2)).under, []);
  // One line per page in a 600 box: the copy runs over pages, each opening where the last ended.
  const pages = new Set();
  for (let t = 1.2; t < 4; t += 1 / 12) { const d = drawn(C.draw(t)); if (d.lines.length) pages.add(d.lines[0]); }
  const all = [...pages].map((l) => l.split(' ')).flat();
  assert.ok(pages.size > 1, [...pages].join(' | '));
  assert.deepEqual([...new Set(all)].join(' '), ALIGN.text);
  // reveal 'page' letters the whole page at once.
  const P = captions(ALIGN, { t0: 1, size: 60, lines: 3, reveal: 'page' });
  assert.equal(drawn(P.draw(1.25)).glyphs, drawn(P.draw(3.9)).glyphs);
  assert.throws(() => captions(ALIGN, { reveal: 'fade' }), /reveal 'fade'/);
});

test('a voiced say: letters, syllables and mouth from the alignment, its events the voice', () => {
  clearAligns();
  setPcm('t-say', spoken([[0.2, 3.0]], 3.2));
  register({ 't-say': { name: 't-say', align: packAlign(ALIGN) } });
  const L = CAST.FOX.say(null, 2, { voice: 't-say' });
  assert.equal(L.text, ALIGN.text);
  assert.equal(L.end, 2 + 3.0);
  assert.equal(L.syllables[0].t, 2.2);                  // 'The' starts 0.2 s into the recording
  assert.equal(L.mouth(1.9), null);
  assert.equal(L.mouth(2.1), 0);                        // leading silence: shut
  assert.notEqual(L.mouth(2 + 0.45), null);
  assert.deepEqual(L.events(10), [{ t: 12, type: 'voice', id: 't-say', gain: 1 }]);
  const sp = spokenOf(unpackAlign(packAlign(ALIGN)), 0);
  assert.ok(sp.letters.every((u, j) => !j || u >= sp.letters[j - 1] - 1e-9));
  // A line without a voice is timed and scored as before.
  const plain = CAST.FOX.say('hello there', 1.25);
  assert.equal(plain.voice, undefined);
  assert.ok(plain.events(0).every((e) => e.type !== 'voice'));
});

test('lint: captions are not the shot\'s words; an estimate over 3 s warns caption-sync', () => {
  clearAligns();
  setPcm('t-lint', spoken([[0.2, 4.5]], 5));
  register({ 't-lint': { name: 't-lint', desc: 'The moon does not make its own light at all, you see.' } });
  const make = (src) => {
    const C = captions(src, { t0: 0.25 });
    const a = shot('a', 5, ({ t, W, H }) => [paper(), meta('anchor', { name: 'strip' }), C.draw(t, { W, H })]);
    const z = shot('z', 2, () => [paper(), meta('anchor', { name: 'signOff' }), signOff('a', 'b')]);
    return film({ name: 'caps', look: 'paperInk', timeline: seq(a, z) });
  };
  const est = lintAll(make('t-lint'));
  assert.deepEqual(est.findings.filter((f) => f.rule === 'words'), []);
  const w = est.warnings.filter((f) => f.rule === 'caption-sync');
  assert.equal(w.length, 1);
  assert.match(w[0].detail, /'t-lint'.*estimate.*hdf align t-lint/);
  assert.ok(w[0].warn);
  // Timed by a tool: no warning.
  assert.deepEqual(lintAll(make(ALIGN)).warnings.filter((f) => f.rule === 'caption-sync'), []);
});

test('hdf align: --json and --estimate store on the entry, --show reads, no transcriber falls back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-align-'));
  try {
    const wav = join(dir, 'line.wav');
    writeFileSync(wav, toWav16(spoken([[0.3, 1.2], [1.6, 2.4]], 2.6)));
    let r = hdf('import', wav, '--kind', 'sample', '--name', 'line', '--licence', 'own', '--root', dir, '--desc', 'Hello there. Moon rise.');
    assert.equal(r.code, 0, r.out);
    r = hdf('align', 'line', '--root', dir);   // HDF_PYTHON points nowhere: the estimate, said so
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /no transcriber.*storing the estimate/s);
    let e = readCatalogue(dir).entry('line');
    assert.equal(e.align.by, 'estimate');
    assert.equal(e.align.words.length, 4);
    const json = join(dir, 'words.json');
    writeFileSync(json, JSON.stringify({ words: [{ text: 'hello', t0: 0.3, t1: 0.7 }, { text: 'there', t0: 0.75, t1: 1.2 }, { text: 'moon', t0: 1.6, t1: 1.9 }, { text: 'rise', t0: 2, t1: 2.4 }] }));
    r = hdf('align', 'line', '--root', dir, '--json', json);
    assert.equal(r.code, 0, r.out);
    e = readCatalogue(dir).entry('line');
    assert.deepEqual(e.align, { text: 'Hello there. Moon rise.', by: 'json', words: [['Hello', 0.3, 0.7], ['there.', 0.75, 1.2], ['Moon', 1.6, 1.9], ['rise.', 2, 2.4]] });
    r = hdf('align', 'line', '--root', dir, '--show');
    assert.match(r.out, /0\.750 +1\.200 +there\./);
    assert.match(r.out, /4 words over 2\.10 s, by json/);
    assert.notEqual(hdf('align', 'nope', '--root', dir).code, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('RE-6: whisper\'s ghost words (the prompt repeated at the end) are trimmed, and a fit on them throws', () => {
  const G = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/whisper-ghosts.json'), 'utf8'));
  const st = readCatalogue(join(ROOT, 'assets')), x = decodeWav(readFileSync(st.payloadPath(st.entry(G.id))));
  const dur = x.length / SR, voiced = voicedSpan(x);
  assert.equal(G.words.length, 64);
  // As it was: the copy fits the ghosts, every word at 9.02 s, 0.20 s in all. That is refused now.
  const raw = fitWords(G.text, G.words, 'whisper');
  assert.ok(alignSpan(raw) < 0.3, `span ${alignSpan(raw)}`);
  assert.throws(() => checkFitted(raw, voiced), /covers only 0\.\d\d s of 8\.90 s voiced.*--json.*--prompt/);
  // Trimmed: the zero-length run at the file's end goes; the few ghosts left before it lose to the real words.
  const heard = trimGhosts(G.words, { dur, voiced });
  assert.ok(heard.length < 40 && heard.length >= 32, `${heard.length} left`);
  const A = fitWords(G.text, heard, 'whisper');
  assert.equal(A.words.length, 32);
  checkFitted(A, voiced);
  assert.ok(alignSpan(A) > 8.5, `span ${alignSpan(A)}`);
  assert.deepEqual([A.words[0].t0, A.words[31].text, A.words[31].t0], [0, 'half.', 8.46]);
  // A word starting 0.3 s past the voiced end goes too, wherever it sits.
  assert.deepEqual(trimGhosts([{ text: 'a', t0: 0, t1: 1 }, { text: 'b', t0: 1.5, t1: 1.6 }, { text: 'c', t0: 1, t1: 1.2 }], { dur: 5, voiced: [0, 1.1] }).map((w) => w.text), ['a', 'c']);
});

test('hdf align: ghost words in --json are trimmed; only ghosts, or a fit covering under half the voiced span, is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-ghost-'));
  try {
    const wav = join(dir, 'line.wav');
    writeFileSync(wav, toWav16(spoken([[0.3, 1.2], [1.6, 2.4]], 2.6)));
    assert.equal(hdf('import', wav, '--kind', 'sample', '--name', 'line', '--licence', 'own', '--root', dir, '--desc', 'Hello there. Moon rise.').code, 0);
    const json = join(dir, 'words.json'), ghosts = ['hello', 'there', 'moon', 'rise'].map((text) => ({ text, t0: 2.58, t1: 2.58 }));
    writeFileSync(json, JSON.stringify([{ text: 'hello', t0: 0.3, t1: 0.7 }, { text: 'there', t0: 0.75, t1: 1.2 }, { text: 'moon', t0: 1.6, t1: 1.9 }, { text: 'rise', t0: 2, t1: 2.4 }, ...ghosts]));
    let r = hdf('align', 'line', '--root', dir, '--json', json);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /4 words over 2\.10 s, by json/);
    writeFileSync(json, JSON.stringify(ghosts));
    r = hdf('align', 'line', '--root', dir, '--json', json);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /all 4 of the tool's words are ghosts/);
    // A transcriber that prints ghosts is refused the same way (a fake python standing in for cli/align.py).
    const py = join(dir, 'python');
    writeFileSync(py, `#!/bin/sh\ncase "$*" in *--prompt*) exit 9;; esac\necho '${JSON.stringify([{ text: 'hello', t0: 1, t1: 1.1 }, { text: 'there', t0: 1.1, t1: 1.2 }])}'\n`);
    chmodSync(py, 0o755);
    const run = (...a) => { const q = spawnSync(process.execPath, ['cli/hdf.mjs', 'align', 'line', '--root', dir, ...a], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, HDF_PYTHON: py } }); return { code: q.status, out: q.stdout + q.stderr }; };
    r = run();
    assert.notEqual(r.code, 0);
    assert.match(r.out, /covers only 0\.\d\d s of 2\.10 s voiced/);
    // The copy is not whisper's prompt unless asked (the fake fails when it gets one).
    assert.match(run('--prompt').out, /cli\/align\.py failed \(9\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('films/narrated.js: the stored alignment is a transcriber\'s, and the underline follows it', async () => {
  const e = readCatalogue(join(ROOT, 'assets')).entry('moon-para');
  assert.equal(e.align.by, 'whisper');
  const { CAPS, VOICE_AT } = await import('../films/narrated.js');
  const words = CAPS.words;
  assert.equal(words.length, 66);
  // At the middle of each word, that word is the one underlined.
  for (const [k, w] of words.entries()) assert.equal(CAPS.current(VOICE_AT + (w.t0 + w.t1) / 2), k, w.text);
});
