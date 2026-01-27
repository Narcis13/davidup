# Phase 10: Video Library & Preview - Research

**Researched:** 2026-01-27
**Domain:** Video library management, thumbnail generation, FFmpeg/FFprobe integration, render progress tracking, and system player integration
**Confidence:** HIGH

## Summary

Phase 10 implements a video library UI for browsing rendered videos and a preview workflow for triggering renders from templates. This builds directly on the template library patterns from Phase 9, extending them for video-specific concerns: thumbnail generation, metadata extraction (duration, file size), and system player integration.

The core technical challenges are:
1. **Thumbnail generation**: Use FFmpeg to extract a representative frame from each video
2. **Video metadata**: Use ffprobe (already in project via `ffprobe-static`) to get duration and verify file size
3. **System player integration**: Use the `open` npm package to launch videos in the user's default player
4. **Render progress**: Extend existing job queue with progress tracking and SSE/polling for real-time updates
5. **Template-video linkage**: Store `template_id` foreign key in videos table (schema already exists)

The existing infrastructure provides a strong foundation:
- `videos` table already exists in `studio-db.ts` with proper schema
- `JobQueueService` already supports progress callbacks via `onProgress`
- FFmpeg/FFprobe already integrated for video rendering
- Template library UI patterns (cards, dialogs, TanStack Query) directly reusable

**Primary recommendation:** Extend the video rendering pipeline to generate thumbnails immediately after render completion, store video metadata in SQLite, and build a VideoLibrary component mirroring the TemplateLibrary pattern. Use the `open` npm package for cross-platform system player launching.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ffmpeg-static | ^5.3.0 | Thumbnail extraction from videos | Already installed, bundles FFmpeg binary |
| ffprobe-static | ^3.1.0 | Video metadata extraction (duration) | Already installed, pattern exists in tests |
| open | ^10.x | Open video in system player | De facto standard for cross-platform file opening |
| @tanstack/react-query | ^5.90.20 | Video list caching, render mutations | Already installed, same patterns as templates |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| better-sqlite3 | ^12.6.2 | Video storage, template-video linkage | Already installed, videos table exists |
| lucide-react | ^0.563.0 | Video icons (Play, Film, Trash, Filter) | Already installed |
| hono | ^4.11.5 | Video API routes | Already installed |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| open (npm) | child_process.exec('open/xdg-open') | open handles cross-platform, WSL paths, edge cases |
| FFmpeg thumbnail | First frame from canvas | FFmpeg more reliable, handles various codecs |
| Polling for progress | WebSocket | Polling simpler, SSE already used elsewhere in project |
| Store thumbnails as files | Store as base64 in DB | Files better for large numbers, easier to serve |

**Installation:**

```bash
# In root directory
npm install open

# No studio-specific packages needed
```

## Architecture Patterns

### Recommended Project Structure

```
src/
  api/
    routes/
      studio.ts           # EXTEND: Add video routes (list, delete, open, render)
    services/
      studio-db.ts        # EXISTS: videos table already defined
      video-service.ts    # NEW: Thumbnail generation, metadata extraction
      job-queue.ts        # MODIFY: Add progress updates to store
studio/src/
  components/
    videos/
      VideoLibrary.tsx        # NEW: Main video grid view
      VideoCard.tsx           # NEW: Thumbnail card with metadata
      VideoFilterBar.tsx      # NEW: Filter by source template
      DeleteVideoDialog.tsx   # NEW: Delete confirmation
      RenderProgressDialog.tsx # NEW: Progress modal during render
    templates/
      TemplateViewDialog.tsx  # MODIFY: Add "Render Video" button
  api/
    videos.ts                 # NEW: TanStack Query hooks for videos
outputs/
  thumbnails/                 # NEW: Generated thumbnail images
```

### Pattern 1: Thumbnail Generation with FFmpeg

**What:** Extract a frame at 1 second (or 10% of duration) as thumbnail
**When to use:** After render completes, before saving video record
**Example:**

