/**
 * Asset routes for file upload and retrieval.
 * Handles POST /assets for uploads and GET /assets/:id for metadata.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { assetStore, AssetStore } from '../services/asset-store.js';

const MAX_SIZE = AssetStore.getMaxSize();

/**
 * Asset routes - requires authentication middleware.
 * Expects userId and plan to be set on context by auth middleware.
 */
export const assetRoutes = new Hono<{
  Variables: { userId: string; plan: 'free' | 'pro' };
}>();

/**
 * POST /assets - Upload asset file
 *
 * Accepts multipart form data with 'file' field.
 * Returns asset_id for use in render specs.
 *
 * Response 201:
 * {
 *   asset_id: string,
 *   filename: string,
 *   original_name: string,
 *   size: number,
 *   type: string
 * }
 *
 * Errors:
 * - 400: No file provided or invalid file type
 * - 413: File too large
 */
assetRoutes.post(
  '/',
  bodyLimit({
    maxSize: MAX_SIZE,
    onError: (c) => {
      return c.json(
        {
          error: 'File too large',
          max_size: MAX_SIZE,
          max_size_mb: MAX_SIZE / 1024 / 1024,
        },
        413
      );
    },
  }),
  async (c) => {
    const userId = c.get('userId');

    // Initialize asset store (creates uploads dir if needed)
    await assetStore.init();

    // Parse multipart body
    const body = await c.req.parseBody();
    const file = body['file'];

    if (!file || !(file instanceof File)) {
      return c.json(
        {
          error: 'No file provided',
          hint: 'Send a multipart form with a "file" field',
        },
        400
      );
    }

    // Validate content type
    const allowedTypes = AssetStore.getAllowedTypes();
    if (!allowedTypes.includes(file.type)) {
      return c.json(
        {
          error: 'Invalid file type',
          received: file.type,
          allowed: allowedTypes,
        },
        400
      );
    }

    try {
      // Read file data
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Save to store
      const asset = await assetStore.save({
        userId,
        file: {
          name: file.name,
          type: file.type,
          data: buffer,
        },
      });

      return c.json(
        {
          asset_id: asset.id,
          filename: asset.filename,
          original_name: asset.originalName,
          size: asset.size,
          type: asset.mimeType,
        },
        201
      );
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('File too large')) {
          return c.json({ error: error.message }, 413);
        }
        if (error.message.includes('Invalid file type')) {
          return c.json({ error: error.message }, 400);
        }
      }
      throw error;
    }
  }
);

/**
 * GET /assets/:assetId - Get asset info
 *
 * Returns asset metadata for a previously uploaded file.
 * Does not return the file content - use the path in render specs.
 *
 * Response 200:
 * {
 *   asset_id: string,
 *   filename: string,
 *   original_name: string,
 *   size: number,
 *   type: string,
 *   created_at: number
 * }
 *
 * Errors:
 * - 404: Asset not found
 */
assetRoutes.get('/:assetId', async (c) => {
  const assetId = c.req.param('assetId');
  const asset = assetStore.get(assetId);

  if (!asset) {
    return c.json({ error: 'Asset not found' }, 404);
  }

  return c.json({
    asset_id: asset.id,
    filename: asset.filename,
    original_name: asset.originalName,
    size: asset.size,
    type: asset.mimeType,
    created_at: asset.createdAt,
  });
});
