# GameMotion

## What This Is

GameMotion is a high-performance, JSON-driven video rendering engine with a local development studio UI. The rendering engine provides a REST API where you submit JSON and receive MP4. The studio provides a chat-based interface for AI template generation, a library of templates and rendered videos, and frictionless testing of the rendering engine. Built for single-user local development with React + Tailwind frontend and Node.js backend.

## Core Value

The JSON-to-video rendering engine must work reliably. If rendering fails, nothing else matters — AI templates, API features, and all higher-level functionality depend on this foundation producing correct MP4 output from valid JSON specifications.

## Requirements

### Validated

- Canvas rendering with text, images, shapes — v0.1
- Keyframe animation with 12 easing functions — v0.1
- Enter/exit presets (fade, slide, scale, bounce) — v0.1
- Scene transitions (fade, slide, zoom) — v0.1
- H.264 MP4 encoding with FFmpeg — v0.1
- Audio track with volume and fade controls — v0.1
- REST API with authentication and rate limiting — v0.1
- AI template generation from natural language — v0.1
- Variable substitution in templates — v0.1
- Asset upload and management — v0.1
- 7 built-in starter templates — v0.1

### Active

**v0.2 Studio UI:**
- [ ] Conversational AI chat for template generation and refinement
- [ ] Template library with version history
- [ ] Video library linked to source templates
- [ ] Video preview via render → system player
- [ ] Frictionless testing of rendering engine

### Out of Scope

- In-browser video playback — System player is simpler, avoids streaming complexity
- Real-time collaboration — Not needed for API-first product
- Mobile app — Web API is the interface
- Video-in-video (embedded videos) — Complexity not worth it for v1
- 3D animations — Scope creep, 2D covers vast majority of use cases
- Live streaming output — Different product category
- Redis/BullMQ job queue — p-queue (in-memory) sufficient for MVP
- Horizontal scaling — Single instance handles MVP load; add later if needed
- Custom font upload — Remote font URLs or system fonts cover most needs
- GPU acceleration — Software rendering is fast enough initially

## Context

**Current State:** v0.1 MVP shipped with 6,654 LOC TypeScript. All 40 requirements validated. 577 tests passing.

**Tech Stack:**
- Runtime: Node.js 20+ / TypeScript
- Rendering: @napi-rs/canvas (skia-based)
- Encoding: FFmpeg (binary)
- API: Hono framework
- AI: OpenRouter (Claude Sonnet 4)

**Market opportunity:** Programmatic video generation market growing. Existing solutions (json2video, Remotion) are either expensive at scale or complex to set up. Gap exists for a fast, simple, AI-enhanced solution.

**User personas:**
1. Content creators (Maya) — Low-medium technical skill, want AI to generate templates from descriptions
2. Developers (Alex) — High technical skill, want simple API to integrate into their products

**Differentiation:** AI template generation is first-class, not bolted on. Speed advantage from game engine approach. Simple infrastructure (single process) vs complex orchestration.

## Constraints

- **Runtime:** Node.js 20+ / TypeScript — Ecosystem maturity, type safety
- **Video encoding:** FFmpeg (binary) — Industry standard, no alternatives
- **AI provider:** OpenRouter — Multi-model access, cost-effective; specific models configurable

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Single process architecture | Simplicity over scalability; can add Redis/BullMQ later if needed | Good for MVP |
| @napi-rs/canvas for rendering | GPU-capable, game engine approach, faster than browser-based | Good |
| OpenRouter for AI | Multi-model flexibility, can switch providers easily | Good |
| Both keyframes and presets for v1 | Presets for simplicity, keyframes for power users — both needed | Good |
| Hono for API framework | Fast, TypeScript-native, lightweight | Good |
| p-queue for job management | Simple in-memory queue sufficient for MVP | Good for MVP |
| canvas.data() for raw pixels | toBuffer('raw') not supported in @napi-rs/canvas | Works |
| FFmpeg for encoding | Industry standard, reliable | Good |

## Current Milestone: v0.2 Studio

**Goal:** Build a local dev UI for frictionless AI-assisted video creation and testing.

**Target features:**
- Conversational AI chat for template generation/refinement
- Template library with version history
- Video library linked to templates
- Preview via system player
- Zero-friction testing workflow

---
*Last updated: 2026-01-27 after starting v0.2 milestone*
