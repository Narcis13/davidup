---
phase: 10
plan: 02
subsystem: studio-frontend
tags: [format, tanstack-query, video, hooks, polling]
dependency-graph:
  requires:
    - 10-01 (Video backend routes for API endpoints)
  provides:
    - Format utilities for duration and file size
    - TanStack Query hooks for video CRUD operations
    - Render progress tracking with polling
  affects:
    - 10-03 (Video Library UI will use these hooks)
    - 10-04 (Preview flow will use useRenderVideo)
tech-stack:
  added: []
  patterns:
    - TanStack Query optimistic updates with getQueriesData
    - Polling with interval cleanup in useEffect
    - useRef for interval handle storage
key-files:
  created:
    - studio/src/lib/format.ts
    - studio/src/api/videos.ts
  modified: []
decisions:
  - id: 10-02-01
    decision: Format helpers in separate format.ts file
    rationale: Keeps date formatting (date.ts) separate from general formatting
  - id: 10-02-02
    decision: Optimistic updates use getQueriesData for all matching queries
    rationale: Handles multiple query keys (filtered vs unfiltered lists)
  - id: 10-02-03
    decision: Polling continues on network errors, stops on completion
    rationale: Temporary network issues should not abort render tracking
metrics:
  duration: ~5 minutes
  completed: 2026-01-27
---

# Phase 10 Plan 02: Frontend Data Layer Summary

**One-liner:** Duration/filesize formatters and 5 TanStack Query video hooks with optimistic updates and render progress polling.

## What Was Built

### Format Helpers (`studio/src/lib/format.ts`)

Two formatting functions for video metadata display:

1. **`formatDuration(ms: number): string`**
   - Converts milliseconds to human-readable duration
   - Format: `MM:SS` for < 1 hour, `HH:MM:SS` for >= 1 hour
   - Handles edge case: `0` returns `"0:00"`

2. **`formatFileSize(bytes: number): string`**
   - Converts bytes to appropriate unit (B, KB, MB, GB)
   - 1 decimal for KB/MB, 2 decimals for GB

### Video TanStack Query Hooks (`studio/src/api/videos.ts`)

Five hooks following the templates.ts pattern:

| Hook | Purpose | Key Features |
|------|---------|--------------|
| `useVideos(options?)` | List videos | Optional templateId filter, 5-min staleTime |
| `useDeleteVideo()` | Delete single | Optimistic update, rollback on error |
| `useBatchDeleteVideos()` | Batch delete | Accepts string[], optimistic update |
| `useOpenVideo()` | System player | Fire-and-forget mutation |
| `useRenderVideo(options?)` | Trigger render | Progress polling, interval cleanup |

### Query Key Structure

```typescript
export const videoKeys = {
  all: ['studio-videos'] as const,
  list: (opts?) => [...videoKeys.all, 'list', opts] as const,
  detail: (id) => [...videoKeys.all, 'detail', id] as const,
};
```

### useRenderVideo Details

The render hook includes progress tracking with proper cleanup:

```typescript
// Returns
{
  render: mutation.mutate,       // Trigger render
  renderAsync: mutation.mutateAsync,
  isRendering: boolean,          // true during queued/processing
  progress: RenderProgress | null,
  resetProgress: () => void,     // Clear progress state
  error: Error | null,
}
```

Progress polling:
- Starts on successful mutation
- Polls `/studio/render/:jobId` every 1 second
- Stops when status is `completed` or `failed`
- Invalidates video list cache on completion
- Calls optional `onComplete` callback with videoId
- Cleanup interval on component unmount via useEffect

## Key Links

| From | To | Pattern |
|------|----|----|
| `useVideos` | `/studio/videos` | fetch with templateId query param |
| `useDeleteVideo` | `/studio/videos/:id` | DELETE request |
| `useBatchDeleteVideos` | `/studio/videos/delete-batch` | POST with ids array |
| `useOpenVideo` | `/studio/videos/:id/open` | POST request |
| `useRenderVideo` | `/studio/templates/:id/render` | POST, then poll `/studio/render/:jobId` |

## Decisions Made

1. **Format helpers separate from date.ts** - Clean separation of concerns between date formatting and general value formatting

2. **Optimistic updates use `getQueriesData`** - Handles multiple query variations (filtered vs unfiltered video lists) in single operation

3. **Polling continues on network errors** - Temporary network issues shouldn't abort render tracking; only stops on explicit completion or failure

4. **`useRef` for interval handle** - Allows cleanup function in useEffect to access current interval ID without dependency issues

## Deviations from Plan

None - plan executed exactly as written.

## Artifacts

| Path | Exports |
|------|---------|
| `studio/src/lib/format.ts` | `formatDuration`, `formatFileSize` |
| `studio/src/api/videos.ts` | `StudioVideo`, `VideoListOptions`, `RenderProgress`, `videoKeys`, `useVideos`, `useDeleteVideo`, `useBatchDeleteVideos`, `useOpenVideo`, `useRenderVideo` |

## Next Phase Readiness

**Ready for 10-03:**
- All video hooks available for VideoLibrary component
- Format helpers ready for VideoCard display
- useRenderVideo ready for TemplateViewDialog integration

**Dependencies verified:**
- TanStack Query already configured (from Phase 8)
- Format patterns consistent with existing date.ts
