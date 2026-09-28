// The probes the `asset` CLI brings when no host gives its own (asset-library plan §2: anything heavier is
// injected; these are the light ones, zero dependencies). A host's probes (davidup's ffprobe driver, hdf's
// skia) replace any of them: `{ ...defaultProbes(), ...host }`.
//
//   probeAudio  a WAV's header (format, rate, channels, length) read here; anything else through ffprobe
//   probeVideo  ffprobe ($FFPROBE, else `ffprobe` on the PATH)
//   fontMeta    a TrueType, OpenType or WOFF font's name, OS/2 and maxp tables: family, weight, style, glyphs
//   pixels      a PNG's pixels (preview.js's decoder); other rasters and a video's frame need a host
//
// Each takes the payload as a file and throws when it cannot read it; the library turns that into a warning
// and leaves the fields empty (index.js probeFacts).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { imageType } from './image.js';
import { decodePng } from './preview.js';

// ---------- WAV ----------

// A RIFF WAVE header: { codec, rate, channels, bits, sec }. Throws on anything that is not one.
export function wavInfo(bytes) {
  const b = Buffer.from(bytes);
  if (b.length < 12 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') throw new Error('not a RIFF WAVE file');
  let fmt = null, data = null;
  for (let at = 12; at + 8 <= b.length;) {
    const id = b.toString('latin1', at, at + 4), size = b.readUInt32LE(at + 4);
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(at + 8), channels: b.readUInt16LE(at + 10), rate: b.readUInt32LE(at + 12), byteRate: b.readUInt32LE(at + 16), bits: b.readUInt16LE(at + 22) };
    if (id === 'data') data = Math.min(size, b.length - at - 8);
    at += 8 + size + (size & 1);
  }
  if (!fmt) throw new Error('WAV has no fmt chunk');
  if (data === null) throw new Error('WAV has no data chunk');
  const codec = { 1: 'pcm', 3: 'pcm_float', 0xfffe: 'pcm' }[fmt.format] ?? `wav format ${fmt.format}`;
  return { codec, rate: fmt.rate, channels: fmt.channels, bits: fmt.bits, sec: fmt.byteRate ? +(data / fmt.byteRate).toFixed(3) : undefined };
}

// ---------- fonts ----------

// The tables of an sfnt (TrueType, OpenType/CFF, the first face of a collection) or a WOFF 1.0, as a map of
// tag -> bytes. WOFF2 (brotli with transformed glyphs) is not read here.
function fontTables(bytes) {
  const b = Buffer.from(bytes), sig = b.toString('latin1', 0, 4), tables = new Map();
  if (sig === 'wOF2') throw new Error('WOFF2 is not read here; give --family');
  if (sig === 'wOFF') {
    const n = b.readUInt16BE(12);
    for (let i = 0; i < n; i++) {
      const r = 44 + i * 20, tag = b.toString('latin1', r, r + 4), off = b.readUInt32BE(r + 4), comp = b.readUInt32BE(r + 8), orig = b.readUInt32BE(r + 12);
      const raw = b.subarray(off, off + comp);
      tables.set(tag, comp < orig ? inflateSync(raw) : raw);
    }
    return tables;
  }
  const base = sig === 'ttcf' ? b.readUInt32BE(12) : 0, head = b.readUInt32BE(base);
  if (head !== 0x00010000 && b.toString('latin1', base, base + 4) !== 'OTTO' && b.toString('latin1', base, base + 4) !== 'true') {
    throw new Error('not a TrueType, OpenType or WOFF font');
  }
  const n = b.readUInt16BE(base + 4);
  for (let i = 0; i < n; i++) {
    const r = base + 12 + i * 16, off = b.readUInt32BE(r + 8), len = b.readUInt32BE(r + 12);
    tables.set(b.toString('latin1', r, r + 4), b.subarray(off, off + len));
  }
  return tables;
}

// The strings of a name table by nameID, English Windows names first, then Mac Roman, then Unicode.
function fontNames(t) {
  if (!t) return {};
  const count = t.readUInt16BE(2), strings = t.readUInt16BE(4), out = {}, rank = {};
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12, platform = t.readUInt16BE(r), lang = t.readUInt16BE(r + 4), id = t.readUInt16BE(r + 6);
    const len = t.readUInt16BE(r + 8), off = strings + t.readUInt16BE(r + 10), raw = t.subarray(off, off + len);
    const score = platform === 3 ? (lang === 0x409 ? 3 : 2) : platform === 1 ? (lang === 0 ? 1.5 : 1) : platform === 0 ? 1.2 : 0;
    if (!score || (rank[id] ?? 0) >= score) continue;
    out[id] = platform === 1 ? raw.toString('latin1') : Buffer.from(raw).swap16().toString('utf16le');
    rank[id] = score;
  }
  return out;
}

