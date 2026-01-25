/**
 * Encoder Module
 *
 * Exports FFmpeg utilities, video encoding, and audio processing functionality.
 */

// FFmpeg process utilities
export {
  spawnFFmpeg,
  type FFmpegProcess,
  type FFmpegProcessOptions
} from './ffmpeg-process.js';

// Video encoding
export {
  VideoEncoder,
  type VideoEncoderConfig,
  type VideoEncoderEvents
} from './video-encoder.js';

// Audio processing
export {
  buildAudioFilterChain,
  muxAudioWithVideo,
  type MuxAudioOptions
} from './audio-processor.js';
