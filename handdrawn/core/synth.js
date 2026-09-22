// The score as samples. Events are data; renderScore mixes them into a Float32Array at 44.1 kHz with the
// v1 envelope (note, noiseBurst), so the Node driver and the player play the same samples.
//   { t, dur, hz, type: 'sine'|'triangle'|'square'|'saw'|'noise'|'hiss', gain = .25, attack = .02, release = 'exp', seed }
// hiss: seeded white noise through a band-pass at hz (q, default .8), held at gain for dur (v1 sand gestures).
//   { t, type: 'voice', id, gain = 1, dur }   a recorded line (4.0 V1): the store's sample `id`, mixed at gain
//   (not scaled by master), cut at dur when given; everything else ducks 9 dB under its voiced part.
// Nothing here reads Date, Math.random or global state; a voice's samples come from the reader the host
// installs (core/assets.js in Node, the player's preload in the browser).
import { FPS } from './curves.js';
import { rng } from './rand.js';
import { cues } from './tree.js';
import { decodeWav, voicedSpan } from './wav.js';

export const SR = 44100;
const FLOOR = 0.0008;   // exponential releases end here (Web Audio cannot ramp to 0)
const TAIL = 0.05;      // v1 stops each oscillator 50 ms after its release ends
const MASTER_MAX = 0.6;

// Pentatonic pitch: octave o, step s (wraps within the octave, as v1 pentHz).
export const pentHz = (o, s, base = 220) => base * Math.pow(2, o + [0, 2, 4, 7, 9][((s % 5) + 5) % 5] / 12);

// Band-limited step correction for square and saw (polyBLEP).
function blep(ph, dt) {
  if (ph < dt) { const x = ph / dt; return x + x - x * x - 1; }
  if (ph > 1 - dt) { const x = (ph - 1) / dt; return x * x + x + x + 1; }
  return 0;
}

// One oscillator sample at phase ph (0..1), phase step dt. Shapes start where Web Audio's do.
const WAVES = {
  sine: (ph) => Math.sin(2 * Math.PI * ph),
  triangle: (ph) => (ph < 0.25 ? 4 * ph : ph < 0.75 ? 2 - 4 * ph : 4 * ph - 4),
  square: (ph, dt) => (ph < 0.5 ? 1 : -1) + blep(ph, dt) - blep((ph + 0.5) % 1, dt),
  saw: (ph, dt) => { const q = (ph + 0.5) % 1; return 2 * q - 1 - blep(q, dt); },
};
WAVES.sawtooth = WAVES.saw;

// Gain at time u seconds after onset: linear attack to g, exponential (or linear) release to FLOOR at dur,
// then held at FLOOR until the oscillator stops TAIL later (exactly what v1's AudioParam ramps do).
function envelope(u, { gain: g, dur, attack, release }) {
  if (u < attack) return g * u / attack;
  if (u >= dur) return FLOOR;
  const r = (u - attack) / (dur - attack);
  return release === 'linear' ? g + (FLOOR - g) * r : g * Math.pow(FLOOR / g, r);
}

function addNote(out, ev) {
  const wave = WAVES[ev.type];
  if (!wave) throw new Error(`synth: unknown type '${ev.type}' (sine, triangle, square, saw, noise, hiss)`);
  if (!(ev.hz > 0)) throw new Error(`synth: ${ev.type} at ${ev.t}s needs hz > 0`);
  if (!(ev.gain > 0)) return;   // a silent note (an exponential release from 0 would be NaN and mute the mix)
  const env = { gain: ev.gain, dur: Math.max(ev.dur, ev.attack + 1e-3), attack: ev.attack, release: ev.release };
  const n0 = Math.round(ev.t * SR), n1 = Math.min(out.length, Math.round((ev.t + env.dur + TAIL) * SR)), dt = ev.hz / SR;
  for (let n = Math.max(0, n0); n < n1; n++) {
    const u = (n - n0) / SR, x = (n - n0) * dt, ph = x - Math.floor(x);
    out[n] += wave(ph, dt) * envelope(u, env);
  }
}

