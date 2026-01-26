import { describe, it, expect } from 'vitest';
import {
  extractVariables,
  substituteVariables,
} from '../../../src/api/services/variable-substitution.js';
import type { VideoSpec } from '../../../src/types/index.js';

/**
 * Helper to create a minimal valid VideoSpec for testing
 */
function createSpec(partial: Partial<VideoSpec>): VideoSpec {
  return {
    output: {
      width: 1920,
      height: 1080,
      fps: 30,
      duration: 5,
    },
    scenes: [
      {
        id: 'scene-1',
        duration: 5,
        background: '#000000',
        elements: [],
      },
    ],
    ...partial,
  } as VideoSpec;
}

describe('extractVariables', () => {
  describe('finding variables', () => {
    it('should find a single variable in text', () => {
      const spec = createSpec({
        scenes: [
          {
            id: 'scene-1',
            duration: 5,
            background: '#000000',
            elements: [
              {
                type: 'text',
                id: 'text-1',
                text: 'Hello {{name}}',
                x: 0,
                y: 0,
                fontSize: 24,
                fontFamily: 'Arial',
                color: '#FFFFFF',
              },
            ],
          },
        ],
      });

      const variables = extractVariables(spec);
      expect(variables).toEqual(['name']);
    });

    it('should find multiple variables in text', () => {
      const spec = createSpec({
        scenes: [
          {
            id: 'scene-1',
            duration: 5,
            background: '#000000',
            elements: [
              {
                type: 'text',
                id: 'text-1',
                text: '{{greeting}}, {{name}}!',
                x: 0,
                y: 0,
                fontSize: 24,
                fontFamily: 'Arial',
                color: '#FFFFFF',
              },
            ],
          },
        ],
      });

      const variables = extractVariables(spec);
      expect(variables).toEqual(['greeting', 'name']);
    });

    it('should deduplicate repeated variables', () => {
      const spec = createSpec({
        scenes: [
          {
            id: 'scene-1',
            duration: 5,
            background: '#000000',
            elements: [
              {
                type: 'text',
                id: 'text-1',
                text: '{{title}}',
                x: 0,
                y: 0,
                fontSize: 24,
                fontFamily: 'Arial',
                color: '#FFFFFF',
              },
            ],
          },
          {
            id: 'scene-2',
            duration: 5,
            background: '#000000',
            elements: [
              {
                type: 'text',
                id: 'text-2',
                text: '{{title}}',
                x: 0,
                y: 0,
                fontSize: 24,
                fontFamily: 'Arial',
                color: '#FFFFFF',
              },
            ],
          },
        ],
      });

      const variables = extractVariables(spec);
      expect(variables).toEqual(['title']);
    });

    it('should return empty array when no variables', () => {
      const spec = createSpec({
        scenes: [
          {
            id: 'scene-1',
            duration: 5,
            background: '#000000',
            elements: [
              {
                type: 'text',
                id: 'text-1',
                text: 'No variables here',
                x: 0,
                y: 0,
                fontSize: 24,
                fontFamily: 'Arial',
                color: '#FFFFFF',
              },
            ],
          },
        ],
      });

      const variables = extractVariables(spec);
      expect(variables).toEqual([]);
    });

    it('should find variables in nested objects', () => {
      const spec = createSpec({
        scenes: [
          {
            id: 'scene-1',
            duration: 5,
            background: '#000000',
            elements: [
              {
                type: 'image',
                id: 'image-1',
                src: '{{imageUrl}}',
                x: 0,
                y: 0,
                width: 100,
                height: 100,
              },
            ],
          },
        ],
      });

      const variables = extractVariables(spec);
      expect(variables).toEqual(['imageUrl']);
    });

    it('should find variables in background color', () => {
      const spec = createSpec({
        scenes: [
          {
            id: 'scene-1',
            duration: 5,
            background: '{{bgColor}}',
            elements: [],
          },
        ],
      });

      const variables = extractVariables(spec);
      expect(variables).toEqual(['bgColor']);
    });

    it('should return sorted unique variable names', () => {
      const spec = createSpec({
        scenes: [
          {
            id: 'scene-1',
            duration: 5,
            background: '#000000',
            elements: [
              {
                type: 'text',
                id: 'text-1',
                text: '{{zebra}} and {{apple}} and {{middle}}',
                x: 0,
                y: 0,
                fontSize: 24,
                fontFamily: 'Arial',
                color: '#FFFFFF',
              },
            ],
          },
        ],
      });

      const variables = extractVariables(spec);
      expect(variables).toEqual(['apple', 'middle', 'zebra']);
    });
  });
});

