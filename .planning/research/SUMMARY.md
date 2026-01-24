# Research Summary: GameMotion

**Completed:** 2026-01-24
**Overall Confidence:** HIGH

---

## Executive Summary

GameMotion is a programmatic video generation engine that transforms JSON specifications into rendered MP4 videos. The research reveals a well-established domain with clear technical patterns: JSON-to-video engines follow a consistent architecture of spec parsing -> scene graph construction -> frame-by-frame rendering -> FFmpeg encoding.

**The recommended technical approach:** Build a Node.js service using @napi-rs/canvas for 2D rendering (44% faster than alternatives, zero system dependencies), stream frames to fluent-ffmpeg for video encoding, expose via Fastify REST API, and queue jobs with p-queue. This stack balances performance, developer experience, and operational simplicity. The architecture should follow proven patterns: reusable canvas instances, preloaded assets, memory-efficient FFmpeg streaming, and robust error boundaries.

**The key differentiator is AI-powered template generation.** No competitor (json2video, Creatomate, Shotstack, Remotion) offers first-class natural language to JSON template creation. This is GameMotion's competitive moat. However, this comes with specific risks: AI JSON hallucinations require multi-layer validation, self-healing pipelines, and defensive output sanitization.

**Critical risks to mitigate early:** Memory leaks from improper canvas reuse (use synchronous methods, reuse instances), FFmpeg child process accumulation (explicit cleanup, event listener management), font rendering inconsistencies across platforms (bundle fonts, set FONTCONFIG_PATH), color space mismatches (explicitly specify bt709 for HD content), and audio/video sync drift (constant frame rate, explicit duration). These pitfalls have clear, documented solutions but will cause major production issues if not addressed during initial implementation.

---

## Stack Recommendations

| Component | Choice | Confidence | Key Insight |
|-----------|--------|------------|-------------|
| 2D Rendering | @napi-rs/canvas@0.1.88 | HIGH | 44% faster than skia-canvas, zero system deps, built-in Lottie support |
| Video Encoding | fluent-ffmpeg@2.1.3 + ffmpeg-static@5.2.0 | HIGH | Industry standard; stream frames via stdin for memory efficiency |
| API Framework | Fastify@5.7.1 | HIGH | 2.3x faster than Express, built-in JSON Schema validation aligns with JSON-driven design |
| Job Queue (MVP) | p-queue@8.0.1 | HIGH | In-memory concurrency control, sufficient for 50-100 concurrent jobs |
| Job Queue (Scale) | BullMQ@5.x | MEDIUM | Upgrade when you need persistence, multi-worker, or job scheduling |
| AI Integration | OpenRouter + Zod | HIGH | Multi-model access (Claude, GPT-4, etc.), structured outputs via json_schema |
| Database | Prisma@5.x (SQLite/PostgreSQL) | HIGH | Type-safe ORM, JSON field support for scene configs |
| Runtime | Node.js 22.x LTS | HIGH | Latest LTS, required for Fastify v5 |

**Most important stack decision:** @napi-rs/canvas over alternatives because it's the fastest single-threaded Canvas API implementation, has zero system dependencies (critical for deployment simplicity), and includes Lottie animation support out of the box. The performance advantage (44% faster) directly impacts the "2x realtime rendering" target.

---

## Feature Priorities

### Table Stakes (Must Ship v1)

**Core rendering:**
- Text elements with rich styling (font, size, weight, color, alignment, shadows)
- Image elements with fit modes (cover, contain, fill)
- Basic shapes (rectangle, circle, ellipse, line) with fills and strokes
- Keyframe animation system with 12-15 easing functions
- Enter/exit animation presets (fade, slide, scale, bounce)

**Scene composition:**
- Scene transitions (fade, slide left/right/up/down, zoom)
- Variable substitution (`{{placeholder}}` syntax)
- Platform dimension presets (TikTok 9:16, YouTube 16:9, Instagram 1:1)

**Audio:**
- Background music track with volume control
- Audio fade in/out

**API:**
- REST API with API key authentication
- Async rendering with job polling
- Sync rendering option for short videos
- Rate limiting
- JSON validation with detailed errors

