/**
 * Video Service
 *
 * Provides thumbnail generation and metadata extraction for rendered videos.
 * Uses FFmpeg for thumbnail extraction and ffprobe for metadata.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

// ffmpeg-static and ffprobe-static are CJS, use createRequire for ESM compatibility
const require = createRequire(import.meta.url);
const ffmpegPath: string | null = require('ffmpeg-static');
const ffprobePath: string = require('ffprobe-static').path;

/**
 * Video metadata extracted from file
 */
export interface VideoMetadata {
  /** Duration in seconds */
  duration: number;
  /** Video width in pixels */
  width: number;
  /** Video height in pixels */
  height: number;
  /** File size in bytes */
  fileSize: number;
}

/**
 * Generate a thumbnail for a video file.
 *
 * Extracts a single frame at 1 second (or first frame for very short videos).
 * Scales to 320px width maintaining aspect ratio.
 * Output is JPEG format with quality level 3.
 *
 * @param videoPath - Absolute or relative path to the source video
 * @param outputDir - Directory to store thumbnail (default: outputs/thumbnails)
 * @returns Absolute path to the generated thumbnail
 */
export async function generateThumbnail(
  videoPath: string,
  outputDir: string = 'outputs/thumbnails'
): Promise<string> {
  if (!ffmpegPath) {
    throw new Error('FFmpeg binary not found. Ensure ffmpeg-static is installed.');
  }

  const videoId = path.basename(videoPath, '.mp4');
  const thumbnailPath = path.join(outputDir, `${videoId}.jpg`);

  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });

  // Extract frame at 1 second using FFmpeg
  // -ss before -i for fast seeking
  // -vframes 1 to extract only one frame
  // -vf scale=320:-1 to resize maintaining aspect ratio
  // -q:v 3 for JPEG quality (2-5 is good range, lower is better quality)
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-ss', '00:00:01',
    '-i', videoPath,
    '-vframes', '1',
    '-vf', 'scale=320:-1',
    '-q:v', '3',
    '-y', // Overwrite output if exists
    thumbnailPath,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = '';

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(path.resolve(thumbnailPath));
      } else {
        reject(new Error(`Thumbnail generation failed: ${stderr || `exit code ${code}`}`));
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Extract metadata from a video file.
 *
 * Uses ffprobe to get duration and dimensions.
 * Uses fs.stat for file size.
 *
 * @param videoPath - Absolute or relative path to the video file
 * @returns Video metadata including duration, dimensions, and file size
 */
export async function getVideoMetadata(videoPath: string): Promise<VideoMetadata> {
  // Get file size directly
  const stats = await fs.stat(videoPath);

  // Get video info via ffprobe
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      videoPath,
    ];

    const proc = spawn(ffprobePath, args);
    let output = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      output += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
        return;
      }

      try {
        const info = JSON.parse(output);
        const videoStream = info.streams?.find(
          (s: { codec_type: string }) => s.codec_type === 'video'
        );

        if (!videoStream) {
          reject(new Error('No video stream found in file'));
          return;
        }

        resolve({
          duration: parseFloat(info.format?.duration || '0'),
          width: videoStream.width || 0,
          height: videoStream.height || 0,
          fileSize: stats.size,
        });
      } catch (e) {
        reject(new Error(`Failed to parse ffprobe output: ${e}`));
      }
    });

    proc.on('error', reject);
  });
}
