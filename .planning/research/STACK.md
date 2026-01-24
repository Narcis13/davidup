# Stack Research: GameMotion

**Researched:** 2026-01-24
**Domain:** Programmatic video generation (JSON-to-video rendering engine)
**Overall Confidence:** HIGH

## Recommended Stack

| Component | Recommendation | Confidence | Rationale |
|-----------|---------------|------------|-----------|
| 2D Rendering | @napi-rs/canvas@0.1.88 | HIGH | 44% faster than skia-canvas, zero system dependencies, pure npm install, Lottie support built-in |
| Video Encoding | fluent-ffmpeg@2.1.3 + ffmpeg-static@5.2.0 | HIGH | Industry standard combination; fluent API + bundled FFmpeg binary |
| API Framework | Fastify@5.7.1 | HIGH | 2.3x faster than Express, mature plugin ecosystem, built-in validation |
| Job Queue (MVP) | p-queue@8.0.1 | HIGH | In-memory concurrency control, sufficient for 50-100 concurrent jobs |
| Job Queue (Scale) | BullMQ@5.x | MEDIUM | Redis-backed, for when you need persistence/multi-worker |
| AI Integration | OpenRouter + Zod | HIGH | Multi-model access, structured outputs via json_schema |
| Database | Prisma@5.x | HIGH | Type-safe ORM, SQLite dev / PostgreSQL prod |
| Runtime | Node.js 22.x LTS | HIGH | Latest LTS, required for Fastify v5 |

---

## 2D Rendering

### Recommendation: @napi-rs/canvas@0.1.88

**Why this over alternatives:**

@napi-rs/canvas is a high-performance Skia binding for Node.js that provides the fastest single-threaded Canvas API implementation. Key advantages:

1. **Performance**: 44% faster than skia-canvas in benchmark tests (68 ops/s vs 47 ops/s for "draw house, export PNG")
2. **Zero dependencies**: Pure npm package, no node-gyp, no system libraries required
3. **Lottie support**: Built-in `LottieAnimation.loadFromFile()` for motion graphics
4. **Format support**: PNG, JPEG, AVIF, WebP export with non-blocking encoding in libuv thread pool
5. **AWS Lambda ready**: Pre-built Lambda layer available

```typescript
import { createCanvas, loadImage, LottieAnimation } from '@napi-rs/canvas';

// Basic rendering
const canvas = createCanvas(1920, 1080);
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#000000';
ctx.fillRect(0, 0, 1920, 1080);

// Export (non-blocking)
const buffer = await canvas.encode('png');

// Lottie animation support
const lottie = LottieAnimation.loadFromFile('./animation.json');
lottie.render(ctx, { width: 1920, height: 1080 });
```

**Alternatives considered:**

| Library | Why Not |
|---------|---------|
| **skia-canvas** | 44% slower in serial mode. Multi-threaded async mode is faster for batch processing, but GameMotion renders frames sequentially for video. More dependencies. |
| **node-canvas** | Uses Cairo, not Skia. 13% slower than @napi-rs/canvas. Requires system dependencies (cairo, pango). No Lottie support. |
| **fabric.js (server)** | Built on node-canvas, adds overhead. Better for complex object manipulation, overkill for frame rendering. |
| **Sharp** | Image processing only, not a Canvas API. Use alongside @napi-rs/canvas for image transformations if needed. |

