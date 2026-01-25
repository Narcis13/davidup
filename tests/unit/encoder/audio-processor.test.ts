/**
 * Audio Processor Unit Tests
 *
 * Tests for buildAudioFilterChain function.
 * Focus on pure function testing without FFmpeg execution.
 */
import { describe, it, expect } from 'vitest';
import { buildAudioFilterChain } from '../../../src/encoder/audio-processor.js';
import type { AudioConfig } from '../../../src/schemas/audio.js';

describe('buildAudioFilterChain', () => {
  describe('no filters', () => {
    it('should return null when all defaults', () => {
      const audio: AudioConfig = {
        src: 'audio.mp3',
        volume: 1,
        fadeIn: 0,
        fadeOut: 0
      };

      expect(buildAudioFilterChain(audio, 10)).toBeNull();
    });
  });

  describe('volume filter (AUDI-02)', () => {
    it('should add volume filter when volume is not 1', () => {
      const audio: AudioConfig = {
        src: 'audio.mp3',
        volume: 0.5,
        fadeIn: 0,
        fadeOut: 0
      };

      expect(buildAudioFilterChain(audio, 10)).toBe('volume=0.5');
    });

    it('should handle volume of 0 (muted)', () => {
      const audio: AudioConfig = {
        src: 'audio.mp3',
        volume: 0,
        fadeIn: 0,
        fadeOut: 0
      };

      expect(buildAudioFilterChain(audio, 10)).toBe('volume=0');
    });
  });

  describe('fade in filter (AUDI-03)', () => {
    it('should add fade in filter', () => {
      const audio: AudioConfig = {
        src: 'audio.mp3',
        volume: 1,
        fadeIn: 2,
        fadeOut: 0
      };

      expect(buildAudioFilterChain(audio, 10)).toBe('afade=t=in:st=0:d=2');
    });

    it('should handle decimal fade in duration', () => {
      const audio: AudioConfig = {
        src: 'audio.mp3',
        volume: 1,
        fadeIn: 1.5,
        fadeOut: 0
      };

      expect(buildAudioFilterChain(audio, 10)).toBe('afade=t=in:st=0:d=1.5');
    });
  });

  describe('fade out filter (AUDI-04)', () => {
    it('should calculate fade out start from video duration', () => {
      const audio: AudioConfig = {
        src: 'audio.mp3',
        volume: 1,
        fadeIn: 0,
        fadeOut: 2
      };

      // 10 second video, 2 second fade = starts at 8
      expect(buildAudioFilterChain(audio, 10)).toBe('afade=t=out:st=8:d=2');
    });

    it('should clamp fade out start to 0 when fade exceeds duration', () => {
      const audio: AudioConfig = {
        src: 'audio.mp3',
        volume: 1,
        fadeIn: 0,
        fadeOut: 15 // Exceeds 10 second video
      };

      // Should start at 0, not negative
      expect(buildAudioFilterChain(audio, 10)).toBe('afade=t=out:st=0:d=15');
    });
  });

  describe('combined filters', () => {
    it('should combine volume and fade in', () => {
      const audio: AudioConfig = {
        src: 'audio.mp3',
        volume: 0.8,
        fadeIn: 1,
        fadeOut: 0
      };

      expect(buildAudioFilterChain(audio, 10)).toBe('volume=0.8,afade=t=in:st=0:d=1');
    });

    it('should combine volume and fade out', () => {
      const audio: AudioConfig = {
        src: 'audio.mp3',
        volume: 0.5,
        fadeIn: 0,
        fadeOut: 2
      };

      expect(buildAudioFilterChain(audio, 10)).toBe('volume=0.5,afade=t=out:st=8:d=2');
    });

    it('should combine all filters in correct order', () => {
      const audio: AudioConfig = {
        src: 'audio.mp3',
        volume: 0.7,
        fadeIn: 1,
        fadeOut: 2
      };

      // Order: volume, fade in, fade out
      expect(buildAudioFilterChain(audio, 10)).toBe(
        'volume=0.7,afade=t=in:st=0:d=1,afade=t=out:st=8:d=2'
      );
    });
  });
});
