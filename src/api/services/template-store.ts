/**
 * Template store service.
 * Provides access to built-in templates.
 */

import { BUILT_IN_TEMPLATES, type BuiltInTemplateData } from '../../templates/index.js';

/**
 * Template metadata returned when listing templates.
 * Excludes the full spec for efficiency.
 */
export interface TemplateListItem {
  id: string;
  name: string;
  description: string;
  platform: string;
  style: string;
  variables: Array<{ name: string; description: string; type: string }>;
}

/**
 * Template store for accessing built-in templates.
 */
export class TemplateStore {
  /**
   * List all built-in templates (without full spec for efficiency).
   * @returns Array of template metadata
   */
  list(): TemplateListItem[] {
    return BUILT_IN_TEMPLATES.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      platform: t.platform,
      style: t.style,
      variables: t.variables.map(v => ({
        name: v.name,
        description: v.description,
        type: v.type,
      })),
    }));
  }

  /**
   * Get a template by ID (includes full spec).
   * @param id - Template ID
   * @returns The template data or undefined if not found
   */
  get(id: string): BuiltInTemplateData | undefined {
    return BUILT_IN_TEMPLATES.find(t => t.id === id);
  }

  /**
   * Get the total number of templates.
   */
  get size(): number {
    return BUILT_IN_TEMPLATES.length;
  }
}

/**
 * Singleton template store instance.
 */
export const templateStore = new TemplateStore();
