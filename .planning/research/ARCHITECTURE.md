# Architecture Research: GameMotion

**Researched:** 2026-01-24
**Domain:** Programmatic video generation
**Confidence:** HIGH (verified against Remotion, Motion Canvas, Creatomate, canvas2video patterns)

## Executive Summary

Programmatic video generation engines follow a consistent architectural pattern: JSON specification -> internal scene graph -> frame-by-frame rendering -> video encoding. The key architectural decisions center on:

1. **Scene representation** - How elements and timelines are modeled internally
2. **Render pipeline** - Frame generation strategy and asset management
3. **Encoding integration** - FFmpeg process management and error handling
4. **Scaling path** - From single-process to distributed workers

GameMotion's proposed architecture aligns well with established patterns. This document provides specific guidance on component boundaries, data flow, and build order.

---

## High-Level Architecture

```
                              +------------------+
                              |   API Gateway    |
                              |   (Fastify)      |
                              +--------+---------+
                                       |
                    +------------------+------------------+
                    |                  |                  |
            +-------v-------+  +-------v-------+  +-------v-------+
            | Render Queue  |  |  AI Service   |  | Asset Service |
            | (p-queue)     |  | (OpenRouter)  |  | (File Mgmt)   |
            +-------+-------+  +---------------+  +-------+-------+
                    |                                     |
            +-------v---------------------------------------v-------+
            |                    Render Service                     |
            +-------------------------------------------------------+
            |  +-------------+  +-------------+  +-------------+   |
            |  | JSON Parser |  | Scene Graph |  | Interpolator|   |
            |  +------+------+  +------+------+  +------+------+   |
            |         |                |                |          |
            |         v                v                v          |
            |  +----------------------------------------------------+
            |  |              Frame Generator                       |
            |  |  +----------+  +----------+  +----------+         |
            |  |  | Element  |  | Element  |  | Element  |  ...    |
            |  |  | Renderer |  | Renderer |  | Renderer |         |
            |  |  +----------+  +----------+  +----------+         |
            |  +----------------------------------------------------+
            |                        |                              |
            |                +-------v--------+                     |
            |                |  Canvas (2D)   |                     |
            |                | node-canvas/   |                     |
            |                | skia-canvas    |                     |
            |                +-------+--------+                     |
            +-------------------------------------------------------+
                                     |
                                     | PNG frames (streamed)
                                     v
                              +------+------+
                              |   FFmpeg    |
                              | (child proc)|
                              +------+------+
                                     |
                                     v
                              +------+------+
                              |  MP4 Output |
                              +-------------+
```

---

## Component Analysis

### 1. JSON Spec Parser

**Responsibility:** Transform JSON video specification into validated internal representation.

**Pattern from Creatomate:** JSON-based "RenderScript" format describes videos from start to finish. Similar to HTML for creating videos - it's a component-based architecture where elements nest and compose.

**Recommended structure:**

```typescript
// Input: Raw JSON spec
interface VideoSpec {
  version: string;
  output: OutputConfig;
  timeline: TimelineSpec;
  assets?: AssetDefinition[];
  variables?: Record<string, unknown>;
}

// Internal: Validated, resolved representation
interface ResolvedSpec {
  output: ValidatedOutput;
  timeline: ResolvedTimeline;
  assetMap: Map<string, LoadedAsset>;
  variableMap: Map<string, ResolvedValue>;
}
```

**Key responsibilities:**
- JSON Schema validation (use Ajv for speed and reliability)
- Variable substitution and resolution
- Asset reference validation (do assets exist?)
- Duration and timing calculation
- Composition flattening (nested compositions -> flat timeline)

**Data flow:**
1. Receive raw JSON
2. Validate against schema
3. Resolve variables (`{{user.name}}` -> actual values)
4. Resolve asset references
5. Calculate total duration
6. Return validated spec or validation errors

---

### 2. Scene Graph / Timeline

**Responsibility:** Model the temporal structure of the video - what appears when, for how long, with what properties.

