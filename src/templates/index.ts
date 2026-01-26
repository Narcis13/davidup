/**
 * Template registry.
 * Loads and exports all built-in template JSON files.
 */

// Import all template JSON files
import tiktokProductShowcase from './tiktok-product-showcase.json' with { type: 'json' };
import youtubeIntro from './youtube-intro.json' with { type: 'json' };
import instagramStoryPromo from './instagram-story-promo.json' with { type: 'json' };
import socialAnnouncement from './social-announcement.json' with { type: 'json' };
import countdownTimer from './countdown-timer.json' with { type: 'json' };
import quoteCard from './quote-card.json' with { type: 'json' };
import beforeAfter from './before-after.json' with { type: 'json' };

/**
 * Variable definition in a template.
 */
export interface TemplateVariable {
  name: string;
  description: string;
  type: 'text' | 'url' | 'color';
  default?: string;
}

/**
 * Built-in template data structure.
 * Matches the JSON file structure.
 */
export interface BuiltInTemplateData {
  id: string;
  name: string;
  description: string;
  platform: 'tiktok' | 'youtube' | 'instagram' | 'universal';
  style: 'energetic' | 'professional' | 'playful';
  variables: TemplateVariable[];
  spec: {
    output: {
      width: number;
      height: number;
      fps: number;
      duration: number;
    };
    scenes: unknown[];
  };
}

/**
 * All built-in templates.
 */
export const BUILT_IN_TEMPLATES: readonly BuiltInTemplateData[] = [
  tiktokProductShowcase,
  youtubeIntro,
  instagramStoryPromo,
  socialAnnouncement,
  countdownTimer,
  quoteCard,
  beforeAfter,
] as unknown as readonly BuiltInTemplateData[];

/**
 * Get a template by ID.
 * @param id - Template ID
 * @returns The template data or undefined if not found
 */
export function getTemplateById(id: string): BuiltInTemplateData | undefined {
  return BUILT_IN_TEMPLATES.find(t => t.id === id);
}
