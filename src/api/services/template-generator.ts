/**
 * Template Generator Service - AI-powered VideoSpec generation
 *
 * Generates valid VideoSpec JSON from natural language descriptions
 * using OpenRouter API. Includes validation, repair, and re-prompt
 * capabilities for robust template generation.
 */
import { z } from 'zod';
import { callOpenRouter, DEFAULT_MODEL } from './ai-client.js';
import { PLATFORM_PRESETS, type GenerateRequest } from '../../schemas/template.js';
import { VideoSpecSchema } from '../../schemas/video-spec.js';
import { extractVariables } from './variable-substitution.js';
import type { VideoSpec } from '../../types/index.js';

/**
 * Result from template generation
 */
export interface GenerateResult {
  /** Generated video specification */
  spec: VideoSpec;
  /** List of variable names found in the spec */
  variables: string[];
}

/**
 * AI-powered template generator that creates VideoSpec from natural language
 */
export class TemplateGenerator {
  /**
   * Generate a VideoSpec template from natural language description
   *
   * @param request - Generation request with description, platform, and style
   * @returns Generated spec and extracted variables
   * @throws Error if AI returns invalid response after repair attempts
   */
  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const systemPrompt = this.buildSystemPrompt(request);

    // Call AI with retry (handled in ai-client)
    const response = await callOpenRouter({
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: request.description },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 4096,
    });

    const rawContent = response.choices[0]?.message?.content;
    if (!rawContent) {
      throw new Error('AI returned empty response');
    }

    // Parse JSON (handle common issues)
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      // Try to repair common JSON issues (markdown code blocks)
      parsed = this.repairJson(rawContent);
    }

    // Validate with Zod
    const validationResult = VideoSpecSchema.safeParse(parsed);
    if (!validationResult.success) {
      // Try auto-repair
      const repaired = this.autoRepairSpec(parsed, validationResult.error);
      const retryResult = VideoSpecSchema.safeParse(repaired);

      if (!retryResult.success) {
        // Re-prompt with error context
        return this.regenerateWithContext(request, rawContent, retryResult.error);
      }

      return {
        spec: retryResult.data,
        variables: extractVariables(retryResult.data),
      };
    }

    return {
      spec: validationResult.data,
      variables: extractVariables(validationResult.data),
    };
  }

  /**
   * Build system prompt with platform dimensions and style guidelines
   */
  private buildSystemPrompt(request: GenerateRequest): string {
    const preset = PLATFORM_PRESETS[request.platform];

    return `You are a video template generator for GameMotion, a JSON-to-video rendering engine.

Generate a valid VideoSpec JSON object with this exact structure:
{
  "output": { "width": ${preset.width}, "height": ${preset.height}, "fps": ${preset.fps} },
  "scenes": [
    {
      "duration": <number in seconds>,
      "background": "<color hex>",
      "elements": [
        // text elements: { "type": "text", "content": "<text>", "x": <number>, "y": <number>, "fontSize": <number>, "color": "<hex>" }
        // image elements: { "type": "image", "src": "<url>", "x": <number>, "y": <number>, "width": <number>, "height": <number> }
        // shape elements: { "type": "shape", "shape": "rectangle|circle|ellipse", ... }
      ],
      "transition": { "type": "fade|slide|zoom", "duration": <seconds> } // optional
    }
  ]
}

STYLE GUIDELINES for "${request.style}":
${this.getStyleGuidelines(request.style)}

IMPORTANT RULES:
1. Use {{variableName}} for user-customizable content (e.g., {{headline}}, {{productName}}, {{imageUrl}})
2. All text elements should use {{variables}} for the main customizable content
3. Include at least one image element with a {{variable}} for the src
4. Total duration: TikTok 15-30s, YouTube 30-60s, Instagram 15-30s
5. Return ONLY valid JSON, no markdown code blocks, no explanation

PLATFORM: ${request.platform}
DIMENSIONS: ${preset.width}x${preset.height}`;
  }

  /**
   * Get style-specific animation and visual guidelines
   */
  private getStyleGuidelines(style: string): string {
    const guidelines: Record<string, string> = {
      energetic: `- Fast-paced animations (0.3-0.5s durations)
- Bold colors, high contrast backgrounds
- Use scale and bounce animation presets
- Quick scene transitions (0.3s fade)`,
      professional: `- Smooth, subtle animations (0.5-0.8s durations)
- Clean, minimal color palette
- Use fade and slide animation presets
- Longer scene transitions (0.5-0.8s fade)`,
      playful: `- Bouncy, fun animations
- Bright, vibrant colors
- Mix of scale, bounce, and slide presets
- Creative transitions between scenes`,
    };
    return guidelines[style] ?? guidelines.professional;
  }

  /**
   * Repair JSON by stripping markdown code blocks
   */
  private repairJson(raw: string): unknown {
    // Strip markdown code blocks if present
    let cleaned = raw.replace(/```json\s*\n?/g, '').replace(/```\s*\n?/g, '');
    // Trim whitespace
    cleaned = cleaned.trim();
    return JSON.parse(cleaned);
  }

  /**
   * Attempt to auto-repair common validation issues in the spec
   */
  private autoRepairSpec(spec: unknown, error: z.ZodError): unknown {
    if (!spec || typeof spec !== 'object') return spec;

    const repaired = JSON.parse(JSON.stringify(spec));

    // Apply common repairs based on error paths
    for (const issue of error.issues) {
      if (
        issue.code === 'invalid_type' &&
        issue.expected === 'number' &&
        issue.received === 'string'
      ) {
        const value = this.getPath(repaired, issue.path);
        if (typeof value === 'string') {
          const numValue = parseFloat(value);
          if (!isNaN(numValue)) {
            this.setPath(repaired, [...issue.path], numValue);
          }
        }
      }
    }

    return repaired;
  }

  /**
   * Re-prompt the AI with error context for a second attempt
   */
  private async regenerateWithContext(
    request: GenerateRequest,
    previousOutput: string,
    error: z.ZodError
  ): Promise<GenerateResult> {
    // One retry with error context
    const errorSummary = error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');

    const response = await callOpenRouter({
      model: DEFAULT_MODEL,
      messages: [
        { role: 'system', content: this.buildSystemPrompt(request) },
        { role: 'user', content: request.description },
        { role: 'assistant', content: previousOutput },
        {
          role: 'user',
          content: `The JSON had validation errors: ${errorSummary}. Please fix and return valid JSON only.`,
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 4096,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('AI retry returned empty response');

    const parsed = JSON.parse(
      content.replace(/```json\s*\n?/g, '').replace(/```\s*\n?/g, '').trim()
    );
    const result = VideoSpecSchema.parse(parsed); // Throw if still invalid

    return {
      spec: result,
      variables: extractVariables(result),
    };
  }

  /**
   * Get value at a path in an object
   */
  private getPath(obj: unknown, path: (string | number)[]): unknown {
    return path.reduce(
      (o, k) => (o && typeof o === 'object' ? (o as Record<string | number, unknown>)[k] : undefined),
      obj
    );
  }

  /**
   * Set value at a path in an object
   */
  private setPath(obj: unknown, path: (string | number)[], value: unknown): void {
    if (path.length === 0) return;
    const last = path.pop();
    const target = path.reduce(
      (o, k) => (o && typeof o === 'object' ? (o as Record<string | number, unknown>)[k] : undefined),
      obj
    );
    if (target && typeof target === 'object' && last !== undefined) {
      (target as Record<string | number, unknown>)[last] = value;
    }
  }
}

// Singleton instance for convenience
export const templateGenerator = new TemplateGenerator();