**Pattern from Motion Canvas:** Scenes are collections of nodes organized in a tree hierarchy, similar to DOM. Each scene has its own timeline. Elements have parent-child relationships.

**Pattern from Remotion:** Compositions contain Sequences. Each Sequence time-shifts content independently. The `from` property controls when content appears on the timeline.

**Recommended structure:**

```typescript
interface Timeline {
  duration: number;       // Total frames
  fps: number;
  tracks: Track[];        // Parallel tracks (like video editor tracks)
}

interface Track {
  id: string;
  clips: Clip[];          // Non-overlapping clips on this track
}

interface Clip {
  id: string;
  element: ElementNode;   // What to render
  startFrame: number;     // When it appears
  endFrame: number;       // When it disappears
  animations: Animation[]; // Property changes over time
}

interface ElementNode {
  type: ElementType;
  properties: ElementProperties;
  children?: ElementNode[];  // For groups/compositions
}

type ElementType = 'text' | 'image' | 'shape' | 'video' | 'group';
```

**Key responsibilities:**
- Maintain element tree structure
- Track timing (start/end frames per element)
- Store animation keyframes
- Provide query interface: "What elements are visible at frame N?"
- Handle element z-ordering (track order or explicit z-index)

**Critical insight from research:** Remotion is "only aware of the current frame" - it doesn't see the component statically. This is the right model: the scene graph answers the question "what should be rendered at frame N?" not "what is the entire video?"

---

### 3. Animation / Interpolation Engine

**Responsibility:** Calculate property values at any given frame based on keyframes.

**Pattern from industry:** Keyframe interpolation with multiple easing functions. Linear, ease-in, ease-out, bezier curves.

**Recommended structure:**

```typescript
interface Animation {
  property: string;       // 'x', 'opacity', 'scale', etc.
  keyframes: Keyframe[];
}

interface Keyframe {
  frame: number;
  value: number | string | Color;
  easing: EasingFunction;
}

type EasingFunction =
  | 'linear'
  | 'easeIn' | 'easeOut' | 'easeInOut'
  | { type: 'bezier'; points: [number, number, number, number] };

// Interpolator service
interface Interpolator {
  getValue(animation: Animation, frame: number): PropertyValue;
  getElementState(element: ElementNode, frame: number): ResolvedProperties;
}
```

**Key responsibilities:**
- Keyframe lookup (find surrounding keyframes for current frame)
- Value interpolation (apply easing function)
- Type-specific interpolation (numbers, colors, transforms)
- Caching computed values when possible

**Build vs Buy:** Consider using a library like `bezier-easing` for bezier curves. The math is well-established but easy to get wrong.

---

### 4. Element Renderers

**Responsibility:** Draw specific element types to the canvas.

**Pattern from ECS (Entity-Component-System):** Components are data, Systems operate on components. Each element type has a renderer system that knows how to draw it.

**Recommended structure:**

```typescript
// Element renderer interface
interface ElementRenderer<T extends ElementType> {
  type: T;
  render(
    ctx: CanvasRenderingContext2D,
    element: ElementNode & { type: T },
    state: ResolvedProperties,
    assets: AssetManager
  ): void | Promise<void>;
}

// Registry pattern for renderers
class RendererRegistry {
  private renderers = new Map<ElementType, ElementRenderer<any>>();

  register<T extends ElementType>(renderer: ElementRenderer<T>): void;
  render(ctx: CanvasRenderingContext2D, element: ElementNode, state: ResolvedProperties, assets: AssetManager): void | Promise<void>;
}
```

**Element types and their responsibilities:**

| Element | Properties | Rendering Considerations |
|---------|------------|-------------------------|
| **text** | content, font, size, color, alignment | Multi-line, word wrap, font loading |
| **image** | src, fit (cover/contain/fill), crop | Aspect ratio, image loading/caching |
| **shape** | type (rect/circle/polygon), fill, stroke | Path construction, gradient fills |
| **video** | src, startTime, playbackRate | Frame extraction, sync issues |
| **group** | children, transforms | Recursive rendering, transform matrices |

