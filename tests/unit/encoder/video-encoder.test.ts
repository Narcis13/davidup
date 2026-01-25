/**
 * VideoEncoder Unit Tests
 *
 * Tests configuration, state management, and events.
 * Full encoding tests are in integration tests (Plan 03) as they require FFmpeg.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VideoEncoder, type VideoEncoderConfig } from '../../../src/encoder/video-encoder.js';

// Mock the ffmpeg-process module to avoid actual FFmpeg spawning
vi.mock('../../../src/encoder/ffmpeg-process.js', () => ({
  spawnFFmpeg: vi.fn(() => ({
    process: { kill: vi.fn() },
    stdin: {
      write: vi.fn(() => true),
      end: vi.fn(),
      once: vi.fn()
    },
    finished: Promise.resolve()
  }))
}));

describe('VideoEncoder', () => {
  const defaultConfig: VideoEncoderConfig = {
    width: 1920,
    height: 1080,
    fps: 30,
    outputPath: '/tmp/test.mp4'
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should accept valid configuration', () => {
      const encoder = new VideoEncoder(defaultConfig);
      expect(encoder.getConfig()).toMatchObject(defaultConfig);
    });

    it('should set default crf to 23', () => {
      const encoder = new VideoEncoder(defaultConfig);
      expect(encoder.getConfig().crf).toBe(23);
    });

    it('should set default preset to medium', () => {
      const encoder = new VideoEncoder(defaultConfig);
      expect(encoder.getConfig().preset).toBe('medium');
    });

    it('should allow custom crf and preset', () => {
      const encoder = new VideoEncoder({
        ...defaultConfig,
        crf: 18,
        preset: 'slow'
      });
      const config = encoder.getConfig();
      expect(config.crf).toBe(18);
      expect(config.preset).toBe('slow');
    });

    it('should accept all valid presets', () => {
      const presets: VideoEncoderConfig['preset'][] = [
        'ultrafast', 'superfast', 'veryfast', 'faster', 'fast',
        'medium', 'slow', 'slower', 'veryslow'
      ];

      for (const preset of presets) {
        const encoder = new VideoEncoder({ ...defaultConfig, preset });
        expect(encoder.getConfig().preset).toBe(preset);
      }
    });

    it('should preserve custom configuration', () => {
      const customConfig: VideoEncoderConfig = {
        width: 3840,
        height: 2160,
        fps: 60,
        outputPath: '/output/4k-video.mp4',
        crf: 15,
        preset: 'veryslow'
      };
      const encoder = new VideoEncoder(customConfig);
      expect(encoder.getConfig()).toEqual(customConfig);
    });
  });

  describe('state management', () => {
    it('should throw when writeFrame called before start', async () => {
      const encoder = new VideoEncoder(defaultConfig);
      const frame = Buffer.alloc(1920 * 1080 * 4); // RGBA

      await expect(encoder.writeFrame(frame)).rejects.toThrow('Encoder not started');
    });

    it('should throw when finish called before start', async () => {
      const encoder = new VideoEncoder(defaultConfig);

      await expect(encoder.finish()).rejects.toThrow('Encoder not started');
    });

    it('should throw when start called twice', () => {
      const encoder = new VideoEncoder(defaultConfig);
      encoder.start();

      expect(() => encoder.start()).toThrow('Encoder already started');
    });

    it('should allow abort before start without error', () => {
      const encoder = new VideoEncoder(defaultConfig);
      expect(() => encoder.abort()).not.toThrow();
    });
  });

  describe('frame counting', () => {
    it('should start with zero frame count', () => {
      const encoder = new VideoEncoder(defaultConfig);
      expect(encoder.getFrameCount()).toBe(0);
    });

    it('should increment frame count on writeFrame', async () => {
      const encoder = new VideoEncoder(defaultConfig);
      encoder.start();

      const frame = Buffer.alloc(1920 * 1080 * 4);
      await encoder.writeFrame(frame);

      expect(encoder.getFrameCount()).toBe(1);
    });

    it('should count multiple frames correctly', async () => {
      const encoder = new VideoEncoder(defaultConfig);
      encoder.start();

      const frame = Buffer.alloc(1920 * 1080 * 4);
      await encoder.writeFrame(frame);
      await encoder.writeFrame(frame);
      await encoder.writeFrame(frame);

      expect(encoder.getFrameCount()).toBe(3);
    });
  });

  describe('events', () => {
    it('should emit progress event on writeFrame', async () => {
      const encoder = new VideoEncoder(defaultConfig);
      encoder.start();

      const progressHandler = vi.fn();
      encoder.on('progress', progressHandler);

      const frame = Buffer.alloc(1920 * 1080 * 4);
      await encoder.writeFrame(frame);

      expect(progressHandler).toHaveBeenCalledWith({ frame: 1 });
    });

    it('should emit progress events with incrementing frame numbers', async () => {
      const encoder = new VideoEncoder(defaultConfig);
      encoder.start();

      const progressHandler = vi.fn();
      encoder.on('progress', progressHandler);

      const frame = Buffer.alloc(1920 * 1080 * 4);
      await encoder.writeFrame(frame);
      await encoder.writeFrame(frame);
      await encoder.writeFrame(frame);

      expect(progressHandler).toHaveBeenCalledTimes(3);
      expect(progressHandler).toHaveBeenNthCalledWith(1, { frame: 1 });
      expect(progressHandler).toHaveBeenNthCalledWith(2, { frame: 2 });
      expect(progressHandler).toHaveBeenNthCalledWith(3, { frame: 3 });
    });

    it('should emit complete event on finish', async () => {
      const encoder = new VideoEncoder(defaultConfig);
      encoder.start();

      const completeHandler = vi.fn();
      encoder.on('complete', completeHandler);

      await encoder.finish();

      expect(completeHandler).toHaveBeenCalledWith({
        frames: 0,
        outputPath: '/tmp/test.mp4'
      });
    });

    it('should emit complete with correct frame count', async () => {
      const encoder = new VideoEncoder(defaultConfig);
      encoder.start();

      const frame = Buffer.alloc(1920 * 1080 * 4);
      await encoder.writeFrame(frame);
      await encoder.writeFrame(frame);

      const completeHandler = vi.fn();
      encoder.on('complete', completeHandler);

      await encoder.finish();

      expect(completeHandler).toHaveBeenCalledWith({
        frames: 2,
        outputPath: '/tmp/test.mp4'
      });
    });
  });

  describe('getConfig', () => {
    it('should return a copy of config', () => {
      const encoder = new VideoEncoder(defaultConfig);
      const config1 = encoder.getConfig();
      const config2 = encoder.getConfig();

      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2); // Different object references
    });

    it('should not allow modifying internal config', () => {
      const encoder = new VideoEncoder(defaultConfig);
      const config = encoder.getConfig();
      config.width = 100;

      expect(encoder.getConfig().width).toBe(1920);
    });
  });
});
