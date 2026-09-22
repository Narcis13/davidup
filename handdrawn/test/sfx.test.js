// 4.0 V4: sound effects and a music bed. The synth's sweeps, vibrato, sustain and swept hiss; the kit in
// recipes/sfx.js; the bed on the grid, stopped and stung; and the done-when: a quiz's wrong answers tick and the
// right one dings over a bright bed that ducks under the narration (films/quiz-time.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DUCK_DB, SR, event, renderScore, scoreEvents, setPcm } from '../core/synth.js';
import { FPS } from '../core/curves.js';
import { cues } from '../core/tree.js';
import {
  pop, boing, whoosh, ding, tada, tick, squeak, flip, erase, pencilScratch, chalkTap, hits, writerSounds, eraserSounds,
  bed, barOf, MOODS, SFX_TOOLS,
} from '../recipes/sfx.js';
import { writing } from '../core/write.js';
import { quizTimes } from '../recipes/shots.js';
import { loadFilm } from '../cli/load.mjs';

const rms = (s, a, b) => { let r = 0; const i0 = Math.round(a * SR), i1 = Math.round(b * SR); for (let i = i0; i < i1; i++) r += s[i] * s[i]; return Math.sqrt(r / (i1 - i0)); };
// Rising zero crossings a second between a and b: the pitch of a clean tone.
const pitch = (s, a, b) => { let n = 0; for (let i = Math.round(a * SR) + 1; i < Math.round(b * SR); i++) if (s[i - 1] < 0 && s[i] >= 0) n++; return n / (b - a); };

test('synth: a note bends from hz to hz1 over bend, then holds hz1', () => {
  const s = renderScore([{ t: 0, dur: 1, hz: 200, hz1: 800, bend: 0.5, type: 'sine', gain: 0.3, sus: 1 }], 1.2);
  assert.ok(Math.abs(pitch(s, 0.02, 0.07) - 200 * 2 ** (0.045 / 0.5 * 2)) < 25, `start ${pitch(s, 0.02, 0.07)}`);
  assert.ok(Math.abs(pitch(s, 0.6, 0.9) - 800) < 8, `end ${pitch(s, 0.6, 0.9)}`);
  const lin = renderScore([{ t: 0, dur: 1, hz: 200, hz1: 800, glide: 'linear', type: 'sine', gain: 0.3, sus: 1 }], 1);
  assert.ok(Math.abs(pitch(lin, 0.45, 0.55) - 500) < 12, `linear midpoint ${pitch(lin, 0.45, 0.55)}`);
  const exp = renderScore([{ t: 0, dur: 1, hz: 200, hz1: 800, type: 'sine', gain: 0.3, sus: 1 }], 1);
  assert.ok(Math.abs(pitch(exp, 0.45, 0.55) - 400) < 12, `exponential midpoint ${pitch(exp, 0.45, 0.55)}`);
});

test('synth: vibrato wobbles the pitch about hz; sus holds the level before the release', () => {
  const v = renderScore([{ t: 0, dur: 1, hz: 400, vib: 4, vibDepth: 0.2, type: 'sine', gain: 0.3, sus: 1 }], 1);
  const hi = pitch(v, 0.02, 0.105), lo = pitch(v, 0.145, 0.23);   // a quarter cycle of the 4 Hz wobble each side
  assert.ok(hi > 430 && lo < 370, `vibrato ${hi} ${lo}`);
  const held = renderScore([{ t: 0, dur: 1, hz: 300, type: 'sine', gain: 0.4, sus: 0.5 }], 1, { master: 0.5 });
  const plain = renderScore([{ t: 0, dur: 1, hz: 300, type: 'sine', gain: 0.4 }], 1, { master: 0.5 });
  assert.ok(Math.abs(rms(held, 0.3, 0.45) - 0.2 / Math.SQRT2) < 0.01, 'at gain through the sustain');
  assert.ok(rms(plain, 0.3, 0.45) < rms(held, 0.3, 0.45) / 3, 'the plain note has decayed');
  assert.ok(rms(held, 0.95, 1) < 0.01, 'and it still releases by dur');
});

test('synth: a swept, swelling hiss is silent at both ends and seeded', () => {
  const ev = [{ t: 0.1, dur: 0.4, hz: 400, hz1: 3000, type: 'hiss', gain: 0.3, swell: true, q: 4, seed: 3 }];
  const a = renderScore(ev, 1), b = renderScore(ev, 1);
  assert.deepEqual(a, b);
  assert.equal(rms(a, 0, 0.1), 0);
  assert.equal(rms(a, 0.5, 1), 0, 'no tail after a swell');
  assert.ok(rms(a, 0.28, 0.32) > 4 * rms(a, 0.1, 0.12), 'loudest in the middle');
  // The band moves: more zero crossings late than early.
  assert.ok(pitch(a, 0.4, 0.46) > 2 * pitch(a, 0.14, 0.2));
});

