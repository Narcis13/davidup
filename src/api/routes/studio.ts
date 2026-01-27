/**
 * Studio API routes.
 * Provides endpoints for conversations, templates, and videos in the Studio UI.
 * No auth required - this is a local development tool.
 */

import { Hono } from 'hono';
import db from '../services/studio-db.js';

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
 * List all videos.
 * Returns videos ordered by most recently created.
 */
studioRoutes.get('/videos', (c) => {
  const stmt = db.prepare('SELECT * FROM videos ORDER BY created_at DESC');
  const videos = stmt.all();
  return c.json(videos);
});
