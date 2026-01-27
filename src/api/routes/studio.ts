/**
 * Studio API routes.
 * Provides endpoints for conversations, templates, and videos in the Studio UI.
 * No auth required - this is a local development tool.
 */

import { Hono } from 'hono';
import open from 'open';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import db from '../services/studio-db.js';
import { generateThumbnail, getVideoMetadata } from '../services/video-service.js';
import { JobQueueService } from '../services/job-queue.js';
import { JobStore } from '../services/job-store.js';
import type { VideoSpec } from '../../types/index.js';

// Create singleton job store and queue for studio renders
const studioJobStore = new JobStore();
const studioJobQueue = new JobQueueService(studioJobStore);

export const studioRoutes = new Hono();

/**
 * Health check endpoint for Studio API.
 * Returns database connection status.
 */
studioRoutes.get('/health', (c) => {
  return c.json({ status: 'ok', db: 'connected' });
});

/**
 * List all conversations.
 * Returns conversations ordered by most recently updated.
 */
studioRoutes.get('/conversations', (c) => {
  const stmt = db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC');
  const conversations = stmt.all();
  return c.json(conversations);
});

/**
 * List all studio templates.
 * Returns templates ordered by most recently updated.
 */
studioRoutes.get('/templates', (c) => {
  const stmt = db.prepare('SELECT * FROM studio_templates ORDER BY updated_at DESC');
  const templates = stmt.all();
  return c.json(templates);
});

/**
 * List videos with optional template filter.
 * Returns videos with template name (if linked) ordered by most recently created.
 */
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

/**
 * Open video in system player.
 * Launches the user's default video application.
 */
