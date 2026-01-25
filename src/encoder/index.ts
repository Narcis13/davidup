/**
 * Encoder Module
 *
 * Exports FFmpeg utilities and video encoding functionality.
 * AudioProcessor will be added in Plan 03.
 */
export { spawnFFmpeg, type FFmpegProcess, type FFmpegProcessOptions } from './ffmpeg-process.js';
export { VideoEncoder, type VideoEncoderConfig, type VideoEncoderEvents } from './video-encoder.js';
