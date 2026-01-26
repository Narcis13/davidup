/**
 * Generate routes - POST /generate
 *
 * AI-powered template generation from natural language descriptions.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { GenerateRequestSchema } from '../../schemas/template.js';
import { templateGenerator } from '../services/template-generator.js';
import type { PlanTier } from '../types.js';

export const generateRoutes = new Hono<{
  Variables: { userId: string; plan: PlanTier };
}>();

/**
 * POST /generate - Generate template from natural language
 *
 * Accepts description, platform, and style. Returns VideoSpec with {{variables}}.
 */
generateRoutes.post(
  '/',
  zValidator('json', GenerateRequestSchema),
  async (c) => {
    const request = c.req.valid('json');

    try {
      const result = await templateGenerator.generate(request);

      return c.json({
        spec: result.spec,
        variables: result.variables.map(name => ({
          name,
          type: name.toLowerCase().includes('url') || name.toLowerCase().includes('image') ? 'url' : 'text',
        })),
      }, 201);
    } catch (error) {
      // Check for specific error types
      if (error instanceof Error) {
        if (error.message.includes('OPENROUTER_API_KEY')) {
          return c.json({ error: 'AI service not configured' }, 503);
        }
        if (error.message.includes('timeout') || error.message.includes('abort')) {
          return c.json({ error: 'AI service timeout' }, 504);
        }
      }

      // Generic error
      return c.json({
        error: 'Template generation failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  }
);
