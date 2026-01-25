/**
 * Encoder Module
 *
 * Exports FFmpeg utilities, video encoding, audio processing,
 * and high-level rendering API.
 */

// FFmpeg process utilities
export {
  spawnFFmpeg,
  type FFmpegProcess,
  type FFmpegProcessOptions,
} from './ffmpeg-process.js';

// Video encoding
export {
  VideoEncoder,
  type VideoEncoderConfig,
  type VideoEncoderEvents,
} from './video-encoder.js';

// Audio processing
export {
  buildAudioFilterChain,
  muxAudioWithVideo,
  type MuxAudioOptions,
} from './audio-processor.js';

// High-level rendering API
export {
  renderVideo,
  type RenderVideoOptions,
  type RenderProgress,
  type RenderResult,
  type RenderVideoEvents,
} from './video-renderer.js';
