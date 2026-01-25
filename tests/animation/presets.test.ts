import { describe, it, expect } from 'vitest';
import {
  generateEnterKeyframes,
  generateExitKeyframes,
  PresetConfig,
  PresetType,
  SlideDirection,
} from '../../src/animation/presets.js';

/**
 * Animation presets tests.
 * Tests for generateEnterKeyframes and generateExitKeyframes.
 */

describe('Animation Presets', () => {
  describe('generateEnterKeyframes', () => {
    describe('fade preset', () => {
      it('returns opacity animation 0->1', () => {
        const config: PresetConfig = { type: 'fade', duration: 30 };
        const keyframes = generateEnterKeyframes(config, 0, 100, 100);

        expect(keyframes).toHaveLength(1);
        expect(keyframes[0].property).toBe('opacity');
        expect(keyframes[0].keyframes).toHaveLength(2);
        expect(keyframes[0].keyframes[0]).toEqual({ frame: 0, value: 0 });
        expect(keyframes[0].keyframes[1].frame).toBe(30);
        expect(keyframes[0].keyframes[1].value).toBe(1);
        expect(keyframes[0].keyframes[1].easing).toBe('easeOut');
      });

      it('respects startFrame offset', () => {
        const config: PresetConfig = { type: 'fade', duration: 20 };
        const keyframes = generateEnterKeyframes(config, 15, 100, 100);

        expect(keyframes[0].keyframes[0].frame).toBe(15);
        expect(keyframes[0].keyframes[1].frame).toBe(35);
      });
    });

    describe('slide preset', () => {
      it('slide left: returns x from (x-distance)->x, opacity 0->1', () => {
        const config: PresetConfig = {
          type: 'slide',
          duration: 30,
          direction: 'left',
        };
        const keyframes = generateEnterKeyframes(config, 0, 500, 300);

        expect(keyframes).toHaveLength(3);

        // X animation
        const xAnim = keyframes.find((k) => k.property === 'x');
        expect(xAnim).toBeDefined();
        expect(xAnim!.keyframes[0].value).toBe(400); // 500 - 100
        expect(xAnim!.keyframes[1].value).toBe(500);

        // Y animation should stay at same position
        const yAnim = keyframes.find((k) => k.property === 'y');
        expect(yAnim).toBeDefined();
        expect(yAnim!.keyframes[0].value).toBe(300);
        expect(yAnim!.keyframes[1].value).toBe(300);

        // Opacity animation
        const opacityAnim = keyframes.find((k) => k.property === 'opacity');
        expect(opacityAnim).toBeDefined();
        expect(opacityAnim!.keyframes[0].value).toBe(0);
        expect(opacityAnim!.keyframes[1].value).toBe(1);
      });

      it('slide right: returns x from (x+distance)->x', () => {
        const config: PresetConfig = {
          type: 'slide',
          duration: 30,
          direction: 'right',
        };
        const keyframes = generateEnterKeyframes(config, 0, 500, 300);

        const xAnim = keyframes.find((k) => k.property === 'x');
        expect(xAnim!.keyframes[0].value).toBe(600); // 500 + 100
        expect(xAnim!.keyframes[1].value).toBe(500);
      });

      it('slide top: returns y from (y-distance)->y', () => {
        const config: PresetConfig = {
          type: 'slide',
          duration: 30,
          direction: 'top',
        };
        const keyframes = generateEnterKeyframes(config, 0, 500, 300);

        const yAnim = keyframes.find((k) => k.property === 'y');
        expect(yAnim!.keyframes[0].value).toBe(200); // 300 - 100
        expect(yAnim!.keyframes[1].value).toBe(300);

        // X should stay same
        const xAnim = keyframes.find((k) => k.property === 'x');
        expect(xAnim!.keyframes[0].value).toBe(500);
        expect(xAnim!.keyframes[1].value).toBe(500);
      });

      it('slide bottom: returns y from (y+distance)->y', () => {
        const config: PresetConfig = {
          type: 'slide',
          duration: 30,
          direction: 'bottom',
        };
        const keyframes = generateEnterKeyframes(config, 0, 500, 300);

        const yAnim = keyframes.find((k) => k.property === 'y');
        expect(yAnim!.keyframes[0].value).toBe(400); // 300 + 100
        expect(yAnim!.keyframes[1].value).toBe(300);
      });

      it('defaults direction to left when not specified', () => {
        const config: PresetConfig = {
          type: 'slide',
          duration: 30,
        };
        const keyframes = generateEnterKeyframes(config, 0, 500, 300);

        const xAnim = keyframes.find((k) => k.property === 'x');
        expect(xAnim!.keyframes[0].value).toBe(400); // left offset
      });

      it('uses custom distance parameter', () => {
        const config: PresetConfig = {
          type: 'slide',
          duration: 30,
          direction: 'left',
          distance: 200,
        };
        const keyframes = generateEnterKeyframes(config, 0, 500, 300);

        const xAnim = keyframes.find((k) => k.property === 'x');
        expect(xAnim!.keyframes[0].value).toBe(300); // 500 - 200
        expect(xAnim!.keyframes[1].value).toBe(500);
      });

      it('uses default distance of 100 when not specified', () => {
        const config: PresetConfig = {
          type: 'slide',
          duration: 30,
          direction: 'right',
        };
        const keyframes = generateEnterKeyframes(config, 0, 0, 0);

        const xAnim = keyframes.find((k) => k.property === 'x');
        expect(xAnim!.keyframes[0].value).toBe(100); // 0 + 100 (default distance)
      });
    });

    describe('scale preset', () => {
      it('returns scaleX and scaleY animations 0->1, plus opacity', () => {
        const config: PresetConfig = { type: 'scale', duration: 30 };
        const keyframes = generateEnterKeyframes(config, 0, 100, 100);

        expect(keyframes).toHaveLength(3);

        // ScaleX
        const scaleXAnim = keyframes.find((k) => k.property === 'scaleX');
        expect(scaleXAnim).toBeDefined();
        expect(scaleXAnim!.keyframes[0].value).toBe(0);
        expect(scaleXAnim!.keyframes[1].value).toBe(1);
        expect(scaleXAnim!.keyframes[1].easing).toBe('easeOut');

        // ScaleY
        const scaleYAnim = keyframes.find((k) => k.property === 'scaleY');
        expect(scaleYAnim).toBeDefined();
        expect(scaleYAnim!.keyframes[0].value).toBe(0);
        expect(scaleYAnim!.keyframes[1].value).toBe(1);

        // Opacity
        const opacityAnim = keyframes.find((k) => k.property === 'opacity');
        expect(opacityAnim).toBeDefined();
        expect(opacityAnim!.keyframes[0].value).toBe(0);
        expect(opacityAnim!.keyframes[1].value).toBe(1);
      });
    });

    describe('bounce preset', () => {
      it('uses easeOutBounce easing', () => {
        const config: PresetConfig = { type: 'bounce', duration: 30 };
        const keyframes = generateEnterKeyframes(config, 0, 100, 100);

        const scaleXAnim = keyframes.find((k) => k.property === 'scaleX');
        expect(scaleXAnim!.keyframes[1].easing).toBe('easeOutBounce');

        const scaleYAnim = keyframes.find((k) => k.property === 'scaleY');
        expect(scaleYAnim!.keyframes[1].easing).toBe('easeOutBounce');
      });

      it('fades in quickly at the start', () => {
        const config: PresetConfig = { type: 'bounce', duration: 100 };
        const keyframes = generateEnterKeyframes(config, 0, 100, 100);

        const opacityAnim = keyframes.find((k) => k.property === 'opacity');
        expect(opacityAnim).toBeDefined();
        expect(opacityAnim!.keyframes[0].frame).toBe(0);
        expect(opacityAnim!.keyframes[0].value).toBe(0);
        // Opacity reaches 1 at 30% of duration
        expect(opacityAnim!.keyframes[1].frame).toBe(30);
        expect(opacityAnim!.keyframes[1].value).toBe(1);
      });

      it('returns scaleX, scaleY, and opacity animations', () => {
        const config: PresetConfig = { type: 'bounce', duration: 30 };
        const keyframes = generateEnterKeyframes(config, 0, 100, 100);

        expect(keyframes).toHaveLength(3);
        expect(keyframes.map((k) => k.property).sort()).toEqual([
          'opacity',
          'scaleX',
          'scaleY',
        ]);
      });
    });

    describe('custom easing', () => {
      it('respects provided easing for fade', () => {
        const config: PresetConfig = {
          type: 'fade',
          duration: 30,
          easing: 'easeInOutCubic',
        };
        const keyframes = generateEnterKeyframes(config, 0, 100, 100);

        expect(keyframes[0].keyframes[1].easing).toBe('easeInOutCubic');
      });

      it('respects provided easing for slide', () => {
        const config: PresetConfig = {
          type: 'slide',
          duration: 30,
          easing: 'linear',
        };
        const keyframes = generateEnterKeyframes(config, 0, 100, 100);

        keyframes.forEach((anim) => {
          expect(anim.keyframes[1].easing).toBe('linear');
        });
      });

      it('respects provided easing for scale', () => {
        const config: PresetConfig = {
          type: 'scale',
          duration: 30,
          easing: 'easeInOutElastic',
        };
        const keyframes = generateEnterKeyframes(config, 0, 100, 100);

        keyframes.forEach((anim) => {
          expect(anim.keyframes[1].easing).toBe('easeInOutElastic');
        });
      });

      it('bounce uses easeOutBounce regardless of custom easing for scale props', () => {
        const config: PresetConfig = {
          type: 'bounce',
          duration: 30,
          easing: 'linear', // This should NOT override bounce easing
        };
        const keyframes = generateEnterKeyframes(config, 0, 100, 100);

        const scaleXAnim = keyframes.find((k) => k.property === 'scaleX');
        // Bounce preset always uses easeOutBounce
        expect(scaleXAnim!.keyframes[1].easing).toBe('easeOutBounce');
      });
    });

    describe('default easing', () => {
      it('uses easeOut by default for fade, slide, scale', () => {
        const types: PresetType[] = ['fade', 'slide', 'scale'];
        types.forEach((type) => {
          const config: PresetConfig = { type, duration: 30 };
          const keyframes = generateEnterKeyframes(config, 0, 100, 100);
          const firstAnim = keyframes[0];
          expect(firstAnim.keyframes[1].easing).toBe('easeOut');
        });
      });

      it('uses easeOutBounce by default for bounce', () => {
        const config: PresetConfig = { type: 'bounce', duration: 30 };
        const keyframes = generateEnterKeyframes(config, 0, 100, 100);
        const scaleXAnim = keyframes.find((k) => k.property === 'scaleX');
        expect(scaleXAnim!.keyframes[1].easing).toBe('easeOutBounce');
      });
    });
  });

  describe('generateExitKeyframes', () => {
    describe('fade preset', () => {
      it('returns opacity animation 1->0', () => {
        const config: PresetConfig = { type: 'fade', duration: 30 };
        const keyframes = generateExitKeyframes(config, 60, 100, 100);

        expect(keyframes).toHaveLength(1);
        expect(keyframes[0].property).toBe('opacity');
        expect(keyframes[0].keyframes[0]).toEqual({ frame: 60, value: 1 });
        expect(keyframes[0].keyframes[1].frame).toBe(90);
        expect(keyframes[0].keyframes[1].value).toBe(0);
        expect(keyframes[0].keyframes[1].easing).toBe('easeIn');
      });
    });

    describe('slide preset', () => {
      it('slide left: returns x from x->(x-distance)', () => {
        const config: PresetConfig = {
          type: 'slide',
          duration: 30,
          direction: 'left',
        };
        const keyframes = generateExitKeyframes(config, 0, 500, 300);

        const xAnim = keyframes.find((k) => k.property === 'x');
        expect(xAnim!.keyframes[0].value).toBe(500);
        expect(xAnim!.keyframes[1].value).toBe(400); // moves to the left
      });

      it('slide right: returns x from x->(x+distance)', () => {
        const config: PresetConfig = {
          type: 'slide',
          duration: 30,
          direction: 'right',
        };
        const keyframes = generateExitKeyframes(config, 0, 500, 300);

        const xAnim = keyframes.find((k) => k.property === 'x');
        expect(xAnim!.keyframes[0].value).toBe(500);
        expect(xAnim!.keyframes[1].value).toBe(600); // moves to the right
      });

      it('returns opacity animation 1->0', () => {
        const config: PresetConfig = {
          type: 'slide',
          duration: 30,
          direction: 'left',
        };
        const keyframes = generateExitKeyframes(config, 0, 500, 300);

        const opacityAnim = keyframes.find((k) => k.property === 'opacity');
        expect(opacityAnim!.keyframes[0].value).toBe(1);
        expect(opacityAnim!.keyframes[1].value).toBe(0);
      });
    });

    describe('scale preset', () => {
      it('returns scaleX and scaleY animations 1->0', () => {
        const config: PresetConfig = { type: 'scale', duration: 30 };
        const keyframes = generateExitKeyframes(config, 0, 100, 100);

        const scaleXAnim = keyframes.find((k) => k.property === 'scaleX');
        expect(scaleXAnim!.keyframes[0].value).toBe(1);
        expect(scaleXAnim!.keyframes[1].value).toBe(0);

        const scaleYAnim = keyframes.find((k) => k.property === 'scaleY');
        expect(scaleYAnim!.keyframes[0].value).toBe(1);
        expect(scaleYAnim!.keyframes[1].value).toBe(0);
      });

      it('returns opacity animation 1->0', () => {
        const config: PresetConfig = { type: 'scale', duration: 30 };
        const keyframes = generateExitKeyframes(config, 0, 100, 100);

        const opacityAnim = keyframes.find((k) => k.property === 'opacity');
        expect(opacityAnim!.keyframes[0].value).toBe(1);
        expect(opacityAnim!.keyframes[1].value).toBe(0);
      });
    });

    describe('bounce preset', () => {
      it('uses easeInBounce easing', () => {
        const config: PresetConfig = { type: 'bounce', duration: 30 };
        const keyframes = generateExitKeyframes(config, 0, 100, 100);

        const scaleXAnim = keyframes.find((k) => k.property === 'scaleX');
        expect(scaleXAnim!.keyframes[1].easing).toBe('easeInBounce');

        const scaleYAnim = keyframes.find((k) => k.property === 'scaleY');
        expect(scaleYAnim!.keyframes[1].easing).toBe('easeInBounce');
      });

      it('fades out quickly at the end', () => {
        const config: PresetConfig = { type: 'bounce', duration: 100 };
        const keyframes = generateExitKeyframes(config, 0, 100, 100);

        const opacityAnim = keyframes.find((k) => k.property === 'opacity');
        expect(opacityAnim).toBeDefined();
        // Opacity stays at 1 until 70% of duration
        expect(opacityAnim!.keyframes[0].frame).toBe(70);
        expect(opacityAnim!.keyframes[0].value).toBe(1);
        // Then fades to 0 at end
        expect(opacityAnim!.keyframes[1].frame).toBe(100);
        expect(opacityAnim!.keyframes[1].value).toBe(0);
      });
    });

    describe('default easing', () => {
      it('uses easeIn by default for fade, slide, scale (not easeOut)', () => {
        const types: PresetType[] = ['fade', 'slide', 'scale'];
        types.forEach((type) => {
          const config: PresetConfig = { type, duration: 30 };
          const keyframes = generateExitKeyframes(config, 0, 100, 100);
          const firstAnim = keyframes[0];
          expect(firstAnim.keyframes[1].easing).toBe('easeIn');
        });
      });

      it('uses easeInBounce by default for bounce', () => {
        const config: PresetConfig = { type: 'bounce', duration: 30 };
        const keyframes = generateExitKeyframes(config, 0, 100, 100);
        const scaleXAnim = keyframes.find((k) => k.property === 'scaleX');
        expect(scaleXAnim!.keyframes[1].easing).toBe('easeInBounce');
      });
    });

    describe('custom easing', () => {
      it('respects provided easing for exit', () => {
        const config: PresetConfig = {
          type: 'fade',
          duration: 30,
          easing: 'easeOutCubic',
        };
        const keyframes = generateExitKeyframes(config, 0, 100, 100);

        expect(keyframes[0].keyframes[1].easing).toBe('easeOutCubic');
      });
    });
  });

  describe('enter/exit complementary behavior', () => {
    it('enter and exit fade are complementary', () => {
      const config: PresetConfig = { type: 'fade', duration: 30 };

      const enterKeyframes = generateEnterKeyframes(config, 0, 100, 100);
      const exitKeyframes = generateExitKeyframes(config, 30, 100, 100);

      // Enter ends at opacity 1
      expect(
        enterKeyframes[0].keyframes[enterKeyframes[0].keyframes.length - 1]
          .value
      ).toBe(1);
      // Exit starts at opacity 1
      expect(exitKeyframes[0].keyframes[0].value).toBe(1);
    });

    it('enter and exit slide are complementary', () => {
      const config: PresetConfig = {
        type: 'slide',
        duration: 30,
        direction: 'left',
      };

      const enterKeyframes = generateEnterKeyframes(config, 0, 500, 300);
      const exitKeyframes = generateExitKeyframes(config, 30, 500, 300);

      // Enter ends at position (500, 300)
      const enterX = enterKeyframes.find((k) => k.property === 'x');
      expect(enterX!.keyframes[1].value).toBe(500);

      // Exit starts at position (500, 300)
      const exitX = exitKeyframes.find((k) => k.property === 'x');
      expect(exitX!.keyframes[0].value).toBe(500);
    });

    it('enter and exit scale are complementary', () => {
      const config: PresetConfig = { type: 'scale', duration: 30 };

      const enterKeyframes = generateEnterKeyframes(config, 0, 100, 100);
      const exitKeyframes = generateExitKeyframes(config, 30, 100, 100);

      // Enter ends at scale (1, 1)
      const enterScaleX = enterKeyframes.find((k) => k.property === 'scaleX');
      expect(enterScaleX!.keyframes[1].value).toBe(1);

      // Exit starts at scale (1, 1)
      const exitScaleX = exitKeyframes.find((k) => k.property === 'scaleX');
      expect(exitScaleX!.keyframes[0].value).toBe(1);
    });
  });

  describe('type exports', () => {
    it('PresetType includes all preset types', () => {
      const types: PresetType[] = ['fade', 'slide', 'scale', 'bounce'];
      expect(types).toHaveLength(4);
    });

    it('SlideDirection includes all directions', () => {
      const directions: SlideDirection[] = ['left', 'right', 'top', 'bottom'];
      expect(directions).toHaveLength(4);
    });
  });
});