// A font's { family, weight, style, glyphs }: the typographic family (name 16) or the family (name 1), the
// OS/2 weight class, italic from OS/2 fsSelection or the subfamily name, maxp's glyph count.
export function fontInfo(bytes) {
  const tables = fontTables(bytes), names = fontNames(tables.get('name'));
  const family = (names[16] || names[1] || '').trim();
  if (!family) throw new Error('the font has no family name');
  const os2 = tables.get('OS/2'), maxp = tables.get('maxp');
  const italic = (os2 && os2.length >= 64 && (os2.readUInt16BE(62) & 1) === 1) || /italic|oblique/i.test(names[17] || names[2] || '');
  return {
    family,
    ...(os2 && os2.length >= 6 ? { weight: os2.readUInt16BE(4) } : {}),
    style: italic ? 'italic' : 'normal',
    ...(maxp && maxp.length >= 6 ? { glyphs: maxp.readUInt16BE(4) } : {}),
  };
}

// ---------- ffprobe ----------

// ffprobe's JSON for a file: $FFPROBE, else `ffprobe` on the PATH. Throws naming what went wrong.
export function ffprobe(file, { bin = process.env.FFPROBE || 'ffprobe' } = {}) {
  const r = spawnSync(bin, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8' });
  if (r.error) throw new Error(r.error.code === 'ENOENT' ? `${bin} is not on the PATH (set $FFPROBE)` : r.error.message);
  if (r.status !== 0) throw new Error(`${bin} failed: ${(r.stderr || '').trim().split('\n').pop() || `exit ${r.status}`}`);
  return JSON.parse(r.stdout);
}

const rate = (s) => {
  const [n, d] = String(s ?? '').split('/').map(Number);
  return n > 0 && (d === undefined || d > 0) ? +(n / (d || 1)).toFixed(3) : undefined;
};
const seconds = (...vs) => vs.map(Number).find((v) => Number.isFinite(v) && v > 0);
const ALPHA_FMT = /^(yuva|rgba|bgra|argb|abgr|gbrap|ya)/;

// A video's { sec, fps, w, h, alpha, codec, audio } from ffprobe.
export function videoInfo(file, opts) {
  const p = ffprobe(file, opts), s = (p.streams ?? []).find((x) => x.codec_type === 'video');
  if (!s) throw new Error('no video stream');
  const tag = Object.entries(s.tags ?? {}).find(([k]) => k.toLowerCase() === 'alpha_mode')?.[1];
  return {
    sec: seconds(p.format?.duration, s.duration), fps: rate(s.avg_frame_rate) ?? rate(s.r_frame_rate),
    w: s.width, h: s.height, alpha: ALPHA_FMT.test(s.pix_fmt ?? '') || tag === '1', codec: s.codec_name,
    audio: (p.streams ?? []).some((x) => x.codec_type === 'audio'),
  };
}

// A sound's { sec, rate, channels, codec }: a WAV's header here, anything else through ffprobe.
export function audioInfo(file, opts) {
  const bytes = readFileSync(file);
  if (bytes.toString('latin1', 0, 4) === 'RIFF') {
    const w = wavInfo(bytes);
    return { sec: w.sec, rate: w.rate, channels: w.channels, codec: w.codec };
  }
  const p = ffprobe(file, opts), s = (p.streams ?? []).find((x) => x.codec_type === 'audio');
  if (!s) throw new Error('no audio stream');
  return { sec: seconds(p.format?.duration, s.duration), rate: Number(s.sample_rate) || undefined, channels: s.channels, codec: s.codec_name };
}

// A raster's pixels, for `colours`: PNGs only (other formats need a host's decoder).
export function pngPixels(file) {
  const bytes = readFileSync(file);
  if (imageType(bytes) !== 'png') throw new Error(`only a PNG is decoded here (this is ${imageType(bytes) ?? 'not an image'})`);
  return decodePng(bytes);
}

// The probes above, in the shape lib.put takes.
export const defaultProbes = ({ ffprobe: bin } = {}) => ({
  probeVideo: (file) => videoInfo(file, { bin }),
  probeAudio: (file) => audioInfo(file, { bin }),
  fontMeta: (file) => fontInfo(readFileSync(file)),
  pixels: (file) => pngPixels(file),
});
