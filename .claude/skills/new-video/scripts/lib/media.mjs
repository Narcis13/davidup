// ffmpeg / ffprobe for the new-video tools: finding the binaries, probing a file, and reading decoded
// frames and samples straight off a pipe (no temp files for the analysis passes).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function staticBin(pkg) {
  try {
    const p = require(pkg);
    const path = typeof p === 'string' ? p : p?.path;
    return path && existsSync(path) ? path : null;
  } catch {
    return null;
  }
}

// $FFMPEG, else the repo's ffmpeg-static when its binary is there, else ffmpeg on PATH.
export const FFMPEG = process.env.FFMPEG || staticBin('ffmpeg-static') || 'ffmpeg';
export const FFPROBE = process.env.FFPROBE || staticBin('ffprobe-static') || 'ffprobe';

export function probe(file) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8', maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(`ffprobe failed on ${file}: ${(r.stderr || '').trim().split('\n').pop()}`);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  const rate = (s) => {
    if (!s) return 0;
    const [n, d] = String(s.avg_frame_rate || s.r_frame_rate || '0/1').split('/').map(Number);
    return d ? n / d : n;
  };
  const duration = Number(j.format?.duration ?? v?.duration ?? a?.duration ?? 0);
  return {
    duration,
    width: v ? v.width : 0,
    height: v ? v.height : 0,
    fps: rate(v),
    codec: v?.codec_name ?? null,
    alpha: /a/.test(v?.pix_fmt ?? '') && !/^(gray|nv|yuvj)/.test(v?.pix_fmt ?? ''),
    audio: !!a,
    audioCodec: a?.codec_name ?? null,
    video: !!v,
  };
}

// Run ffmpeg and collect stdout as one Buffer.
export function ffmpegBuffer(args, { maxBytes = 1 << 30 } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let n = 0, err = '';
    p.stdout.on('data', (c) => {
      n += c.length;
      if (n > maxBytes) { p.kill('SIGKILL'); reject(new Error(`ffmpeg output over ${maxBytes} bytes`)); return; }
      chunks.push(c);
    });
    p.stderr.on('data', (c) => { err += c; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) reject(new Error(`ffmpeg ${args.slice(0, 6).join(' ')} ... failed (${code}): ${err.trim().split('\n').slice(-3).join(' | ')}`));
      else resolve(Buffer.concat(chunks));
    });
  });
}

export function ffmpegRun(args) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 1 << 24 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ')}`);
}

// Every frame at `fps`, scaled to `width` (even height), as RGB24 buffers.
export async function rgbFrames(file, { fps = 10, width = 96, from, to } = {}) {
  const info = probe(file);
  const w = width, h = Math.max(2, 2 * Math.round((info.height / info.width) * width / 2));
  const args = [];
  if (from !== undefined) args.push('-ss', String(from));
  args.push('-i', file);
  if (to !== undefined) args.push('-t', String(to - (from ?? 0)));
  args.push('-vf', `fps=${fps},scale=${w}:${h}:flags=area,format=rgb24`, '-f', 'rawvideo', '-');
  const buf = await ffmpegBuffer(args);
  const size = w * h * 3, frames = [];
  for (let o = 0; o + size <= buf.length; o += size) frames.push(buf.subarray(o, o + size));
  return { frames, w, h, fps, info };
}

// Selected frames of the `fps` stream (indices n), scaled to `width`, as JPEG files `${prefix}NNN.jpg`
// (one decode pass). Returns the paths in the order of `indices`.
export function extractFrames(file, indices, { fps = 10, width = 480, prefix, from } = {}) {
  if (!indices.length) return [];
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const sel = sorted.map((n) => `eq(n\\,${n})`).join('+');
  const args = [];
  if (from !== undefined) args.push('-ss', String(from));
  args.push('-i', file, '-vf', `fps=${fps},select='${sel}',scale=${width}:-2:flags=lanczos`, '-fps_mode', 'vfr', '-q:v', '3', `${prefix}%03d.jpg`);
  ffmpegRun(args);
  const byN = new Map(sorted.map((n, k) => [n, `${prefix}${String(k + 1).padStart(3, '0')}.jpg`]));
  return indices.map((n) => byN.get(n));
}

// Mono float32 samples at `rate`, or null when the file has no audio.
export async function monoSamples(file, { rate = 11025 } = {}) {
  const info = probe(file);
  if (!info.audio) return null;
  const buf = await ffmpegBuffer(['-i', file, '-vn', '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-']);
  const out = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 4)));
  return { samples: out, rate };
}