**Key insight from Konva research:** Memory management is critical. Hold references to reusable objects (images, fonts) but explicitly clean up. Node.js + Canvas runs on native Cairo - memory leaks are real.

---

### 5. Frame Generator

**Responsibility:** Orchestrate rendering of a single frame.

**Pattern from canvas2video and Remotion:** Generate each frame separately, then stitch into video. Frame-by-frame is slower but much simpler than real-time composition.

**Recommended structure:**

```typescript
class FrameGenerator {
  constructor(
    private timeline: Timeline,
    private renderers: RendererRegistry,
    private assets: AssetManager,
    private interpolator: Interpolator
  ) {}

  async generateFrame(frameNumber: number, canvas: Canvas): Promise<Buffer> {
    const ctx = canvas.getContext('2d');

    // 1. Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 2. Draw background
    this.drawBackground(ctx);

    // 3. Get visible elements at this frame
    const visibleElements = this.timeline.getElementsAtFrame(frameNumber);

    // 4. Sort by z-order
    const sorted = this.sortByZOrder(visibleElements);

    // 5. Render each element
    for (const element of sorted) {
      const state = this.interpolator.getElementState(element, frameNumber);
      await this.renderers.render(ctx, element, state, this.assets);
    }

    // 6. Export as PNG buffer
    return canvas.toBuffer('image/png');
  }
}
```

**Performance insight from Konva research:** Reuse the Stage/Canvas object between frames. Creating a new canvas for each frame is expensive. Cache images and filter results.

---

### 6. Asset Manager

**Responsibility:** Load, cache, and serve assets (images, fonts, audio, video clips).

**Pattern from Remotion:** Preloading vs Prefetching. Preloading signals the browser to start downloading. Prefetching downloads fully and converts to blob URL for instant access.

**Recommended structure:**

```typescript
interface AssetManager {
  // Preload all assets before render starts
  preloadAll(assetRefs: AssetReference[]): Promise<PreloadResult>;

  // Get loaded asset
  get(id: string): LoadedAsset | undefined;

  // Get with lazy load fallback
  getOrLoad(ref: AssetReference): Promise<LoadedAsset>;

  // Cleanup
  dispose(): void;
}

interface LoadedAsset {
  type: 'image' | 'font' | 'audio' | 'video';
  data: Image | FontFace | AudioBuffer | VideoFrameExtractor;
  metadata: AssetMetadata;
}

class AssetCache {
  private cache = new Map<string, LoadedAsset>();
  private maxSize: number;
  private currentSize: number = 0;

  // LRU eviction when cache exceeds maxSize
}
```

**Key responsibilities:**
- Load images into node-canvas compatible format
- Register fonts for text rendering
- Extract frames from video clips (FFmpeg or ffprobe)
- Cache with size limits (images can be large)
- Handle load failures gracefully (placeholder or error)

**Preload strategy:**
1. Parse spec, extract all asset references
2. Validate all assets exist (fail fast if missing)
3. Preload all images and fonts before frame 1
4. For video clips, prepare frame extractor but don't load all frames

---

### 7. Video Encoder (FFmpeg Integration)

**Responsibility:** Stitch frames into video file with optional audio.

**Pattern from multiple sources:** Use FFmpeg as child process. Stream frames via pipe for memory efficiency. Handle process lifecycle carefully.

**Recommended structure:**

```typescript
interface EncoderOptions {
  fps: number;
  width: number;
  height: number;
  codec: 'h264' | 'h265' | 'vp9';
  quality: 'draft' | 'normal' | 'high';
  audioPath?: string;
}

class VideoEncoder {
  private process: ChildProcess | null = null;

  start(outputPath: string, options: EncoderOptions): void {
    // Spawn FFmpeg with appropriate args
    // Input: pipe:0 (stdin) for PNG frames
    // Output: outputPath
  }

  writeFrame(pngBuffer: Buffer): Promise<void> {
    // Write to stdin pipe
    // Handle backpressure (pause if FFmpeg can't keep up)
  }

  async finish(): Promise<EncoderResult> {
    // Close stdin pipe
    // Wait for FFmpeg to exit
    // Return success/failure + output path
  }

  abort(): void {
    // Kill FFmpeg process
    // Clean up partial output
  }
}
```

