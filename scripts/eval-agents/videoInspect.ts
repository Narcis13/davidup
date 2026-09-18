// ffprobe/ffmpeg helpers for the "frame-inspection" leg of the eval harness —
// the same render-then-ffprobe pattern as tests/drivers/videoExamples.integration.test.ts,
// plus raw-pixel frame extraction so a rendered frame can be checked for
// "is there actually something drawn here" without a PNG decoder: ffmpeg's
// rawvideo muxer hands back interleaved RGBA bytes directly.

import { spawnSync } from "node:child_process";

export interface FfmpegPaths {
  ffmpeg: string;
  ffprobe: string;
}

export async function resolveFfmpegPaths(): Promise<FfmpegPaths> {
  const ffmpegStatic = (await import("ffmpeg-static")).default as unknown as string | null;
  const ffprobeStatic = (await import("ffprobe-static")).default as { path: string } | undefined;
  return {
    ffmpeg: ffmpegStatic ?? "ffmpeg",
    ffprobe: ffprobeStatic?.path ?? "ffprobe",
  };
}

interface ProbeStream {
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  duration?: string;
}

interface ProbeOutput {
  streams: ProbeStream[];
  format: { duration?: string };
}

export interface VideoProbeInfo {
  width: number;
  height: number;
  durationSec: number;
}

export function probeVideo(ffprobePath: string, filePath: string): VideoProbeInfo {
  const result = spawnSync(
    ffprobePath,
    ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`ffprobe failed (${result.status}): ${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout) as ProbeOutput;
  const videoStream = parsed.streams.find((s) => s.width !== undefined && s.height !== undefined);
  if (!videoStream || videoStream.width === undefined || videoStream.height === undefined) {
    throw new Error("ffprobe returned no video stream with dimensions.");
  }
  const durationStr = parsed.format.duration ?? videoStream.duration;
  const durationSec = durationStr !== undefined ? Number(durationStr) : Number.NaN;
  return { width: videoStream.width, height: videoStream.height, durationSec };
}

/**
 * Extract one frame at `timeSec` as raw interleaved RGBA bytes
 * (width * height * 4 bytes, no container/PNG framing to parse).
 */
export function extractFrameRgba(
  ffmpegPath: string,
  filePath: string,
  timeSec: number,
): Buffer {
  const args = [
    "-y",
    "-ss",
    String(Math.max(0, timeSec)),
    "-i",
    filePath,
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-vsync",
    "0",
    "pipe:1",
  ];
  const result = spawnSync(ffmpegPath, args, { encoding: "buffer", maxBuffer: 1024 * 1024 * 64 });
  if (result.status !== 0) {
    throw new Error(`ffmpeg frame extraction at t=${timeSec}s failed: ${result.stderr?.toString()}`);
  }
  if (!result.stdout || result.stdout.length === 0) {
    throw new Error(`ffmpeg produced no frame data at t=${timeSec}s.`);
  }
  return result.stdout;
}

export interface FrameStats {
  /** Population standard deviation of per-pixel luma, sampled across the frame. */
  stddev: number;
  samples: number;
}

/**
 * Cheap "is this frame blank" heuristic: sample luma across the frame and
 * measure spread. A frame that is one flat color (nothing drawn, or an
 * opaque background with no visible content) has ~zero variance; real
 * content — text, shapes, photos — does not.
 */
export function frameStats(rgba: Buffer): FrameStats {
  const pixelCount = rgba.length / 4;
  const targetSamples = 20_000;
  const stride = Math.max(1, Math.floor(pixelCount / targetSamples));

  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4 * stride) {
    const r = rgba[i] ?? 0;
    const g = rgba[i + 1] ?? 0;
    const b = rgba[i + 2] ?? 0;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    sum += luma;
    sumSq += luma * luma;
    n++;
  }
  if (n === 0) return { stddev: 0, samples: 0 };
  const mean = sum / n;
  const variance = Math.max(0, sumSq / n - mean * mean);
  return { stddev: Math.sqrt(variance), samples: n };
}

const NON_BLANK_STDDEV_THRESHOLD = 1.5;

export function isNonBlank(rgba: Buffer, threshold = NON_BLANK_STDDEV_THRESHOLD): boolean {
  return frameStats(rgba).stddev > threshold;
}