**Sources:**
- [@napi-rs/canvas npm](https://www.npmjs.com/package/@napi-rs/canvas)
- [GitHub Brooooooklyn/canvas](https://github.com/Brooooooklyn/canvas)
- [Benchmark discussion](https://github.com/Brooooooklyn/canvas/discussions/977)

---

## Video Encoding

### Recommendation: fluent-ffmpeg@2.1.3 + ffmpeg-static@5.2.0

**Why this combination:**

These packages work together: `ffmpeg-static` bundles the FFmpeg binary, `fluent-ffmpeg` provides a clean Node.js API.

```typescript
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';

// Point fluent-ffmpeg to bundled binary
ffmpeg.setFfmpegPath(ffmpegStatic);

// Memory-efficient streaming: pipe frames to FFmpeg stdin
const command = ffmpeg()
  .input('pipe:0')
  .inputFormat('rawvideo')
  .inputOptions([
    '-framerate 30',
    '-video_size 1920x1080',
    '-pix_fmt rgba'
  ])
  .outputOptions([
    '-c:v libx264',
    '-preset medium',
    '-crf 23',
    '-pix_fmt yuv420p'
  ])
  .output('output.mp4');

// Pipe canvas frames
command.on('start', () => {
  for (const frame of frames) {
    command.stdin.write(frame.toBuffer('raw'));
  }
  command.stdin.end();
});
```

**Memory-efficient patterns:**

1. **Streaming via stdin**: Pipe frames directly to FFmpeg instead of writing temp files
2. **Use `-f rawvideo`**: Avoid PNG encoding overhead, send raw pixel data
3. **Buffer management**: Use `queue.onSizeLessThan(10)` to prevent memory buildup

**Hardware acceleration (optional):**

For NVIDIA GPUs, add NVENC support:

```typescript
// Check for NVENC support
ffmpeg.getAvailableEncoders((err, encoders) => {
  const hasNvenc = Object.keys(encoders).some(e => e.includes('nvenc'));

  if (hasNvenc) {
    command.outputOptions([
      '-c:v h264_nvenc',
      '-preset p4',  // NVENC preset
      '-b:v 5M'
    ]);
  }
});
```

**Alternatives considered:**

| Approach | Why Not |
|----------|---------|
| **Raw child_process** | Works, but fluent-ffmpeg handles progress tracking, error handling, and option building. Less code to maintain. |
| **@ffmpeg/ffmpeg (WASM)** | WASM version is 10-20x slower than native FFmpeg. Only use for browser. |
| **ffmpeg-kit** | Overkill for Node.js. Designed for mobile/desktop apps. |
| **FFCreator** | Higher-level abstraction. Good for simple videos, but GameMotion needs frame-level control. |

**Sources:**
- [Creatomate: How to use FFmpeg in Node.js](https://creatomate.com/blog/how-to-use-ffmpeg-in-nodejs)
- [fluent-ffmpeg GitHub](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg)
- [NVIDIA FFmpeg documentation](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/ffmpeg-with-nvidia-gpu/index.html)

---

## API Framework

### Recommendation: Fastify@5.7.1

**Why Fastify over Hono:**

Both are excellent, but Fastify is the better choice for a Node.js monolith:

| Factor | Fastify | Hono |
|--------|---------|------|
| **Performance** | 2.3x faster than Express | Slightly behind Fastify on Node.js |
| **Ecosystem** | 200+ official plugins | Growing, but smaller |
| **Validation** | Built-in JSON Schema | Manual or third-party |
| **Node.js optimization** | Primary focus | Multi-runtime focus |
| **Memory** | Higher than Hono | 30% less than Fastify |

**Recommendation rationale:**
- GameMotion runs as a single Node.js process, not edge/serverless
- Fastify's built-in JSON Schema validation aligns with GameMotion's JSON-driven design
- Mature plugin ecosystem (auth, rate limiting, multipart, etc.)
- Better JSON serialization performance (important for API responses)

```typescript
import Fastify from 'fastify';

const app = Fastify({
  logger: true,
  ajv: {
    customOptions: {
      removeAdditional: 'all',  // Strip unknown properties
      coerceTypes: true,
      useDefaults: true
    }
  }
});

// Built-in schema validation
app.post('/render', {
  schema: {
    body: {
      type: 'object',
      required: ['scenes'],
      properties: {
        scenes: { type: 'array' },
        fps: { type: 'number', default: 30 }
      }
    }
  }
}, async (request, reply) => {
  // request.body is validated and typed
});
```

**Alternatives considered:**

| Framework | Why Not |
|-----------|---------|
| **Hono** | Optimized for edge/serverless. Lower memory is nice, but Fastify's Node.js optimization and plugin ecosystem are more valuable for a monolith. |
| **Express** | 2.3x slower than Fastify. Legacy callback patterns. No built-in validation. |
| **Elysia** | Bun-optimized. GameMotion targets Node.js for broader compatibility. |
| **NestJS** | Enterprise framework with steep learning curve. Overkill for GameMotion's API surface. |

**Sources:**
- [Better Stack: Hono vs Fastify](https://betterstack.com/community/guides/scaling-nodejs/hono-vs-fastify/)
- [Fastify LTS documentation](https://fastify.dev/docs/latest/Reference/LTS/)
- [Fastify npm](https://www.npmjs.com/package/fastify)

---

## Job Queue

### MVP: p-queue@8.0.1

For MVP with single-process deployment, p-queue is sufficient:

```typescript
import PQueue from 'p-queue';

const renderQueue = new PQueue({
  concurrency: 4,        // Parallel render jobs
  intervalCap: 10,       // Max 10 jobs started per interval
  interval: 1000,        // Per second
  carryoverConcurrencyCount: true
});

// Add job with priority
await renderQueue.add(() => renderVideo(config), { priority: 1 });

// Backpressure: wait if queue too large
await renderQueue.onSizeLessThan(100);

// Progress tracking
console.log(`Queue: ${renderQueue.size} waiting, ${renderQueue.pending} running`);
```

**p-queue capabilities:**
- Concurrency limiting (handles 50-100 concurrent jobs easily)
- Priority queuing
- Rate limiting (intervalCap)
- Pause/resume
- Backpressure management (onSizeLessThan)
- AbortController support for cancellation

**Limitation:** In-memory only. Jobs lost on process restart.

### Scale: BullMQ@5.x

Upgrade to BullMQ when you need:
- **Persistence**: Jobs survive process restarts
- **Multi-worker**: Scale across multiple Node.js processes/servers
- **Scheduling**: Delayed jobs, cron-like scheduling
- **Retries**: Automatic retry with backoff
- **Observability**: Redis-backed dashboards

```typescript
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis();

const renderQueue = new Queue('render', { connection });

const worker = new Worker('render', async (job) => {
  const { config } = job.data;
  await renderVideo(config);
}, {
  connection,
  concurrency: 4
});
```

**When to upgrade from p-queue to BullMQ:**
- Need job persistence across restarts
- Running multiple Node.js processes
- Need scheduled/delayed jobs
- Need built-in retry logic
- Want job progress dashboards

**Sources:**
- [p-queue GitHub](https://github.com/sindresorhus/p-queue)
- [BullMQ documentation](https://docs.bullmq.io)
- [BullMQ getting started guide](https://www.dragonflydb.io/guides/bullmq)

---

## AI Integration

### Recommendation: OpenRouter + Zod

**Why OpenRouter:**
- Single API for 400+ models (Claude, GPT-4, Gemini, Llama, etc.)
- OpenAI-compatible API format
- Built-in structured outputs support
- Provider routing and fallback
- Usage analytics

**Recommended models for JSON generation:**

| Model | Use Case | Pricing |
|-------|----------|---------|
| **Claude Sonnet 4** | Complex scene generation, best instruction following | $3/$15 per 1M tokens |
| **Claude Sonnet 4.5** | Latest, best for agentic workflows | Higher |
| **GPT-4o** | Alternative, good structured output | Varies |
| **Claude Haiku** | Simple scenes, cost-optimized | Lower |

**Structured output with Zod:**

```typescript
import { z } from 'zod';
import OpenAI from 'openai';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Define scene schema with Zod
const SceneSchema = z.object({
  duration: z.number().min(0.1).describe('Scene duration in seconds'),
  elements: z.array(z.object({
    type: z.enum(['text', 'image', 'shape']),
    position: z.object({ x: z.number(), y: z.number() }),
    animations: z.array(z.object({
      property: z.string(),
      from: z.number(),
      to: z.number(),
      easing: z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut'])
    }))
  }))
});

type Scene = z.infer<typeof SceneSchema>;

// OpenRouter client
const client = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY
});

// Generate with structured output
const response = await client.chat.completions.create({
  model: 'anthropic/claude-sonnet-4',
  messages: [
    { role: 'user', content: 'Create a 5-second intro scene with animated text' }
  ],
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'scene',
      strict: true,
      schema: zodToJsonSchema(SceneSchema)
    }
  }
});

// Parse and validate
const scene = SceneSchema.parse(JSON.parse(response.choices[0].message.content));
```

**Key packages:**
- `openai@4.x` - OpenAI SDK (works with OpenRouter)
- `zod@3.x` - Schema definition and validation
- `zod-to-json-schema@3.x` - Convert Zod to JSON Schema for API

**Sources:**
- [OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
- [OpenRouter Claude Sonnet 4](https://openrouter.ai/anthropic/claude-sonnet-4)
- [Zod for TypeScript AI development](https://workos.com/blog/zod-for-typescript)
- [OpenAI Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)

---

## Database

### Recommendation: Prisma@5.x with SQLite (dev) / PostgreSQL (prod)

Already specified in PRD. This is the right choice:

```prisma
// prisma/schema.prisma
datasource db {
  provider = "postgresql"  // or "sqlite" for dev
  url      = env("DATABASE_URL")
}

model RenderJob {
  id        String   @id @default(cuid())
  status    JobStatus
  config    Json     // Store scene config as JSON
  progress  Float    @default(0)
  outputUrl String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

enum JobStatus {
  PENDING
  RENDERING
  COMPLETE
  FAILED
}
```

**Why Prisma:**
- Type-safe queries with auto-generated types
- Easy migrations
- SQLite for local dev (zero setup)
- PostgreSQL for production (scalable)
- JSON field support for scene configs

---

## Version Constraints

| Package | Min Version | Reason |
|---------|-------------|--------|
| Node.js | 22.x LTS | Latest LTS, Fastify v5 requires 20+ |
| @napi-rs/canvas | 0.1.88 | Latest, includes Lottie and AVIF support |
| Fastify | 5.7.1 | Latest stable, security fixes |
| fluent-ffmpeg | 2.1.3 | Stable, well-maintained |
| ffmpeg-static | 5.2.0 | Bundles FFmpeg 5.1.x |
| p-queue | 8.0.1 | ESM-only, TypeScript types |
| Prisma | 5.x | JSON field improvements |
| Zod | 3.x | Stable, AI SDK integration |
| TypeScript | 5.x | Latest features |

---

## Installation

```bash
# Core dependencies
npm install @napi-rs/canvas@^0.1.88 \
  fluent-ffmpeg@^2.1.3 \
  ffmpeg-static@^5.2.0 \
  fastify@^5.7.1 \
  p-queue@^8.0.1 \
  @prisma/client@^5.0.0 \
  openai@^4.0.0 \
  zod@^3.23.0 \
  zod-to-json-schema@^3.23.0

# Dev dependencies
npm install -D typescript@^5.0.0 \
  prisma@^5.0.0 \
  @types/node@^22.0.0 \
  @types/fluent-ffmpeg@^2.1.0

# Initialize Prisma
npx prisma init
```

---

## Open Questions

1. **GPU acceleration scope**: Should hardware encoding (NVENC) be MVP or post-MVP? It's optional but provides 3-5x encoding speedup on supported hardware.

2. **WebCodecs integration**: @napi-rs/canvas supports @napi-rs/webcodecs for video encoding. Worth investigating as alternative to FFmpeg for some use cases.

3. **Lottie library selection**: @napi-rs/canvas has built-in Lottie support, but lottie-to-canvas or lottie-player might offer more features. Needs deeper research if complex Lottie support is required.

4. **Memory profiling**: Need to benchmark memory usage with 4K video frames. May need to tune Node.js heap size or implement frame pooling.

---

## Summary

The recommended stack prioritizes:
- **Performance**: @napi-rs/canvas + FFmpeg streaming for efficient rendering
- **Developer experience**: TypeScript throughout, Fastify validation, Prisma types
- **Simplicity**: Single Node.js process, p-queue for MVP, upgrade path to BullMQ
- **AI flexibility**: OpenRouter for multi-model access, Zod for type-safe structured outputs

This stack is production-ready and scales from MVP to handling significant render volume.