**Critical patterns from research:**

1. **Stream frames, don't buffer:** Write frames to FFmpeg stdin as they're generated. Don't store all frames in memory.

2. **Handle backpressure:** FFmpeg might not encode as fast as you generate. Check `process.stdin.write()` return value; pause generation if false.

3. **Increase threadpool:** If spawning multiple FFmpeg processes, set `UV_THREADPOOL_SIZE` environment variable higher.

4. **Capture stderr:** FFmpeg logs to stderr. Capture it for debugging but don't let it fill up buffers.

5. **Graceful shutdown:** On error, kill the FFmpeg process and clean up partial output files.

**FFmpeg command pattern:**

```bash
ffmpeg -y \
  -f image2pipe -framerate {fps} -i pipe:0 \  # Input: PNG stream
  -c:v libx264 -preset medium -crf 23 \        # Video codec
  -pix_fmt yuv420p \                           # Pixel format for compatibility
  {outputPath}
```

---

### 8. Job Queue / Render Orchestrator

**Responsibility:** Manage concurrent render jobs with resource limits.

**Pattern from BullMQ research:** Queue-based processing with configurable concurrency. Priority levels for different job types.

**Recommended MVP structure (p-queue):**

```typescript
import PQueue from 'p-queue';

class RenderQueue {
  private queue: PQueue;
  private activeJobs = new Map<string, RenderJob>();

  constructor(concurrency: number = 2) {
    this.queue = new PQueue({
      concurrency,
      timeout: 10 * 60 * 1000,  // 10 minute timeout
    });
  }

  async enqueue(spec: VideoSpec): Promise<RenderJob> {
    const job = new RenderJob(spec);
    this.activeJobs.set(job.id, job);

    const result = this.queue.add(async () => {
      try {
        return await this.executeRender(job);
      } finally {
        this.activeJobs.delete(job.id);
      }
    });

    return job;
  }

  getStatus(jobId: string): JobStatus | undefined;
  cancel(jobId: string): boolean;
}
```

**Concurrency considerations:**
- Video rendering is CPU-bound (canvas drawing) and I/O-bound (FFmpeg encoding)
- Default to 2 concurrent renders per CPU core
- Monitor memory usage - each render needs ~100-500MB depending on resolution
- Consider separate queues for preview (fast, low quality) vs final render

---

## Data Flow: Complete Render Pipeline

```
1. API Request (JSON spec)
        |
        v
2. JSON Validation (Ajv schema)
        |
        v
3. Variable Resolution
        |
        v
4. Asset Preloading
        |  [All images, fonts loaded into memory]
        v
5. Scene Graph Construction
        |  [Timeline with tracks, clips, elements]
        v
6. FFmpeg Process Start
        |
        v
7. Frame Loop (frame 0 to duration-1)
   |
   +---> 7a. Query visible elements at frame N
   |
   +---> 7b. Interpolate properties for each element
   |
   +---> 7c. Render elements to canvas (sorted by z-order)
   |
   +---> 7d. Export canvas as PNG buffer
   |
   +---> 7e. Write PNG to FFmpeg stdin
   |
   +---> [repeat for next frame]
        |
        v
8. FFmpeg Process Finish
        |
        v
9. Cleanup (dispose assets, delete temp files)
        |
        v
10. Return video URL/path
```

**Timing for a 30-second 1080p 30fps video (900 frames):**
- Asset preload: 1-5 seconds (depends on asset count/size)
- Frame generation: 5-30 seconds (depends on complexity)
- FFmpeg encoding: 5-20 seconds (runs in parallel with generation)
- Total: 15-60 seconds typical

---

## Build Order

Recommended order to build components (dependencies inform sequence):

### Phase 1: Foundation
Build these first - everything depends on them.

