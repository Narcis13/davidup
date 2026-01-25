/**
 * VideoEncoder - Frame-by-frame video encoding via FFmpeg
 *
 * Accepts raw RGBA frame buffers from @napi-rs/canvas and encodes
 * them to H.264 MP4 video using FFmpeg with proper backpressure handling.
 */
import { EventEmitter } from 'node:events';
import { spawnFFmpeg, type FFmpegProcess } from './ffmpeg-process.js';

export interface VideoEncoderConfig {
  width: number;
  height: number;
  fps: number;
  outputPath: string;
  /** Quality (0-51, default 23, lower = better) */
  crf?: number;
  /** Speed preset (default: 'medium') */
  preset?: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' |
           'medium' | 'slow' | 'slower' | 'veryslow';
}

export interface VideoEncoderEvents {
  progress: { frame: number };
  complete: { frames: number; outputPath: string };
  log: string;
}

export class VideoEncoder extends EventEmitter {
  private ffmpeg: FFmpegProcess | null = null;
  private frameCount = 0;
  private readonly config: VideoEncoderConfig;

  constructor(config: VideoEncoderConfig) {
    super();
    this.config = {
      crf: 23,
      preset: 'medium',
      ...config
    };
  }

  /**
   * Start the encoding process. Must be called before writeFrame().
   */
  start(): void {
    if (this.ffmpeg) {
      throw new Error('Encoder already started');
    }

    const { width, height, fps, outputPath, crf, preset } = this.config;

    // CRITICAL: Input options MUST come before -i
    // CRITICAL: Use -pix_fmt rgba for input (matches canvas.data())
    // CRITICAL: Use -pix_fmt yuv420p for output (compatibility)
    const args = [
      // Input configuration
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',           // Match @napi-rs/canvas output
      '-s', `${width}x${height}`,
      '-r', String(fps),
      '-i', 'pipe:0',               // Read from stdin

      // Output configuration
      '-c:v', 'libx264',
      '-preset', preset!,
      '-crf', String(crf),
      '-pix_fmt', 'yuv420p',        // Required for compatibility
      '-movflags', '+faststart',    // Optimize for web playback
      '-y',                          // Overwrite output
      outputPath
    ];

    this.ffmpeg = spawnFFmpeg({
      args,
      stdin: 'pipe',
      onStderr: (data) => this.emit('log', data)
    });
  }

  /**
   * Write a single frame to the encoder.
   * Frame must be raw RGBA buffer from canvas.data().
   * Handles backpressure automatically.
   */
  async writeFrame(buffer: Buffer): Promise<void> {
    if (!this.ffmpeg?.stdin) {
      throw new Error('Encoder not started. Call start() first.');
    }

    const canWrite = this.ffmpeg.stdin.write(buffer);
    this.frameCount++;
    this.emit('progress', { frame: this.frameCount });

    // Handle backpressure - wait for drain before continuing
    if (!canWrite) {
      await new Promise<void>(resolve =>
        this.ffmpeg!.stdin!.once('drain', resolve)
      );
    }
  }

  /**
   * Finish encoding and wait for output file to be written.
   * CRITICAL: Must call stdin.end() or FFmpeg hangs forever.
   */
  async finish(): Promise<void> {
    if (!this.ffmpeg?.stdin) {
      throw new Error('Encoder not started');
    }

    // Signal end of input - CRITICAL for FFmpeg to finalize
    this.ffmpeg.stdin.end();

    // Wait for encoding to complete
    await this.ffmpeg.finished;

    this.emit('complete', {
      frames: this.frameCount,
      outputPath: this.config.outputPath
    });
  }

  /**
   * Abort encoding (e.g., on error or cancellation).
   */
  abort(): void {
    this.ffmpeg?.process.kill('SIGKILL');
    this.ffmpeg = null;
  }

  /**
   * Get current frame count.
   */
  getFrameCount(): number {
    return this.frameCount;
  }

  /**
   * Get encoder configuration.
   */
  getConfig(): VideoEncoderConfig {
    return { ...this.config };
  }
}
