/**
 * FFmpeg Process Wrapper
 *
 * Promise-based FFmpeg spawn wrapper for video encoding.
 * Provides clean interface for spawning FFmpeg processes
 * with stdin piping support for frame data.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';

// ffmpeg-static is CJS, use createRequire for ESM compatibility
const require = createRequire(import.meta.url);
const ffmpegPath: string | null = require('ffmpeg-static');

/**
 * Options for spawning an FFmpeg process
 */
export interface FFmpegProcessOptions {
  /** FFmpeg arguments (input/output options, filters, etc.) */
  args: string[];
  /** stdin mode: 'pipe' for frame input, 'ignore' for file input */
  stdin?: 'pipe' | 'ignore';
  /** Callback for stderr output (errors, progress) */
  onStderr?: (data: string) => void;
}

/**
 * Handle to a spawned FFmpeg process
 */
export interface FFmpegProcess {
  /** The underlying child process */
  process: ChildProcess;
  /** stdin stream (only available when stdin='pipe') */
  stdin: NodeJS.WritableStream | null;
  /** Promise that resolves when process completes successfully */
  finished: Promise<void>;
}

/**
 * Spawn an FFmpeg process with the given options.
 *
 * Automatically includes -hide_banner and -loglevel error flags.
 * Caller is responsible for argument ordering (input options before -i flag).
 *
 * @example
 * // Encode frames piped to stdin
 * const { stdin, finished } = spawnFFmpeg({
 *   args: ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', '1920x1080', '-r', '30', '-i', '-', 'output.mp4'],
 *   stdin: 'pipe'
 * });
 *
 * for (const frame of frames) {
 *   stdin.write(frame);
 * }
 * stdin.end();
 * await finished;
 *
 * @example
 * // Encode from file
 * const { finished } = spawnFFmpeg({
 *   args: ['-i', 'input.mp4', '-c:v', 'libx264', 'output.mp4'],
 *   stdin: 'ignore'
 * });
 * await finished;
 */
export function spawnFFmpeg(options: FFmpegProcessOptions): FFmpegProcess {
  const { args, stdin = 'ignore', onStderr } = options;

  if (!ffmpegPath) {
    throw new Error('FFmpeg binary not found. Ensure ffmpeg-static is installed.');
  }

  const ffmpeg = spawn(ffmpegPath, [
    '-hide_banner',
    '-loglevel', 'error',
    ...args
  ], {
    stdio: [stdin, 'pipe', 'pipe']
  });

  if (onStderr) {
    ffmpeg.stderr?.on('data', (data: Buffer) => {
      onStderr(data.toString());
    });
  }

  const finished = new Promise<void>((resolve, reject) => {
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
    ffmpeg.on('error', reject);
  });

  return {
    process: ffmpeg,
    stdin: stdin === 'pipe' ? ffmpeg.stdin : null,
    finished
  };
}
