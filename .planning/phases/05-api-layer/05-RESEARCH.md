# Phase 5: API Layer - Research

**Researched:** 2026-01-26
**Domain:** HTTP API, authentication, rate limiting, job queue, file uploads, webhooks
**Confidence:** HIGH

## Summary

This phase builds a REST API layer on top of the existing video rendering engine. The API enables external developers to authenticate, submit render jobs, poll status, receive webhooks, and manage assets. Research confirms Hono as the optimal framework choice given its exceptional performance (3x faster than Express, 40% less memory), TypeScript-first design, and built-in Zod validator integration that aligns with the project's existing schema validation approach.

The API follows an async job pattern: POST /render accepts the JSON spec, validates it using existing Zod schemas, queues the job, and returns a job ID. Clients poll GET /render/:jobId for status. For short videos (<30s), sync mode returns the completed video directly. Rate limiting uses hono-rate-limiter with API key-based keying (not IP addresses). p-queue manages job concurrency in-memory - sufficient for MVP, with clear upgrade path to BullMQ if persistence becomes necessary.

Asset uploads (images, audio) use Hono's built-in parseBody for multipart handling with bodyLimit middleware for size constraints. Uploaded assets are stored locally with unique IDs (crypto.randomUUID), and the existing AssetManager caches remote URLs during render sessions.

**Primary recommendation:** Use Hono with @hono/zod-validator for API framework, hono-rate-limiter for tiered rate limits, p-queue for job management, and crypto.randomUUID for identifiers. Leverage existing validateVideoSpec and renderVideo for the render pipeline.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| hono | ^4.x | HTTP framework | 3x faster than Express, TypeScript-first, Zod integration |
| @hono/node-server | ^1.x | Node.js adapter | Official Hono adapter for Node.js runtime |
| @hono/zod-validator | ^0.4.x | Request validation | Direct Zod integration, already using Zod 3.25 |
| hono-rate-limiter | ^0.4.x | Rate limiting | API key-based rate limiting, tiered plans |
| p-queue | ^8.0.1 | Job queue | In-memory concurrency control, priority support |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| crypto (built-in) | Node.js | UUID generation | randomUUID for job IDs, asset IDs |
| async-retry | ^1.3.x | Webhook retries | Exponential backoff for webhook delivery |
| node:fs/promises | Node.js | File storage | Local asset and output storage for MVP |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hono | Fastify | Fastify mature but heavier; Hono lighter, faster, better edge portability |
| Hono | Express | Express slower (3x), larger footprint, older patterns |
| p-queue | BullMQ | BullMQ needs Redis; p-queue sufficient for single-instance MVP |
| Local storage | S3 | S3 adds complexity; local sufficient for MVP, easy to abstract later |
| randomUUID | nanoid | UUID 4x faster, no extra dependency, standard format |

**Installation:**
```bash
npm install hono @hono/node-server @hono/zod-validator hono-rate-limiter p-queue async-retry
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── api/                    # API layer (new)
│   ├── app.ts             # Hono app setup, middleware
│   ├── server.ts          # Node.js server with graceful shutdown
│   ├── routes/
│   │   ├── render.ts      # POST /render, GET /render/:jobId
│   │   └── assets.ts      # POST /assets
│   ├── middleware/
│   │   ├── auth.ts        # API key authentication
│   │   ├── rate-limit.ts  # Tiered rate limiting
│   │   └── error-handler.ts
│   ├── services/
│   │   ├── job-queue.ts   # p-queue wrapper for render jobs
│   │   ├── job-store.ts   # In-memory job state storage
│   │   ├── webhook.ts     # Webhook delivery with retries
│   │   └── asset-store.ts # Asset upload and storage
│   └── types.ts           # API-specific types
├── encoder/               # Existing (Phase 4)
├── render/                # Existing
└── schemas/               # Existing + extend for API
```

