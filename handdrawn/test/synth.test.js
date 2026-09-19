import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SR, event, pentHz, renderScore, toWav16, scoreEvents, filmAudio } from '../core/synth.js';
import { plucks, swell, cueNotes, travel, sparse, impact, dyad } from '../recipes/score.js';
import mini from '../films/mini.js';

test('pentHz is v1: base 220, pentatonic steps, wrapping within the octave', () => {
  assert.equal(pentHz(0, 0), 220);
  assert.equal(pentHz(1, 0), 440);
  assert.ok(Math.abs(pentHz(0, 3) - 220 * 2 ** (7 / 12)) < 1e-9);
  assert.equal(pentHz(0, 5), pentHz(0, 0));
  assert.equal(pentHz(-1, 0), 110);
});

test('a note follows the v1 envelope: 20 ms linear attack to gain, exponential release to 0.0008', () => {
  const s = renderScore([{ t: 0.1, dur: 0.5, hz: 441, type: 'square', gain: 0.4 }], 1, { master: 0.5 });
  assert.equal(s.length, SR);
  const peak = (a, b) => { let m = 0; for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) m = Math.max(m, Math.abs(s[i])); return m; };
  assert.equal(peak(0, 0.1), 0);                                   // nothing before the onset
  assert.ok(Math.abs(peak(0.11, 0.125) - 0.4 * 0.5) < 0.03);       // top of the attack, times master
  const late = peak(0.55, 0.6);
  assert.ok(late < 0.01 && late > 0, `release ${late}`);           // near the floor at the end of dur
  assert.equal(peak(0.66, 1), 0);                                  // stopped 50 ms after dur
});

test('master gain clamps at 0.6 and the mix hard-clips', () => {
  const loud = renderScore([{ t: 0, dur: 0.5, hz: 100, type: 'square', gain: 5 }], 0.5, { master: 2 });
  let m = 0; for (const v of loud) m = Math.max(m, Math.abs(v));
  assert.equal(m, 1);
  const q = renderScore([{ t: 0, dur: 0.5, hz: 100, type: 'square', gain: 1 }], 0.5, { master: 2 });
  let p = 0; for (const v of q) p = Math.max(p, Math.abs(v));
  assert.ok(p <= 0.6 * 1.1, `peak ${p}`);
});

test('noise bursts are seeded; renders are deterministic', () => {
  const a = renderScore([impact(0.1, { seed: 3 })], 1), b = renderScore([impact(0.1, { seed: 3 })], 1), c = renderScore([impact(0.1, { seed: 4 })], 1);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('events are validated', () => {
  assert.throws(() => event({ t: 0, dur: 0 }), /dur/);
  assert.throws(() => event({ t: 'x', dur: 1 }), /t must be a number/);
  assert.throws(() => renderScore([{ t: 0, dur: 1, hz: 220, type: 'kazoo' }], 1), /unknown type/);
  assert.throws(() => renderScore([{ t: 0, dur: 1, type: 'sine' }], 1), /hz/);
});

test('toWav16: a 16-bit PCM header and clamped samples', () => {
  const w = toWav16(new Float32Array([0, 1, -1, 2]));
  const v = new DataView(w.buffer);
  assert.equal(String.fromCharCode(...w.subarray(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...w.subarray(8, 12)), 'WAVE');
  assert.equal(v.getUint32(24, true), 44100);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 8);
  assert.deepEqual([0, 1, 2, 3].map((i) => v.getInt16(44 + 2 * i, true)), [0, 32767, -32767, 32767]);
});

test('motifs land on their grids and read like the v1 table', () => {
  assert.deepEqual(plucks(1, 2).map((e) => e.t), [1, 1.5, 2, 2.5]);
  assert.deepEqual(plucks(0, 2, { steps: 'rise' }).map((e) => e.hz), [0, 1, 2, 3].map((s) => pentHz(0, s)));
  assert.deepEqual(swell(3).map((e) => [e.hz, e.type]), [[55, 'saw'], [110, 'sine']]);
  assert.deepEqual(cueNotes([0, 1, 2, 3, 4, 5]).map((e) => e.hz), [pentHz(1, 0), pentHz(1, 1), pentHz(1, 2), pentHz(1, 3), pentHz(1, 4), pentHz(2, 0)]);
  const tr = travel(0, 1);
  assert.equal(tr.filter((e) => e.type === 'square').length, 8);
  assert.equal(tr.filter((e) => e.type === 'sine').length, 2);
  assert.deepEqual(sparse(0, 3).map((e) => e.t), [0, 0.75, 1.5, 2.25]);
  assert.deepEqual(impact(2).map((e) => e.type), ['noise', 'sine']);
  assert.deepEqual(dyad(5).map((e) => e.type), ['sine', 'sine']);
});

test("a film's score reads its cues: mini plucks while the ball rolls and ends on a dyad at the cut", () => {
  const { events, master } = scoreEvents(mini);
  assert.equal(master, 0.5);
  assert.deepEqual(events.map((e) => e.t), [0, 0.5, 1, 1.5, 2, 2.1]);
  const { samples } = filmAudio(mini);
  assert.equal(samples.length, Math.ceil(mini.dur * SR));
});
