// The score as samples. Events are data; renderScore mixes them into a Float32Array at 44.1 kHz with the
// v1 envelope (note, noiseBurst), so the Node driver and the player play the same samples.
//   { t, dur, hz, type: 'sine'|'triangle'|'square'|'saw'|'noise'|'hiss', gain = .25, attack = .02, release = 'exp', seed }
// hiss: seeded white noise through a band-pass at hz (q, default .8), held at gain for dur (v1 sand gestures).
// Nothing here reads Date, Math.random or global state.
import { rng } from './rand.js';
import { cues } from './tree.js';

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

const DEFAULTS = { gain: 0.25, attack: 0.02, release: 'exp', type: 'triangle' };

// Checks and fills defaults; throws on anything a score should not contain.
export function event(e) {
  const ev = { ...DEFAULTS, ...e };
  for (const k of ['t', 'dur', 'gain']) if (!Number.isFinite(ev[k])) throw new TypeError(`synth: event ${k} must be a number, got ${JSON.stringify(e)}`);
  if (ev.dur <= 0) throw new RangeError(`synth: event at ${ev.t}s has dur ${ev.dur}`);
  return Object.freeze(ev);
}

// events => mono Float32Array of ceil(dur * SR) samples, scaled by master (clamped to 0.6), hard-clipped to +-1.
export function renderScore(events, dur, { master = 0.5 } = {}) {
  const out = new Float32Array(Math.ceil(dur * SR));
  for (const e of events.flat(Infinity)) {
    if (!e) continue;
    const ev = event(e);
    if (ev.type === 'noise') addNoise(out, ev); else if (ev.type === 'hiss') addHiss(out, ev); else addNote(out, ev);
  }
  const m = Math.min(MASTER_MAX, Math.max(0, master));
  for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i] * m));
  return out;
}

// A film's score: film.score(cues) => events (or { events, master }). null when the film has none.
export function scoreEvents(film) {
  if (!film.score) return null;
  const got = film.score(cues(film));
  const events = (Array.isArray(got) ? got : got?.events ?? []).flat(Infinity).filter(Boolean).map(event);
  return { events, master: Array.isArray(got) ? undefined : got?.master };
}

export function filmAudio(film) {
  const s = scoreEvents(film);
  return s && { events: s.events, samples: renderScore(s.events, film.dur, { master: s.master }) };
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