### Pattern 1: Async Job Processing with Polling
**What:** Submit long-running job, return immediately with job ID, poll for completion
**When to use:** All render requests (with sync mode shortcut for <30s videos)
**Example:**
```typescript
// Source: Hono docs + async job pattern research
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { VideoSpecSchema } from '../schemas/video-spec.js';

const RenderRequestSchema = z.object({
  spec: VideoSpecSchema,
  webhook_url: z.string().url().optional(),
  sync: z.boolean().default(false),
});

type Job = {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  result?: { download_url: string };
  error?: string;
  created_at: number;
  completed_at?: number;
};

const jobs = new Map<string, Job>();

app.post('/render',
  zValidator('json', RenderRequestSchema),
  async (c) => {
    const { spec, webhook_url, sync } = c.req.valid('json');
    const jobId = crypto.randomUUID();

    // Calculate duration for sync mode check
    const duration = spec.scenes?.reduce((sum, s) => sum + s.duration, 0) ?? 0;
    const isShortVideo = duration <= 30;

    const job: Job = {
      id: jobId,
      status: 'queued',
      created_at: Date.now(),
    };
    jobs.set(jobId, job);

    // Queue the job
    jobQueue.add(async () => {
      // ... render logic
    }, { priority: 0 });

    if (sync && isShortVideo) {
      // Wait for completion and return inline
      // (implementation detail)
    }

    return c.json({
      job_id: jobId,
      status: 'queued',
      poll_url: `/render/${jobId}`,
    }, 202);
  }
);
```

### Pattern 2: API Key Authentication
**What:** Validate API key from Authorization header, lookup user/plan
**When to use:** All API routes
**Example:**
```typescript
// Source: Hono bearer-auth docs
import { bearerAuth } from 'hono/bearer-auth';

// For MVP: Simple lookup from in-memory store or env
// Production: Database lookup
interface ApiKey {
  key: string;
  userId: string;
  plan: 'free' | 'pro';
}

const apiKeys = new Map<string, ApiKey>();
// Load from env or config on startup

const authMiddleware = bearerAuth({
  verifyToken: async (token, c) => {
    const apiKey = apiKeys.get(token);
    if (!apiKey) return false;

    // Attach to context for downstream use
    c.set('userId', apiKey.userId);
    c.set('plan', apiKey.plan);
    return true;
  },
});

app.use('/render/*', authMiddleware);
app.use('/assets/*', authMiddleware);
```

### Pattern 3: Tiered Rate Limiting
**What:** Different rate limits based on plan tier
**When to use:** All API routes, keyed by API key
**Example:**
```typescript
// Source: hono-rate-limiter docs
import { rateLimiter } from 'hono-rate-limiter';

const createRateLimiter = (plan: 'free' | 'pro') => {
  const limits = {
    free: { windowMs: 60_000, limit: 10 },   // 10/min
    pro: { windowMs: 60_000, limit: 60 },    // 60/min
  };

  return rateLimiter({
    windowMs: limits[plan].windowMs,
    limit: limits[plan].limit,
    standardHeaders: 'draft-7',
    keyGenerator: (c) => c.get('userId') ?? 'anonymous',
  });
};

// Apply based on plan from auth
app.use('/render/*', async (c, next) => {
  const plan = c.get('plan') ?? 'free';
  const limiter = createRateLimiter(plan);
  return limiter(c, next);
});
```

### Pattern 4: Webhook Delivery with Exponential Backoff
**What:** Deliver webhook on job completion with retries
**When to use:** When webhook_url is provided in render request
**Example:**
```typescript
// Source: async-retry docs + webhook best practices
import retry from 'async-retry';

interface WebhookPayload {
  job_id: string;
  status: 'completed' | 'failed';
  download_url?: string;
  error?: string;
  timestamp: string;
}

async function deliverWebhook(url: string, payload: WebhookPayload): Promise<void> {
  await retry(
    async (bail) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000), // 10s timeout per attempt
      });

      // Don't retry 4xx errors (client error)
      if (res.status >= 400 && res.status < 500) {
        bail(new Error(`Webhook rejected: ${res.status}`));
        return;
      }

      if (!res.ok) {
        throw new Error(`Webhook failed: ${res.status}`);
      }
    },
    {
      retries: 5,
      factor: 2,
      minTimeout: 1000,     // 1s initial
      maxTimeout: 60_000,   // 1min max
      randomize: true,      // Add jitter
    }
  );
}
```

