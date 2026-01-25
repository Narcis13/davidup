/**
 * Audio Processor
 *
 * Audio muxing and filter chain building for video encoding.
 * Supports volume control and fade in/out effects.
 *
 * Requirements covered:
 * - AUDI-01: Background audio track
 * - AUDI-02: Volume control (0.0-1.0)
 * - AUDI-03: Fade in duration
 * - AUDI-04: Fade out duration
 */
import { spawnFFmpeg } from './ffmpeg-process.js';
import type { AudioConfig } from '../schemas/audio.js';

/**
 * Build FFmpeg audio filter chain for volume and fade effects.
 *
 * @param audio Audio configuration
 * @param videoDuration Total video duration in seconds (for fade out timing)
 * @returns Filter string for -af flag, or null if no filters needed
 */
export function buildAudioFilterChain(
  audio: AudioConfig,
  videoDuration: number
): string | null {
  const filters: string[] = [];

  // Volume adjustment (AUDI-02)
  // FFmpeg volume filter uses linear scale: 0.5 = half volume
  if (audio.volume !== undefined && audio.volume !== 1) {
    filters.push(`volume=${audio.volume}`);
  }

  // Fade in from silence (AUDI-03)
  // afade=t=in:st=0:d=X fades in over X seconds from start
  if (audio.fadeIn && audio.fadeIn > 0) {
    filters.push(`afade=t=in:st=0:d=${audio.fadeIn}`);
  }

  // Fade out to silence (AUDI-04)
  // CRITICAL: Calculate start time from video duration, not audio duration
  // fadeOutStart = videoDuration - fadeOutDuration
  if (audio.fadeOut && audio.fadeOut > 0) {
    const fadeOutStart = Math.max(0, videoDuration - audio.fadeOut);
    filters.push(`afade=t=out:st=${fadeOutStart}:d=${audio.fadeOut}`);
  }

  return filters.length > 0 ? filters.join(',') : null;
}

/**
 * Options for muxing audio with video
 */
export interface MuxAudioOptions {
  /** Path to silent video file */
  videoPath: string;
  /** Audio configuration */
  audio: AudioConfig;
  /** Output path for final video with audio */
  outputPath: string;
  /** Video duration in seconds (for fade out timing) */
  videoDuration: number;
  /** Audio bitrate (default: '128k') */
  audioBitrate?: string;
}

/**
 * Mux audio with video using FFmpeg.
 *
 * Uses -c:v copy to avoid re-encoding video (fast).
 * Applies audio filters for volume and fade effects.
 * Uses -shortest to match audio to video duration.
 *
 * @throws Error if FFmpeg fails
 */
export async function muxAudioWithVideo(options: MuxAudioOptions): Promise<void> {
  const {
    videoPath,
    audio,
    outputPath,
    videoDuration,
    audioBitrate = '128k'
  } = options;

  const filterChain = buildAudioFilterChain(audio, videoDuration);

  const args = [
    // Input files
    '-i', videoPath,         // Input video (silent)
    '-i', audio.src,         // Input audio

    // Stream mapping
    '-map', '0:v',           // Use video from first input
    '-map', '1:a',           // Use audio from second input

    // Video codec (copy = no re-encoding)
    '-c:v', 'copy',

    // Audio codec
    '-c:a', 'aac',
    '-b:a', audioBitrate,

    // Audio filters (if any)
    ...(filterChain ? ['-af', filterChain] : []),

    // Match shortest input (don't exceed video duration)
    '-shortest',

    // Optimize for web playback
    '-movflags', '+faststart',

    // Overwrite output
    '-y',
    outputPath
  ];

  const ffmpeg = spawnFFmpeg({
    args,
    stdin: 'ignore',
    onStderr: (data) => {
      // Log FFmpeg errors for debugging
      console.error('FFmpeg audio mux:', data);
    }
  });

  await ffmpeg.finished;
}
