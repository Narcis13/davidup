// ffmpeg as a sink for raw RGBA frames. Spawn, backpressure and drain handling follow
// src/drivers/node/index.ts (the davidup driver) rather than re-deriving them.
import { spawn } from 'node:child_process';

const STDERR_TAIL = 8192;

// Drawn at 12 fps, packed to 24 by frame duplication (-r 24), H.264 yuv420p.
export function h264Args(out, { w, h, fps = 12, outFps = 24, crf = 18 }) {
  return ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-framerate', String(fps), '-i', '-',
    '-r', String(outFps), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', String(crf), '-movflags', '+faststart', out];
}

// { write(buf) => Promise, end() => Promise, kill() }. write resolves once ffmpeg can take more.
export function ffmpegSink(args, { bin = process.env.FFMPEG ?? 'ffmpeg' } = {}) {
  const proc = spawn(bin, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let tail = '', failed;
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (c) => { tail = (tail + c).slice(-STDERR_TAIL); });
  // Race-aware close and stdin error, so a crashed ffmpeg (EPIPE, missing codec) fails fast instead of hanging on drain.
  const closed = new Promise((res) => {
    proc.on('error', (e) => { failed ??= e; res({ code: null, signal: null }); });
    proc.on('close', (code, signal) => res({ code, signal }));
  });
  proc.stdin.on('error', (e) => { failed ??= e; });
  const drain = () => new Promise((res) => {
    const done = () => { proc.stdin.off('drain', done); proc.off('close', done); res(); };
    proc.stdin.once('drain', done);
    proc.once('close', done);
  });
  return {
    async write(buf) {
      if (failed) throw failed;
      if (!proc.stdin.write(buf)) await drain();
      if (failed) throw failed;
    },
    async end() {
      proc.stdin.end();
      const { code, signal } = await closed;
      if (failed && code !== 0) throw new Error(`ffmpeg: ${failed.message}${tail ? `\n${tail.trim()}` : ''}`);
      if (code !== 0) throw new Error(`ffmpeg exited with ${code === null ? `signal ${signal ?? 'unknown'}` : `code ${code}`}${tail ? `:\n${tail.trim()}` : ''}`);
    },
    kill() { try { proc.kill('SIGKILL'); } catch { /* already gone */ } },
  };
}
