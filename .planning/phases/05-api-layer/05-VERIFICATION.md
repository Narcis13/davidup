---
phase: 05-api-layer
verified: 2026-01-25T22:54:16Z
status: gaps_found
score: 10/11 must-haves verified
gaps:
  - truth: "Developer can retrieve completed video via download URL"
    status: failed
    reason: "download_url is returned in job result but no GET /download/:jobId endpoint exists"
    artifacts:
      - path: "src/api/app.ts"
        issue: "No route handler for /download/:jobId pattern"
    missing:
      - "GET /download/:jobId endpoint to serve rendered video files"
      - "Static file serving or stream handler for outputs/*.mp4 files"
      - "Wire download route to app.ts with appropriate middleware"
---

# Phase 5: API Layer Verification Report

**Phase Goal:** External developers can authenticate, submit render jobs, poll status, receive webhooks, and manage assets

**Verified:** 2026-01-25T22:54:16Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Developer can authenticate with API key | VERIFIED | authMiddleware validates Bearer token, sets userId/plan on context. Tests pass (8/8). |
| 2 | Developer can submit render job via POST /render | VERIFIED | renderRoutes.post() validates spec, queues job, returns 202 with job_id. Tests pass (14/14). |
| 3 | Developer can poll job status via GET /render/:jobId | VERIFIED | renderRoutes.get() returns job with status/progress/result. 404 on not found. |
| 4 | Developer receives sync response for short videos (<30s) | VERIFIED | Sync mode logic checks totalDuration <= 30, waits for job:completed event, returns 200 with result. |
| 5 | Developer can configure webhook URL | VERIFIED | webhook_url accepted in POST /render, stored in job, delivers on completion/failure. |
| 6 | Developer receives webhook notification on completion | VERIFIED | jobQueue.on('job:completed') wired to deliverWebhook(). Tests verify delivery. |
| 7 | Developer can retrieve validation errors for invalid specs | VERIFIED | validateVideoSpec() returns fieldErrors, returned as 400 response. Tests verify. |
| 8 | System enforces rate limits per plan | VERIFIED | rateLimitMiddleware applies 10/min (free) or 60/min (pro). Tests verify 429 on exceed. |
| 9 | Developer can upload image assets via POST /assets | VERIFIED | assetRoutes.post() accepts PNG/JPEG/WebP up to 50MB, returns asset_id. Tests pass (14/14). |
| 10 | Developer can upload audio assets via POST /assets | VERIFIED | assetRoutes accepts MP3/WAV files, validates type and size. Tests verify. |
| 11 | Developer can retrieve completed video via download URL | FAILED | download_url returned (/download/:jobId.mp4) but no endpoint to serve file. |
| 12 | System caches remote assets during render | VERIFIED | AssetManager.loadImage() checks this.images.has(), caches with this.images.set(). Used by renderVideo. |

**Score:** 11/12 truths verified (1 failed)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| src/api/types.ts | API type definitions (Job, RenderRequest, ApiKey) | VERIFIED | 104 lines, exports all required types, no stubs |
| src/api/app.ts | Hono app with CORS, logger, error handler | VERIFIED | 69 lines, wires routes with auth/rate limit middleware |
| src/api/server.ts | Node.js server with graceful shutdown | VERIFIED | 42 lines, SIGTERM/SIGINT handlers present |
| src/api/middleware/error-handler.ts | Global error handler middleware | VERIFIED | Returns JSON for HTTPException/ZodError/generic errors |
| src/api/middleware/auth.ts | API key authentication middleware | VERIFIED | 50 lines, validates Bearer token, sets context |
| src/api/middleware/rate-limit.ts | Tiered rate limiting middleware | VERIFIED | 59 lines, 10/min free, 60/min pro, userId-based |
| src/api/services/job-store.ts | In-memory job storage with TTL | VERIFIED | 79 lines, create/get/update/delete/cleanup/size methods |
| src/api/services/job-queue.ts | p-queue wrapper with job processing | VERIFIED | 162 lines, enqueue/events/concurrency control, calls renderVideo |
| src/api/services/api-key-store.ts | API key storage and validation | VERIFIED | 56 lines, env var loading, validate() method |
| src/api/services/webhook.ts | Webhook delivery with retries | VERIFIED | 122 lines, 5 retries, exponential backoff, jitter |
| src/api/services/asset-store.ts | Local file storage for assets | VERIFIED | 165 lines, type/size validation, saves to ./uploads |
| src/api/routes/render.ts | POST /render, GET /render/:jobId | VERIFIED | 212 lines, spec validation, job queuing, sync mode |
| src/api/routes/assets.ts | POST /assets endpoint | VERIFIED | 160 lines, multipart upload, 50MB limit, returns asset_id |
| **src/api/routes/download.ts** | **GET /download/:jobId endpoint** | **MISSING** | **No file serving endpoint exists** |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| src/api/app.ts | src/api/middleware/error-handler.ts | app.onError import | WIRED | app.onError(errorHandler) on line 43 |
| src/api/app.ts | src/api/middleware/auth.ts | app.use middleware | WIRED | app.use('/render/*', authMiddleware) on line 58 |
| src/api/app.ts | src/api/middleware/rate-limit.ts | app.use middleware | WIRED | app.use('/render/*', rateLimitMiddleware) on line 59 |
| src/api/app.ts | src/api/routes/render.ts | app.route | WIRED | app.route('/render', renderRoutes) on line 60 |
| src/api/app.ts | src/api/routes/assets.ts | app.route | WIRED | app.route('/assets', assetRoutes) on line 65 |
| src/api/routes/render.ts | src/api/services/job-queue.ts | JobQueueService.enqueue | WIRED | await jobQueue.enqueue() on line 96 |
| src/api/routes/render.ts | src/validators/spec-validator.ts | validateVideoSpec | WIRED | validateVideoSpec(spec) on line 77 |
| src/api/routes/render.ts | src/api/services/webhook.ts | deliverWebhook | WIRED | jobQueue.on('job:completed') calls deliverWebhook on line 34 |
| src/api/services/job-queue.ts | src/encoder/video-renderer.ts | renderVideo | WIRED | import and call renderVideo() on line 104 |
| src/api/middleware/auth.ts | src/api/services/api-key-store.ts | apiKeyStore.validate | WIRED | apiKeyStore.validate(token) on line 38 |
| src/api/routes/assets.ts | src/api/services/asset-store.ts | assetStore.save | WIRED | await assetStore.save() on line 92 |
| **src/api/app.ts** | **src/api/routes/download.ts** | **app.route('/download')** | **NOT_WIRED** | **Missing route registration** |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| API-01: Authenticate with API key | SATISFIED | All truths verified |
| API-02: Submit render job via POST /render | SATISFIED | All truths verified |
| API-03: Poll job status via GET /render/:jobId | SATISFIED | All truths verified |
| API-04: Sync response for short videos (<30s) | SATISFIED | All truths verified |
| API-05: Configure webhook URL | SATISFIED | All truths verified |
| API-06: Retrieve validation errors | SATISFIED | All truths verified |
| API-07: Rate-limited per plan | SATISFIED | All truths verified |
| ASST-01: Upload image assets | SATISFIED | All truths verified |
| ASST-02: Upload audio assets | SATISFIED | All truths verified |
| ASST-03: Reference uploaded assets by ID | SATISFIED | asset_id returned, can be used in spec |
| ASST-04: Cache remote assets | SATISFIED | AssetManager caches in Map |
| **OUTP-05: Rendered video accessible via URL** | **BLOCKED** | **No download endpoint to serve files** |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/api/routes/render.ts | 29 | Comment: "will be replaced with DI in production" | Info | Acceptable for MVP, shared instances work |