### Pattern 5: File Upload with Size Limits
**What:** Handle multipart file uploads with validation
**When to use:** POST /assets endpoint
**Example:**
```typescript
// Source: Hono file upload + body-limit docs
import { bodyLimit } from 'hono/body-limit';

const MAX_ASSET_SIZE = 50 * 1024 * 1024; // 50MB

app.post('/assets',
  bodyLimit({
    maxSize: MAX_ASSET_SIZE,
    onError: (c) => {
      return c.json({ error: 'File too large', max_size: MAX_ASSET_SIZE }, 413);
    },
  }),
  async (c) => {
    const body = await c.req.parseBody();
    const file = body['file'];

    if (!(file instanceof File)) {
      return c.json({ error: 'No file provided' }, 400);
    }

    // Validate content type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'audio/mpeg', 'audio/wav'];
    if (!allowedTypes.includes(file.type)) {
      return c.json({ error: 'Invalid file type', allowed: allowedTypes }, 400);
    }

    const assetId = crypto.randomUUID();
    const ext = file.name.split('.').pop() ?? 'bin';
    const filename = `${assetId}.${ext}`;

    // Write to local storage
    const buffer = await file.arrayBuffer();
    await fs.writeFile(`./uploads/${filename}`, Buffer.from(buffer));

    return c.json({
      asset_id: assetId,
      filename,
      size: file.size,
      type: file.type,
    }, 201);
  }
);
```

### Anti-Patterns to Avoid
- **Blocking the event loop:** Never run renderVideo synchronously in request handler; always queue
- **Rate limiting by IP:** IP can be shared; use API key for accurate per-user limiting
- **No timeout on webhook delivery:** Always set AbortSignal.timeout to prevent hanging
- **Storing jobs only in memory without cleanup:** Implement TTL/cleanup for completed jobs
- **Ignoring Content-Type on validation:** Hono's zValidator returns empty object without proper content-type header

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP framework | Custom http server | Hono | Routing, middleware, error handling, testing |
| Request validation | Manual JSON.parse + checks | @hono/zod-validator | Type safety, error messages, already using Zod |
| Rate limiting | Counter in Map | hono-rate-limiter | Sliding window, headers, storage backends |
| Concurrency control | Promise.all with limits | p-queue | Backpressure, priority, events, timeout |
| Retry with backoff | setTimeout loops | async-retry | Jitter, configurable strategies, bail |
| UUID generation | Math.random string | crypto.randomUUID | Cryptographically secure, 4x faster than nanoid |
| API key verification | Custom header parsing | Hono bearerAuth | Standard format, error responses |

**Key insight:** The API layer is primarily orchestration - validating input, queuing work, tracking status, delivering results. Every piece has a well-tested library. Focus on integration, not reinvention.

## Common Pitfalls

### Pitfall 1: Empty Validation Result Without Content-Type
**What goes wrong:** zValidator returns empty object, validation silently passes
**Why it happens:** Client didn't send `Content-Type: application/json` header
**How to avoid:** Document API requirements; add custom error for missing content-type
**Warning signs:** Validation succeeds but data is undefined/empty

### Pitfall 2: Memory Growth from Job Store
**What goes wrong:** Memory grows unbounded as completed jobs accumulate
**Why it happens:** Jobs stored in Map without cleanup
**How to avoid:** Implement TTL (24h) and periodic cleanup; limit max stored jobs
**Warning signs:** Increasing memory usage over time, OOM in long-running servers

### Pitfall 3: Rate Limiter Key Not Set
**What goes wrong:** hono-rate-limiter throws or limits globally
**Why it happens:** keyGenerator function returns undefined or empty string
**How to avoid:** Always return a valid key; fallback to 'anonymous' for unauthenticated
**Warning signs:** "keyGenerator must return a string" errors

### Pitfall 4: Sync Mode Blocks Event Loop
**What goes wrong:** Server unresponsive during sync render
**Why it happens:** Waiting for renderVideo in request handler without proper architecture
**How to avoid:** Even sync mode should queue job and wait for completion event, not inline
**Warning signs:** Other requests time out during sync render

