// 4.0 V3: lip sync from audio. The energy track (the voice band a frame, dips shut, levels open), a tool's
// cues on the grid, letters onto a puppet's mouths, a voiced say and actor.mouth following the recording, the
// track stored on the sample by `hdf align --mouth`, and the fox closing its mouth on the "th" of a recorded
// "Hello there!".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkMouth, clearMouths, cuesMouth, energyMouth, mouthAt, mouthFrom, mouthIndex } from '../core/mouth.js';
import { clearAligns, packAlign } from '../core/align.js';
import { SR, pcmOf, setPcm, toWav16 } from '../core/synth.js';
import { register } from '../core/store.js';
import { fromStore, readCatalogue } from '../core/assets.js';
import { actorOf, puppet, stickSource } from '../core/index.js';
import { CAST } from '../recipes/doodle.js';

fromStore(['fox', 'hello-there']);

const ROOT = new URL('..', import.meta.url).pathname;
const hdf = (env, ...args) => { const r = spawnSync(process.execPath, ['cli/hdf.mjs', ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } }); return { code: r.status, out: r.stdout + r.stderr }; };

// A vowel-ish tone (a 300 Hz carrier, in the voice band) at amplitude amp over each [t0, t1], silence elsewhere.
function voiced(spans, sec) {
  const x = new Float32Array(Math.round(sec * SR));
  for (const [a, b, amp = 0.4] of spans) for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) x[i] = amp * Math.sin(2 * Math.PI * 300 * i / SR);
  return x;
}

test('energyMouth: silence rests, a dip inside a phrase shuts, the level opens', () => {
  const F = 1 / 12;
  // Loud 0.25..1.0 s with a 40 ms gap at 0.6 s (a consonant), a quiet tail to 1.25 s, silence after.
  const x = voiced([[3 * F, 0.6], [0.64, 12 * F], [12 * F, 15 * F, 0.12]], 2);
  const { by, shapes } = energyMouth(x);
  assert.equal(by, 'energy');
  assert.equal(shapes.length, 24);
  assert.equal(shapes.slice(0, 3), 'XXX');
  assert.equal(shapes[7], 'A', shapes);                // the gap at 0.6 s is frame 7
  assert.match(shapes.slice(4, 7), /^D+$/);
  assert.match(shapes.slice(12, 15), /^B+$/, shapes);   // the quiet tail
  assert.match(shapes.slice(16), /^X+$/);
  // Scaled by the loud part: the same line at a tenth of the level makes the same track.
  assert.equal(energyMouth(x.map((v) => v / 10)).shapes, shapes);
  assert.match(energyMouth(new Float32Array(SR)).shapes, /^X{12}$/);
});

test('cuesMouth: the cue covering most of a frame, a short shut wins its frame, bad letters refused', () => {
  const M = cuesMouth({ mouthCues: [
    { start: 0, end: 0.1, value: 'X' }, { start: 0.1, end: 0.3, value: 'D' }, { start: 0.3, end: 0.33, value: 'A' },
    { start: 0.33, end: 0.5, value: 'f' }, { start: 0.5, end: 0.6, value: 'X' },
  ] }, 0.6, 'rhubarb');
  assert.equal(M.by, 'rhubarb');
  assert.equal(M.shapes, 'XDDAFFXX');                // frame 3: 30 ms of shut in 0.25..0.33 wins it
  assert.throws(() => cuesMouth([{ start: 0, end: 0.1, value: 'Q' }], 1), /cue 'Q'/);
  assert.throws(() => cuesMouth([{ start: 0.2, end: 0.1, value: 'A' }], 1), /start <= end/);
  assert.deepEqual(checkMouth({ by: 'rhubarb', shapes: 'XABCDEFGH' }), []);
  assert.equal(checkMouth({ by: 'guess', shapes: 'xz' }).length, 2);
});

test('mouthIndex: the fox shuts on clenched teeth, the stick has its oo, eight draw the set', () => {
  assert.deepEqual([...'ABCDEFGHX'].map((s) => mouthIndex(s, 4)), [0, 0, 2, 2, 1, 1, 0, 1, 0]);
  assert.deepEqual([...'ABCDEFGHX'].map((s) => mouthIndex(s, 6)), [0, 1, 2, 3, 2, 4, 1, 2, 0]);
  assert.deepEqual([...'ABCDEFGHX'].map((s) => mouthIndex(s, 8)), [0, 1, 2, 3, 4, 5, 6, 7, 0]);
  assert.deepEqual([...'ABCD'].map((s) => mouthIndex(s, 2)), [0, 1, 1, 1]);
  assert.equal(mouthIndex('D', 0), undefined);
  assert.equal(mouthAt({ shapes: 'XBD' }, 0.1), 'B');
  assert.equal(mouthAt({ shapes: 'XBD' }, 0.25), null);
  assert.equal(mouthAt({ shapes: 'XBD' }, -0.01), null);
});

