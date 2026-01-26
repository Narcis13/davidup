/**
 * Template Generator Service Tests
 *
 * Tests AI-powered template generation with mocked OpenRouter calls.
 * Covers valid generation, variable extraction, markdown handling, and error cases.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemplateGenerator } from '../../../src/api/services/template-generator.js';
import * as aiClient from '../../../src/api/services/ai-client.js';

// Mock the AI client
vi.mock('../../../src/api/services/ai-client.js', () => ({
  callOpenRouter: vi.fn(),
  DEFAULT_MODEL: 'test-model',
}));

describe('TemplateGenerator', () => {
  let generator: TemplateGenerator;

  beforeEach(() => {
    generator = new TemplateGenerator();
    vi.clearAllMocks();
  });

  describe('generate', () => {
    it('generates valid VideoSpec from description', async () => {
      const mockSpec = {
        output: { width: 1080, height: 1920, fps: 30, duration: 15 },
        scenes: [
          {
            duration: 5,
            background: '#000000',
            elements: [
              {
                type: 'text',
                text: '{{headline}}',
                x: 540,
                y: 960,
                fontSize: 48,
                color: '#ffffff',
              },
            ],
          },
        ],
      };

      vi.mocked(aiClient.callOpenRouter).mockResolvedValue({
        id: 'test',
        choices: [
          {
            message: { role: 'assistant', content: JSON.stringify(mockSpec) },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      });

      const result = await generator.generate({
        description: 'Create a TikTok promo video with a headline',
        platform: 'tiktok',
        style: 'energetic',
      });

      expect(result.spec.output.width).toBe(1080);
      expect(result.spec.output.height).toBe(1920);
      expect(result.variables).toContain('headline');
    });

    it('extracts multiple variables from generated spec', async () => {
      const mockSpec = {
        output: { width: 1920, height: 1080, fps: 30, duration: 30 },
        scenes: [
          {
            duration: 5,
            background: '#ffffff',
            elements: [
              {
                type: 'text',
                text: '{{title}}',
                x: 100,
                y: 100,
                fontSize: 32,
                color: '#000000',
              },
              {
                type: 'image',
                src: '{{logoUrl}}',
                x: 200,
                y: 200,
                width: 100,
                height: 100,
              },
            ],
          },
        ],
      };

      vi.mocked(aiClient.callOpenRouter).mockResolvedValue({
        id: 'test',
        choices: [
          {
            message: { role: 'assistant', content: JSON.stringify(mockSpec) },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      });

      const result = await generator.generate({
        description: 'Create a YouTube intro with logo',
        platform: 'youtube',
        style: 'professional',
      });

      expect(result.variables).toEqual(expect.arrayContaining(['logoUrl', 'title']));
      expect(result.variables).toHaveLength(2);
    });

    it('handles markdown-wrapped JSON response', async () => {
      const mockSpec = {
        output: { width: 1080, height: 1080, fps: 30, duration: 15 },
        scenes: [{ duration: 3, background: '#ffffff', elements: [] }],
      };

      vi.mocked(aiClient.callOpenRouter).mockResolvedValue({
        id: 'test',
        choices: [
          {
            message: {
              role: 'assistant',
              content: '```json\n' + JSON.stringify(mockSpec) + '\n```',
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      });

      const result = await generator.generate({
        description: 'Create an Instagram story with minimal design',
        platform: 'instagram',
        style: 'playful',
      });

      expect(result.spec.output.width).toBe(1080);
      expect(result.spec.output.height).toBe(1080);
    });

    it('throws on empty AI response', async () => {
      vi.mocked(aiClient.callOpenRouter).mockResolvedValue({
        id: 'test',
        choices: [
          {
            message: { role: 'assistant', content: '' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 0, total_tokens: 100 },
      });

      await expect(
        generator.generate({
          description: 'Create a test video',
          platform: 'tiktok',
          style: 'energetic',
        })
      ).rejects.toThrow('empty response');
    });

    it('uses correct platform dimensions in generated spec', async () => {
      const mockSpec = {
        output: { width: 1080, height: 1920, fps: 30, duration: 20 },
        scenes: [
          {
            duration: 10,
            background: '#111111',
            elements: [
              {
                type: 'text',
                text: 'Test',
                x: 0,
                y: 0,
                fontSize: 24,
                color: '#ffffff',
              },
            ],
          },
        ],
      };

      vi.mocked(aiClient.callOpenRouter).mockResolvedValue({
        id: 'test',
        choices: [
          {
            message: { role: 'assistant', content: JSON.stringify(mockSpec) },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      });

      const result = await generator.generate({
        description: 'Create a vertical video',
        platform: 'tiktok',
        style: 'energetic',
      });

      // TikTok should be 1080x1920
      expect(result.spec.output.width).toBe(1080);
      expect(result.spec.output.height).toBe(1920);
      expect(result.spec.output.fps).toBe(30);
    });

    it('calls callOpenRouter with correct parameters', async () => {
      const mockSpec = {
        output: { width: 1920, height: 1080, fps: 30, duration: 30 },
        scenes: [
          {
            duration: 5,
            background: '#000000',
            elements: [],
          },
        ],
      };

      vi.mocked(aiClient.callOpenRouter).mockResolvedValue({
        id: 'test',
        choices: [
          {
            message: { role: 'assistant', content: JSON.stringify(mockSpec) },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      });

      await generator.generate({
        description: 'Create a professional YouTube video',
        platform: 'youtube',
        style: 'professional',
      });

      expect(aiClient.callOpenRouter).toHaveBeenCalledTimes(1);
      expect(aiClient.callOpenRouter).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'test-model',
          messages: expect.arrayContaining([
            expect.objectContaining({ role: 'system' }),
            expect.objectContaining({
              role: 'user',
              content: 'Create a professional YouTube video',
            }),
          ]),
          response_format: { type: 'json_object' },
          max_tokens: 4096,
        })
      );
    });
  });
});
