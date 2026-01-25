/**
 * Video Renderer - High-level API for rendering AnimatedScene to MP4
 *
 * Orchestrates:
 * 1. Frame generation from AnimatedFrameGenerator
 * 2. Video encoding with VideoEncoder
 * 3. Audio muxing (if audio provided)
 *
 * Requirements covered:
 * - OUTP-01: Render AnimatedScene to complete MP4 file
 * - OUTP-05: Video uses H.264 encoding with yuv420p pixel format
 * - AUDI-01 through AUDI-04: Audio with volume and fade effects
 */
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { VideoEncoder, type VideoEncoderConfig } from './video-encoder.js';
import { muxAudioWithVideo } from './audio-processor.js';
import {
  AnimatedFrameGenerator,
  type AnimatedScene,
} from '../render/animated-frame-generator.js';
import { RendererRegistry } from '../render/renderer-registry.js';
import { AssetManager } from '../render/asset-manager.js';
import { TextRenderer } from '../render/renderers/text-renderer.js';
import { ImageRenderer } from '../render/renderers/image-renderer.js';
import { ShapeRenderer } from '../render/renderers/shape-renderer.js';
import type { AudioConfig } from '../schemas/audio.js';

export interface RenderVideoOptions {
  /** Scene configuration with animations */
  scenes: AnimatedScene[];
  /** Output dimensions */
  width: number;
  height: number;
  /** Frames per second (default: 30) */
  fps?: number;
  /** Output file path */
  outputPath: string;
  /** Optional audio configuration */
  audio?: AudioConfig;
  /** Encoder quality settings */
  encoder?: {
    crf?: number;
    preset?: VideoEncoderConfig['preset'];
  };
}

export interface RenderProgress {
  /** Current frame being encoded */
  frame: number;
  /** Total frames to encode */
  totalFrames: number;
  /** Progress percentage (0-100) */
  percent: number;
  /** Current phase: 'encoding' or 'muxing' */
  phase: 'encoding' | 'muxing';
}

export interface RenderResult {
  /** Path to output video file */
  outputPath: string;
  /** Total frames rendered */
  frames: number;
  /** Video duration in seconds */
  duration: number;
  /** Whether audio was included */
  hasAudio: boolean;
}

export interface RenderVideoEvents {
  progress: RenderProgress;
  complete: RenderResult;
  error: Error;
}

/**
 * Render animated scenes to MP4 video file.
 *
 * Orchestrates:
 * 1. Frame generation from AnimatedFrameGenerator
 * 2. Video encoding with VideoEncoder
 * 3. Audio muxing (if audio provided)
 *
 * @param options Render configuration
 * @param onProgress Optional progress callback
 * @returns Render result with output path and metadata
 */
export async function renderVideo(
  options: RenderVideoOptions,
  onProgress?: (progress: RenderProgress) => void
): Promise<RenderResult> {
  const {
    scenes,
    width,
    height,
    fps = 30,
    outputPath,
    audio,
    encoder = {},
  } = options;

  // Create renderer components
  const registry = new RendererRegistry();
  registry.register(new TextRenderer());
  registry.register(new ImageRenderer());
  registry.register(new ShapeRenderer());

  const assets = new AssetManager();

  // Create animated frame generator with the scenes
  const generator = new AnimatedFrameGenerator(
    { width, height, fps, scenes },
    registry,
    assets
  );

  // Calculate total frames and duration
  const totalDuration = scenes.reduce((sum, scene) => sum + scene.duration, 0);
  const totalFrames = generator.getTotalFrames();

  // Determine paths for two-pass encoding (video first, then mux audio)
  const needsAudioMux = !!audio?.src;
  const videoOutputPath = needsAudioMux
    ? path.join(os.tmpdir(), `gamemotion-${randomUUID()}.mp4`)
    : outputPath;

  // Phase 1: Encode frames to video
  const videoEncoder = new VideoEncoder({
    width,
    height,
    fps,
    outputPath: videoOutputPath,
    crf: encoder.crf,
    preset: encoder.preset,
  });

  videoEncoder.start();

  let frameIndex = 0;
  for (const frameBuffer of generator.generateAllFrames()) {
    await videoEncoder.writeFrame(frameBuffer);
    frameIndex++;

    if (onProgress) {
      onProgress({
        frame: frameIndex,
        totalFrames,
        percent: Math.round((frameIndex / totalFrames) * 100),
        phase: 'encoding',
      });
    }
  }

  await videoEncoder.finish();

  // Phase 2: Mux audio (if provided)
  if (needsAudioMux && audio) {
    if (onProgress) {
      onProgress({
        frame: totalFrames,
        totalFrames,
        percent: 100,
        phase: 'muxing',
      });
    }

    await muxAudioWithVideo({
      videoPath: videoOutputPath,
      audio,
      outputPath,
      videoDuration: totalDuration,
    });

    // Clean up temp file
    await fs.unlink(videoOutputPath).catch(() => {
      // Ignore cleanup errors
    });
  }

  return {
    outputPath,
    frames: totalFrames,
    duration: totalDuration,
    hasAudio: needsAudioMux,
  };
}
