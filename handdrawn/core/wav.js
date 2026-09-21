// WAV bytes -> mono float samples at the synth's rate (4.0 V1, narration). Browser-safe: the player decodes
// the same bytes the Node driver does, so a voice sits under the same frames in both.
//
//   readWav(bytes)            { sr, channels, bits, float, sec, data: Float32Array[] }, one array per channel
//   decodeWav(bytes, { sr })  mono (channels averaged), resampled to sr (the synth's 44.1 kHz by default)
//   voicedSpan(samples, sr)   [t0, t1] seconds of the part above the energy floor, or null when all silence
//
// PCM 8/16/24/32-bit and IEEE float 32/64, plain or WAVE_FORMAT_EXTENSIBLE; chunks are walked, so a LIST or
// fact chunk before the data (what `say`, Audacity and phones write) is skipped rather than read as sound.
const SR = 44100;   // synth.js SR (not imported: synth.js imports this module)

const u8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b.buffer ?? b, b.byteOffset ?? 0, b.byteLength));
const tag = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

// { sr, channels, bits, float, sec, data: Float32Array per channel } off the fmt and data chunks.
export function readWav(bytes) {
  const b = u8(bytes), v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 12 || tag(b, 0) !== 'RIFF' || tag(b, 8) !== 'WAVE') throw new Error('wav: not a RIFF/WAVE file (the package takes wavs; see the skill for making one)');
  let fmt = null, data = null;
  for (let o = 12; o + 8 <= b.length;) {
    const id = tag(b, o), len = v.getUint32(o + 4, true), body = o + 8;
    if (id === 'fmt ') fmt = { code: v.getUint16(body, true), channels: v.getUint16(body + 2, true), sr: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true), ext: len >= 26 ? v.getUint16(body + 24, true) : null };
    // A data chunk whose length runs past the file (a recorder that never patched its header) reads to the end.
    else if (id === 'data') { data = [body, Math.min(len, b.length - body)]; break; }
    o = body + len + (len & 1);
  }
  if (!fmt) throw new Error('wav: no fmt chunk');
  if (!data) throw new Error('wav: no data chunk');
  const code = fmt.code === 0xfffe ? fmt.ext : fmt.code, { channels: ch, bits } = fmt;
  const float = code === 3;
  if (!(code === 1 || float)) throw new Error(`wav: format ${code} is not PCM or float (re-export as 16-bit PCM)`);
  if (!ch || !fmt.sr) throw new Error('wav: no channels or no sample rate');
  if (float ? bits !== 32 && bits !== 64 : ![8, 16, 24, 32].includes(bits)) throw new Error(`wav: ${bits}-bit ${float ? 'float' : 'PCM'} is not supported`);
  const size = bits / 8, n = Math.floor(data[1] / (size * ch));
  const read = float
    ? (bits === 32 ? (o) => v.getFloat32(o, true) : (o) => v.getFloat64(o, true))
    : bits === 8 ? (o) => (b[o] - 128) / 128
      : bits === 16 ? (o) => v.getInt16(o, true) / 32768
        : bits === 24 ? (o) => ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) << 8 >> 8) / 8388608
          : (o) => v.getInt32(o, true) / 2147483648;
  const out = Array.from({ length: ch }, () => new Float32Array(n));
  for (let i = 0, o = data[0]; i < n; i++) for (let c = 0; c < ch; c++, o += size) out[c][i] = read(o);
  return { sr: fmt.sr, channels: ch, bits, float, sec: n / fmt.sr, data: out };
}

// Linear interpolation between neighbours; speech at 16 to 48 kHz loses nothing a film mix hears.
export function resample(x, from, to = SR) {
  if (from === to) return x;
  const n = Math.max(1, Math.round(x.length * to / from)), out = new Float32Array(n), step = from / to;
  for (let i = 0; i < n; i++) {
    const p = i * step, k = Math.floor(p), f = p - k, a = x[Math.min(k, x.length - 1)], c = x[Math.min(k + 1, x.length - 1)];
    out[i] = a + (c - a) * f;
  }
  return out;
}

// Mono samples at sr (channels averaged, resampled): what the synth mixes.
export function decodeWav(bytes, { sr = SR } = {}) {
  const w = readWav(bytes);
  let mono = w.data[0];
  if (w.channels > 1) {
    mono = new Float32Array(mono.length);
    for (const c of w.data) for (let i = 0; i < c.length; i++) mono[i] += c[i] / w.channels;
  }
  return resample(mono, w.sr, sr);
}

// The voiced region: 20 ms windows whose RMS is above `floor` (-40 dBFS by default), first to last. Ducking
// (synth.js) and the contact sheet's voice bars use it, so a line's leading silence neither ducks the score
// nor draws.
export function voicedSpan(x, sr = SR, { floor = 0.01, win = 0.02 } = {}) {
  const w = Math.max(1, Math.round(win * sr)), f2 = floor * floor;
  let first = -1, last = -1;
  for (let k = 0; k * w < x.length; k++) {
    let s = 0;
    const end = Math.min(x.length, (k + 1) * w);
    for (let i = k * w; i < end; i++) s += x[i] * x[i];
    if (s / (end - k * w) > f2) { if (first < 0) first = k; last = k; }
  }
  return first < 0 ? null : [first * w / sr, Math.min(x.length, (last + 1) * w) / sr];
}