test('synth: the new fields are validated', () => {
  assert.throws(() => event({ t: 0, dur: 1, hz: 200, hz1: 0 }), /hz1/);
  assert.throws(() => event({ t: 0, dur: 1, hz: 200, hz1: 300, bend: 0 }), /bend/);
  assert.throws(() => event({ t: 0, dur: 1, hz: 200, glide: 'wobbly' }), /glide/);
  assert.throws(() => event({ t: 0, dur: 1, hz: 200, vib: -1 }), /vib/);
  assert.throws(() => event({ t: 0, dur: 1, hz: 200, sus: NaN }), /sus/);
});

test('the kit: every effect sounds from t, nowhere before, and the same every time', () => {
  const kit = {
    pop: pop(0.5), boing: boing(0.5), whoosh: whoosh(0.5), ding: ding(0.5), tada: tada(0.5), tick: tick(0.5), flip: flip(0.5),
    erase: erase(0.5, 0.8), pencilScratch: pencilScratch(0.5, 0.5), chalkTap: chalkTap(0.5),
    ...Object.fromEntries(SFX_TOOLS.map((tool) => [`squeak ${tool}`, squeak(0.5, { tool })])),
  };
  for (const [name, ev] of Object.entries(kit)) {
    const s = renderScore(ev, 2.5), again = renderScore(ev, 2.5);
    assert.deepEqual(s, again, name);
    assert.equal(rms(s, 0, 0.5), 0, `${name} before t`);
    const r = rms(s, 0.5, 2.5);
    assert.ok(r > 1e-4 && s.every(Number.isFinite), `${name} sounds (${r})`);
    let peak = 0; for (const v of s) peak = Math.max(peak, Math.abs(v));
    assert.ok(peak < 0.5, `${name} sits under the mix (${peak})`);
  }
  assert.throws(() => squeak(0, { tool: 'quill' }), /unknown tool 'quill'/);
  // A pop rises: its pitch after the bend is 2.6 times its start.
  const p = renderScore([pop(0, { gain: 0.3 })[0]], 0.2);
  assert.ok(pitch(p, 0.075, 0.09) > 2 * 380, 'pop bends up');
});

test('hits: an accent on each cut, a whoosh centred on it', () => {
  const w = hits([1, 3]);
  assert.deepEqual(w.map((e) => e.t), [0.775, 2.775]);
  assert.equal(w[0].dur, 0.45);
  assert.deepEqual(hits([2], { kind: 'pop' }).map((e) => e.t), [2, 2]);
  assert.deepEqual(hits([0.1]).map((e) => e.t), [0], 'never before the film');
  assert.deepEqual(hits([1, 2], { kind: (t, k) => [{ t, dur: 0.1, hz: 100 + k }] }).map((e) => e.hz), [100, 101]);
  assert.throws(() => hits([1], { kind: 'kazoo' }), /unknown kind/);
});

test('writerSounds: the tool on the surface for each unit the writer puts down; eraserSounds a stroke a row', async () => {
  const { textBox } = await import('../core/text.js');
  const node = textBox('quiz time!', [190, 380, 700, 300], { size: 150, align: 'center', ink2: null, seed: 17 });
  const W = { at: 0.25, per: 'word', wps: 1 }, units = writing(node, W).units;
  assert.equal(units.length, 2);
  const pens = writerSounds(node, { ...W, t0: 10, tool: 'pen' });
  assert.deepEqual(pens.map((e) => e.t), units.map((u) => 10 + u.t1));
  assert.ok(pens.every((e, k) => Math.abs(e.dur - (units[k].t2 - units[k].t1)) < 1e-9));
  assert.ok(writerSounds(node, { ...W, tool: 'chalk' }).some((e) => e.type === 'noise'), 'chalk taps as it starts');
  assert.throws(() => writerSounds(node, { tool: 'quill' }), /unknown tool/);
  // fx('erase') over the 1080 frame with its default band sweeps nine rows.
  const rows = eraserSounds({ t: 2, dur: 0.9 });
  assert.equal(rows.length, 9);
  assert.ok(Math.abs(rows[8].t - 2.8) < 1e-9);
  assert.equal(eraserSounds({ t: 0, dur: 1, box: [0, 0, 1080, 300], band: 150 }).length, 3);
  assert.throws(() => eraserSounds({ t: 0 }), /dur/);
});

test('bed: a bar a whole number of twelfths, the tempo snapped to it, nothing starting at or after `to`', () => {
  assert.deepEqual(barOf(120), { frames: 24, bar: 2, tempo: 120 });
  assert.equal(barOf(112).frames, 26);
  assert.ok(Math.abs(barOf(112).tempo - 2880 / 26) < 1e-9);
  for (const mood of Object.keys(MOODS)) {
    const b = bed({ mood, from: 1, to: 9 });
    assert.ok(Number.isInteger(Math.round(b.bar * FPS)) && Math.abs(b.bar * FPS - Math.round(b.bar * FPS)) < 1e-9, mood);
    for (const t of b.bars) assert.ok(Math.abs(t * FPS - Math.round(t * FPS)) < 1e-9, `${mood} bar at ${t} off the grid`);
    assert.equal(b.bars[0], 1);
    assert.ok(b.every((e) => e.t >= 1 - 1e-9 && e.t < 9), mood);
    assert.ok(b.length > 4, mood);
    const s = renderScore(b, 11);
    assert.ok(rms(s, 1, 9) > 1e-3 && s.every(Number.isFinite), mood);
    assert.deepEqual(renderScore(bed({ mood, from: 1, to: 9 }), 11), s, `${mood} is deterministic`);
  }
  assert.throws(() => bed({ mood: 'jazzy', to: 4 }), /unknown mood/);
  assert.throws(() => bed({ key: 'H', to: 4 }), /key 'H'/);
  assert.throws(() => bed({ to: 0 }), /to/);
  // A minor key's first chord is minor: C, E flat, G.
  const cm = bed({ mood: 'calm', key: 'Cm', to: 2 }).filter((e) => e.t === 0 && e.type === 'sine' && e.sus);
  assert.deepEqual(cm.map((e) => Math.round(12 * Math.log2(e.hz / 440) + 69)), [48, 51, 55]);
});

