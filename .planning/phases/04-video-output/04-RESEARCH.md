# Phase 4: Video Output - Research

**Researched:** 2026-01-25
**Domain:** Video encoding, audio muxing, FFmpeg integration
**Confidence:** MEDIUM

## Summary

This phase requires encoding raw RGBA frame buffers from the AnimatedFrameGenerator into H.264/MP4 video files with optional audio tracks. The research reveals an important ecosystem change: fluent-ffmpeg was archived in May 2025 and is no longer maintained.

The recommended approach is to use FFmpeg directly via Node.js `child_process.spawn()` with `ffmpeg-static` for the binary. This is simpler than it sounds - the project only needs one specific FFmpeg invocation pattern (rawvideo to H.264), making a full wrapper library unnecessary. Audio handling uses FFmpeg's `afade` and `volume` filters for fade in/out and volume control.

For piping frames to FFmpeg, the key insight is that MP4 normally requires seekable output (incompatible with pipes). The solution is either: (a) write to a temp file then move, or (b) use fragmented MP4 with `movflags frag_keyframe+empty_moov`. Since the requirement is downloadable files (not streaming), writing to disk is the simpler approach.

**Primary recommendation:** Use `child_process.spawn()` with `ffmpeg-static` directly, piping raw RGBA frames to stdin, outputting H.264/MP4 to disk. Avoid deprecated fluent-ffmpeg.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ffmpeg-static | ^5.2.0 | Bundled FFmpeg binary | No system dependencies, bundles FFmpeg 6.1.1 |
| ffprobe-static | ^3.1.0 | Bundled ffprobe binary | Required for audio duration detection |
| child_process (built-in) | Node.js | Spawn FFmpeg process | Direct control, no wrapper overhead |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| get-audio-duration | ^4.0.0 | Get audio file duration | Calculate fade out timing |
| p-queue | ^8.0.1 | Queue management | Limit concurrent encodes (already in project) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct spawn | fluent-ffmpeg | Fluent-ffmpeg deprecated May 2025, archived and unmaintained |
| Direct spawn | @mmomtchev/ffmpeg | Native bindings, more complex, "semi-safe" (segfaults possible) |
| ffmpeg-static | System FFmpeg | Requires users to install FFmpeg separately |
| File output | Pipe with fragmented MP4 | Added complexity for streaming compatibility not needed for downloads |

**Installation:**
```bash
npm install ffmpeg-static@^5.2.0 ffprobe-static@^3.1.0 get-audio-duration@^4.0.0
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── encoder/           # Video encoding module
│   ├── video-encoder.ts      # Main encoder class
│   ├── audio-processor.ts    # Audio handling (volume, fade)
│   ├── ffmpeg-process.ts     # FFmpeg spawn wrapper
│   └── index.ts              # Module exports
├── render/            # Existing (Phase 3)
└── schemas/           # Add audio schema
```

