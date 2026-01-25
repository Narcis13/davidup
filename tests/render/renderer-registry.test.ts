import { describe, it, expect, beforeEach } from 'vitest';
import { RendererRegistry, type ElementRenderer, type BaseElement } from '../../src/render/renderer-registry.js';

describe('RendererRegistry', () => {
  let registry: RendererRegistry;

  beforeEach(() => {
    registry = new RendererRegistry();
  });

  it('should register a renderer', () => {
    const mockRenderer: ElementRenderer = {
      type: 'text',
      render: () => {},
    };

    registry.register(mockRenderer);

    expect(registry.has('text')).toBe(true);
  });

  it('should report unregistered types', () => {
    expect(registry.has('text')).toBe(false);
    expect(registry.has('image')).toBe(false);
  });

  it('should throw when rendering unregistered type', () => {
    const element: BaseElement = { type: 'text', x: 0, y: 0 };

    expect(() => registry.render({} as any, element, {} as any))
      .toThrow('No renderer registered for element type: text');
  });

  it('should dispatch to correct renderer', () => {
    let called = false;
    const mockRenderer: ElementRenderer = {
      type: 'text',
      render: () => { called = true; },
    };

    registry.register(mockRenderer);
    registry.render({} as any, { type: 'text', x: 0, y: 0 }, {} as any);

    expect(called).toBe(true);
  });

  it('should list registered types', () => {
    registry.register({ type: 'text', render: () => {} });
    registry.register({ type: 'image', render: () => {} });

    const types = registry.getRegisteredTypes();

    expect(types).toContain('text');
    expect(types).toContain('image');
    expect(types).toHaveLength(2);
  });
});