| Component | Why First |
|-----------|-----------|
| **JSON Schema** | Defines the contract. Can't build anything without knowing the spec format. |
| **Spec Parser** | Validates input, extracts structure. Blocks all downstream work. |
| **Basic Types** | TypeScript interfaces for elements, timeline, animations. |

### Phase 2: Core Rendering
The heart of the system. Build end-to-end for single frame first.

| Component | Depends On |
|-----------|------------|
| **Canvas Setup** | Types |
| **Element Renderers (text, shape)** | Canvas, Types |
| **Frame Generator** | Renderers |
| **Single Frame Test** | Frame Generator |

### Phase 3: Timeline & Animation
Extend from single frame to full video.

| Component | Depends On |
|-----------|------------|
| **Timeline Model** | Types |
| **Interpolator** | Timeline |
| **Scene Graph Query** | Timeline, Interpolator |
| **Multi-frame Loop** | Frame Generator, Scene Graph |

### Phase 4: Video Output
Connect frames to FFmpeg.

| Component | Depends On |
|-----------|------------|
| **FFmpeg Encoder** | - (independent) |
| **Render Pipeline** | Frame Generator, Encoder |
| **Asset Manager** | Types |
| **Image Element** | Asset Manager, Renderers |

### Phase 5: API Layer
Expose rendering as a service.

| Component | Depends On |
|-----------|------------|
| **Job Queue** | Render Pipeline |
| **REST API** | Job Queue |
| **Progress Tracking** | Job Queue |
| **Webhooks** | Job Queue |

### Phase 6: AI Integration
Add AI-driven features.

| Component | Depends On |
|-----------|------------|
| **AI Service** | REST API |
| **Prompt Processing** | AI Service |
| **Spec Generation** | AI Service, Spec Parser |

---

## Scaling Path

| Scale | Architecture | Changes from Previous | Trigger for Next |
|-------|--------------|----------------------|------------------|
| **MVP** (1-2 concurrent) | Single process, p-queue, local files | - | Queue depth > 10 consistently |
| **Growth** (10-50 concurrent) | Single server, BullMQ + Redis, S3 storage | Add Redis, move files to S3, increase server resources | Single server CPU > 80%, or need multiple servers for availability |
| **Scale** (100+ concurrent) | Multiple worker servers, shared Redis, load balancer | Separate API from workers, horizontal worker scaling | Worker costs, need geographic distribution |
| **Enterprise** | Kubernetes, auto-scaling worker pools, CDN | Container orchestration, auto-scaling policies | Complex deployment needs, multi-region |

**Key migration points:**

1. **p-queue -> BullMQ:** When you need persistence (job survives restart), visibility (dashboard), or multiple servers.

2. **Local files -> S3:** When disk fills up, or when you need multiple servers accessing same files, or when you need CDN delivery.

3. **Single server -> Workers:** When CPU is bottleneck. Render workers can scale horizontally; API server stays small.

---

## Error Boundaries

Where to catch and handle errors, and what to do:

### Boundary 1: API Input Validation
**Errors:** Invalid JSON, schema violations, missing required fields
**Handling:** Return 400 with detailed validation errors
**Recovery:** None needed - fail fast

### Boundary 2: Asset Loading
**Errors:** Asset not found (404), network timeout, corrupt file
**Handling:**
- Try alternate sources if configured
- Use placeholder for non-critical assets
- Fail render if critical asset missing
**Recovery:** Retry with exponential backoff for network errors

### Boundary 3: Frame Rendering
**Errors:** Canvas errors, font rendering failures, out of memory
**Handling:**
- Log frame number and element that failed
- For non-critical elements, skip and continue
- For critical failures, abort render
**Recovery:** Consider reducing quality or resolution for memory issues

### Boundary 4: FFmpeg Process
**Errors:** Process crash, encoding error, disk full, timeout
**Handling:**
- Capture stderr for diagnostics
- Clean up partial output file
- Mark job as failed with error details
**Recovery:**
- Retry once for transient failures
- For disk full, alert and halt new jobs
- For consistent failures, check FFmpeg installation