test('a voiced say moves the mouth with the recording; actor.mouth does it with no bubble', () => {
  clearAligns(); clearMouths();
  setPcm('t-mouth', voiced([[0.25, 0.6], [0.64, 1.0]], 1.5));
  register({ 't-mouth': { name: 't-mouth', align: packAlign({ text: 'Hi there', by: 'json', words: [{ text: 'Hi', t0: 0.25, t1: 0.6 }, { text: 'there', t0: 0.64, t1: 1.0 }] }) } });
  const M = mouthFrom('t-mouth');
  assert.equal(M.by, 'energy');
  assert.equal(M.shapes[7], 'A');
  assert.deepEqual([M.from, M.to], [3, 13]);         // the band filter rings a frame past a tone cut dead
  const L = CAST.FOX.say(null, 2, { voice: 't-mouth' });
  assert.equal(L.shape(2 + 7 / 12), 'A');
  assert.equal(L.shape(2 + 4 / 12), 'D');
  assert.equal(L.mouth(2 + 4 / 12), 2);
  assert.deepEqual(L.state(2 + 4 / 12), { mouth: 2 });
  assert.deepEqual(L.state(2 + 7 / 12), { mouth: 0 });
  assert.deepEqual(L.state(1.9), {});
  // actor.mouth: {} before the first voiced frame and after the last, the stick's own six in between.
  const SAM = actorOf(puppet(stickSource({ name: 'sam-v3' })));
  assert.deepEqual(SAM.mouth('t-mouth', 1 + 2 / 12, 1), {});
  assert.deepEqual(SAM.mouth('t-mouth', 1 + 4 / 12, 1), { mouth: 3 });
  assert.deepEqual(SAM.mouth('t-mouth', 1 + 7 / 12, 1), { mouth: 0 });
  assert.deepEqual(SAM.mouth('t-mouth', 1 + 14 / 12, 1), {});
  assert.deepEqual(SAM.mouth('t-mouth', 4 / 12), { mouth: 3 });   // t0 defaults to 0
  // A synth line still cycles its visemes.
  const plain = CAST.FOX.say('hello there', 1);
  assert.equal(plain.shape(1.1), null);
  assert.ok(plain.mouth(1.1) !== null);
});

test('films/hello.js: the fox says a recorded "hello there" and its mouth shuts on the consonants', async () => {
  clearMouths();
  const e = readCatalogue(join(ROOT, 'assets')).entry('hello-there');
  assert.equal(e.mouth.by, 'rhubarb');
  const { HELLO, LINE_AT } = await import('../films/hello.js');
  const at = (k) => LINE_AT + k / 12;
  const seq = Array.from({ length: 10 }, (_, k) => HELLO.state(at(k)).mouth);
  // "He-llo th-ere": open on the vowels, shut on the "th" (frame 5, 0.42..0.5 s into the recording).
  assert.equal(seq[5], 0, seq.join(' '));
  assert.ok(seq.slice(0, 5).some((m) => m === 2) && seq.slice(6, 8).some((m) => m === 2), seq.join(' '));
  // The energy track, with no Rhubarb, shuts on the same frame.
  const energy = energyMouth(pcmOf('hello-there').samples);
  assert.equal(energy.shapes[5], 'A', energy.shapes);
  assert.equal(mouthIndex(energy.shapes[5], 4), 0);
});

test('hdf align --mouth: no rhubarb stores the energy track, --json takes cues, --show reads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-mouth-'));
  try {
    const wav = join(dir, 'line.wav');
    writeFileSync(wav, toWav16(voiced([[0.25, 0.6], [0.64, 1.0]], 1.25)));
    let r = hdf({}, 'import', wav, '--kind', 'sample', '--name', 'line', '--licence', 'own', '--root', dir, '--desc', 'Hi there.');
    assert.equal(r.code, 0, r.out);
    r = hdf({ RHUBARB: '/nonexistent/rhubarb' }, 'align', 'line', '--mouth', '--root', dir);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /no rhubarb.*storing the energy track/s);
    let e = readCatalogue(dir).entry('line');
    assert.equal(e.mouth.by, 'energy');
    assert.equal(e.mouth.shapes.length, 15);
    assert.equal(e.mouth.shapes[7], 'A');
    const cues = join(dir, 'cues.json');
    writeFileSync(cues, JSON.stringify([{ start: 0, end: 0.25, value: 'X' }, { start: 0.25, end: 1, value: 'C' }, { start: 1, end: 1.25, value: 'X' }]));
    r = hdf({}, 'align', 'line', '--mouth', '--json', cues, '--root', dir);
    assert.equal(r.code, 0, r.out);
    e = readCatalogue(dir).entry('line');
    assert.deepEqual(e.mouth, { by: 'json', shapes: 'XXXCCCCCCCCCXXX' });
    assert.ok(e.align === undefined, 'the word timing is left alone');
    r = hdf({}, 'align', 'line', '--mouth', '--show', '--root', dir);
    assert.match(r.out, /XXXCCCCCCCCCXXX/);
    assert.match(r.out, /15 frames of mouth, by json/);
    writeFileSync(cues, JSON.stringify([{ start: 0, end: 1, value: 'Z' }]));
    assert.notEqual(hdf({}, 'align', 'line', '--mouth', '--json', cues, '--root', dir).code, 0);
    // RE-7: a Rhubarb killed by a signal (1.14 segfaults on some Macs) stores the energy track and says why;
    // one that exits non-zero is still an error.
    const rh = join(dir, 'rhubarb');
    writeFileSync(rh, '#!/bin/sh\nkill -SEGV $$\n');
    chmodSync(rh, 0o755);
    r = hdf({ RHUBARB: rh }, 'align', 'line', '--mouth', '--root', dir);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /rhubarb was killed by SIGSEGV; storing the energy track/);
    assert.equal(readCatalogue(dir).entry('line').mouth.by, 'energy');
    writeFileSync(rh, '#!/bin/sh\necho "no such recognizer" >&2\nexit 2\n');
    r = hdf({ RHUBARB: rh }, 'align', 'line', '--mouth', '--root', dir);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /rhubarb failed \(2\):\nno such recognizer/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