test('bed: stop(t) releases everything by t + 0.35; sting(t) climbs the tonic on the frames', () => {
  const b = bed({ mood: 'bright', to: 20 }), s = b.stop(5.5);
  assert.ok(s.every((e) => e.t < 5.5 && e.t + e.dur <= 5.85 + 1e-9));
  assert.ok(s.length < b.length && s.bars.length === 3);
  const out = renderScore(s, 8);
  assert.ok(rms(out, 6, 8) < 1e-4, 'quiet after the stop');
  const g = b.sting(6);
  const onsets = [...new Set(g.map((e) => e.t))].sort((x, y) => x - y);
  assert.ok(onsets.every((t) => Math.abs(t * FPS - Math.round(t * FPS)) < 1e-9), 'on the frames');
  assert.equal(onsets[0], 6);
});

test('the bed ducks under a voice, the effects with it', () => {
  const sr = SR, line = new Float32Array(sr);   // a second of tone from 1 s: the "voice"
  for (let i = 0; i < sr; i++) line[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / sr);
  setPcm('sfx-test-line', line);
  const b = bed({ mood: 'calm', to: 4 });
  const alone = renderScore(b, 4), vox = renderScore([{ t: 1, type: 'voice', id: 'sfx-test-line' }], 4);
  const both = renderScore([b, { t: 1, type: 'voice', id: 'sfx-test-line' }], 4);
  const under = both.map((v, i) => v - vox[i]);
  const db = 20 * Math.log10(rms(under, 1.3, 1.8) / rms(alone, 1.3, 1.8));
  assert.ok(Math.abs(db + DUCK_DB) < 0.3, `ducked ${db.toFixed(2)} dB`);
  assert.ok(Math.abs(rms(under, 3, 3.5) - rms(alone, 3, 3.5)) < 1e-6, 'back up after the line');
});

test('quizTimes gives each option\'s arrival and the end', () => {
  const T = quizTimes({ question: 'which one can fly?', options: ['fish', 'bird', 'cat'], answer: 1, audience: 'kids-9' });
  assert.equal(T.options.length, 3);
  assert.ok(T.options[0] < T.options[1] && T.options[2] < T.pause[0] && T.ding < T.end);
});

test('done when: quiz-time ticks the wrong answers and dings the right one over a bright bed that ducks under the narration', async () => {
  const f = await loadFilm(new URL('../films/quiz-time.js', import.meta.url).pathname), c = cues(f), q = c.shots[1];
  const { events } = scoreEvents(f);
  const T = quizTimes({ question: 'which one can fly?', options: ['fish', 'bird', 'cat'], answer: 1, audience: 'kids-9' });
  const at = (t) => events.filter((e) => Math.abs(e.t - t) < 1e-9);
  for (const t of T.ticks) assert.ok(at(q.t0 + t).some((e) => e.type === 'noise' && e.dur === 0.04), `a tick at ${q.t0 + t}`);
  assert.ok(at(q.t0 + T.ding).some((e) => e.type === 'sine' && e.dur === 1.4), 'the ding');
  const voices = events.filter((e) => e.type === 'voice');
  assert.deepEqual(voices.map((e) => e.id), ['quiz-ask', 'quiz-yes']);
  // The bed (bright: triangle chord hits) runs from the start until the sign-off, and none of it sounds after.
  const chords = events.filter((e) => e.type === 'triangle' && e.gain < 0.06);
  assert.equal(chords[0].t, 0);
  assert.ok(chords.every((e) => e.t < c.shots[3].t0 + 1e-9));
  // It ducks: the mix under the first line, minus the line, is DUCK_DB under the same stretch without voices.
  const dur = f.dur, all = renderScore(events, dur, { master: 0.45 });
  const bare = renderScore(events.filter((e) => e.type !== 'voice'), dur, { master: 0.45 });
  const vox = renderScore(voices, dur, { master: 0.45 });
  const v0 = voices[0].t + 0.6, v1 = v0 + 0.8;
  const db = 20 * Math.log10(rms(all.map((v, i) => v - vox[i]), v0, v1) / rms(bare, v0, v1));
  assert.ok(Math.abs(db + DUCK_DB) < 0.5, `bed under the narration ${db.toFixed(2)} dB`);
});
