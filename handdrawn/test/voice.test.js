// 4.0 V1: narration. A wav from the store under a shot, decoded once, mixed over a score that ducks 9 dB
// under it; the same bytes in the player (bundle and dev carry them) and a voice bar on the contact sheet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWav, decodeWav, resample, voicedSpan } from '../core/wav.js';
import { DUCK_DB, DUCK_RAMP, SR, event, filmAudio, pcmOf, renderScore, scoreEvents, setPcm, toWav16, voiceIds, voiceSpans } from '../core/synth.js';
import { voice, plucks } from '../recipes/score.js';
import { film, seq } from '../core/tree.js';
import { lint } from '../core/lint.js';
import { roll, sign } from '../films/mini.js';
import { loadFilm } from '../cli/load.mjs';
import { bundle } from '../cli/bundle.mjs';
import { storeState } from '../cli/dev.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const hdf = (...args) => { const r = spawnSync(process.execPath, ['cli/hdf.mjs', ...args], { cwd: ROOT, encoding: 'utf8' }); return { code: r.status, out: r.stdout + r.stderr }; };

// A wav by hand: chunks in order, so a LIST chunk can sit before the data as `say` and phones write it.
function wav({ sr = 22050, ch = 1, bits = 16, code = 1, frames = [], ext = false, list = false }) {
  const size = bits / 8, data = Buffer.alloc(frames.length * ch * size);
  frames.forEach((f, i) => (Array.isArray(f) ? f : [f]).forEach((x, c) => {
    const o = (i * ch + c) * size;
    if (code === 3) bits === 32 ? data.writeFloatLE(x, o) : data.writeDoubleLE(x, o);
    else if (bits === 8) data.writeUInt8(Math.round(x * 127 + 128), o);
    else if (bits === 16) data.writeInt16LE(Math.round(x * 32767), o);
    else if (bits === 24) data.writeIntLE(Math.round(x * 8388607), o, 3);
    else data.writeInt32LE(Math.round(x * 2147483647), o);
  }));
  const fmt = Buffer.alloc(ext ? 40 : 16);
  fmt.writeUInt16LE(ext ? 0xfffe : code, 0); fmt.writeUInt16LE(ch, 2); fmt.writeUInt32LE(sr, 4);
  fmt.writeUInt32LE(sr * ch * size, 8); fmt.writeUInt16LE(ch * size, 12); fmt.writeUInt16LE(bits, 14);
  if (ext) { fmt.writeUInt16LE(22, 16); fmt.writeUInt16LE(code, 24); }
  const chunk = (id, body) => Buffer.concat([Buffer.from(id, 'latin1'), Buffer.from(Uint32Array.of(body.length).buffer), body, body.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  const body = Buffer.concat([Buffer.from('WAVE'), chunk('fmt ', fmt), ...(list ? [chunk('LIST', Buffer.from('INFOISFT\x05\x00\x00\x00say!\x00'))] : []), chunk('data', data)]);
  return Buffer.concat([Buffer.from('RIFF'), Buffer.from(Uint32Array.of(body.length).buffer), body]);
}
const near = (a, b, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const tone = (n, hz, sr, amp = 0.5) => Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * hz * i / sr));

test('readWav: 8/16/24/32-bit PCM, float, extensible and stereo, with a LIST chunk before the data', () => {
  const x = [0, 0.5, -0.5, 0.25];
  for (const bits of [8, 16, 24, 32]) {
    const w = readWav(wav({ bits, frames: x }));
    assert.equal(w.sr, 22050); assert.equal(w.bits, bits); assert.equal(w.data[0].length, 4);
    x.forEach((v, i) => near(w.data[0][i], v, bits === 8 ? 0.01 : 1e-4));
  }
  for (const bits of [32, 64]) assert.deepEqual([...readWav(wav({ code: 3, bits, frames: x })).data[0]], x);
  const st = readWav(wav({ ch: 2, bits: 24, ext: true, list: true, frames: [[0.5, -0.5], [0.25, 0.25]] }));
  assert.equal(st.channels, 2);
  near(st.data[1][0], -0.5, 1e-4);
  near(st.sec, 2 / 22050, 1e-9);
  // Our own writer reads back.
  near(readWav(toWav16(Float32Array.of(0.1, -0.2))).data[0][1], -0.2, 1e-4);
});

test('readWav refuses what it cannot play, saying so', () => {
  assert.throws(() => readWav(Buffer.from('not a wav at all')), /not a RIFF\/WAVE/);
  assert.throws(() => readWav(wav({ code: 2, frames: [0] })), /format 2 is not PCM or float/);
  assert.throws(() => readWav(wav({ bits: 12, frames: [] })), /12-bit PCM/);
});

test('decodeWav: stereo averaged to mono, 22.05 kHz resampled to the synth rate at the same pitch', () => {
  const b = wav({ ch: 2, frames: tone(22050, 220, 22050).map((v) => [v, 0]) });
  const d = decodeWav(b);
  assert.equal(d.length, SR);
  let peak = 0, cross = 0;
  for (let i = 1; i < d.length; i++) { peak = Math.max(peak, Math.abs(d[i])); if (d[i - 1] < 0 && d[i] >= 0) cross++; }
  near(peak, 0.25, 0.01);   // half of a 0.5 tone on one channel
  assert.ok(Math.abs(cross - 220) <= 1, `${cross} cycles`);
  assert.equal(resample(Float32Array.of(1, 2), SR, SR).length, 2);
});

test('voicedSpan: the part above the floor, null for silence', () => {
  const x = new Float32Array(SR);
  x.fill(0.3, SR * 0.25, SR * 0.5);
  const [a, b] = voicedSpan(x);
  near(a, 0.24, 0.021); near(b, 0.5, 0.021);
  assert.equal(voicedSpan(new Float32Array(SR)), null);
});

test('voice(): an event the synth checks; a sample the reader cannot find is named with the fix', () => {
  assert.deepEqual(voice('a', 1), { t: 1, type: 'voice', id: 'a', gain: 1 });
  assert.deepEqual(voice('a', 1, { gain: 0.5, dur: 2 }), { t: 1, type: 'voice', id: 'a', gain: 0.5, dur: 2 });
  assert.throws(() => event({ t: 0, type: 'voice' }), /needs the id/);
  assert.throws(() => event({ t: 0, type: 'voice', id: 'a', dur: 0 }), /dur 0/);
  assert.throws(() => pcmOf('v1-no-such'), /hdf import <line\.wav> --kind sample --name v1-no-such/);
  assert.deepEqual(voiceIds([voice('b', 0), [voice('a', 1)], plucks(0, 1), voice('b', 2)]), ['b', 'a']);
});

test('renderScore: the voice lands on its sample at gain, after the master; dur cuts it', () => {
  const s = new Float32Array(SR / 2).fill(0.4);
  setPcm('v1-flat', s);
  const out = renderScore([voice('v1-flat', 0.25, { gain: 0.5 })], 1, { master: 0.5 });
  const n0 = Math.round(0.25 * SR);
  assert.equal(out[n0 - 1], 0);
  near(out[n0], 0.2, 1e-6);
  near(out[n0 + s.length - 1], 0.2, 1e-6);
  assert.equal(out[n0 + s.length], 0);
  const cut = renderScore([voice('v1-flat', 0, { dur: 0.1 })], 1);
  assert.equal(cut[Math.round(0.1 * SR)], 0);
  near(cut[Math.round(0.1 * SR) - 1], 0.4, 1e-6);
  // Past the end is dropped, not an error; before the start too.
  assert.equal(renderScore([voice('v1-flat', 0.9)], 1).length, SR);
  near(renderScore([voice('v1-flat', -0.25)], 1)[0], 0.4, 1e-6);
});

test('ducking: the score drops 9 dB under the voiced part, ramps over 0.15 s, and is untouched elsewhere', () => {
  const s = new Float32Array(SR);
  s.fill(0.2, SR * 0.4, SR * 0.6);   // voiced 0.4..0.6 s of a 1 s sample
  setPcm('v1-mid', s);
  const bed = [{ t: 0, dur: 3, hz: 220, type: 'sine', gain: 0.5, attack: 0.001, release: 'linear' }];
  const dry = renderScore(bed, 3), wet = renderScore([bed, voice('v1-mid', 1)], 3);
  const [{ v0, v1, t1 }] = voiceSpans([voice('v1-mid', 1)]);
  near(v0, 1.4, 0.021); near(v1, 1.6, 0.021); near(t1, 2, 1e-9);
  const at = (t) => Math.round(t * SR);
  const g = (t) => (wet[at(t)] - (t >= 1 && t < 2 ? s[at(t) - SR] : 0)) / dry[at(t)];
  // Samples where the bed is not near zero, so the ratio is the gain.
  const probe = (t0) => { for (let k = 0; k < 200; k++) { const t = t0 + k / SR; if (Math.abs(dry[at(t)]) > 0.05) return g(t); } throw new Error('no probe'); };
  near(probe(1.5), Math.pow(10, -DUCK_DB / 20), 1e-3);
  near(probe(0.5), 1, 1e-6);
  near(probe(v0 - DUCK_RAMP - 0.01), 1, 1e-6);
  near(probe(v1 + DUCK_RAMP + 0.01), 1, 1e-6);
  const half = probe(v0 - DUCK_RAMP / 2);
  assert.ok(half < 0.9 && half > Math.pow(10, -DUCK_DB / 20), `mid-ramp ${half}`);
  // A score with no voice is exactly what it was before voices existed.
  assert.deepEqual(renderScore([bed, voice('v1-mid', 1, { gain: 0 })], 3).slice(0, at(1.2)), dry.slice(0, at(1.2)));
});

test('mini-voice: the store sample, read through the film, speaks at 0.5 s over the ducked plucks', async () => {
  const f = await loadFilm('films/mini-voice.js'), mini = await loadFilm('films/mini.js');
  const ev = scoreEvents(f).events.filter((e) => e.type === 'voice');
  assert.deepEqual(ev.map((e) => [e.id, e.t]), [['mini-line', 0.5]]);
  const a = filmAudio(f).samples, b = filmAudio(mini).samples;
  assert.equal(a.length, b.length);
  const rms = (x, t0, t1) => { let s = 0; for (let i = Math.round(t0 * SR); i < Math.round(t1 * SR); i++) s += x[i] * x[i]; return Math.sqrt(s / ((t1 - t0) * SR)); };
  assert.ok(rms(a, 0.6, 1.4) > 5 * rms(b, 0.6, 1.4));
  assert.deepEqual(a.slice(0, Math.round(0.3 * SR)), b.slice(0, Math.round(0.3 * SR)));   // before the ramp
  assert.deepEqual(a.slice(Math.round(2.2 * SR)), b.slice(Math.round(2.2 * SR)));        // after the line
  const [sp] = voiceSpans(ev);
  assert.ok(sp.t1 < f.dur && sp.v0 >= 0.5 && sp.v1 <= sp.t1);
});

test('lint voice: a sample the store lacks, and a line that runs past the end', () => {
  setPcm('v1-long', new Float32Array(SR * 6).fill(0.2));
  const f = (score) => film({ name: 'v', look: 'paperInk', timeline: seq(roll, sign), score });
  const rules = (fl) => lint(fl).filter((x) => x.rule === 'voice').map((x) => x.detail);
  assert.deepEqual(rules(f(() => [voice('v1-flat', 1)])), []);
  assert.match(rules(f(() => [voice('v1-missing', 1)])).join(), /no sample 'v1-missing'/);
  assert.match(rules(f(() => [voice('v1-long', 1)])).join(), /ends at 7\.00 s, after the film's end \(4\.50 s\)/);
  assert.deepEqual(rules(f(() => [voice('v1-long', 1, { dur: 3 })])), []);
});

test('import --kind sample: sec read off the data chunk (a LIST chunk ahead of it), a bad wav refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-voice-'));
  try {
    const root = join(dir, 'store'), good = join(dir, 'line.wav'), bad = join(dir, 'bad.wav');
    writeFileSync(good, wav({ list: true, frames: tone(11025, 220, 22050) }));
    writeFileSync(bad, wav({ code: 2, frames: [0] }));
    assert.equal(hdf('import', good, '--kind', 'sample', '--name', 'line', '--root', root, '--licence', 'own').code, 0);
    assert.equal(JSON.parse(readFileSync(join(root, 'catalogue.json'), 'utf8')).line.sec, 0.5);
    const r = hdf('import', bad, '--kind', 'sample', '--name', 'bad', '--root', root, '--licence', 'own');
    assert.notEqual(r.code, 0);
    assert.match(r.out, /a wav file the synth can read \(wav: format 2/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the player gets the wav: bundle inlines it, dev points at its blob', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-voice-bundle-'));
  try {
    const r = await bundle('films/mini-voice.js', { loadFilm, out: dir });
    const config = JSON.parse(readFileSync(r.dest, 'utf8').match(/window\.HDF = (.*?);<\/script>/s)[1]);
    assert.match(config.assets['mini-line'], /^data:audio\/wav;base64,UklGR/);
    assert.equal(config.catalogue['mini-line'].sec, 1.029);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const { assets } = storeState((p) => p);
  assert.match(assets['mini-line'], /^\/v0\/.*\/blobs\/[0-9a-f]{40}\.wav$/);
});

test('render: the voice is in the -final.mp4 and on the contact sheet', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 && 'no ffmpeg' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdf-voice-render-'));
  try {
    const r = hdf('render', 'films/mini-voice.js', '--out', dir, '--workers', '1', '--width', '240');
    assert.equal(r.code, 0, r.out);
    const probe = spawnSync(process.env.FFPROBE ?? 'ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', join(dir, 'mini-voice-final.mp4')], { encoding: 'utf8' });
    if (probe.status === 0) assert.deepEqual(probe.stdout.trim().split('\n').sort(), ['audio', 'video']);
    const w = readWav(readFileSync(join(dir, 'mini-voice.wav'))).data[0];
    assert.ok(w.slice(Math.round(0.6 * SR), Math.round(1.4 * SR)).some((v) => Math.abs(v) > 0.2));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
