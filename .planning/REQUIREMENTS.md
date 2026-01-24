# Requirements: GameMotion

**Defined:** 2026-01-24
**Core Value:** JSON-to-video rendering engine must work reliably — everything else builds on this foundation

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Rendering

- [ ] **RNDR-01**: User can add text elements with font family, size, weight, style, color, alignment
- [ ] **RNDR-02**: User can add text shadow and stroke/outline effects
- [ ] **RNDR-03**: User can add text background with padding and border radius
- [ ] **RNDR-04**: User can set text max width for automatic wrapping
- [ ] **RNDR-05**: User can animate text word-by-word for caption-style reveals
- [ ] **RNDR-06**: User can add image elements from URLs or uploaded assets
- [ ] **RNDR-07**: User can set image fit mode (cover, contain, fill)
- [ ] **RNDR-08**: User can add border radius to images
- [ ] **RNDR-09**: User can add shape elements (rectangle, circle, ellipse, line)
- [ ] **RNDR-10**: User can set shape fill color including linear/radial gradients
- [ ] **RNDR-11**: User can set shape stroke color and width

### Animation

- [ ] **ANIM-01**: User can animate element properties with keyframes (position, scale, rotation, opacity)
- [ ] **ANIM-02**: User can specify easing function for animations (12 functions: linear, ease family, bounce, elastic)
- [ ] **ANIM-03**: User can apply enter animation presets (fade, slide, scale, bounce)
- [ ] **ANIM-04**: User can apply exit animation presets (fade, slide, scale, bounce)
- [ ] **ANIM-05**: User can control animation timing with start time and duration

### Scenes

- [ ] **SCEN-01**: User can create multiple scenes with different backgrounds
- [ ] **SCEN-02**: User can set scene duration
- [ ] **SCEN-03**: User can apply transitions between scenes (fade, slide, zoom)
- [ ] **SCEN-04**: User can configure transition duration and easing

### Audio

- [ ] **AUDI-01**: User can add background audio track to video
- [ ] **AUDI-02**: User can control audio volume (0-1)
- [ ] **AUDI-03**: User can apply audio fade in at start
- [ ] **AUDI-04**: User can apply audio fade out at end

### API

- [ ] **API-01**: Developer can authenticate with API key in Authorization header
- [ ] **API-02**: Developer can submit render job via POST /render with JSON spec
- [ ] **API-03**: Developer can poll job status via GET /render/:jobId
- [ ] **API-04**: Developer can receive sync response for short videos (<30s)
- [ ] **API-05**: Developer can configure webhook URL to receive job completion notification
- [ ] **API-06**: Developer can retrieve validation errors for invalid JSON specs
- [ ] **API-07**: Developer is rate-limited based on plan (Free: 10/min, Pro: 60/min)

### AI & Templates

- [ ] **TMPL-01**: User can generate JSON template from natural language description
- [ ] **TMPL-02**: User can specify target platform (TikTok, YouTube, Instagram) in AI generation
- [ ] **TMPL-03**: User can specify video style (energetic, professional, playful) in AI generation
- [ ] **TMPL-04**: AI returns list of {{variables}} requiring user input
- [ ] **TMPL-05**: User can substitute {{variables}} with custom data when rendering
- [ ] **TMPL-06**: User can list available built-in templates via API
- [ ] **TMPL-07**: User can render using built-in template by ID

### Assets

- [ ] **ASST-01**: Developer can upload image assets via POST /assets
- [ ] **ASST-02**: Developer can upload audio assets via POST /assets
- [ ] **ASST-03**: Developer can reference uploaded assets by ID in render spec
- [ ] **ASST-04**: System caches remote assets during render session

### Output

- [ ] **OUTP-01**: System outputs MP4 video with H.264 encoding
- [ ] **OUTP-02**: User can configure output dimensions (up to 1920x1920)
- [ ] **OUTP-03**: User can configure output fps (1-60, default 30)
- [ ] **OUTP-04**: User can configure total video duration (up to 300s)
- [ ] **OUTP-05**: Rendered video is accessible via URL for download

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Enhanced Audio