### Pitfall 5: Webhook Delivery Retry Storm
**What goes wrong:** Server overwhelmed with webhook retries
**Why it happens:** No jitter in backoff, all retries synchronized
**How to avoid:** Always use randomize: true in async-retry options
**Warning signs:** Sudden spikes in outbound requests

### Pitfall 6: Asset Reference Not Found During Render
**What goes wrong:** Render fails with "asset not found"
**Why it happens:** Asset ID in spec doesn't map to uploaded file
**How to avoid:** Validate asset references exist before queueing job; preload into AssetManager
**Warning signs:** "Image not preloaded" errors from AssetManager

## Code Examples

Verified patterns from official sources:

### Complete Hono App Setup
```typescript
// Source: Hono Node.js docs
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { logger } from 'hono/logger';

// Create app with typed bindings
type Bindings = {
  userId?: string;
  plan?: 'free' | 'pro';
};

const app = new Hono<{ Bindings: Bindings }>();

// Global middleware
app.use('*', logger());
app.use('*', cors({
  origin: ['https://your-app.com'],
  allowMethods: ['GET', 'POST'],
  allowHeaders: ['Authorization', 'Content-Type'],
}));

// Global error handler
app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return error.getResponse();
  }
  console.error('Unhandled error:', error);
  return c.json({ error: 'Internal server error' }, 500);
});

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Mount routes
// app.route('/render', renderRoutes);
// app.route('/assets', assetRoutes);

// Start server with graceful shutdown
const server = serve({
  fetch: app.fetch,
  port: Number(process.env.PORT ?? 3000),
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});
```

### Job Queue Service
```typescript
// Source: p-queue docs
import PQueue from 'p-queue';
import { EventEmitter } from 'node:events';

interface RenderJob {
  id: string;
  spec: VideoSpec;
  webhookUrl?: string;
  userId: string;
}

interface JobResult {
  id: string;
  outputPath: string;
  duration: number;
}

class JobQueueService extends EventEmitter {
  private queue: PQueue;
  private jobs = new Map<string, Job>();

  constructor(concurrency = 2) {
    super();
    this.queue = new PQueue({
      concurrency,
      timeout: 5 * 60 * 1000, // 5 min timeout per job
    });

    // Forward queue events
    this.queue.on('idle', () => this.emit('idle'));
    this.queue.on('error', (err) => this.emit('error', err));
  }

  async enqueue(renderJob: RenderJob): Promise<void> {
    const job: Job = {
      id: renderJob.id,
      status: 'queued',
      created_at: Date.now(),
    };
    this.jobs.set(job.id, job);

    // Don't await - fire and forget, status tracked separately
    this.queue.add(async () => {
      job.status = 'processing';
      this.emit('job:processing', job.id);

      try {
        const result = await this.processJob(renderJob);
        job.status = 'completed';
        job.result = { download_url: `/download/${result.outputPath}` };
        job.completed_at = Date.now();
        this.emit('job:completed', job.id, result);
      } catch (error) {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : 'Unknown error';
        job.completed_at = Date.now();
        this.emit('job:failed', job.id, error);
      }
    });
  }

  private async processJob(renderJob: RenderJob): Promise<JobResult> {
    // Use existing renderVideo from encoder module
    const { renderVideo } = await import('../encoder/video-renderer.js');

    const outputPath = `outputs/${renderJob.id}.mp4`;
    const result = await renderVideo({
      scenes: renderJob.spec.scenes,
      width: renderJob.spec.output.width,
      height: renderJob.spec.output.height,
      fps: renderJob.spec.output.fps,
      outputPath,
      audio: renderJob.spec.audio,
    });

    return {
      id: renderJob.id,
      outputPath: result.outputPath,
      duration: result.duration,
    };
  }

  getJob(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  get size(): number {
    return this.queue.size;
  }

  get pending(): number {
    return this.queue.pending;
  }
}
```