```typescript
// src/api/services/video-service.ts
// Source: FFmpeg documentation, verified via tests/integration/encoder.test.ts pattern

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const require = createRequire(import.meta.url);
const ffmpegPath: string = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static');

export interface VideoMetadata {
  duration: number;  // seconds
  width: number;
  height: number;
  fileSize: number;  // bytes
}

/**
 * Generate thumbnail for a video file.
 * Extracts a single frame at 1 second or 10% of duration (whichever is smaller).
 */
export async function generateThumbnail(
  videoPath: string,
  outputDir: string = 'outputs/thumbnails'
): Promise<string> {
  const videoId = path.basename(videoPath, '.mp4');
  const thumbnailPath = path.join(outputDir, `${videoId}.jpg`);

  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });

  // Extract frame at 1 second using thumbnail filter for best frame selection
  const args = [
    '-hide_banner',
    '-loglevel', 'error',
    '-i', videoPath,
    '-ss', '00:00:01',
    '-vframes', '1',
    '-vf', 'scale=320:-1',  // Resize to 320px width, maintain aspect
    '-q:v', '3',             // JPEG quality (2-5 is good)
    '-y',                    // Overwrite output
    thumbnailPath,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args);
    let stderr = '';

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(thumbnailPath);
      } else {
        reject(new Error(`Thumbnail generation failed: ${stderr}`));
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Get video metadata using ffprobe.
 * Returns duration, dimensions, and file size.
 */
export async function getVideoMetadata(videoPath: string): Promise<VideoMetadata> {
  // Get file size directly
  const stats = await fs.stat(videoPath);

  // Get video info via ffprobe
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      videoPath,
    ];

    const proc = spawn(ffprobePath.path, args);
    let output = '';

    proc.stdout?.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}`));
        return;
      }

      try {
        const info = JSON.parse(output);
        const videoStream = info.streams.find(
          (s: { codec_type: string }) => s.codec_type === 'video'
        );

        resolve({
          duration: parseFloat(info.format.duration),
          width: videoStream?.width || 0,
          height: videoStream?.height || 0,
          fileSize: stats.size,
        });
      } catch (e) {
        reject(new Error(`Failed to parse ffprobe output: ${e}`));
      }
    });

    proc.on('error', reject);
  });
}
```

### Pattern 2: Open Video in System Player

**What:** Launch video in user's default video player (VLC, QuickTime, etc.)
**When to use:** When user clicks "Play" on a video card, or auto-open after render
**Example:**

```typescript
// src/api/routes/studio.ts - Add open endpoint
// Source: https://github.com/sindresorhus/open

import open from 'open';
import * as path from 'node:path';

/**
 * POST /studio/videos/:id/open
 * Opens the video file in the system's default video player.
 *
 * NOTE: This is a backend endpoint because only the backend has
 * filesystem access. The browser cannot directly open local files.
 */