### Pattern 1: Promise-based FFmpeg Wrapper
**What:** Wrap FFmpeg spawn in a Promise for async/await usage
**When to use:** All FFmpeg operations
**Example:**
```typescript
// Source: Node.js child_process docs + FFmpeg patterns
import { spawn, ChildProcess } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

interface EncoderOptions {
  width: number;
  height: number;
  fps: number;
  outputPath: string;
  crf?: number;          // Quality (default: 23, lower = better)
  preset?: string;       // Speed preset (default: 'medium')
}

function createEncoder(options: EncoderOptions): {
  process: ChildProcess;
  stdin: NodeJS.WritableStream;
  finished: Promise<void>;
} {
  const {
    width,
    height,
    fps,
    outputPath,
    crf = 23,
    preset = 'medium'
  } = options;

  const args = [
    // Input options (MUST come before -i)
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${width}x${height}`,
    '-r', String(fps),
    '-i', 'pipe:0',           // Read from stdin

    // Output options
    '-c:v', 'libx264',
    '-preset', preset,
    '-crf', String(crf),
    '-pix_fmt', 'yuv420p',    // Required for compatibility
    '-movflags', '+faststart', // Optimize for web playback
    '-y',                      // Overwrite output
    outputPath
  ];

  const ffmpeg = spawn(ffmpegPath!, args, {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const finished = new Promise<void>((resolve, reject) => {
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with code ${code}`));
    });
    ffmpeg.on('error', reject);
  });

  return {
    process: ffmpeg,
    stdin: ffmpeg.stdin!,
    finished
  };
}
```

### Pattern 2: Frame Streaming with Backpressure
**What:** Stream frames to FFmpeg respecting backpressure
**When to use:** Encoding video from frame generator
**Example:**
```typescript
// Source: Node.js streams documentation
import { AnimatedFrameGenerator } from '../render/animated-frame-generator.js';

async function encodeVideo(
  generator: AnimatedFrameGenerator,
  outputPath: string
): Promise<void> {
  const config = generator.getConfig(); // Assume getter exists
  const encoder = createEncoder({
    width: config.width,
    height: config.height,
    fps: config.fps,
    outputPath
  });

  const stdin = encoder.stdin;

  for (const frame of generator.generateAllFrames()) {
    // Frame is raw RGBA Buffer from canvas.data()
    const canWrite = stdin.write(frame);

    // Handle backpressure
    if (!canWrite) {
      await new Promise<void>(resolve => stdin.once('drain', resolve));
    }
  }

  // Signal end of input
  stdin.end();

  // Wait for encoding to complete
  await encoder.finished;
}
```

### Pattern 3: Audio with Video Muxing
**What:** Add audio track with volume/fade effects
**When to use:** When audio is specified in video spec
**Example:**
```typescript
// Source: FFmpeg filter documentation
import { getAudioDurationInSeconds } from 'get-audio-duration';
import ffprobePath from 'ffprobe-static';

interface AudioConfig {
  src: string;           // Audio file path or URL
  volume?: number;       // 0-1 (default: 1)
  fadeIn?: number;       // Fade in duration in seconds
  fadeOut?: number;      // Fade out duration in seconds
}

async function encodeWithAudio(
  videoPath: string,      // Silent video from first pass
  audio: AudioConfig,
  outputPath: string,
  videoDuration: number   // Total video duration in seconds
): Promise<void> {
  // Build audio filter chain
  const audioFilters: string[] = [];

  // Volume adjustment
  if (audio.volume !== undefined && audio.volume !== 1) {
    audioFilters.push(`volume=${audio.volume}`);
  }

  // Fade in
  if (audio.fadeIn && audio.fadeIn > 0) {
    audioFilters.push(`afade=t=in:st=0:d=${audio.fadeIn}`);
  }

  // Fade out (calculate start time)
  if (audio.fadeOut && audio.fadeOut > 0) {
    const fadeOutStart = videoDuration - audio.fadeOut;
    audioFilters.push(`afade=t=out:st=${fadeOutStart}:d=${audio.fadeOut}`);
  }

  const args = [
    '-i', videoPath,           // Input video
    '-i', audio.src,           // Input audio
    '-map', '0:v',             // Use video from first input
    '-map', '1:a',             // Use audio from second input
    '-c:v', 'copy',            // Copy video (no re-encode)
    '-c:a', 'aac',             // Encode audio to AAC
    '-b:a', '128k',            // Audio bitrate
    ...(audioFilters.length > 0
      ? ['-af', audioFilters.join(',')]
      : []),
    '-shortest',               // Match shortest input duration
    '-movflags', '+faststart',
    '-y',
    outputPath
  ];

  const ffmpeg = spawn(ffmpegPath!, args, {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await new Promise<void>((resolve, reject) => {
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg audio mux exited with code ${code}`));
    });
    ffmpeg.on('error', reject);
  });
}
```

### Anti-Patterns to Avoid
- **Using fluent-ffmpeg:** Deprecated and archived May 2025, no longer maintained
- **Piping MP4 to stdout without fragmentation:** MP4 requires seeking; will fail or produce corrupted output
- **Ignoring backpressure:** Will cause memory buildup and potential OOM
- **Not using -y flag:** FFmpeg will hang waiting for overwrite confirmation
- **Putting output options before -i:** Input options must precede -i, output options follow

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| H.264 encoding | Custom encoder | FFmpeg libx264 | Decades of optimization, hardware support |
| Audio fade effects | Custom DSP | FFmpeg afade filter | Edge cases, sample-accurate timing |
| Audio volume | Custom multiplier | FFmpeg volume filter | Handles clipping, multiple channels |
| MP4 muxing | Custom container | FFmpeg mp4 muxer | Complex format, moov atom placement |
| Get audio duration | Parse audio headers | get-audio-duration / ffprobe | Many formats, metadata extraction |
| FFmpeg binary | System dependency | ffmpeg-static | Cross-platform, bundled with npm |

**Key insight:** Video encoding and audio processing are solved problems with decades of work in FFmpeg. The only custom code needed is orchestrating the FFmpeg process and piping frames.

## Common Pitfalls

### Pitfall 1: Input Options After -i Flag
**What goes wrong:** FFmpeg ignores input options, produces garbled video or errors
**Why it happens:** FFmpeg requires input options BEFORE the -i they apply to
**How to avoid:** Always structure args as: `[input opts] -i [input] [output opts] [output]`
**Warning signs:** "Invalid data found when processing input", wrong resolution

### Pitfall 2: Missing -pix_fmt yuv420p for Output
**What goes wrong:** Video doesn't play in browsers/QuickTime, shows as black
**Why it happens:** libx264 defaults to yuv444p which has poor compatibility
**How to avoid:** Always specify `-pix_fmt yuv420p` for H.264 output
**Warning signs:** "Non-monotonous DTS" warnings, playback issues

### Pitfall 3: FFmpeg Hanging - No stdin.end()
**What goes wrong:** Encoding never completes, process hangs indefinitely
**Why it happens:** FFmpeg waits for more input data
**How to avoid:** Always call `stdin.end()` after writing all frames
**Warning signs:** Process stays alive, no output file finalized

### Pitfall 4: Memory Explosion - Ignoring Backpressure
**What goes wrong:** Memory usage grows unbounded, OOM crash
**Why it happens:** Writing frames faster than FFmpeg can encode
**How to avoid:** Check `stdin.write()` return value, wait for 'drain' event
**Warning signs:** Memory usage increases linearly during encoding

### Pitfall 5: Audio Fade Out Timing Miscalculation
**What goes wrong:** Fade out starts too early/late or extends past audio end
**Why it happens:** Using audio duration instead of video duration for calculation
**How to avoid:** Calculate `fadeOutStart = videoDuration - fadeOutDuration`
**Warning signs:** Audio cuts abruptly, or fades to silence too early

### Pitfall 6: Raw RGBA vs RGB24 Pixel Format Mismatch
**What goes wrong:** Colors wrong, image stretched/squished, garbled output
**Why it happens:** @napi-rs/canvas outputs RGBA (4 bytes), but specifying rgb24 (3 bytes)
**How to avoid:** Use `-pix_fmt rgba` for input to match canvas.data() format
**Warning signs:** Colors shifted, resolution wrong by 4/3

## Code Examples

Verified patterns from official sources:

### Complete Video Encoder Class
```typescript
// Recommended architecture for Phase 4
import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import ffmpegPath from 'ffmpeg-static';