// v1 noiseBurst: seeded white noise under a (1 - i/n)^2 decay, at a flat gain.
function addNoise(out, ev) {
  const r = rng(ev.seed ?? 1), len = Math.ceil(SR * ev.dur), n0 = Math.round(ev.t * SR);
  for (let i = 0; i < len; i++) {
    const v = (r() * 2 - 1) * Math.pow(1 - i / len, 2) * ev.gain, n = n0 + i;
    if (n >= 0 && n < out.length) out[n] += v;
  }
}

// v1's sand hiss: looped noise through a BiquadFilter 'bandpass' (RBJ, 0 dB peak), opened over
// min(.08, dur / 2), held, closed .12 s after the end. dur is at least .06.
function addHiss(out, ev) {
  const r = rng(ev.seed ?? 5), d = Math.max(ev.dur, 0.06), up = Math.min(0.08, d / 2), n0 = Math.round(ev.t * SR), len = Math.ceil((d + 0.12) * SR);
  const w0 = 2 * Math.PI * ev.hz / SR, al = Math.sin(w0) / (2 * (ev.q ?? 0.8)), a0 = 1 + al;
  const b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w0) / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < len; i++) {
    const x = r() * 2 - 1, y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    const u = i / SR, g = u < up ? ev.gain * u / up : u < d ? ev.gain : ev.gain * Math.max(0, 1 - (u - d) / 0.12);
    const n = n0 + i;
    if (n >= 0 && n < out.length) out[n] += y * g;
  }
}

// ---------- voices (4.0 V1) ----------

// How far the score drops under a voice's voiced part (dB), and the ramp either side (s).
export const DUCK_DB = 9, DUCK_RAMP = 0.15;
const PCM = new Map();   // id -> { samples (mono, SR), span: [t0, t1] voiced, or null }
let PCM_READER = null;

// How a sample's bytes are found by id: (id) => wav bytes | undefined. core/assets.js installs the store's.
export function setPcmReader(fn) { PCM_READER = fn; }

// Hands the synth a sample: wav bytes (decoded here) or mono samples already at SR. Decoded once per process.
export function setPcm(id, data) {
  const samples = data instanceof Float32Array ? data : decodeWav(data);
  PCM.set(id, { samples, span: voicedSpan(samples) });
}

// { samples, span } for a sample id, read through the installed reader the first time it is asked for.
export function pcmOf(id) {
  if (!PCM.has(id)) {
    const bytes = PCM_READER?.(id);
    if (!bytes) throw new Error(`synth: no sample '${id}' (hdf import <line.wav> --kind sample --name ${id}, and name it in the film's assets)`);
    setPcm(id, bytes);
  }
  return PCM.get(id);
}

// Where each voice plays in film time: { id, t, t1 (end of the sound), v0, v1 (its voiced part) }.
export function voiceSpans(events) {
  return events.flat(Infinity).filter((e) => e?.type === 'voice').map((e) => {
    const { samples, span } = pcmOf(e.id), len = Math.min(samples.length / SR, e.dur ?? Infinity);
    return { id: e.id, t: e.t, t1: e.t + len, v0: e.t + Math.min(span?.[0] ?? 0, len), v1: e.t + Math.min(span?.[1] ?? 0, len) };
  });
}

function addVoice(out, ev) {
  const { samples } = pcmOf(ev.id), n0 = Math.round(ev.t * SR);
  const len = ev.dur === undefined ? samples.length : Math.min(samples.length, Math.round(ev.dur * SR));
  for (let i = Math.max(0, -n0); i < len && n0 + i < out.length; i++) out[n0 + i] += samples[i] * ev.gain;
}

// The score's gain under the voices: 1, down DUCK_DB dB over each voiced part, ramped linearly in dB over
// DUCK_RAMP s on either side. Overlapping voices take the deeper duck.
function duckCurve(spans, n) {
  const d = new Float32Array(n), r = DUCK_RAMP * SR;
  for (const s of spans) {
    if (!(s.v1 > s.v0)) continue;
    const a = s.v0 * SR, b = s.v1 * SR;
    for (let i = Math.max(0, Math.floor(a - r)); i < Math.min(n, Math.ceil(b + r)); i++) {
      const k = i < a ? 1 - (a - i) / r : i > b ? 1 - (i - b) / r : 1;
      if (k > d[i]) d[i] = k;
    }
  }
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = d[i] ? Math.pow(10, -DUCK_DB * d[i] / 20) : 1;
  return g;
}