### Testing with Hono testClient
```typescript
// Source: Hono testing docs
import { describe, it, expect, beforeAll } from 'vitest';
import { testClient } from 'hono/testing';
import app from '../api/app.js';

describe('Render API', () => {
  const client = testClient(app);

  it('should reject request without auth', async () => {
    const res = await client.render.$post({
      json: { spec: { output: { width: 1920, height: 1080, duration: 10 }, scenes: [] } },
    });

    expect(res.status).toBe(401);
  });

  it('should accept valid render request', async () => {
    const res = await client.render.$post(
      {
        json: {
          spec: {
            output: { width: 1920, height: 1080, duration: 10 },
            scenes: [{ duration: 10, elements: [] }],
          },
        },
      },
      {
        headers: { Authorization: 'Bearer test-api-key' },
      }
    );

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.job_id).toBeDefined();
    expect(body.status).toBe('queued');
  });

  it('should return validation errors for invalid spec', async () => {
    const res = await client.render.$post(
      {
        json: {
          spec: { output: { width: 10000, height: 1080, duration: 10 }, scenes: [] },
        },
      },
      {
        headers: { Authorization: 'Bearer test-api-key' },
      }
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.fieldErrors).toBeDefined();
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Express.js | Hono/Fastify | 2024-2025 | 3x performance, TypeScript-first |
| passport.js | Framework middleware | 2024+ | Simpler, less boilerplate |
| Redis for everything | p-queue for MVP | N/A | Reduced dependencies, faster iteration |
| nanoid for IDs | crypto.randomUUID | Node 15.6+ | Built-in, 4x faster |
| IP-based rate limiting | API key-based | Best practice | More accurate, fairer limits |

**Deprecated/outdated:**
- **Express middleware patterns:** Hono uses different context-based pattern; don't copy Express tutorials
- **passport.js:** Overkill for API key auth; use framework's built-in bearerAuth
- **body-parser:** Hono has built-in parseBody; no separate middleware needed

## Open Questions

Things that couldn't be fully resolved:

1. **Sync mode implementation details**
   - What we know: For <30s videos, API should wait and return completed video
   - What's unclear: Best way to wait - EventEmitter, Promise, polling internally?
   - Recommendation: Use job queue event emitter, await specific job completion

2. **Job cleanup strategy**
   - What we know: Need TTL for completed jobs to prevent memory growth
   - What's unclear: Optimal TTL, should we persist job history anywhere?
   - Recommendation: Start with 24h TTL in-memory, add persistence if needed later

3. **Asset storage abstraction**
   - What we know: MVP uses local filesystem for uploads
   - What's unclear: When to abstract for S3 compatibility?
   - Recommendation: Create simple interface now (saveAsset, getAsset), implement S3 later

4. **API key management**
   - What we know: Need API keys with plan tiers
   - What's unclear: Key rotation, revocation, UI for management?
   - Recommendation: Start with env-configured keys, add database-backed later

## Sources

### Primary (HIGH confidence)
- [Hono Official Documentation](https://hono.dev/docs/) - Framework setup, middleware, validation, testing
- [@hono/zod-validator](https://hono.dev/docs/guides/validation) - Zod integration
- [p-queue GitHub](https://github.com/sindresorhus/p-queue) - Queue API, events, configuration
- [Node.js crypto.randomUUID](https://nodejs.org/api/crypto.html#cryptorandomuuidoptions) - Built-in UUID

### Secondary (MEDIUM confidence)
- [hono-rate-limiter GitHub](https://github.com/rhinobase/hono-rate-limiter) - Rate limiting middleware
- [async-retry npm](https://www.npmjs.com/package/async-retry) - Retry with backoff
- [Framework benchmarks](https://betterstack.com/community/guides/scaling-nodejs/hono-vs-fastify/) - Hono vs Fastify comparison
- [Webhook best practices](https://www.svix.com/resources/webhook-best-practices/retries/) - Retry patterns

### Tertiary (LOW confidence)
- Various Medium articles on API patterns - General guidance
- Community discussions on framework choices - Supplementary

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Hono well-documented, p-queue mature, patterns established
- Architecture: HIGH - Async job pattern is standard, well-documented
- Pitfalls: HIGH - Common issues documented in library issues/docs
- Integration with existing code: HIGH - Clear integration points with validateVideoSpec and renderVideo

**Research date:** 2026-01-26
**Valid until:** ~60 days (Hono ecosystem stable, patterns established)