export interface VideoEncoderConfig {
  width: number;
  height: number;
  fps: number;
  outputPath: string;
  crf?: number;       // 0-51, default 23 (lower = better quality)
  preset?: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' |
           'medium' | 'slow' | 'slower' | 'veryslow';
}

export class VideoEncoder extends EventEmitter {
  private process: ChildProcess | null = null;
  private frameCount = 0;
  private finished: Promise<void> | null = null;

  constructor(private readonly config: VideoEncoderConfig) {
    super();
  }

  start(): void {
    const { width, height, fps, outputPath, crf = 23, preset = 'medium' } = this.config;

    const args = [
      // Hide banner and reduce logging
      '-hide_banner',
      '-loglevel', 'error',

      // Input configuration
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',       // CRITICAL: Match canvas.data() format
      '-s', `${width}x${height}`,
      '-r', String(fps),
      '-i', 'pipe:0',

      // Output configuration
      '-c:v', 'libx264',
      '-preset', preset,
      '-crf', String(crf),
      '-pix_fmt', 'yuv420p',    // CRITICAL: For compatibility
      '-movflags', '+faststart',
      '-y',
      outputPath
    ];

    this.process = spawn(ffmpegPath!, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Capture stderr for debugging
    this.process.stderr?.on('data', (data) => {
      this.emit('log', data.toString());
    });

    this.finished = new Promise((resolve, reject) => {
      this.process!.on('close', (code) => {
        if (code === 0) {
          this.emit('complete', { frames: this.frameCount });
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });
      this.process!.on('error', reject);
    });
  }

  async writeFrame(buffer: Buffer): Promise<void> {
    if (!this.process?.stdin) {
      throw new Error('Encoder not started');
    }

    const canWrite = this.process.stdin.write(buffer);
    this.frameCount++;
    this.emit('progress', { frame: this.frameCount });

    // Handle backpressure
    if (!canWrite) {
      await new Promise<void>(resolve =>
        this.process!.stdin!.once('drain', resolve)
      );
    }
  }

  async finish(): Promise<void> {
    if (!this.process?.stdin || !this.finished) {
      throw new Error('Encoder not started');
    }

    this.process.stdin.end();
    await this.finished;
  }

  abort(): void {
    this.process?.kill('SIGKILL');
  }
}
```

### Audio Muxing with Fade Effects
```typescript
// Source: FFmpeg filter documentation
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

export interface AudioConfig {
  src: string;
  volume?: number;     // 0.0 to 1.0
  fadeIn?: number;     // seconds
  fadeOut?: number;    // seconds
}

export async function muxAudioWithVideo(
  videoPath: string,
  audio: AudioConfig,
  outputPath: string,
  videoDuration: number
): Promise<void> {
  const filters: string[] = [];

  // Volume (FFmpeg uses linear scale, 0.5 = half volume)
  if (audio.volume !== undefined && audio.volume !== 1) {
    filters.push(`volume=${audio.volume}`);
  }

  // Fade in from silence
  if (audio.fadeIn && audio.fadeIn > 0) {
    filters.push(`afade=t=in:st=0:d=${audio.fadeIn}`);
  }

  // Fade out to silence
  if (audio.fadeOut && audio.fadeOut > 0) {
    const startTime = Math.max(0, videoDuration - audio.fadeOut);
    filters.push(`afade=t=out:st=${startTime}:d=${audio.fadeOut}`);
  }

  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', videoPath,
    '-i', audio.src,
    '-map', '0:v',
    '-map', '1:a',
    '-c:v', 'copy',            // No video re-encoding
    '-c:a', 'aac',
    '-b:a', '128k',
    ...(filters.length > 0 ? ['-af', filters.join(',')] : []),
    '-shortest',               // Don't exceed video duration
    '-movflags', '+faststart',
    '-y',
    outputPath
  ];

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath!, args);