### Boundary 5: Job Queue
**Errors:** Job timeout, job abandoned (server restart)
**Handling:**
- Mark job as failed after timeout
- Clean up any partial resources
- Notify via webhook if configured
**Recovery:** Jobs should be idempotent - safe to retry

**Error code taxonomy:**

```typescript
enum RenderErrorCode {
  // 4xx - Client errors (don't retry)
  INVALID_SPEC = 'INVALID_SPEC',
  ASSET_NOT_FOUND = 'ASSET_NOT_FOUND',
  UNSUPPORTED_FORMAT = 'UNSUPPORTED_FORMAT',

  // 5xx - Server errors (may retry)
  RENDER_FAILED = 'RENDER_FAILED',
  ENCODER_CRASHED = 'ENCODER_CRASHED',
  OUT_OF_MEMORY = 'OUT_OF_MEMORY',
  TIMEOUT = 'TIMEOUT',

  // Retryable
  TRANSIENT_FAILURE = 'TRANSIENT_FAILURE',
}
```

---

## Open Architecture Questions

Decisions to make during planning/implementation:

1. **Canvas backend: node-canvas vs skia-canvas?**
   - node-canvas: More mature, Cairo-based, well-documented
   - skia-canvas: Skia-based (Chrome's engine), potentially faster, better text
   - Recommendation: Start with node-canvas, benchmark skia-canvas later

2. **Video clips: FFmpeg frame extraction vs dedicated library?**
   - Need to extract frames from video clips used as elements
   - FFmpeg can do it but requires managing another process
   - Libraries like `ffmpeg-extract-frames` wrap FFmpeg
   - Recommendation: FFmpeg with caching - extract needed frames on demand

3. **Audio handling: Mix during render or post-process?**
   - Option A: Generate silent video, mix audio with FFmpeg post
   - Option B: Generate audio track in parallel, combine at end
   - Recommendation: Post-process is simpler; do audio mixing as separate step

4. **Font handling: System fonts or embedded?**
   - System fonts are simpler but inconsistent across servers
   - Embedded fonts require font file management
   - Recommendation: Support both; default to embedded for consistency

5. **Resolution limits: What's the max supported?**
   - 4K (3840x2160) at 60fps is ~25GB of raw frames for 30 seconds
   - Memory and CPU constraints are real
   - Recommendation: Start with 1080p cap, test higher resolutions carefully

---

## Sources

**Programmatic Video Frameworks:**
- [Remotion](https://www.remotion.dev/) - React-based video generation
- [Motion Canvas](https://motioncanvas.io/) - TypeScript animation library
- [Creatomate](https://creatomate.com/docs/json/introduction) - JSON-based video API
- [canvas2video](https://github.com/pankod/canvas2video) - Canvas to video library

**Architecture Patterns:**
- [Entity Component System](https://en.wikipedia.org/wiki/Entity_component_system) - ECS pattern
- [Game Programming Patterns - Component](https://gameprogrammingpatterns.com/component.html) - Component pattern
- [BullMQ](https://bullmq.io/) - Queue architecture for Node.js

**Canvas & Rendering:**
- [Konva Node.js Setup](https://konvajs.org/docs/nodejs/nodejs-setup) - Server-side canvas
- [LeanLabs Konva Video Tutorial](https://leanylabs.com/blog/node-videos-konva/) - Video generation patterns

**FFmpeg Integration:**
- [Transloadit FFmpeg Streaming](https://transloadit.com/devtips/stream-video-processing-with-node-js-and-ffmpeg/) - Stream processing
- [FFmpeg Incident Response](https://hoop.dev/blog/ffmpeg-incident-response-fast-exact-repeatable/) - Error handling

**Scaling:**
- [Horizontal Scaling Video Processing](https://ignitarium.com/horizontal-scaling-of-video-processing-applications/) - Scaling patterns
- [AWS SageMaker Video Generation](https://aws.amazon.com/blogs/machine-learning/build-a-scalable-ai-video-generator-using-amazon-sagemaker-ai-and-cogvideox/) - Cloud architecture