**AI (differentiator):**
- Natural language to JSON template generation
- Auto-generated placeholder suggestions
- Built-in starter templates

### Differentiators (Why Choose GameMotion)

1. **AI template generation from natural language** - Primary competitive moat; no competitor has this
2. **3-10x faster rendering** - Speed advantage from game engine-style rendering techniques
3. **Simple self-hosting** - Single Node.js process vs. Remotion's complex setup
4. **OpenRouter integration** - Access to 400+ models, not locked to one provider

### Gaps Identified (Consider for v1.x or v2)

**High-value additions for early updates:**
- **Webhooks** (v1 or v1.1) - Production integrations strongly prefer webhooks over polling; add simple `webhookUrl` parameter
- **Word-by-word text animation** (v1.1) - High demand for captions/kinetic typography; Creatomate has this
- **Image filters** (v1.1) - Brightness, contrast, saturation; common design need, low implementation effort
- **Additional easing functions** (v1) - Add easeInQuart, easeOutQuart, easeInBack, easeOutBack for parity

**Medium-priority for v2:**
- Text-to-speech voiceover (ElevenLabs integration)
- Multiple audio tracks (voiceover + music)
- Auto-transcription and captions
- Audio ducking (auto-lower music during voiceover)
- Lottie animation support (@napi-rs/canvas has built-in support)