    ffmpeg.stderr?.on('data', (data) => {
      console.error('FFmpeg:', data.toString());
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Audio mux failed with code ${code}`));
    });

    ffmpeg.on('error', reject);
  });
}
```

### Audio Schema Extension
```typescript
// Source: Phase requirements (AUDI-01 through AUDI-04)
import { z } from 'zod';

export const AudioConfigSchema = z.object({
  /** Audio file path or URL */
  src: z.string().min(1),

  /** Volume multiplier 0.0-1.0 (default: 1.0) */
  volume: z.number().min(0).max(1).default(1),

  /** Fade in duration in seconds (default: 0) */
  fadeIn: z.number().min(0).default(0),

  /** Fade out duration in seconds (default: 0) */
  fadeOut: z.number().min(0).default(0),
});

export type AudioConfig = z.infer<typeof AudioConfigSchema>;

// Extend video spec to include audio
export const RenderConfigSchema = z.object({
  width: z.number().int().min(1).max(1920),
  height: z.number().int().min(1).max(1920),
  fps: z.number().int().min(1).max(60).default(30),
  scenes: z.array(AnimatedSceneSchema),
  audio: AudioConfigSchema.optional(),
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| fluent-ffmpeg wrapper | Direct spawn + ffmpeg-static | May 2025 | Library deprecated, use native spawn |
| node-canvas | @napi-rs/canvas | 2023-2024 | Already using, outputs RGBA buffers |
| Temp PNG files | Pipe raw frames | Best practice | Faster, no disk I/O overhead |
| Standard MP4 piping | File output or fragmented | N/A | MP4 cannot be piped without fragmentation |

**Deprecated/outdated:**
- **fluent-ffmpeg@2.1.3:** Archived May 22, 2025. Repository read-only. No longer maintained or compatible with recent FFmpeg versions.
- **ffmpeg-kit:** Retired January 6, 2025. Mobile-focused, not relevant for Node.js.

## Open Questions

Things that couldn't be fully resolved:

1. **Temporary file location for two-pass encoding**
   - What we know: Need temp silent video before audio mux
   - What's unclear: Best location for temp files (os.tmpdir? project temp folder?)
   - Recommendation: Use os.tmpdir() with unique names, clean up after mux

2. **Progress reporting granularity**
   - What we know: Can emit per-frame progress
   - What's unclear: Whether percentage progress or frame count is more useful
   - Recommendation: Emit both frame count and percentage

3. **Audio file validation**
   - What we know: FFmpeg can read many formats (mp3, wav, aac, ogg, etc.)
   - What's unclear: Should we validate audio format before encoding?
   - Recommendation: Let FFmpeg handle validation, catch and report errors

4. **Concurrent encoding limits**
   - What we know: FFmpeg is CPU-intensive, multiple instances compete
   - What's unclear: Optimal concurrency limit
   - Recommendation: Use p-queue with concurrency: 2-4, expose as config

## Sources

### Primary (HIGH confidence)
- [FFmpeg Filters Documentation](https://ffmpeg.org/ffmpeg-filters.html) - afade and volume filter specs
- [FFmpeg Formats Documentation](https://ffmpeg.org/ffmpeg-formats.html) - rawvideo input format
- [Node.js child_process](https://nodejs.org/api/child_process.html) - spawn API
- [ffmpeg-static npm](https://www.npmjs.com/package/ffmpeg-static) - bundles FFmpeg 6.1.1

### Secondary (MEDIUM confidence)
- [fluent-ffmpeg deprecation issue](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1324) - confirmed May 2025 archive
- [Creatomate: Video Rendering with Node.js](https://creatomate.com/blog/video-rendering-with-nodejs-and-ffmpeg) - spawn patterns
- [fluent-ffmpeg issue #546](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/546) - raw buffer piping patterns
- [Transloadit: Stream video processing](https://transloadit.com/devtips/stream-video-processing-with-node-js-and-ffmpeg/) - pipe patterns

### Tertiary (LOW confidence)
- [StackShare: fluent-ffmpeg alternatives](https://stackshare.io/npm-fluent-ffmpeg/alternatives) - ecosystem overview
- Community discussions on presets and CRF values

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM - fluent-ffmpeg deprecation is verified, direct spawn is recommended path but less documented
- Architecture: HIGH - Pattern is well-established (spawn + pipe)
- Pitfalls: HIGH - Well-documented in FFmpeg community
- Audio handling: HIGH - FFmpeg filter syntax is stable and documented

**Research date:** 2026-01-25
**Valid until:** ~60 days (FFmpeg ecosystem is stable, major change was fluent-ffmpeg deprecation)