studioRoutes.post('/videos/:id/open', async (c) => {
  const id = c.req.param('id');

  // Get video record from database
  const stmt = db.prepare('SELECT file_path FROM videos WHERE id = ?');
  const video = stmt.get(id) as { file_path: string } | undefined;

  if (!video) {
    return c.json({ error: 'Video not found' }, 404);
  }

  // Resolve absolute path
  const absolutePath = path.resolve(process.cwd(), video.file_path);

  try {
    // Open in system player - fire and forget
    await open(absolutePath);
    return c.json({ success: true });
  } catch (error) {
    return c.json({
      error: 'Failed to open video',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});
```

### Pattern 3: Video Library Grid with Template Filter

**What:** Responsive grid of video thumbnails with filter by source template
**When to use:** Main video library view
**Example:**

```typescript
// studio/src/components/videos/VideoLibrary.tsx

import { useState } from 'react';
import { useVideos, useTemplates } from '@/api/videos';
import { VideoCard } from './VideoCard';
import { VideoFilterBar } from './VideoFilterBar';
import type { StudioVideo } from '@/api/videos';

export function VideoLibrary() {
  const [templateFilter, setTemplateFilter] = useState<string | null>(null);
  const { data: videos, isLoading, error } = useVideos({ templateId: templateFilter });
  const { data: templates } = useTemplates();

  if (isLoading) {
    return <div className="p-6 text-slate-400">Loading videos...</div>;
  }

  if (error) {
    return <div className="p-6 text-red-400">Error loading videos</div>;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold text-slate-100">
          Video Library
        </h2>
        <VideoFilterBar
          templates={templates || []}
          selectedTemplateId={templateFilter}
          onFilterChange={setTemplateFilter}
        />
      </div>

      {!videos?.length ? (
        <div className="flex flex-col items-center justify-center h-64 text-slate-400">
          <p>No videos rendered yet.</p>
          <p className="text-sm mt-2">
            Render videos from templates to see them here.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {videos.map((video) => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>
      )}
    </div>
  );
}
```

### Pattern 4: Render with Progress Tracking

**What:** Trigger render from template, show progress, auto-open on complete
**When to use:** "Render" button in template view or video library
**Example:**

```typescript
// studio/src/api/videos.ts - Render mutation with progress

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';

interface RenderProgress {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  error?: string;
  videoId?: string;
}

export function useRenderVideo(options?: { onComplete?: (videoId: string) => void }) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const mutation = useMutation({
    mutationFn: async (templateId: string): Promise<{ jobId: string }> => {
      const response = await fetch(`/studio/templates/${templateId}/render`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to start render');
      return response.json();
    },
    onSuccess: (data) => {
      // Start polling for progress
      setProgress({ status: 'queued' });
      pollForProgress(data.jobId);
    },
  });

  const pollForProgress = (jobId: string) => {
    // Clear any existing interval
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    pollIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/studio/render/${jobId}`);
        const job = await response.json();

        setProgress({
          status: job.status,
          progress: job.progress,
          error: job.error,
          videoId: job.video_id,
        });

        // Stop polling when complete or failed
        if (job.status === 'completed' || job.status === 'failed') {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
          }

          // Invalidate video list cache
          queryClient.invalidateQueries({ queryKey: ['studio-videos'] });

          // Callback on complete
          if (job.status === 'completed' && job.video_id && options?.onComplete) {
            options.onComplete(job.video_id);
          }
        }
      } catch (error) {
        console.error('Failed to poll for progress:', error);
      }
    }, 1000); // Poll every second
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  return {
    render: mutation.mutate,
    isRendering: mutation.isPending || (progress?.status === 'processing'),
    progress,
    resetProgress: () => setProgress(null),
  };
}
```

### Pattern 5: Video Card with Thumbnail and Metadata

**What:** Card showing thumbnail, duration, file size, and source template
**When to use:** Each item in video grid
**Example:**

```typescript
// studio/src/components/videos/VideoCard.tsx

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Play, Clock, HardDrive } from 'lucide-react';
import { DeleteVideoDialog } from './DeleteVideoDialog';
import { formatRelativeTime, formatDuration, formatFileSize } from '@/lib/format';
import type { StudioVideo } from '@/api/videos';

interface VideoCardProps {
  video: StudioVideo;
}

export function VideoCard({ video }: VideoCardProps) {
  const handlePlay = async () => {
    try {
      await fetch(`/studio/videos/${video.id}/open`, { method: 'POST' });
    } catch (error) {
      console.error('Failed to open video:', error);
    }
  };

  return (
    <Card className="overflow-hidden">
      {/* Thumbnail with play overlay */}
      <div
        className="relative aspect-video bg-slate-800 cursor-pointer group"
        onClick={handlePlay}
      >
        {video.thumbnail_path ? (
          <img
            src={`/studio/thumbnails/${video.id}.jpg`}
            alt={video.filename}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film className="size-12 text-slate-600" />
          </div>
        )}

        {/* Play overlay on hover */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <Play className="size-12 text-white fill-white" />
        </div>

        {/* Duration badge */}
        {video.duration_ms && (
          <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/70 rounded text-xs text-white">
            {formatDuration(video.duration_ms)}
          </div>
        )}
      </div>

      <CardContent className="p-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-100 truncate">
              {video.filename}
            </p>
            <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
              {video.file_size_bytes && (
                <span className="flex items-center gap-1">
                  <HardDrive className="size-3" />
                  {formatFileSize(video.file_size_bytes)}
                </span>
              )}
              <span>{formatRelativeTime(video.created_at)}</span>
            </div>
            {video.template_name && (
              <p className="text-xs text-slate-500 mt-1 truncate">
                From: {video.template_name}
              </p>
            )}
          </div>
          <div onClick={(e) => e.stopPropagation()}>
            <DeleteVideoDialog videoId={video.id} videoName={video.filename} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

### Anti-Patterns to Avoid

- **Opening files from browser directly:** Browser cannot access local filesystem; must use backend endpoint with `open` package
- **Generating thumbnails synchronously during page load:** Generate once after render, store path in DB
- **Polling without cleanup:** Must clear intervals on component unmount to prevent memory leaks
- **Storing full thumbnails in SQLite:** Store file path, serve via static endpoint
- **Not handling render failures:** Always show error state with clear message

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Thumbnail generation | Canvas frame capture | FFmpeg `-vframes 1` | Handles all codecs, consistent quality |
| Video metadata | Parse MP4 headers manually | ffprobe | Handles all formats, battle-tested |
| System player opening | `exec('open')` + platform checks | `open` npm package | Cross-platform, WSL support, edge cases |
| Progress polling | setInterval without cleanup | useEffect cleanup pattern | Prevents memory leaks |
| Duration/size formatting | Manual string building | Helper functions | Consistent formatting, edge cases |
| Batch delete | Multiple DELETE calls | Single endpoint with array | Atomic operation, better UX |

**Key insight:** Video processing has many edge cases (codecs, container formats, metadata locations). FFmpeg and ffprobe have solved these for decades; don't reinvent them.

## Common Pitfalls

### Pitfall 1: Thumbnail Generation Blocking Render Completion

**What goes wrong:** User waits extra time for thumbnail before seeing "completed" status
**Why it happens:** Thumbnail generated synchronously in render completion callback
**How to avoid:** Generate thumbnail immediately after video file is written, but don't block the job completion event. Run in parallel or queue separately.
**Warning signs:** Long delay between render finishing and video appearing in library

### Pitfall 2: Progress Polling Memory Leak

**What goes wrong:** Multiple intervals stacking up, high CPU usage
**Why it happens:** Component unmounts or re-renders without clearing interval
**How to avoid:** Store interval ref, clear in useEffect cleanup; clear on completion/failure
**Warning signs:** Memory growth over time, multiple simultaneous polls for same job

### Pitfall 3: Video Player Fails to Open

**What goes wrong:** Video exists but system player doesn't open
**Why it happens:** File path is relative but `open` needs absolute; or file permissions issue
**How to avoid:** Use `path.resolve()` for absolute path; ensure outputs directory permissions
**Warning signs:** "File not found" errors in system, or nothing happens on click

### Pitfall 4: Stale Video List After Render

**What goes wrong:** User renders video, sees old list, needs manual refresh
**Why it happens:** TanStack Query cache not invalidated after render completes
**How to avoid:** Call `queryClient.invalidateQueries({ queryKey: ['studio-videos'] })` on completion
**Warning signs:** Video doesn't appear until page refresh

### Pitfall 5: Template Filter Shows Wrong Videos

**What goes wrong:** Filtering by template shows all videos or wrong subset
**Why it happens:** SQL query not using template_id filter, or null template_id handling
**How to avoid:** Proper WHERE clause with null check; test edge cases
**Warning signs:** Filter appears to do nothing or shows partial results

### Pitfall 6: Thumbnail Not Displaying

**What goes wrong:** Video card shows placeholder even though thumbnail exists
**Why it happens:** Wrong path format, or static file serving not configured
**How to avoid:** Verify thumbnail path in DB matches file location; add static route for thumbnails
**Warning signs:** 404 errors for thumbnail URLs in network tab

## Code Examples

### Format Helpers

```typescript
// studio/src/lib/format.ts

/**
 * Format milliseconds as MM:SS or HH:MM:SS
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Format bytes as human-readable size (KB, MB, GB)
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
```

### Video Database Types

```typescript
// studio/src/api/videos.ts - Types

export interface StudioVideo {
  id: string;
  template_id: string | null;
  template_name?: string;  // Joined from templates table
  filename: string;
  file_path: string;
  thumbnail_path: string | null;
  duration_ms: number | null;
  file_size_bytes: number | null;
  status: 'rendering' | 'completed' | 'failed';
  created_at: string;
}

export interface VideoListOptions {
  templateId?: string | null;  // Filter by source template
}

export const videoKeys = {
  all: ['studio-videos'] as const,
  list: (opts?: VideoListOptions) => [...videoKeys.all, 'list', opts] as const,
  detail: (id: string) => [...videoKeys.all, 'detail', id] as const,
};
```

### Render Progress Dialog

```typescript
// studio/src/components/videos/RenderProgressDialog.tsx

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface RenderProgressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: 'queued' | 'processing' | 'completed' | 'failed' | null;
  progress?: number;
  error?: string;
}

export function RenderProgressDialog({
  open,
  onOpenChange,
  status,
  progress,
  error,
}: RenderProgressDialogProps) {
  const canClose = status === 'completed' || status === 'failed';

  return (
    <Dialog open={open} onOpenChange={canClose ? onOpenChange : () => {}}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {status === 'queued' && 'Preparing render...'}
            {status === 'processing' && 'Rendering video...'}
            {status === 'completed' && 'Render complete!'}
            {status === 'failed' && 'Render failed'}
          </DialogTitle>
        </DialogHeader>

        <div className="py-4">
          {status === 'processing' && (
            <div className="space-y-2">
              <Progress value={progress || 0} className="h-2" />
              <p className="text-sm text-slate-400 text-center">
                {progress || 0}% complete
              </p>
            </div>
          )}

          {status === 'queued' && (
            <div className="flex items-center justify-center gap-2 text-slate-400">
              <Loader2 className="size-5 animate-spin" />
              <span>Waiting in queue...</span>
            </div>
          )}

          {status === 'completed' && (
            <div className="flex flex-col items-center gap-2 text-green-400">
              <CheckCircle className="size-12" />
              <span>Video rendered successfully!</span>
              <p className="text-sm text-slate-400">Opening in your video player...</p>
            </div>
          )}

          {status === 'failed' && (
            <div className="flex flex-col items-center gap-2 text-red-400">
              <XCircle className="size-12" />
              <span>Render failed</span>
              {error && (
                <p className="text-sm text-slate-400 text-center mt-2">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### Backend Video Routes

```typescript
// src/api/routes/studio.ts - Extended video routes

// List videos with optional template filter
studioRoutes.get('/videos', (c) => {
  const templateId = c.req.query('templateId');

  let sql = `
    SELECT
      v.*,
      t.name as template_name
    FROM videos v
    LEFT JOIN studio_templates t ON v.template_id = t.id
  `;

  if (templateId) {
    sql += ` WHERE v.template_id = ?`;
    sql += ` ORDER BY v.created_at DESC`;
    const stmt = db.prepare(sql);
    const videos = stmt.all(templateId);
    return c.json(videos);
  } else {
    sql += ` ORDER BY v.created_at DESC`;
    const stmt = db.prepare(sql);
    const videos = stmt.all();
    return c.json(videos);
  }
});

// Delete single video
studioRoutes.delete('/videos/:id', async (c) => {
  const id = c.req.param('id');

  const stmt = db.prepare('SELECT file_path, thumbnail_path FROM videos WHERE id = ?');
  const video = stmt.get(id) as { file_path: string; thumbnail_path: string | null } | undefined;

  if (!video) {
    return c.json({ error: 'Video not found' }, 404);
  }

  // Delete files
  try {
    await fs.unlink(video.file_path);
    if (video.thumbnail_path) {
      await fs.unlink(video.thumbnail_path);
    }
  } catch {
    // Ignore file deletion errors - DB cleanup is primary goal
  }

  // Delete from database
  const deleteStmt = db.prepare('DELETE FROM videos WHERE id = ?');
  deleteStmt.run(id);

  return c.body(null, 204);
});

// Batch delete videos
studioRoutes.post('/videos/delete-batch', async (c) => {
  const { ids } = await c.req.json() as { ids: string[] };

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return c.json({ error: 'ids array is required' }, 400);
  }

  // Get file paths for cleanup
  const placeholders = ids.map(() => '?').join(',');
  const selectStmt = db.prepare(
    `SELECT id, file_path, thumbnail_path FROM videos WHERE id IN (${placeholders})`
  );
  const videos = selectStmt.all(...ids) as Array<{
    id: string;
    file_path: string;
    thumbnail_path: string | null;
  }>;

  // Delete files (best effort)
  for (const video of videos) {
    try {
      await fs.unlink(video.file_path);
      if (video.thumbnail_path) {
        await fs.unlink(video.thumbnail_path);
      }
    } catch {
      // Continue with other deletions
    }
  }

  // Delete from database
  const deleteStmt = db.prepare(`DELETE FROM videos WHERE id IN (${placeholders})`);
  const result = deleteStmt.run(...ids);

  return c.json({ deleted: result.changes });
});

// Serve thumbnail images
studioRoutes.get('/thumbnails/:filename', async (c) => {
  const filename = c.req.param('filename');
  const filePath = path.join('outputs', 'thumbnails', filename);

  try {
    const stat = await fs.stat(filePath);
    const file = await fs.readFile(filePath);

    c.header('Content-Type', 'image/jpeg');
    c.header('Content-Length', stat.size.toString());
    c.header('Cache-Control', 'public, max-age=86400');

    return c.body(file);
  } catch {
    return c.json({ error: 'Thumbnail not found' }, 404);
  }
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Child process exec + platform switch | `open` npm package | 2020+ | Cross-platform, WSL, edge cases handled |
| External ffprobe install | ffprobe-static npm | 2019+ | No system dependency, consistent version |
| Canvas frame extraction | FFmpeg thumbnail filter | Always | Handles all codecs, better quality |
| Long polling > 5s | 1-second polling | Current practice | Better UX, reasonable server load |
| Inline video player | System player | Project decision | Simpler, better playback, native codecs |

**Deprecated/outdated:**
- **Manual platform detection for file opening:** Use `open` package
- **Moment.js for duration formatting:** Use simple helper or native Intl

## Open Questions

1. **Thumbnail timing strategy**
   - What we know: FFmpeg can extract at specific timestamp or use thumbnail filter for "best" frame
   - What's unclear: Should we extract at 1s, 10%, or use thumbnail filter?
   - Recommendation: Use 1 second for simplicity; short videos will still have content there

2. **Batch selection UI**
   - What we know: VID-06 requires batch delete
   - What's unclear: Checkbox selection, or shift-click range select?
   - Recommendation: Simple checkbox selection on each card; avoid complex selection patterns for MVP

3. **Progress update mechanism**
   - What we know: Job store already has progress field; renderVideo has onProgress callback
   - What's unclear: Should we use SSE or polling for frontend?
   - Recommendation: Polling at 1s interval. SSE more complex; polling is adequate for this use case.

4. **Auto-open behavior**
   - What we know: PREV-03 says video should auto-open on render completion
   - What's unclear: What if user navigated away? Should we still open?
   - Recommendation: Only auto-open if user is still on the render progress dialog/view

## Sources

### Primary (HIGH confidence)
- Project codebase: `tests/integration/encoder.test.ts` - ffprobe usage pattern
- Project codebase: `src/encoder/ffmpeg-process.ts` - FFmpeg spawning pattern
- Project codebase: `src/api/services/studio-db.ts` - Videos table schema
- [sindresorhus/open GitHub](https://github.com/sindresorhus/open) - Cross-platform file opening
- [FFmpeg Documentation](https://ffmpeg.org/ffmpeg.html#Video-Options) - Thumbnail generation flags
- [TanStack Query Docs](https://tanstack.com/query/v4/docs/framework/react/reference/useQuery) - refetchInterval for polling

### Secondary (MEDIUM confidence)
- [David Walsh Blog](https://davidwalsh.name/create-thumbnail-ffmpeg) - FFmpeg thumbnail command reference
- [npm open package](https://www.npmjs.com/package/open) - Version and API verification
- [OTTVerse FFmpeg Thumbnails](https://ottverse.com/thumbnails-screenshots-using-ffmpeg/) - Thumbnail generation techniques

### Tertiary (LOW confidence)
- WebSearch results on video gallery patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries already in project or well-documented (open, ffmpeg-static, ffprobe-static)
- Architecture: HIGH - Follows existing Phase 9 patterns for template library
- Pitfalls: MEDIUM - Based on common patterns and ffmpeg documentation
- Progress tracking: MEDIUM - Job queue has progress field but integration needs implementation

**Research date:** 2026-01-27
**Valid until:** ~30 days (stable patterns, FFmpeg/ffprobe are mature)