- **AUDI-05**: User can add multiple audio tracks
- **AUDI-06**: User can integrate text-to-speech voiceover (ElevenLabs)
- **AUDI-07**: System auto-ducks music during voiceover

### Enhanced Animation

- **ANIM-06**: User can use spring physics for natural bouncy motion
- **ANIM-07**: User can animate along a motion path (bezier curve)
- **ANIM-08**: User can use additional easing functions (quart, back)

### Enhanced Rendering

- **RNDR-12**: User can apply image filters (brightness, contrast, saturation)
- **RNDR-13**: User can add Lottie animation elements
- **RNDR-14**: User can embed video clips within video

### Enhanced API

- **API-08**: Developer can submit batch render jobs
- **API-09**: Developer can request video thumbnail/preview

### Enhanced Templates

- **TMPL-08**: AI generates auto-captions from audio
- **TMPL-09**: User can create responsive templates that adapt to platforms

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Browser-based preview/editor | Adds frontend complexity, distracts from API-first focus |
| Real-time collaboration | Enterprise feature, misaligned with target users |
| Mobile app | Web API is the interface |
| Video-in-video embedding | Extreme complexity for limited use cases |
| 3D animations | Different rendering pipeline, wrong product category |
| Live streaming output | Different product category |
| Redis/BullMQ for MVP | p-queue sufficient, add later if needed |
| Horizontal scaling for MVP | Single instance handles MVP load |
| Custom font upload | Remote font URLs or system fonts cover most needs |
| GPU acceleration for MVP | Software rendering is fast enough initially |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| RNDR-01 | Phase 2 | Pending |
| RNDR-02 | Phase 2 | Pending |
| RNDR-03 | Phase 2 | Pending |
| RNDR-04 | Phase 2 | Pending |
| RNDR-05 | Phase 2 | Pending |
| RNDR-06 | Phase 2 | Pending |
| RNDR-07 | Phase 2 | Pending |
| RNDR-08 | Phase 2 | Pending |
| RNDR-09 | Phase 2 | Pending |
| RNDR-10 | Phase 2 | Pending |
| RNDR-11 | Phase 2 | Pending |
| ANIM-01 | Phase 3 | Pending |
| ANIM-02 | Phase 3 | Pending |
| ANIM-03 | Phase 3 | Pending |
| ANIM-04 | Phase 3 | Pending |
| ANIM-05 | Phase 3 | Pending |
| SCEN-01 | Phase 3 | Pending |
| SCEN-02 | Phase 3 | Pending |
| SCEN-03 | Phase 3 | Pending |
| SCEN-04 | Phase 3 | Pending |
| AUDI-01 | Phase 4 | Pending |
| AUDI-02 | Phase 4 | Pending |
| AUDI-03 | Phase 4 | Pending |
| AUDI-04 | Phase 4 | Pending |
| API-01 | Phase 5 | Pending |
| API-02 | Phase 5 | Pending |
| API-03 | Phase 5 | Pending |
| API-04 | Phase 5 | Pending |
| API-05 | Phase 5 | Pending |
| API-06 | Phase 5 | Pending |
| API-07 | Phase 5 | Pending |
| TMPL-01 | Phase 6 | Pending |
| TMPL-02 | Phase 6 | Pending |
| TMPL-03 | Phase 6 | Pending |
| TMPL-04 | Phase 6 | Pending |
| TMPL-05 | Phase 6 | Pending |
| TMPL-06 | Phase 6 | Pending |
| TMPL-07 | Phase 6 | Pending |
| ASST-01 | Phase 5 | Pending |
| ASST-02 | Phase 5 | Pending |
| ASST-03 | Phase 5 | Pending |
| ASST-04 | Phase 5 | Pending |
| OUTP-01 | Phase 1 | Pending |
| OUTP-02 | Phase 1 | Complete |
| OUTP-03 | Phase 1 | Complete |
| OUTP-04 | Phase 1 | Complete |
| OUTP-05 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 40 total
- Mapped to phases: 40
- Unmapped: 0

---
*Requirements defined: 2026-01-24*
*Last updated: 2026-01-25 after Phase 1 completion*
