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