### Human Verification Required

#### 1. End-to-end Render Flow

**Test:** 
1. Start server: `npm run dev:api`
2. Submit render job: 
```bash
curl -X POST http://localhost:3000/render \
  -H "Authorization: Bearer test-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "spec": {
      "output": {"width": 1280, "height": 720, "fps": 30, "duration": 5},
      "scenes": [{"duration": 5, "elements": []}]
    }
  }'
```
3. Note the job_id from response
4. Poll status: `curl http://localhost:3000/render/{job_id} -H "Authorization: Bearer test-api-key"`
5. Wait for status: "completed"
6. Attempt to download: `curl http://localhost:3000/download/{job_id}.mp4 -o video.mp4`

**Expected:** 
- POST returns 202 with job_id
- GET shows status progression (queued -> processing -> completed)
- Download URL works (currently will 404 - GAP)
- Video file downloads and plays

**Why human:** Full integration test with actual rendering, file I/O, and network behavior

#### 2. Rate Limiting Behavior

**Test:**
1. Use free tier API key
2. Make 11 requests rapidly to POST /render
3. Observe 11th request

**Expected:**
- First 10 requests: 200/202
- 11th request: 429 Too Many Requests
- Response includes rate limit headers

**Why human:** Timing-sensitive behavior across requests

#### 3. Webhook Delivery

**Test:**
1. Set up webhook endpoint (e.g., webhook.site)
2. Submit render job with webhook_url
3. Wait for job completion
4. Check webhook endpoint received notification

**Expected:**
- Webhook POST received with job_id, status, download_url
- Retries on 5xx errors (test by returning 503 first)
- No retry on 4xx errors

**Why human:** External service integration and retry behavior

### Gaps Summary

**1 critical gap blocking requirement OUTP-05:**

The API returns download URLs (`/download/{jobId}.mp4`) in job results, but no endpoint exists to serve these files. When a developer polls a completed job and receives the download_url, attempting to fetch it will result in 404.

**What's missing:**
- Route handler for `GET /download/:jobId` pattern
- File streaming logic to serve files from `outputs/` directory
- Optional: authentication check (should download URLs be public or require API key?)
- Optional: content-disposition header for browser download behavior

**Impact:** Developers can submit jobs and track status, but cannot retrieve the rendered video. This blocks the core use case.

**Recommended fix:**
Create `src/api/routes/download.ts`:
```typescript
import { Hono } from 'hono';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

export const downloadRoutes = new Hono();

downloadRoutes.get('/:jobId', async (c) => {
  const jobId = c.req.param('jobId');
  const filePath = `outputs/${jobId}`;
  
  // Check file exists
  try {
    await stat(filePath);
  } catch {
    return c.json({ error: 'Video not found' }, 404);
  }
  
  // Stream file
  const stream = createReadStream(filePath);
  return c.body(stream, {
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Disposition': `attachment; filename="${jobId}"`,
    },
  });
});
```

Wire to app.ts:
```typescript
import { downloadRoutes } from './routes/download.js';
app.route('/download', downloadRoutes);
```

---

**Tests:** 79/79 tests pass
**TypeScript:** Compiles without errors
**Files created:** 17 source files, 8 test files (2,812 total lines)
**Verification depth:** Level 3 (exists, substantive, wired)

---

_Verified: 2026-01-25T22:54:16Z_
_Verifier: Claude (gsd-verifier)_
