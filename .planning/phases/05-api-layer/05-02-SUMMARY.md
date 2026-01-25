---
phase: 05-api-layer
plan: 02
subsystem: api-services
tags: [job-store, job-queue, p-queue, async-jobs, tdd]
requires:
  - 04-04 (renderVideo pipeline)
provides:
  - JobStore for job state management
  - JobQueueService for async job processing
affects:
  - 05-03 (render routes will use JobQueueService)
  - 05-04 (polling will use JobStore.get)
tech-stack:
  added:
    - p-queue (9.1.0)
  patterns:
    - In-memory Map storage with TTL
    - EventEmitter for job lifecycle events
    - Queue concurrency control
key-files:
  created:
    - src/api/types.ts
    - src/api/services/job-store.ts
    - src/api/services/job-queue.ts
    - tests/api/job-store.test.ts
    - tests/api/job-queue.test.ts
decisions:
  - p-queue-concurrency: "Default concurrency 2 for memory management"
  - ttl-default: "24-hour TTL for job cleanup"
  - event-emitter: "EventEmitter for job:processing, job:completed, job:failed"
metrics:
  duration: 3 minutes
  completed: 2026-01-25
---

# Phase 05 Plan 02: Job Store & Queue Services Summary

In-memory job storage with TTL cleanup and p-queue-based job queue with renderVideo integration using TDD approach.

## What Was Built

### JobStore Service
- **Location:** `src/api/services/job-store.ts`
- **Purpose:** In-memory job storage with automatic TTL cleanup
- **API:**
  - `create(job)`: Store a new job
  - `get(id)`: Retrieve job by ID
  - `update(id, updates)`: Merge partial updates
  - `delete(id)`: Remove job
  - `cleanup()`: Remove expired jobs
  - `size`: Get job count

### JobQueueService
- **Location:** `src/api/services/job-queue.ts`
- **Purpose:** Queue manager for video rendering with concurrency control
- **API:**
  - `enqueue(renderJob)`: Queue job for processing
  - `getJob(id)`: Retrieve job from store
  - `size`: Pending jobs count
  - `pending`: Currently processing count
  - `onIdle()`: Wait for queue to empty
- **Events:**
  - `job:processing`: When job starts
  - `job:completed`: When job finishes successfully
  - `job:failed`: When job fails

### Job Type Definition
- **Location:** `src/api/types.ts`
- **Types:** Job, JobStatus, JobResult

## TDD Execution

### Task 1: RED - JobStore Tests
- Created 7 test cases covering create, get, update, delete, cleanup, size
- Tests failed with "module not found" (expected)
- **Commit:** b97df1a

### Task 2: GREEN - JobStore Implementation
- Implemented JobStore with Map storage
- All 7 tests pass
- **Commit:** f647648

### Task 3: RED/GREEN - JobQueueService
- Created 6 test cases with mocked renderVideo
- Implemented JobQueueService with p-queue integration
- All tests pass (13 total)
- **Commit:** 61f72f9

## Verification Results

| Check | Status |
|-------|--------|
| All tests pass | PASS (13/13) |
| TypeScript compiles | PASS |
| job-store.test.ts >= 50 lines | PASS (92 lines) |
| job-queue.test.ts >= 50 lines | PASS (122 lines) |
| JobStore imports in job-queue | PASS |
| renderVideo imports in job-queue | PASS |

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Default concurrency 2 | Balance throughput vs memory for video rendering |
| 24-hour TTL | Reasonable retention for download links |
| EventEmitter pattern | Standard Node.js pattern for async events |
| Type assertion for scenes | VideoSpec scenes compatible with AnimatedScene |

## Deviations from Plan

None - plan executed exactly as written.

## Key Patterns

```typescript
// Job lifecycle
const store = new JobStore();
const queue = new JobQueueService(store, { concurrency: 2 });

queue.on('job:completed', (jobId, result) => {
  console.log(`Job ${jobId} completed: ${result.outputPath}`);
});

await queue.enqueue({
  id: 'job-123',
  spec: videoSpec,
  userId: 'user-1',
  webhookUrl: 'https://...',
});
```

## Files Changed

| File | Lines | Purpose |
|------|-------|---------|
| src/api/types.ts | 37 | Job type definitions |
| src/api/services/job-store.ts | 79 | In-memory job storage |
| src/api/services/job-queue.ts | 134 | Queue service with p-queue |
| tests/api/job-store.test.ts | 92 | JobStore unit tests |
| tests/api/job-queue.test.ts | 122 | JobQueueService unit tests |

## Next Phase Readiness

Ready for 05-03 (Render Routes):
- JobQueueService ready for route integration
- JobStore provides job state for polling
- Events available for webhook notifications
