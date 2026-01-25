import { describe, it, expect } from 'vitest';
import { Timeline } from '../../src/timeline/timeline.js';
import type { SceneWithTransition } from '../../src/timeline/types.js';

/**
 * Timeline class tests.
 * Tests scene sequencing, frame calculations, and transition detection.
 */

describe('Timeline', () => {
  // Helper to create minimal test scenes
  const createScene = (
    duration: number,
    transition?: SceneWithTransition['transition']
  ): SceneWithTransition => ({
    duration,
    background: '#000000',
    elements: [],
    transition,
  });

  describe('constructor and basic getters', () => {
    it('calculates total frames correctly from single scene', () => {
      const timeline = new Timeline({
        scenes: [createScene(2)],
        fps: 30,
      });
      expect(timeline.getTotalFrames()).toBe(60); // 2s * 30fps
    });

    it('calculates total frames correctly from multiple scenes', () => {
      const timeline = new Timeline({
        scenes: [createScene(1), createScene(2), createScene(1.5)],
        fps: 30,
      });
      // 1s + 2s + 1.5s = 4.5s * 30fps = 135 frames
      expect(timeline.getTotalFrames()).toBe(135);
    });

    it('returns correct total duration', () => {
      const timeline = new Timeline({
        scenes: [createScene(1), createScene(2)],
        fps: 30,
      });
      expect(timeline.getTotalDuration()).toBe(3); // 1 + 2 = 3s
    });

    it('returns correct scene count', () => {
      const timeline = new Timeline({
        scenes: [createScene(1), createScene(2), createScene(3)],
        fps: 30,
      });
      expect(timeline.getSceneCount()).toBe(3);
    });

    it('handles fractional durations with Math.round', () => {
      // 1.1s at 30fps = 33 frames (rounded)
      const timeline = new Timeline({
        scenes: [createScene(1.1)],
        fps: 30,
      });
      expect(timeline.getTotalFrames()).toBe(33);
    });
  });

  describe('getSceneAtFrame - single scene', () => {
    it('returns scene 0 at frame 0', () => {
      const scene = createScene(2);
      const timeline = new Timeline({
        scenes: [scene],
        fps: 30,
      });

      const info = timeline.getSceneAtFrame(0);

      expect(info.scene).toBe(scene);
      expect(info.sceneIndex).toBe(0);
      expect(info.localFrame).toBe(0);
      expect(info.globalFrame).toBe(0);
      expect(info.inTransition).toBe(false);
    });

    it('returns scene 0 at last frame', () => {
      const scene = createScene(2);
      const timeline = new Timeline({
        scenes: [scene],
        fps: 30,
      });
      const lastFrame = timeline.getTotalFrames() - 1; // 59

      const info = timeline.getSceneAtFrame(lastFrame);

      expect(info.scene).toBe(scene);
      expect(info.sceneIndex).toBe(0);
      expect(info.localFrame).toBe(59);
      expect(info.globalFrame).toBe(59);
      expect(info.inTransition).toBe(false);
    });

    it('returns scene 0 at middle frame', () => {
      const scene = createScene(2);
      const timeline = new Timeline({
        scenes: [scene],
        fps: 30,
      });

      const info = timeline.getSceneAtFrame(30);

      expect(info.scene).toBe(scene);
      expect(info.sceneIndex).toBe(0);
      expect(info.localFrame).toBe(30);
      expect(info.globalFrame).toBe(30);
    });
  });

  describe('getSceneAtFrame - two scenes', () => {
    it('returns scene 0 for frame in first scene', () => {
      const scene0 = createScene(1);
      const scene1 = createScene(1);
      const timeline = new Timeline({
        scenes: [scene0, scene1],
        fps: 30,
      });

      const info = timeline.getSceneAtFrame(15); // Frame 15 is in scene 0 (0-29)

      expect(info.scene).toBe(scene0);
      expect(info.sceneIndex).toBe(0);
      expect(info.localFrame).toBe(15);
      expect(info.globalFrame).toBe(15);
    });

    it('returns scene 1 for frame in second scene', () => {
      const scene0 = createScene(1);
      const scene1 = createScene(1);
      const timeline = new Timeline({
        scenes: [scene0, scene1],
        fps: 30,
      });

      const info = timeline.getSceneAtFrame(30); // Frame 30 is start of scene 1

      expect(info.scene).toBe(scene1);
      expect(info.sceneIndex).toBe(1);
      expect(info.localFrame).toBe(0);
      expect(info.globalFrame).toBe(30);
    });

    it('returns scene 1 at last frame of second scene', () => {
      const scene0 = createScene(1);
      const scene1 = createScene(1);
      const timeline = new Timeline({
        scenes: [scene0, scene1],
        fps: 30,
      });

      const info = timeline.getSceneAtFrame(59); // Last frame

      expect(info.scene).toBe(scene1);
      expect(info.sceneIndex).toBe(1);
      expect(info.localFrame).toBe(29);
      expect(info.globalFrame).toBe(59);
    });
  });

  describe('getSceneAtFrame - transition detection', () => {
    it('returns inTransition=true when frame is in transition zone', () => {
      const scene0 = createScene(2, {
        type: 'fade',
        duration: 0.5, // 15 frames at 30fps
      });
      const scene1 = createScene(1);
      const timeline = new Timeline({
        scenes: [scene0, scene1],
        fps: 30,
      });

      // Scene 0 is 60 frames, transition starts at frame 45 (60 - 15)
      const info = timeline.getSceneAtFrame(50);

      expect(info.inTransition).toBe(true);
      expect(info.transition).toBeDefined();
    });

    it('returns inTransition=false when frame is before transition zone', () => {
      const scene0 = createScene(2, {
        type: 'fade',
        duration: 0.5,
      });
      const scene1 = createScene(1);
      const timeline = new Timeline({
        scenes: [scene0, scene1],
        fps: 30,
      });

      // Frame 30 is before transition (which starts at 45)
      const info = timeline.getSceneAtFrame(30);

      expect(info.inTransition).toBe(false);
      expect(info.transition).toBeUndefined();
    });

    it('returns correct transition from and to scenes', () => {
      const scene0 = createScene(2, {
        type: 'slide',
        direction: 'left',
        duration: 0.5,
      });
      const scene1 = createScene(1);
      const timeline = new Timeline({
        scenes: [scene0, scene1],
        fps: 30,
      });

      const info = timeline.getSceneAtFrame(50);

      expect(info.transition?.from).toBe(scene0);
      expect(info.transition?.to).toBe(scene1);
      expect(info.transition?.type).toBe('slide');
      expect(info.transition?.direction).toBe('left');
    });
  });

  describe('getSceneAtFrame - transition progress', () => {
    it('calculates progress correctly at transition start', () => {
      const scene0 = createScene(2, {
        type: 'fade',
        duration: 0.5, // 15 frames
      });
      const scene1 = createScene(1);
      const timeline = new Timeline({
        scenes: [scene0, scene1],
        fps: 30,
      });

      // Transition starts at frame 45, so frame 45 is progress 0
      const info = timeline.getSceneAtFrame(45);

      expect(info.inTransition).toBe(true);
      expect(info.transition?.progress).toBeCloseTo(0, 5);
    });

    it('calculates progress correctly at transition midpoint', () => {
      const scene0 = createScene(2, {
        type: 'fade',
        duration: 0.5, // 15 frames
      });
      const scene1 = createScene(1);
      const timeline = new Timeline({
        scenes: [scene0, scene1],
        fps: 30,
      });

      // Transition is frames 45-59 (15 frames)
      // Midpoint is frame 45 + 7.5 = 52.5, so frame 52 or 53
      const info = timeline.getSceneAtFrame(52);
      // (52 - 45) / 15 = 7/15 = 0.4666...
      expect(info.transition?.progress).toBeCloseTo(7 / 15, 5);
    });

    it('calculates progress correctly near transition end', () => {
      const scene0 = createScene(2, {
        type: 'fade',
        duration: 0.5, // 15 frames
      });
      const scene1 = createScene(1);
      const timeline = new Timeline({
        scenes: [scene0, scene1],
        fps: 30,
      });

      // Frame 59 is last frame of scene 0
      // Progress = (59 - 45) / 15 = 14/15
      const info = timeline.getSceneAtFrame(59);

      expect(info.inTransition).toBe(true);
      expect(info.transition?.progress).toBeCloseTo(14 / 15, 5);
    });
  });

  describe('getSceneAtFrame - transition easing', () => {
    it('applies easeInOut easing by default', () => {
      const scene0 = createScene(2, {
        type: 'fade',
        duration: 0.5,
        // No easing specified - defaults to easeInOut
      });
      const scene1 = createScene(1);
      const timeline = new Timeline({
        scenes: [scene0, scene1],
        fps: 30,
      });

      const info = timeline.getSceneAtFrame(52);

      // Progress ~0.4666, with easeInOut should be different
      expect(info.transition?.easedProgress).not.toBe(
        info.transition?.progress
      );
    });

    it('applies specified easing function', () => {
      const scene0 = createScene(2, {
        type: 'fade',
        duration: 0.5,
        easing: 'linear',
      });
      const scene1 = createScene(1);
      const timeline = new Timeline({
        scenes: [scene0, scene1],
        fps: 30,
      });

      const info = timeline.getSceneAtFrame(52);

      // With linear easing, easedProgress equals progress
      expect(info.transition?.easedProgress).toBeCloseTo(
        info.transition?.progress ?? 0,
        5
      );
    });

    it('applies easeIn easing correctly', () => {
      const scene0 = createScene(2, {
        type: 'fade',
        duration: 0.5,
        easing: 'easeIn',
      });
      const scene1 = createScene(1);
      const timeline = new Timeline({
        scenes: [scene0, scene1],
        fps: 30,
      });

      const info = timeline.getSceneAtFrame(52);
      const progress = info.transition?.progress ?? 0;
      // easeIn (quadratic) = t * t
      const expectedEased = progress * progress;

      expect(info.transition?.easedProgress).toBeCloseTo(expectedEased, 5);
    });
  });

  describe('getSceneAtFrame - edge cases', () => {
    it('clamps negative frame to 0', () => {
      const scene = createScene(2);
      const timeline = new Timeline({
        scenes: [scene],
        fps: 30,
      });

      const info = timeline.getSceneAtFrame(-5);

      expect(info.globalFrame).toBe(0);
      expect(info.localFrame).toBe(0);
      expect(info.sceneIndex).toBe(0);
    });

    it('clamps frame beyond duration to last frame', () => {
      const scene = createScene(2);
      const timeline = new Timeline({
        scenes: [scene],
        fps: 30,
      });
      const totalFrames = timeline.getTotalFrames();

      const info = timeline.getSceneAtFrame(totalFrames + 100);

      expect(info.globalFrame).toBe(totalFrames - 1);
      expect(info.localFrame).toBe(59);
      expect(info.sceneIndex).toBe(0);
    });

    it('handles frame exactly at scene boundary', () => {
      const scene0 = createScene(1);
      const scene1 = createScene(1);
      const timeline = new Timeline({
        scenes: [scene0, scene1],
        fps: 30,
      });

      // Frame 30 is the first frame of scene 1
      const info = timeline.getSceneAtFrame(30);

      expect(info.sceneIndex).toBe(1);
      expect(info.localFrame).toBe(0);
    });
  });

  describe('getSceneAtFrame - scene without transition', () => {
    it('never returns inTransition=true when scene has no transition', () => {
      const scene0 = createScene(2); // No transition
      const scene1 = createScene(1);
      const timeline = new Timeline({
        scenes: [scene0, scene1],
        fps: 30,
      });

      // Check all frames in scene 0
      for (let frame = 0; frame < 60; frame++) {
        const info = timeline.getSceneAtFrame(frame);
        expect(info.inTransition).toBe(false);
        expect(info.transition).toBeUndefined();
      }
    });

    it('last scene never has transition regardless of transition property', () => {
      const scene0 = createScene(1);
      const scene1 = createScene(1, {
        type: 'fade',
        duration: 0.5,
      }); // Transition on last scene is ignored
      const timeline = new Timeline({
        scenes: [scene0, scene1],
        fps: 30,
      });

      // Check frames in last scene
      for (let frame = 30; frame < 60; frame++) {
        const info = timeline.getSceneAtFrame(frame);
        expect(info.inTransition).toBe(false);
      }
    });
  });

  describe('getSceneAtFrame - multiple scenes with transitions', () => {
    it('handles transitions between multiple scenes', () => {
      const scene0 = createScene(1, { type: 'fade', duration: 0.5 });
      const scene1 = createScene(1, { type: 'slide', direction: 'left', duration: 0.5 });
      const scene2 = createScene(1); // Last scene, no transition needed
      const timeline = new Timeline({
        scenes: [scene0, scene1, scene2],
        fps: 30,
      });

      // Scene 0: frames 0-29, transition at 15-29
      const info0 = timeline.getSceneAtFrame(20);
      expect(info0.sceneIndex).toBe(0);
      expect(info0.inTransition).toBe(true);
      expect(info0.transition?.type).toBe('fade');
      expect(info0.transition?.to).toBe(scene1);

      // Scene 1: frames 30-59, transition at 45-59
      const info1 = timeline.getSceneAtFrame(50);
      expect(info1.sceneIndex).toBe(1);
      expect(info1.inTransition).toBe(true);
      expect(info1.transition?.type).toBe('slide');
      expect(info1.transition?.to).toBe(scene2);

      // Scene 2: frames 60-89, no transition
      const info2 = timeline.getSceneAtFrame(70);
      expect(info2.sceneIndex).toBe(2);
      expect(info2.inTransition).toBe(false);
    });
  });

  describe('floating point handling', () => {
    it('avoids floating point drift across many scenes', () => {
      // Create many scenes with fractional durations
      const scenes = Array.from({ length: 100 }, () => createScene(0.1));
      const timeline = new Timeline({
        scenes,
        fps: 30,
      });

      // Each scene is 0.1s = 3 frames (rounded)
      // 100 scenes = 300 frames
      expect(timeline.getTotalFrames()).toBe(300);
      expect(timeline.getSceneCount()).toBe(100);

      // Verify last scene is accessible
      const info = timeline.getSceneAtFrame(299);
      expect(info.sceneIndex).toBe(99);
      expect(info.localFrame).toBe(2); // Last frame of last scene
    });
  });
});