**Anti-features (Don't Build):**
- Browser-based preview/editor - Adds frontend complexity, distracts from API focus
- Video-in-video embedding - Extreme complexity for limited use cases
- 3D animations - Different rendering pipeline, wrong product category
- Custom font upload before v1 - Google Fonts covers 95% of needs

---

## Architecture Highlights

### Build Order (Dependency-Informed Sequence)

**Phase 1: Foundation (Week 1-2)**
1. JSON Schema definition
2. Spec Parser with validation
3. Basic TypeScript types and interfaces

**Phase 2: Core Rendering (Week 3-4)**
1. Canvas setup (@napi-rs/canvas)
2. Element renderers (text, image, shape)
3. Frame Generator orchestration
4. Single frame rendering test

**Phase 3: Timeline & Animation (Week 5-6)**
1. Timeline/Scene Graph model
2. Interpolator with easing functions
3. Scene graph query interface
4. Multi-frame render loop

**Phase 4: Video Output (Week 7-8)**
1. FFmpeg Encoder with streaming
2. Render Pipeline integration
3. Asset Manager with preloading
4. Complete end-to-end test

**Phase 5: API Layer (Week 9-10)**
1. Job Queue (p-queue)
2. REST API endpoints (Fastify)
3. Progress tracking
4. Webhooks (optional but recommended)

**Phase 6: AI Integration (Week 11-12)**
1. OpenRouter client
2. Prompt processing and schema conversion
3. JSON validation and self-healing
4. Template generation endpoint

**Why this order:** Foundation blocks everything. Rendering is the core value - build end-to-end for single frame first, then extend to full timeline. FFmpeg integration is independent and can start in parallel with timeline work. API layer wraps the render pipeline. AI integration is last because it depends on stable JSON schema and rendering validation.

### Key Architectural Pattern

**Scene Graph Pattern:** The timeline is a collection of tracks, each containing non-overlapping clips. Each clip references an element (text, image, shape) with timing (startFrame, endFrame) and animations. The scene graph answers "what elements are visible at frame N?" rather than modeling the entire video statically. This matches Remotion's model: the system is "only aware of the current frame."

**Data Flow:**
```
API Request (JSON)
  -> Validation (Ajv/Zod)
  -> Variable Resolution
  -> Asset Preloading (all images/fonts loaded to memory)
  -> Scene Graph Construction
  -> FFmpeg Process Start
  -> Frame Loop:
       Query visible elements at frame N
       Interpolate properties (animations)
       Render elements to canvas (z-ordered)
       Export PNG buffer
       Write to FFmpeg stdin
  -> FFmpeg Finish
  -> Cleanup
  -> Return video URL
```

**Performance target:** 15-60 seconds total for 30-second 1080p 30fps video (900 frames). Asset preload: 1-5s, frame generation: 5-30s, FFmpeg encoding: 5-20s (parallel).

### Scaling Path

| Scale | Architecture | Trigger for Next |
|-------|--------------|------------------|
| MVP | Single process, p-queue, local files | Queue depth > 10 consistently |
| Growth | Single server, BullMQ + Redis, S3 storage | Single server CPU > 80% |
| Scale | Multiple workers, shared Redis, load balancer | Worker costs, need geographic distribution |

**Key migration points:**
- p-queue -> BullMQ when you need persistence or multiple servers
- Local files -> S3 when disk fills or need CDN delivery
- Single server -> Workers when CPU is bottleneck (render workers scale horizontally)

---

## Critical Pitfalls

### Top 5 to Watch (Must Address in Initial Implementation)

| Pitfall | When It Hits | Prevention | Phase to Address |
|---------|--------------|------------|------------------|
| **Memory leaks in canvas rendering** | Long videos, high volume | Reuse canvas instances; use sync methods (`toBufferSync`); @napi-rs/canvas v1.0.1 has leak with async methods | Phase 2 (Rendering) |
| **FFmpeg child process accumulation** | Concurrent renders | Explicit cleanup: destroy stdin/stdout/stderr, removeAllListeners(), kill on timeout; consume stderr to prevent buffer deadlock | Phase 4 (Video Output) |
| **Font rendering inconsistencies** | Cross-platform (macOS dev, Linux prod) | Bundle fonts, set FONTCONFIG_PATH and PANGOCAIRO_BACKEND env vars, use FontLibrary.use() to register explicitly | Phase 5 (Production) |
| **Color space mismatch** | First render tests | Explicitly specify bt709 color matrix in FFmpeg args for HD content; set `-colorspace bt709 -color_primaries bt709 -color_trc bt709` | Phase 4 (Video Output) |
| **AI JSON hallucinations** | AI template generation | Multi-layer validation: structured output if available, JSON.parse with repair, Zod validation, auto-repair common issues (type coercion, enum mapping, clamping), re-prompt with error context | Phase 6 (AI Integration) |

### Additional Important Pitfalls

**Audio/video sync drift (High)** - Phase 4
- Problem: Audio drifts out of sync, especially in videos >60s
- Solution: Use constant frame rate, add `-af aresample=async=1` for drift correction, explicit duration instead of `-shortest`

**Job timeout handling (Medium)** - Phase 5
- Problem: Fixed timeouts block or kill legitimate long renders
- Solution: Dynamic timeout based on video duration and complexity; graceful shutdown with AbortController

**Prompt injection in user descriptions (Medium)** - Phase 6
- Problem: Malicious users inject instructions into AI prompts
- Solution: Sanitize input (remove instruction markers), structural separation in prompts, validate output content for policy violations

**Disk space exhaustion (Medium)** - Phase 5
- Problem: Disk fills during render, corrupting output
- Solution: Pre-flight disk space check based on estimated output size, periodic cleanup of orphaned temps, output retention policy

**Progress reporting accuracy (Low)** - Phase 5
- Problem: Progress stuck at 99% or jumps backwards
- Solution: Phase-based progress with weights (validating 5%, loading 10%, rendering 70%, encoding 10%, finalizing 5%); never show 100% until truly done

---

## Requirements Implications

**What this research means for requirements definition:**

1. **JSON Schema is foundational** - Requirements must include complete schema definition before coding starts. Schema versioning strategy needed from day 1 (use discriminated union on `version` field).

2. **Asset preloading is non-negotiable** - Requirements must specify that all assets (images, fonts) are validated and preloaded before frame 1 renders. Fail fast if assets are missing.

3. **Memory management is a feature** - Requirements must include memory limits, canvas reuse patterns, and cleanup lifecycle. Not optional performance optimization.

4. **FFmpeg process lifecycle requires explicit design** - Requirements must specify stdin streaming strategy, stderr consumption, graceful shutdown on timeout/cancel, orphan process cleanup.

5. **AI validation is multi-layered** - Requirements must include not just schema validation but auto-repair strategies, re-prompting with context, and output content validation.

6. **Error boundaries are architectural** - Requirements must specify where errors are caught (API input, asset loading, frame rendering, FFmpeg process, job queue) and recovery strategies for each.

7. **Font consistency requires bundled fonts** - Requirements must specify font bundling and registration, not reliance on system fonts.

8. **Color space must be explicit** - Requirements must specify bt709 color matrix for HD output, not FFmpeg defaults.

---

## Roadmap Implications

**What this research means for phase structure:**

### Suggested Phase Structure (6 phases)

**Phase 1: Foundation & Validation**
- JSON Schema with versioning
- Zod/Ajv validation with detailed errors
- Variable substitution engine
- **Rationale:** Everything depends on knowing the contract. Can't build rendering without spec format.
- **Deliverable:** Can validate JSON specs, substitute variables, return detailed errors
- **Pitfalls to avoid:** Schema too complex (progressive disclosure with defaults), validation performance (compile once), breaking changes (version from day 1)

**Phase 2: Core Rendering Engine**
- Canvas setup (@napi-rs/canvas)
- Element renderers (text, image, shape)
- Frame generator orchestration
- Asset manager with preloading
- **Rationale:** The heart of the system. Build end-to-end for single frame before adding complexity.
- **Deliverable:** Can render a single frame PNG from a scene
- **Pitfalls to avoid:** Memory leaks (reuse canvas, sync methods), asset caching (LRU eviction), font inconsistencies (bundle fonts)
- **Features:** Text (PRD table), Image (PRD table), Shapes (PRD table)

**Phase 3: Animation & Timeline**
- Timeline/Scene Graph model
- Interpolator with 15 easing functions
- Keyframe animation system
- Scene transitions
- Enter/exit animation presets
- **Rationale:** Extend from single frame to full video with smooth motion.
- **Deliverable:** Can render multi-frame sequences with animations
- **Pitfalls to avoid:** Animation timing accuracy (0-1 normalized time, correct easing domains), floating-point errors
- **Features:** All PRD animations, easing functions, transitions

**Phase 4: Video Encoding & Output**
- FFmpeg encoder with stdin streaming
- Render pipeline (frame loop -> FFmpeg)
- Audio mixing (background music with fade)
- Complete render job execution
- **Rationale:** Connect frames to video output.
- **Deliverable:** Can produce MP4 files with audio
- **Pitfalls to avoid:** FFmpeg process leaks (explicit cleanup), color space (bt709), audio sync (constant framerate, aresample), backpressure handling
- **Features:** MP4 output, audio track, fade in/out

**Phase 5: API & Job Management**
- Fastify REST API
- p-queue job queue
- Job status polling
- Progress tracking (phase-based)
- Rate limiting (per-endpoint, per-plan)
- Webhooks (recommended)
- **Rationale:** Expose rendering as a service with proper resource management.
- **Deliverable:** Production-ready API for external clients
- **Pitfalls to avoid:** Job timeouts (dynamic based on complexity), progress accuracy (phase weights), rate limiting (by API key not IP)
- **Features:** POST /render, GET /jobs/:id, webhooks, rate limits

**Phase 6: AI Template Generation**
- OpenRouter integration
- Prompt processing
- JSON generation with structured outputs
- Multi-layer validation and auto-repair
- Self-healing pipeline (re-prompt with errors)
- Template library with starter templates
- **Rationale:** The key differentiator. Build on stable foundation.
- **Deliverable:** Can generate video specs from natural language
- **Pitfalls to avoid:** JSON hallucinations (multi-layer validation), token limits (chunked generation), prompt injection (sanitize input)
- **Features:** POST /ai/generate, template library API, placeholder suggestions

### Research Flags

**Phases that need deeper research during planning:**
- **Phase 4:** FFmpeg command construction - test color space settings, audio sync parameters, backpressure handling. Run experiments before finalizing implementation.
- **Phase 6:** AI model selection - benchmark Claude Sonnet 4 vs GPT-4o vs Haiku for template generation quality and cost. May need iteration.

**Phases with well-documented patterns (can skip additional research):**
- **Phase 1:** JSON Schema validation - Ajv and Zod are well-documented
- **Phase 2:** Canvas 2D API - Standard browser API, well-known patterns
- **Phase 3:** Easing functions - Established math, use libraries like bezier-easing
- **Phase 5:** Fastify REST API - Mature framework with extensive docs

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| **Stack** | HIGH | All recommended technologies are production-proven with active maintenance. @napi-rs/canvas benchmarks verified, FFmpeg patterns well-documented, Fastify mature ecosystem. |
| **Features** | HIGH | Feature expectations verified against 4 major competitors (json2video, Creatomate, Shotstack, Remotion). Table stakes clearly defined. Differentiators validated (no competitor has AI generation). |
| **Architecture** | HIGH | Scene graph pattern used by Remotion and Motion Canvas. Frame-by-frame rendering is proven approach. Data flow verified against multiple implementations. Component boundaries clear. |
| **Pitfalls** | HIGH | All critical pitfalls have documented occurrences with GitHub issues, blog posts, or official docs. Prevention strategies verified with working code examples. Phase mapping complete. |

**Overall confidence: HIGH** - This domain has mature patterns and well-documented solutions. The research uncovered no major unknowns or unresolved questions. All critical decision points have clear, evidence-backed recommendations.

### Gaps to Address During Planning

1. **GPU acceleration scope:** Should NVENC hardware encoding be MVP or post-MVP? Optional but provides 3-5x encoding speedup on supported hardware. Recommend post-MVP unless target deployment has known GPU availability.

2. **WebCodecs investigation:** @napi-rs/canvas supports @napi-rs/webcodecs for video encoding. Worth deeper investigation as potential FFmpeg alternative for specific use cases. Low priority.

3. **Memory profiling for 4K:** Need to benchmark memory usage with 4K video frames (3840x2160). May need Node.js heap size tuning or frame pooling. Recommend starting with 1080p cap, test 4K carefully.

4. **Rate limit strategy:** Need to define specific limits per plan tier. Research provides patterns but not specific numbers. Requires business input on abuse scenarios and acceptable load.

5. **Template library content:** AI generation is differentiator, but starter templates are table stakes. Need to define what templates ship with v1 (e.g., "Social Post", "Promo Video", "Caption Video").

---

## Sources Summary

**Research aggregated from 50+ sources across 4 research files:**

### Stack Research (STACK.md)
- @napi-rs/canvas GitHub and npm docs
- fluent-ffmpeg documentation
- Fastify vs Hono performance comparisons
- OpenRouter API reference
- BullMQ and p-queue documentation

### Features Research (FEATURES.md)
- json2video, Creatomate, Shotstack, Remotion API docs
- Competitor feature comparison articles
- GSAP, Remotion animation documentation
- API best practices guides

### Architecture Research (ARCHITECTURE.md)
- Remotion, Motion Canvas, Creatomate architecture
- Entity-Component-System pattern references
- canvas2video implementation
- FFmpeg streaming guides
- BullMQ queue architecture

### Pitfalls Research (PITFALLS.md)
- GitHub issues for skia-canvas, node-canvas, fluent-ffmpeg
- Memory leak debugging articles
- FFmpeg color space documentation
- OWASP LLM security guidelines
- Docker optimization guides

**All sources verified as current (2024-2026) and authoritative.** Research prioritized official documentation, GitHub issues with confirmed solutions, and production engineering blogs from companies solving similar problems.

---

## Ready for Requirements

This research summary provides sufficient foundation to proceed with detailed requirements definition. All major technical decisions have clear recommendations backed by evidence. Risk areas are identified with prevention strategies. Build order is dependency-informed and matches industry patterns.

**Next steps:**
1. Define exact JSON schema with examples
2. Specify API endpoints and contracts
3. Detail element property tables
4. Create test plan for critical pitfalls
5. Define deployment architecture (Docker, env vars, health checks)

**Key questions for requirements phase:**
- What are the specific rate limit numbers per tier?
- What starter templates should ship with v1?
- What's the maximum supported video duration and resolution?
- Should webhooks be in v1 or v1.1?
- What's the output file retention policy?
