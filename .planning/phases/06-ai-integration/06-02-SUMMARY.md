---
phase: 06
plan: 02
subsystem: templates
tags: [templates, json, store, service]
requires: [01-01, 02-02]
provides: [built-in-templates, template-store]
affects: [06-03, 06-04]
tech-stack:
  added: []
  patterns: [json-templates, registry-pattern, singleton-service]
key-files:
  created:
    - src/templates/tiktok-product-showcase.json
    - src/templates/youtube-intro.json
    - src/templates/instagram-story-promo.json
    - src/templates/social-announcement.json
    - src/templates/countdown-timer.json
    - src/templates/quote-card.json
    - src/templates/before-after.json
    - src/templates/index.ts
    - src/api/services/template-store.ts
  modified:
    - src/api/services/index.ts
decisions:
  - id: json-template-structure
    choice: "VideoSpec embedded in template JSON with {{variables}}"
    rationale: "Self-contained templates, easy validation"
  - id: import-attributes
    choice: "ESM import attributes with type: json"
    rationale: "NodeNext module resolution supports this pattern"
  - id: template-type-assertion
    choice: "Cast BUILT_IN_TEMPLATES via unknown"
    rationale: "JSON imports are typed as any, need safe casting"
metrics:
  duration: 3m10s
  completed: 2026-01-26
---

# Phase 06 Plan 02: Built-in Templates Summary

**One-liner:** 7 JSON video templates (TikTok, YouTube, Instagram, universal) with TemplateStore service for listing and retrieval.

## What Was Built

### Built-in Templates (7 total)

| Template ID | Platform | Style | Variables | Duration |
|-------------|----------|-------|-----------|----------|
| tiktok-product-showcase | tiktok | energetic | 5 | 7s |
| youtube-intro | youtube | professional | 4 | 5s |
| instagram-story-promo | instagram | playful | 4 | 4s |
| social-announcement | universal | professional | 4 | 5s |
| countdown-timer | universal | energetic | 3 | 5s |
| quote-card | universal | professional | 4 | 5s |
| before-after | universal | professional | 4 | 4s |

Each template:
- Contains valid VideoSpec with {{variable}} placeholders
- Defines proper element structures (text, image, shape)
- Uses scene transitions (fade, slide, zoom)
- Follows platform-specific dimensions

### Template Registry

`src/templates/index.ts`:
- Imports all 7 JSON template files
- Exports `BUILT_IN_TEMPLATES` readonly array
- Exports `getTemplateById()` helper function
- Defines `BuiltInTemplateData` and `TemplateVariable` interfaces

### TemplateStore Service

`src/api/services/template-store.ts`:
- `list()` - Returns all templates without full spec (metadata only)
- `get(id)` - Returns full template with spec
- `size` getter - Returns template count
- Singleton `templateStore` instance

## Key Implementation Details

### Template JSON Structure
```json
{
  "id": "template-id",
  "name": "Template Name",
  "description": "What this template does",
  "platform": "tiktok|youtube|instagram|universal",
  "style": "energetic|professional|playful",
  "variables": [{ "name": "...", "description": "...", "type": "text|url|color" }],
  "spec": { /* Valid VideoSpec */ }
}
```

### Variable Types
- `text` - String content (product name, headline, etc.)
- `url` - URL to image or other resource
- `color` - CSS color value

### Platform Dimensions
- TikTok: 1080x1920 (vertical)
- YouTube: 1920x1080 (horizontal)
- Instagram: 1080x1080 (square)
- Universal: 1080x1080 (square)

## Commits

| Hash | Message |
|------|---------|
| 0e37d4b | feat(06-02): create built-in template JSON files |
| 4f58c9e | feat(06-02): create template registry |
| 1f600ff | feat(06-02): create TemplateStore service |

## Deviations from Plan

None - plan executed exactly as written.

## Usage Examples

```typescript
import { templateStore } from './api/services/template-store.js';

// List all templates
const templates = templateStore.list();
// Returns: [{ id, name, description, platform, style, variables }]

// Get a specific template
const tiktokTemplate = templateStore.get('tiktok-product-showcase');
// Returns full template with spec

// Count templates
console.log(templateStore.size); // 7
```

## Testing

```bash
# Verify templates load
npx tsx -e "import { BUILT_IN_TEMPLATES } from './src/templates/index.ts'; console.log(BUILT_IN_TEMPLATES.length)"
# Output: 7

# Verify TemplateStore works
npx tsx -e "import { templateStore } from './src/api/services/template-store.ts'; console.log(templateStore.list().map(t => t.id))"
```

## Next Phase Readiness

Ready for:
- 06-03: Template instantiation (substituting variables)
- 06-04: AI-powered template generation using these as examples
