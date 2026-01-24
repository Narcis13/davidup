# Roadmap: GameMotion

**Created:** 2026-01-24
**Total Phases:** 6
**Total Requirements:** 40

## Phase Overview

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|------------------|
| 1 | Foundation | JSON specifications can be validated and configured | 5 | 3 |
| 2 | Core Rendering | Static frames can be rendered with text, images, and shapes | 11 | 4 |
| 3 | Animation & Timeline | Elements can be animated across multi-scene timelines | 9 | 5 |
| 4 | Video Output | Complete videos with audio can be encoded to MP4 | 4 | 3 |
| 5 | API Layer | External developers can submit and manage render jobs | 11 | 5 |
| 6 | AI Integration | Users can generate templates from natural language | 7 | 4 |

---

## Phase 1: Foundation

**Goal:** JSON specifications can be validated with detailed error feedback and output parameters configured

**Plans:** 2 plans

Plans:
- [ ] 01-01-PLAN.md — Project setup with TypeScript, Zod, and limits configuration
- [ ] 01-02-PLAN.md — Video spec schema validation (TDD)

**Requirements:**
- OUTP-01: System outputs MP4 video with H.264 encoding
- OUTP-02: User can configure output dimensions (up to 1920x1920)
- OUTP-03: User can configure output fps (1-60, default 30)
- OUTP-04: User can configure total video duration (up to 300s)
- OUTP-05: Rendered video is accessible via URL for download

**Success Criteria:**
1. User submits JSON spec and receives detailed validation errors for invalid fields
2. User can specify output dimensions, fps, and duration in JSON spec
3. System rejects specs exceeding limits (1920x1920, 60fps, 300s) with clear error messages

**Dependencies:** None

---

## Phase 2: Core Rendering

**Goal:** Static frames can be rendered with text elements (styled, shadowed, wrapped), images (fitted, rounded), and shapes (filled, stroked, gradients)

**Requirements:**
- RNDR-01: User can add text elements with font family, size, weight, style, color, alignment
- RNDR-02: User can add text shadow and stroke/outline effects
- RNDR-03: User can add text background with padding and border radius
- RNDR-04: User can set text max width for automatic wrapping
- RNDR-05: User can animate text word-by-word for caption-style reveals
- RNDR-06: User can add image elements from URLs or uploaded assets
- RNDR-07: User can set image fit mode (cover, contain, fill)
- RNDR-08: User can add border radius to images
- RNDR-09: User can add shape elements (rectangle, circle, ellipse, line)
- RNDR-10: User can set shape fill color including linear/radial gradients
- RNDR-11: User can set shape stroke color and width

**Success Criteria:**
1. User can render a frame with styled text (font, size, color, alignment, shadow, stroke, background)
2. User can render a frame with images that respect fit mode (cover/contain/fill) and border radius
3. User can render a frame with shapes (rectangle, circle, ellipse, line) with gradient fills and strokes
4. User can render wrapped text within max-width constraints

**Dependencies:** Phase 1

---

## Phase 3: Animation & Timeline

**Goal:** Elements can be animated with keyframes and easing, scenes can transition smoothly, and videos span multiple scenes

**Requirements:**
- ANIM-01: User can animate element properties with keyframes (position, scale, rotation, opacity)
- ANIM-02: User can specify easing function for animations (12 functions: linear, ease family, bounce, elastic)
- ANIM-03: User can apply enter animation presets (fade, slide, scale, bounce)
- ANIM-04: User can apply exit animation presets (fade, slide, scale, bounce)
- ANIM-05: User can control animation timing with start time and duration
- SCEN-01: User can create multiple scenes with different backgrounds
- SCEN-02: User can set scene duration
- SCEN-03: User can apply transitions between scenes (fade, slide, zoom)
- SCEN-04: User can configure transition duration and easing

**Success Criteria:**
1. User can animate an element from point A to B with custom easing (e.g., bounce, elastic)
2. User can apply enter/exit presets (fade, slide, scale, bounce) to elements with specified timing
3. User can create a multi-scene video where each scene has different content and duration
4. User can apply transitions between scenes (fade, slide, zoom) with configurable duration
5. User can render a complete animated sequence to frame buffers (not yet encoded to video)

**Dependencies:** Phase 2

---

## Phase 4: Video Output

**Goal:** Frame sequences with audio tracks can be encoded into downloadable MP4 videos

**Requirements:**
- AUDI-01: User can add background audio track to video
- AUDI-02: User can control audio volume (0-1)
- AUDI-03: User can apply audio fade in at start
- AUDI-04: User can apply audio fade out at end

**Success Criteria:**
1. User can render a complete video to MP4 file with H.264 encoding
2. User can add background audio with volume control and fade in/out effects
3. Rendered video file is accessible via download URL

**Dependencies:** Phase 3

---

## Phase 5: API Layer

**Goal:** External developers can authenticate, submit render jobs, poll status, receive webhooks, and manage assets

**Requirements:**
- API-01: Developer can authenticate with API key in Authorization header
- API-02: Developer can submit render job via POST /render with JSON spec
- API-03: Developer can poll job status via GET /render/:jobId
- API-04: Developer can receive sync response for short videos (<30s)
- API-05: Developer can configure webhook URL to receive job completion notification
- API-06: Developer can retrieve validation errors for invalid JSON specs
- API-07: Developer is rate-limited based on plan (Free: 10/min, Pro: 60/min)
- ASST-01: Developer can upload image assets via POST /assets
- ASST-02: Developer can upload audio assets via POST /assets
- ASST-03: Developer can reference uploaded assets by ID in render spec
- ASST-04: System caches remote assets during render session

**Success Criteria:**
1. Developer can authenticate with API key and submit a render job via POST /render
2. Developer can poll job status and retrieve completed video via download URL
3. Developer receives webhook notification when job completes (if configured)
4. Developer can upload and reference assets (images, audio) in render specs
5. System enforces rate limits per plan tier (10/min free, 60/min pro)

**Dependencies:** Phase 4

---

## Phase 6: AI Integration

**Goal:** Users can generate valid JSON templates from natural language descriptions and use built-in templates

**Requirements:**
- TMPL-01: User can generate JSON template from natural language description
- TMPL-02: User can specify target platform (TikTok, YouTube, Instagram) in AI generation
- TMPL-03: User can specify video style (energetic, professional, playful) in AI generation
- TMPL-04: AI returns list of {{variables}} requiring user input
- TMPL-05: User can substitute {{variables}} with custom data when rendering
- TMPL-06: User can list available built-in templates via API
- TMPL-07: User can render using built-in template by ID

**Success Criteria:**
1. User can describe a video in natural language and receive a valid JSON template
2. User can specify platform (TikTok/YouTube/Instagram) and style preferences in generation request
3. Generated templates include {{variables}} that user can substitute before rendering
4. User can list and render using built-in starter templates via API

**Dependencies:** Phase 5

---

## Progress

| Phase | Status | Plans |
|-------|--------|-------|
| 1 - Foundation | In Progress | 0/2 |
| 2 - Core Rendering | Pending | 0/0 |
| 3 - Animation & Timeline | Pending | 0/0 |
| 4 - Video Output | Pending | 0/0 |
| 5 - API Layer | Pending | 0/0 |
| 6 - AI Integration | Pending | 0/0 |

---
*Roadmap created: 2026-01-24*
*Last updated: 2026-01-25*
