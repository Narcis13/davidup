# GameMotion

## What This Is

GameMotion is a high-performance, JSON-driven video rendering engine that enables programmatic video creation using game engine techniques. It provides a simple REST API where you submit a JSON specification and receive an MP4 file, with AI-powered template generation from natural language descriptions. Built as a single Node.js process with skia-canvas and FFmpeg, it prioritizes simplicity over complex infrastructure.

## Core Value

The JSON-to-video rendering engine must work reliably. If rendering fails, nothing else matters — AI templates, API features, and all higher-level functionality depend on this foundation producing correct MP4 output from valid JSON specifications.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] JSON-to-video rendering with text, images, and shapes
- [ ] Keyframe animation system with easing functions
- [ ] Animation presets (fade, slide, scale, bounce) for enter/exit
- [ ] Scene transitions (fade, slide, zoom)
- [ ] Audio track support with fade in/out
- [ ] REST API with authentication (API keys)
- [ ] AI template generation from natural language descriptions
- [ ] Variable substitution in templates ({{placeholder}} syntax)
- [ ] Asset management (upload/serve images, audio, fonts)
- [ ] Built-in starter templates for common video types

### Out of Scope

- Browser-based preview/editor — Keep infrastructure simple, no frontend complexity
- Real-time collaboration — Not needed for API-first product
- Mobile app — Web API is the interface
- Video-in-video (embedded videos) — Complexity not worth it for v1
- 3D animations — Scope creep, 2D covers vast majority of use cases
- Live streaming output — Different product category
- Redis/BullMQ job queue — p-queue (in-memory) sufficient for MVP
- Horizontal scaling — Single instance handles MVP load; add later if needed

## Context

**Market opportunity:** Programmatic video generation market growing. Existing solutions (json2video, Remotion) are either expensive at scale or complex to set up. Gap exists for a fast, simple, AI-enhanced solution.

**Technical approach:** Game engine techniques (immediate mode rendering with skia-canvas) instead of browser-based rendering. Direct frame generation piped to FFmpeg, avoiding DOM overhead and screenshot-based capture.

**User personas:**
1. Content creators (Maya) — Low-medium technical skill, want AI to generate templates from descriptions
2. Developers (Alex) — High technical skill, want simple API to integrate into their products

**Differentiation:** AI template generation is first-class, not bolted on. Speed advantage from game engine approach. Simple infrastructure (single process) vs complex orchestration.

## Constraints

- **Runtime:** Node.js 20+ / TypeScript — Ecosystem maturity, type safety
- **Video encoding:** FFmpeg (binary) — Industry standard, no alternatives
- **AI provider:** OpenRouter — Multi-model access, cost-effective; specific models negotiable

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Single process architecture | Simplicity over scalability; can add Redis/BullMQ later if needed | — Pending |
| skia-canvas for rendering | GPU-capable, game engine approach, faster than browser-based | — Pending |
| OpenRouter for AI | Multi-model flexibility, can switch providers easily | — Pending |
| Both keyframes and presets for v1 | Presets for simplicity, keyframes for power users — both needed | — Pending |

---
*Last updated: 2026-01-24 after initialization*
