/**
 * Integration tests for video encoding pipeline.
 *
 * These tests require actual FFmpeg execution and may take a few seconds.
 * Tests verify:
 * - VideoEncoder produces valid H.264 MP4 files
 * - renderVideo() orchestrates complete pipeline
 * - Output videos have correct dimensions, duration, and codec
 * - Progress callbacks work correctly
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';
import ffprobePath from 'ffprobe-static';

import { renderVideo, VideoEncoder } from '../../src/encoder/index.js';
import type { AnimatedScene } from '../../src/render/animated-frame-generator.js';

/**
 * Get video metadata using ffprobe.
 * Returns duration, dimensions, codec, and audio presence.
 */
async function getVideoInfo(videoPath: string): Promise<{
  duration: number;
  width: number;
  height: number;
  codec: string;
  hasAudio: boolean;
}> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      videoPath,
    ];

    const proc = spawn(ffprobePath.path, args);
    let output = '';

    proc.stdout.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}`));
        return;
      }

      const info = JSON.parse(output);
      const videoStream = info.streams.find(
        (s: { codec_type: string }) => s.codec_type === 'video'
      );
      const audioStream = info.streams.find(
        (s: { codec_type: string }) => s.codec_type === 'audio'
      );

      resolve({
        duration: parseFloat(info.format.duration),
        width: videoStream?.width || 0,
        height: videoStream?.height || 0,
        codec: videoStream?.codec_name || '',
        hasAudio: !!audioStream,
      });
    });

    proc.on('error', reject);
  });
}

describe('Video Encoder Integration', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gamemotion-test-'));
  });

  afterAll(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('VideoEncoder', () => {
    it('should encode raw frames to H.264 MP4', async () => {
      const outputPath = path.join(tempDir, 'test-encoder.mp4');
      const width = 320;
      const height = 240;
      const fps = 30;
      const frameCount = 30; // 1 second

      const encoder = new VideoEncoder({
        width,
        height,
        fps,
        outputPath,
        preset: 'ultrafast', // Fast for tests
      });

      encoder.start();

      // Write solid color frames (red)
      const frameSize = width * height * 4; // RGBA
      const frame = Buffer.alloc(frameSize);
      for (let i = 0; i < frameSize; i += 4) {
        frame[i] = 255; // R
        frame[i + 1] = 0; // G
        frame[i + 2] = 0; // B
        frame[i + 3] = 255; // A
      }

      for (let i = 0; i < frameCount; i++) {
        await encoder.writeFrame(frame);
      }

      await encoder.finish();

      // Verify output exists and is valid
      const stats = await fs.stat(outputPath);
      expect(stats.size).toBeGreaterThan(0);

      const info = await getVideoInfo(outputPath);
      expect(info.codec).toBe('h264');
      expect(info.width).toBe(width);
      expect(info.height).toBe(height);
      expect(info.duration).toBeCloseTo(1, 0); // ~1 second
    }, 30000); // 30s timeout for encoding

    it('should handle different video dimensions', async () => {
      const outputPath = path.join(tempDir, 'test-dimensions.mp4');
      const width = 640;
      const height = 480;
      const fps = 30;
      const frameCount = 15; // 0.5 seconds

      const encoder = new VideoEncoder({
        width,
        height,
        fps,
        outputPath,
        preset: 'ultrafast',
      });

      encoder.start();

      const frameSize = width * height * 4;
      const frame = Buffer.alloc(frameSize, 128); // Gray

      for (let i = 0; i < frameCount; i++) {
        await encoder.writeFrame(frame);
      }

      await encoder.finish();

      const info = await getVideoInfo(outputPath);
      expect(info.width).toBe(width);
      expect(info.height).toBe(height);
      expect(info.duration).toBeCloseTo(0.5, 1);
    }, 30000);
  });

  describe('renderVideo', () => {
    it('should render simple scene to MP4', async () => {
      const outputPath = path.join(tempDir, 'test-render.mp4');

      // Use TextElement format: text, fontFamily, fontSize (not content, font object)
      const scenes: AnimatedScene[] = [
        {
          duration: 1,
          background: '#0000ff',
          elements: [
            {
              id: 'text-1',
              type: 'text',
              text: 'Hello World',
              x: 160,
              y: 120,
              fontFamily: 'Arial',
              fontSize: 24,
              color: '#ffffff',
            },
          ],
        },
      ];

      const result = await renderVideo({
        scenes,
        width: 320,
        height: 240,
        fps: 30,
        outputPath,
        encoder: { preset: 'ultrafast' },
      });

      expect(result.outputPath).toBe(outputPath);
      expect(result.frames).toBe(30); // 1s * 30fps
      expect(result.duration).toBe(1);
      expect(result.hasAudio).toBe(false);

      const info = await getVideoInfo(outputPath);
      expect(info.codec).toBe('h264');
      expect(info.hasAudio).toBe(false);
    }, 30000);

    it('should render animated element with keyframes', async () => {
      const outputPath = path.join(tempDir, 'test-animated.mp4');

      const scenes: AnimatedScene[] = [
        {
          duration: 2,
          background: '#000000',
          elements: [
            {
              id: 'rect-1',
              type: 'shape',
              shape: 'rectangle',
              x: 10,
              y: 100,
              width: 50,
              height: 50,
              fill: '#ff0000',
              animations: [
                {
                  property: 'x',
                  keyframes: [
                    { frame: 0, value: 10 },
                    { frame: 60, value: 260 },
                  ],
                },
              ],
            },
          ],
        },
      ];

      const result = await renderVideo({
        scenes,
        width: 320,
        height: 240,
        fps: 30,
        outputPath,
        encoder: { preset: 'ultrafast' },
      });

      expect(result.frames).toBe(60); // 2s * 30fps

      const info = await getVideoInfo(outputPath);
      expect(info.duration).toBeCloseTo(2, 0);
    }, 30000);

    it('should report progress during encoding', async () => {
      const outputPath = path.join(tempDir, 'test-progress.mp4');
      const progressEvents: number[] = [];

      const scenes: AnimatedScene[] = [
        {
          duration: 1,
          background: '#333333',
          elements: [],
        },
      ];

      await renderVideo(
        {
          scenes,
          width: 320,
          height: 240,
          fps: 30,
          outputPath,
          encoder: { preset: 'ultrafast' },
        },
        (progress) => {
          progressEvents.push(progress.percent);
        }
      );

      // Should have multiple progress events
      expect(progressEvents.length).toBeGreaterThan(5);
      // Should end at 100%
      expect(progressEvents[progressEvents.length - 1]).toBe(100);
    }, 30000);

    it('should handle multi-scene video', async () => {
      const outputPath = path.join(tempDir, 'test-multiscene.mp4');

      const scenes: AnimatedScene[] = [
        {
          duration: 0.5,
          background: '#ff0000',
          elements: [],
        },
        {
          duration: 0.5,
          background: '#00ff00',
          elements: [],
        },
        {
          duration: 0.5,
          background: '#0000ff',
          elements: [],
        },
      ];

      const result = await renderVideo({
        scenes,
        width: 320,
        height: 240,
        fps: 30,
        outputPath,
        encoder: { preset: 'ultrafast' },
      });

      expect(result.duration).toBeCloseTo(1.5, 1);
      expect(result.frames).toBe(45); // 1.5s * 30fps

      const info = await getVideoInfo(outputPath);
      expect(info.duration).toBeCloseTo(1.5, 0);
    }, 30000);

    it('should render scene with shape elements', async () => {
      const outputPath = path.join(tempDir, 'test-shapes.mp4');

      const scenes: AnimatedScene[] = [
        {
          duration: 1,
          background: '#ffffff',
          elements: [
            {
              id: 'rect-1',
              type: 'shape',
              shape: 'rectangle',
              x: 50,
              y: 50,
              width: 100,
              height: 80,
              fill: '#ff0000',
            },
            {
              id: 'circle-1',
              type: 'shape',
              shape: 'circle',
              x: 200,
              y: 100,
              radius: 40,
              fill: '#00ff00',
            },
          ],
        },
      ];

      const result = await renderVideo({
        scenes,
        width: 320,
        height: 240,
        fps: 30,
        outputPath,
        encoder: { preset: 'ultrafast' },
      });

      expect(result.frames).toBe(30);
      expect(result.hasAudio).toBe(false);

      const info = await getVideoInfo(outputPath);
      expect(info.codec).toBe('h264');
      expect(info.width).toBe(320);
      expect(info.height).toBe(240);
    }, 30000);

    it('should handle element visibility timing', async () => {
      const outputPath = path.join(tempDir, 'test-timing.mp4');

      const scenes: AnimatedScene[] = [
        {
          duration: 2,
          background: '#000000',
          elements: [
            {
              id: 'text-appear',
              type: 'text',
              text: 'Appears at 0.5s',
              x: 160,
              y: 120,
              fontFamily: 'Arial',
              fontSize: 20,
              color: '#ffffff',
              startTime: 0.5,
              endTime: 1.5,
            },
          ],
        },
      ];

      const result = await renderVideo({
        scenes,
        width: 320,
        height: 240,
        fps: 30,
        outputPath,
        encoder: { preset: 'ultrafast' },
      });

      expect(result.frames).toBe(60); // 2s * 30fps

      const info = await getVideoInfo(outputPath);
      expect(info.duration).toBeCloseTo(2, 0);
    }, 30000);
  });
});