studioRoutes.post('/videos/:id/open', async (c) => {
  const id = c.req.param('id');

  const stmt = db.prepare('SELECT file_path FROM videos WHERE id = ?');
  const video = stmt.get(id) as { file_path: string } | undefined;

  if (!video) {
    return c.json({ error: 'Video not found' }, 404);
  }

  // Resolve to absolute path
  const absolutePath = path.resolve(process.cwd(), video.file_path);

  try {
    await open(absolutePath);
    return c.json({ success: true });
  } catch (error) {
    return c.json({
      error: 'Failed to open video',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * Delete a single video.
 * Removes video file, thumbnail, and database record.
 */
studioRoutes.delete('/videos/:id', async (c) => {
  const id = c.req.param('id');

  const stmt = db.prepare('SELECT file_path, thumbnail_path FROM videos WHERE id = ?');
  const video = stmt.get(id) as { file_path: string; thumbnail_path: string | null } | undefined;

  if (!video) {
    return c.json({ error: 'Video not found' }, 404);
  }

  // Delete files (ignore errors - DB cleanup is primary goal)
  try {
    await fs.unlink(video.file_path);
  } catch {
    // File may not exist, continue
  }
  try {
    if (video.thumbnail_path) {
      await fs.unlink(video.thumbnail_path);
    }
  } catch {
    // Thumbnail may not exist, continue
  }

  // Delete from database
  const deleteStmt = db.prepare('DELETE FROM videos WHERE id = ?');
  deleteStmt.run(id);

  return c.body(null, 204);
});

/**
 * Batch delete videos.
 * Accepts array of video IDs and removes all matching files and records.
 */
studioRoutes.post('/videos/delete-batch', async (c) => {
  const body = await c.req.json() as { ids?: string[] };
  const { ids } = body;

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return c.json({ error: 'ids array is required and must not be empty' }, 400);
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
    } catch {
      // Continue with other deletions
    }
    try {
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

/**
 * Serve thumbnail images.
 * Returns JPEG thumbnail for a video with caching headers.
 */
studioRoutes.get('/thumbnails/:filename', async (c) => {
  const filename = c.req.param('filename');
  const filePath = path.join(process.cwd(), 'outputs', 'thumbnails', filename);

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

/**
 * Trigger render from template.
 * Creates a render job and returns the job ID for polling.
 */
studioRoutes.post('/templates/:id/render', async (c) => {
  const templateId = c.req.param('id');

  // Get template from database
  const stmt = db.prepare('SELECT * FROM studio_templates WHERE id = ?');
  const template = stmt.get(templateId) as {
    id: string;
    name: string;
    spec: string;
  } | undefined;

  if (!template) {
    return c.json({ error: 'Template not found' }, 404);
  }

  // Parse spec JSON
  let spec: VideoSpec;
  try {
    spec = JSON.parse(template.spec) as VideoSpec;
  } catch {
    return c.json({ error: 'Invalid template spec JSON' }, 500);
  }

  // Create job ID and video record
  const jobId = crypto.randomUUID();
  const videoId = jobId; // Use same ID for simplicity
  const filename = `${template.name.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.mp4`;
  const filePath = `outputs/${videoId}.mp4`;
  const now = new Date().toISOString();

  // Insert video record with 'rendering' status
  const insertStmt = db.prepare(
    `INSERT INTO videos (id, template_id, filename, file_path, status, created_at)
     VALUES (?, ?, ?, ?, 'rendering', ?)`
  );
  insertStmt.run(videoId, templateId, filename, filePath, now);

  // Enqueue the render job
  await studioJobQueue.enqueue({
    id: jobId,
    spec,
    userId: 'studio', // Local dev, no real user
  });

  // Set up completion handler to generate thumbnail and update metadata
  studioJobQueue.once('job:completed', async (completedJobId) => {
    if (completedJobId !== jobId) return;

    try {
      // Generate thumbnail
      const thumbnailPath = await generateThumbnail(filePath);

      // Get video metadata
      const metadata = await getVideoMetadata(filePath);

      // Update video record with metadata
      const updateStmt = db.prepare(
        `UPDATE videos SET
          thumbnail_path = ?,
          duration_ms = ?,
          file_size_bytes = ?,
          status = 'completed'
        WHERE id = ?`
      );
      updateStmt.run(
        thumbnailPath,
        Math.round(metadata.duration * 1000), // Convert seconds to ms
        metadata.fileSize,
        videoId
      );
    } catch (error) {
      console.error('Failed to process completed video:', error);
      // Still mark as completed even if thumbnail/metadata fails
      const updateStmt = db.prepare(
        `UPDATE videos SET status = 'completed' WHERE id = ?`
      );
      updateStmt.run(videoId);
    }
  });

  // Handle job failure
  studioJobQueue.once('job:failed', async (failedJobId, error) => {
    if (failedJobId !== jobId) return;

    const updateStmt = db.prepare(
      `UPDATE videos SET status = 'failed' WHERE id = ?`
    );
    updateStmt.run(videoId);
  });

  return c.json({ jobId, videoId });
});

/**
 * Get render job status.
 * Returns current status, progress, and any error for a render job.
 */
studioRoutes.get('/render/:jobId', (c) => {
  const jobId = c.req.param('jobId');

  const job = studioJobQueue.getJob(jobId);

  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  return c.json({
    status: job.status,
    progress: job.progress || 0,
    error: job.error,
    video_id: jobId, // Same as video ID
  });
});

/**
 * Create a new template.
 * Accepts JSON body: { name: string, spec: object, conversationId?: string }
 * Returns the created template with generated id.
 */
studioRoutes.post('/templates', async (c) => {
  const body = await c.req.json();
  const { name, spec, conversationId } = body;

  if (!name || !spec) {
    return c.json({ error: 'name and spec are required' }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const specJson = typeof spec === 'string' ? spec : JSON.stringify(spec);

  const stmt = db.prepare(
    `INSERT INTO studio_templates (id, name, spec, conversation_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  stmt.run(id, name, specJson, conversationId || null, now, now);

  return c.json({
    id,
    name,
    spec: specJson,
    conversation_id: conversationId || null,
    created_at: now,
    updated_at: now,
  }, 201);
});

/**
 * Get a single template by id.
 * Returns 404 if not found.
 */
studioRoutes.get('/templates/:id', (c) => {
  const id = c.req.param('id');
  const stmt = db.prepare('SELECT * FROM studio_templates WHERE id = ?');
  const template = stmt.get(id);

  if (!template) {
    return c.json({ error: 'Template not found' }, 404);
  }

  return c.json(template);
});

/**
 * Update a template (rename).
 * Accepts JSON body: { name: string }
 * Returns the updated template.
 */
studioRoutes.patch('/templates/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { name } = body;

  if (!name) {
    return c.json({ error: 'name is required' }, 400);
  }

  // Check if template exists
  const checkStmt = db.prepare('SELECT * FROM studio_templates WHERE id = ?');
  const existing = checkStmt.get(id);

  if (!existing) {
    return c.json({ error: 'Template not found' }, 404);
  }

  const now = new Date().toISOString();
  const updateStmt = db.prepare(
    'UPDATE studio_templates SET name = ?, updated_at = ? WHERE id = ?'
  );
  updateStmt.run(name, now, id);

  // Return updated template
  const updatedTemplate = checkStmt.get(id);
  return c.json(updatedTemplate);
});

/**
 * Delete a template by id.
 * Returns 204 No Content on success.
 */
studioRoutes.delete('/templates/:id', (c) => {
  const id = c.req.param('id');

  // Check if template exists
  const checkStmt = db.prepare('SELECT * FROM studio_templates WHERE id = ?');
  const existing = checkStmt.get(id);

  if (!existing) {
    return c.json({ error: 'Template not found' }, 404);
  }

  const deleteStmt = db.prepare('DELETE FROM studio_templates WHERE id = ?');
  deleteStmt.run(id);

  return c.body(null, 204);
});