describe('substituteVariables', () => {
  describe('basic substitution', () => {
    it('should replace a single variable', () => {
      const spec = createSpec({
        scenes: [
          {
            id: 'scene-1',
            duration: 5,
            background: '#000000',
            elements: [
              {
                type: 'text',
                id: 'text-1',
                text: '{{name}}',
                x: 0,
                y: 0,
                fontSize: 24,
                fontFamily: 'Arial',
                color: '#FFFFFF',
              },
            ],
          },
        ],
      });

      const result = substituteVariables(spec, { name: 'World' });
      const textElement = result.scenes[0].elements[0] as { text: string };
      expect(textElement.text).toBe('World');
    });

    it('should replace variable in context', () => {
      const spec = createSpec({
        scenes: [
          {
            id: 'scene-1',
            duration: 5,
            background: '#000000',
            elements: [
              {
                type: 'text',
                id: 'text-1',
                text: 'Hello {{name}}!',
                x: 0,
                y: 0,
                fontSize: 24,
                fontFamily: 'Arial',
                color: '#FFFFFF',
              },
            ],
          },
        ],
      });

      const result = substituteVariables(spec, { name: 'World' });
      const textElement = result.scenes[0].elements[0] as { text: string };
      expect(textElement.text).toBe('Hello World!');
    });

    it('should replace multiple different variables', () => {
      const spec = createSpec({
        scenes: [
          {
            id: 'scene-1',
            duration: 5,
            background: '#000000',
            elements: [
              {
                type: 'text',
                id: 'text-1',
                text: '{{a}} and {{b}}',
                x: 0,
                y: 0,
                fontSize: 24,
                fontFamily: 'Arial',
                color: '#FFFFFF',
              },
            ],
          },
        ],
      });

      const result = substituteVariables(spec, { a: 'X', b: 'Y' });
      const textElement = result.scenes[0].elements[0] as { text: string };
      expect(textElement.text).toBe('X and Y');
    });

    it('should replace repeated variable with same value', () => {
      const spec = createSpec({
        scenes: [
          {
            id: 'scene-1',
            duration: 5,
            background: '#000000',
            elements: [
              {
                type: 'text',
                id: 'text-1',
                text: '{{word}} {{word}} {{word}}',
                x: 0,
                y: 0,
                fontSize: 24,
                fontFamily: 'Arial',
                color: '#FFFFFF',
              },
            ],
          },
        ],
      });

      const result = substituteVariables(spec, { word: 'echo' });
      const textElement = result.scenes[0].elements[0] as { text: string };
      expect(textElement.text).toBe('echo echo echo');
    });
  });

  describe('missing variables', () => {
    it('should leave missing variables unchanged', () => {
      const spec = createSpec({
        scenes: [
          {
            id: 'scene-1',
            duration: 5,
            background: '#000000',
            elements: [
              {
                type: 'text',
                id: 'text-1',
                text: '{{name}}',
                x: 0,
                y: 0,
                fontSize: 24,
                fontFamily: 'Arial',
                color: '#FFFFFF',
              },
            ],
          },
        ],
      });

      const result = substituteVariables(spec, {});
      const textElement = result.scenes[0].elements[0] as { text: string };
      expect(textElement.text).toBe('{{name}}');
    });

    it('should partially substitute when some variables missing', () => {
      const spec = createSpec({
        scenes: [
          {
            id: 'scene-1',
            duration: 5,
            background: '#000000',
            elements: [
              {
                type: 'text',
                id: 'text-1',
                text: '{{a}} and {{b}}',
                x: 0,
                y: 0,
                fontSize: 24,
                fontFamily: 'Arial',
                color: '#FFFFFF',
              },
            ],
          },
        ],
      });

      const result = substituteVariables(spec, { a: 'X' });
      const textElement = result.scenes[0].elements[0] as { text: string };
      expect(textElement.text).toBe('X and {{b}}');
    });
  });

  describe('special character escaping', () => {
    it('should handle values with double quotes', () => {
      const spec = createSpec({
        scenes: [
          {
            id: 'scene-1',
            duration: 5,
            background: '#000000',
            elements: [
              {
                type: 'text',
                id: 'text-1',
                text: '{{name}}',
                x: 0,
                y: 0,
                fontSize: 24,
                fontFamily: 'Arial',
                color: '#FFFFFF',
              },
            ],
          },
        ],
      });

      const result = substituteVariables(spec, { name: 'Say "Hello"' });
      const textElement = result.scenes[0].elements[0] as { text: string };
      expect(textElement.text).toBe('Say "Hello"');
    });

    it('should handle values with backslashes', () => {
      const spec = createSpec({
        scenes: [
          {
            id: 'scene-1',
            duration: 5,
            background: '#000000',
            elements: [
              {
                type: 'text',
                id: 'text-1',
                text: '{{path}}',
                x: 0,
                y: 0,
                fontSize: 24,
                fontFamily: 'Arial',
                color: '#FFFFFF',
              },
            ],
          },
        ],
      });

      const result = substituteVariables(spec, { path: 'C:\\Users\\Name' });
      const textElement = result.scenes[0].elements[0] as { text: string };
      expect(textElement.text).toBe('C:\\Users\\Name');
    });

    it('should handle values with newlines', () => {
      const spec = createSpec({
        scenes: [
          {
            id: 'scene-1',
            duration: 5,
            background: '#000000',
            elements: [
              {
                type: 'text',
                id: 'text-1',
                text: '{{message}}',
                x: 0,
                y: 0,
                fontSize: 24,
                fontFamily: 'Arial',
                color: '#FFFFFF',
              },
            ],
          },
        ],
      });

      const result = substituteVariables(spec, { message: 'Line 1\nLine 2' });
      const textElement = result.scenes[0].elements[0] as { text: string };
      expect(textElement.text).toBe('Line 1\nLine 2');
    });

    it('should handle values with tabs', () => {
      const spec = createSpec({
        scenes: [
          {
            id: 'scene-1',
            duration: 5,
            background: '#000000',
            elements: [
              {
                type: 'text',
                id: 'text-1',
                text: '{{data}}',
                x: 0,
                y: 0,
                fontSize: 24,
                fontFamily: 'Arial',
                color: '#FFFFFF',
              },
            ],
          },
        ],
      });

      const result = substituteVariables(spec, { data: 'A\tB\tC' });
      const textElement = result.scenes[0].elements[0] as { text: string };
      expect(textElement.text).toBe('A\tB\tC');
    });

    it('should handle values with unicode characters', () => {
      const spec = createSpec({
        scenes: [
          {
            id: 'scene-1',
            duration: 5,
            background: '#000000',
            elements: [
              {
                type: 'text',
                id: 'text-1',
                text: '{{emoji}}',
                x: 0,
                y: 0,
                fontSize: 24,
                fontFamily: 'Arial',
                color: '#FFFFFF',
              },
            ],
          },
        ],
      });

      const result = substituteVariables(spec, { emoji: 'Hello!' });
      const textElement = result.scenes[0].elements[0] as { text: string };
      expect(textElement.text).toBe('Hello!');
    });
  });

  describe('JSON round-trip safety', () => {
    it('should return a valid VideoSpec after substitution', () => {
      const spec = createSpec({
        scenes: [
          {
            id: 'scene-1',
            duration: 5,
            background: '#000000',
            elements: [
              {
                type: 'text',
                id: 'text-1',
                text: '{{message}}',
                x: 0,
                y: 0,
                fontSize: 24,
                fontFamily: 'Arial',
                color: '#FFFFFF',
              },
            ],
          },
        ],
      });

      const result = substituteVariables(spec, { message: 'Test' });

      // Should be a valid VideoSpec
      expect(result.output).toBeDefined();
      expect(result.scenes).toBeDefined();
      expect(Array.isArray(result.scenes)).toBe(true);
    });

    it('should not modify the original spec', () => {
      const spec = createSpec({
        scenes: [
          {
            id: 'scene-1',
            duration: 5,
            background: '#000000',
            elements: [
              {
                type: 'text',
                id: 'text-1',
                text: '{{name}}',
                x: 0,
                y: 0,
                fontSize: 24,
                fontFamily: 'Arial',
                color: '#FFFFFF',
              },
            ],
          },
        ],
      });

      const originalText = (spec.scenes[0].elements[0] as { text: string }).text;
      substituteVariables(spec, { name: 'World' });

      // Original should be unchanged
      const currentText = (spec.scenes[0].elements[0] as { text: string }).text;
      expect(currentText).toBe(originalText);
      expect(currentText).toBe('{{name}}');
    });

    it('should handle empty spec gracefully', () => {
      const spec = createSpec({
        scenes: [],
      });

      const result = substituteVariables(spec, { name: 'World' });
      expect(result.scenes).toEqual([]);
    });
  });
});