const DEFAULTS = { gain: 0.25, attack: 0.02, release: 'exp', type: 'triangle' };

// Checks and fills defaults; throws on anything a score should not contain.
export function event(e) {
  if (e?.type === 'voice') {
    const ev = { gain: 1, ...e };
    if (typeof ev.id !== 'string' || !ev.id) throw new TypeError(`synth: a voice needs the id of a sample, got ${JSON.stringify(e)}`);
    for (const k of ['t', 'gain']) if (!Number.isFinite(ev[k])) throw new TypeError(`synth: voice '${ev.id}' ${k} must be a number, got ${JSON.stringify(e)}`);
    if (ev.dur !== undefined && !(ev.dur > 0)) throw new RangeError(`synth: voice '${ev.id}' at ${ev.t}s has dur ${ev.dur}`);
    return Object.freeze(ev);
  }
  const ev = { ...DEFAULTS, ...e };
  for (const k of ['t', 'dur', 'gain']) if (!Number.isFinite(ev[k])) throw new TypeError(`synth: event ${k} must be a number, got ${JSON.stringify(e)}`);
  if (ev.dur <= 0) throw new RangeError(`synth: event at ${ev.t}s has dur ${ev.dur}`);
  return Object.freeze(ev);
}

// events => mono Float32Array of ceil(dur * SR) samples, scaled by master (clamped to 0.6), hard-clipped to +-1.
// Voices are mixed after the master, at their own gain, over the score ducked under them.
export function renderScore(events, dur, { master = 0.5 } = {}) {
  const out = new Float32Array(Math.ceil(dur * SR)), voices = [];
  for (const e of events.flat(Infinity)) {
    if (!e) continue;
    const ev = event(e);
    if (ev.type === 'voice') voices.push(ev);
    else if (ev.type === 'noise') addNoise(out, ev); else if (ev.type === 'hiss') addHiss(out, ev); else addNote(out, ev);
  }
  const m = Math.min(MASTER_MAX, Math.max(0, master));
  if (!voices.length) {
    for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i] * m));
    return out;
  }
  const vox = new Float32Array(out.length), duck = duckCurve(voiceSpans(voices), out.length);
  for (const v of voices) addVoice(vox, v);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i] * m * duck[i] + vox[i]));
  return out;
}

// The sample ids a film's score speaks, in order of first use (the player fetches these before it plays).
export const voiceIds = (events) => [...new Set(events.flat(Infinity).filter((e) => e?.type === 'voice').map((e) => e.id))];

// A film's score: film.score(cues) => events (or { events, master }). null when the film has none.
export function scoreEvents(film) {
  if (!film.score) return null;
  const got = film.score(cues(film));
  const events = (Array.isArray(got) ? got : got?.events ?? []).flat(Infinity).filter(Boolean).map(event);
  return { events, master: Array.isArray(got) ? undefined : got?.master };
}

// An excerpt (4.0 E1: hdf render --chapter) sounds as its stretch of the whole film does: the whole score is
// rendered and cut, so a note or a voice under way at its start is heard, and the events are shifted into it.
export function filmAudio(film) {
  const s = scoreEvents(film);
  if (!s) return null;
  if (!film.whole) return { events: s.events, samples: renderScore(s.events, film.dur, { master: s.master }) };
  const t0 = film.from / FPS, all = renderScore(s.events, film.whole.dur, { master: s.master });
  const a = Math.round(t0 * SR), samples = all.slice(a, a + Math.round(film.dur * SR));
  const events = s.events.filter((e) => e.t >= t0 - 1e-9 && e.t < t0 + film.dur - 1e-9).map((e) => ({ ...e, t: e.t - t0 }));
  return { events, samples };
}

// 16-bit PCM WAV bytes (mono unless channels says otherwise; interleaved input).
export function toWav16(samples, { sr = SR, channels = 1 } = {}) {
  const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * channels * 2, true); v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true);
  ws(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0, o = 44; i < n; i++, o += 2) v.setInt16(o, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  return new Uint8Array(buf);
}
