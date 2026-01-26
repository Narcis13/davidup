/**
 * Download routes for video file retrieval.
 * Serves completed rendered videos from the outputs/ directory.
 *
 * Note: Download endpoints are intentionally PUBLIC (no auth middleware)
 * to allow direct browser downloads and sharing via URL.
 */

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';

/**
 * Download routes handler.
 * GET /:jobId - Download a rendered video file
 */
export const downloadRoutes = new Hono();

/**
 * Download video file by job ID.
 *
 * @param jobId - The job ID (with or without .mp4 extension)
 * @returns Video file stream or 404 error
 *
 * @example
 * GET /download/abc123 -> streams outputs/abc123.mp4
 * GET /download/abc123.mp4 -> streams outputs/abc123.mp4
 */
downloadRoutes.get('/:jobId', async (c) => {
  const rawJobId = c.req.param('jobId');
  // Strip .mp4 extension if present to normalize the job ID
  const jobId = rawJobId.replace(/\.mp4$/, '');
  const filePath = `outputs/${jobId}.mp4`;

  // Check if file exists
  try {
    await stat(filePath);
  } catch {
    return c.json({ error: 'Video not found' }, 404);
  }

  // Get file size for Content-Length header
  const fileStat = await stat(filePath);

  // Set response headers
  c.header('Content-Type', 'video/mp4');
  c.header('Content-Disposition', `attachment; filename="${jobId}.mp4"`);
  c.header('Content-Length', fileStat.size.toString());

  // Stream the file using Hono's streaming helper
  return stream(c, async (honoStream) => {
    const nodeStream = createReadStream(filePath);

    // Pipe node stream data to hono stream
    for await (const chunk of nodeStream) {
      await honoStream.write(chunk as Uint8Array);
    }
  });
});
