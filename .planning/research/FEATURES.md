# Features Research: GameMotion

**Researched:** 2026-01-24
**Domain:** Programmatic video generation
**Overall Confidence:** MEDIUM-HIGH (verified against multiple competitor documentation and current sources)

## Executive Summary

The programmatic video generation market has mature, well-defined feature expectations. Competitors like json2video, Creatomate, Shotstack, and Remotion have established clear table stakes features. GameMotion's PRD covers most essential features but has gaps in advanced text animation, audio capabilities, and image processing that should be considered.

**Key insight:** The AI template generation focus is a genuine differentiator. No major competitor offers first-class AI-powered template creation from natural language descriptions. This is GameMotion's competitive moat.

---

## Feature Categories

### Table Stakes (Must Have)

Users expect these or they leave. Missing any is a dealbreaker.

| Feature | Why Table Stakes | Complexity | Notes |
|---------|-----------------|------------|-------|
| Text elements with styling | Every competitor supports rich text | Medium | Font, size, color, alignment, shadows |
| Image elements with fit modes | Universal expectation | Low | cover, contain, fill modes |
| Basic shapes | Required for backgrounds, overlays | Low | Rectangle, circle, line minimum |
| Keyframe animation | json2video, Creatomate, Remotion all have this | High | Position, scale, rotation, opacity |
| Easing functions | Expected for smooth motion | Medium | 10-15 common easing functions |
| Enter/exit animation presets | Time-saver all competitors offer | Medium | Fade, slide, scale, bounce |
| Scene transitions | Expected for multi-scene videos | Medium | Fade, slide, wipe, zoom |
| Background music support | Basic audio is universal | Low | Single audio track with volume |
| Audio fade in/out | Standard audio feature | Low | Smooth transitions |
| REST API with authentication | All API products have this | Medium | API key based |
| Async rendering with polling | Industry standard | Medium | Job ID + status endpoint |
| Variable substitution | All template systems support | Medium | {{placeholder}} syntax |
| Platform dimension presets | Users expect TikTok, YouTube, Instagram | Low | 9:16, 16:9, 1:1 |
| MP4 H.264 output | Universal format | Low | Industry standard |

### Differentiators (Competitive Advantage)

Features that set you apart. Not expected, but valued.

| Feature | Competitive Value | Complexity | Notes |
|---------|------------------|------------|-------|
| AI template generation from NL | **Primary differentiator** - no competitor has this | High | GameMotion's key value prop |
| 3-10x faster rendering | Speed advantage from skia-canvas approach | High | Game engine technique |
| Simple self-hosting | Simpler than Remotion's complex setup | Medium | Single Node.js process |
| Word-by-word text animation | Valued for captions, kinetic typography | Medium | Creatomate has this, Shotstack doesn't |
| Auto-transcription to subtitles | High demand for accessibility | High | Requires speech-to-text AI |
| Text-to-speech voiceover | Pairs with AI templates naturally | Medium | ElevenLabs integration common |
| Audio ducking | Professional audio mixing | High | Auto-lower music during voiceover |
| Responsive/adaptive templates | Auto-resize for different platforms | High | Creatomate has this |
| Webhook notifications | Preferred over polling for production | Medium | Event-driven architecture |
| Lottie animation support | Rich animations from After Effects | High | Popular in design workflows |

### Anti-Features (Don't Build)

Features that seem good but hurt the product.

| Feature | Why Avoid | Risk |
|---------|----------|------|
| Browser-based preview/editor | Adds frontend complexity, distracts from API focus | Scope creep, infrastructure complexity |
| Video-in-video embedding | Extreme complexity for limited use cases | Development time sink, memory issues |
| 3D animations | Completely different rendering pipeline | Wrong product category |
| Real-time collaboration | Enterprise feature, not API-first | Misaligned with target users |
| Custom font upload before v1 | Google Fonts covers 95% of needs | Pre-optimization |
| GPU acceleration before v1 | skia-canvas is already fast | Premature optimization |
| Horizontal scaling before v1 | Single instance handles MVP load | Over-engineering |

---

## Detailed Feature Analysis

### Category 1: Element Types (Rendering)

**Table stakes:**

| Element | Status in PRD | Competitor Coverage | Notes |
|---------|---------------|---------------------|-------|
| Text | Yes | Universal | All competitors support |
| Image | Yes | Universal | All competitors support |
| Shape (rectangle, circle, ellipse, line) | Yes | Universal | json2video, Creatomate, Shotstack |
| Video clip embedding | No (out of scope) | Common | json2video, Creatomate, Shotstack have it |

**Differentiators:**

| Element | Status in PRD | Competitor Coverage | Recommendation |
|---------|---------------|---------------------|----------------|
| HTML elements | No | json2video has it | Not needed for MVP |
| SVG support | No | Shotstack has SvgAsset | Consider post-MVP |
| Lottie animations | No | Growing demand | High value for v2 |
| Captions/Subtitles element | No | Shotstack has CaptionAsset | High value for v2 |

**Text element features (detail):**

| Feature | PRD Status | Competitor Support | Priority |
|---------|-----------|-------------------|----------|
| Font family | Yes | All | Table stakes |
| Font size | Yes | All | Table stakes |
| Font weight | Yes | All | Table stakes |
| Font style (italic) | Yes | All | Table stakes |
| Color | Yes | All | Table stakes |
| Text alignment | Yes | All | Table stakes |
| Line height | Yes | Most | Table stakes |
| Max width / wrapping | Yes | Most | Table stakes |
| Background color | Yes | Most | Nice to have |
| Padding | Yes | Most | Nice to have |
| Border radius | Yes | Most | Nice to have |
| Text shadow | Yes | Most | Table stakes |
| Text stroke/outline | Yes | Creatomate, Shotstack | Nice to have |
| **Word-by-word reveal** | No | Creatomate | Differentiator |
| **Typewriter effect** | No | json2video | Differentiator |
| **Text along path** | No | Rare | Post-MVP |

**Image element features (detail):**

| Feature | PRD Status | Competitor Support | Priority |
|---------|-----------|-------------------|----------|
| URL source | Yes | All | Table stakes |
| Asset ID source | Yes | All | Table stakes |
| Fit: cover | Yes | All | Table stakes |
| Fit: contain | Yes | All | Table stakes |
| Fit: fill | Yes | All | Table stakes |
| Border radius | Yes | Most | Nice to have |
| **Filters (brightness, contrast, etc.)** | No | Creatomate | Differentiator |
| **Blur effect** | No | Creatomate | Nice to have |
| **Color overlay/tint** | No | Creatomate | Nice to have |
| **Masking** | No | Creatomate | Post-MVP |
| **Chroma key (green screen)** | No | Shotstack | Post-MVP |

**Shape element features (detail):**

| Feature | PRD Status | Competitor Support | Priority |
|---------|-----------|-------------------|----------|
| Rectangle | Yes | All | Table stakes |
| Circle | Yes | All | Table stakes |
| Ellipse | Yes | All | Table stakes |
| Line | Yes | All | Table stakes |
| Fill color | Yes | All | Table stakes |
| Stroke color/width | Yes | All | Table stakes |
| Linear gradient | Yes | Most | Nice to have |
| Radial gradient | Yes | Most | Nice to have |
| Border radius | Yes | Most | Nice to have |
| **Polygon** | No | Shotstack | Post-MVP |
| **Custom SVG path** | No | Shotstack | Post-MVP |

### Category 2: Animation System

**Table stakes:**

| Feature | PRD Status | Competitor Support | Priority |
|---------|-----------|-------------------|----------|
| Keyframe animation | Yes | Creatomate, Remotion | Table stakes |
| Position animation (x, y) | Yes | All | Table stakes |
| Scale animation | Yes | All | Table stakes |
| Rotation animation | Yes | All | Table stakes |
| Opacity animation | Yes | All | Table stakes |
| Easing: linear | Yes | All | Table stakes |
| Easing: ease-in/out family | Yes | All | Table stakes |
| Easing: cubic bezier | Implied | Most | Table stakes |
| Animation presets (fade, slide, scale, bounce) | Yes | Most | Table stakes |
| Enter animations | Yes | All | Table stakes |
| Exit animations | Yes | All | Table stakes |

**Easing functions (recommend 15+ for parity):**

Based on research, the following easing functions are expected:

```
linear
easeIn, easeOut, easeInOut (default quad)
easeInQuad, easeOutQuad, easeInOutQuad
easeInCubic, easeOutCubic, easeInOutCubic
easeInQuart, easeOutQuart, easeInOutQuart
easeInElastic, easeOutElastic
easeInBounce, easeOutBounce
easeInBack, easeOutBack (overshoot)
```

**PRD Gap:** PRD lists 12 easing functions. Recommend adding:
- `easeInQuart`, `easeOutQuart`, `easeInOutQuart`
- `easeInBack`, `easeOutBack` (popular overshoot effect)

**Differentiators:**

| Feature | PRD Status | Competitor Support | Priority |
|---------|-----------|-------------------|----------|
| **Spring physics** | No | Remotion has spring() | Differentiator |
| **Motion path (bezier curve)** | No | After Effects, limited in APIs | Post-MVP |
| **Stagger/sequence animations** | Implicit | Remotion | Nice to have |
| **Animation delay** | Implicit via start time | Most | Table stakes |

### Category 3: Scene Transitions

**Table stakes:**

| Transition | PRD Status | Competitor Support | Priority |
|------------|-----------|-------------------|----------|
| None (cut) | Implicit | All | Table stakes |
| Fade (cross-dissolve) | Yes | All | Table stakes |
| Slide left/right/up/down | Yes | All | Table stakes |
| Zoom | Yes | Most | Table stakes |

**Nice to have:**

| Transition | PRD Status | Competitor Support | Priority |
|------------|-----------|-------------------|----------|
| Wipe | No | Shotstack | Nice to have |
| Push (slide where both scenes move) | No | Common | Nice to have |
| Reveal | No | Shotstack | Post-MVP |
| Carousel | No | Shotstack | Post-MVP |

**PRD is adequate** for MVP transitions. The 6 listed (none, fade, slideLeft, slideRight, slideUp, slideDown, zoom) cover primary use cases.

### Category 4: Audio Features

**Table stakes:**

| Feature | PRD Status | Competitor Support | Priority |
|---------|-----------|-------------------|----------|
| Background music track | Yes | All | Table stakes |
| Volume control | Yes | All | Table stakes |
| Fade in | Yes | Most | Table stakes |
| Fade out | Yes | Most | Table stakes |

**Gaps in PRD (consider for v1 or v2):**

| Feature | PRD Status | Competitor Support | Value | Complexity |
|---------|-----------|-------------------|-------|------------|
| **Multiple audio tracks** | No | Creatomate, Shotstack | High | Medium |
| **Audio ducking** | No | Filmora, Premiere (not APIs) | High | High |
| **Sound effects layer** | No | Some competitors | Medium | Medium |
| **Voiceover sync** | No | json2video (TTS built-in) | High | Medium |
| **Text-to-speech** | No | json2video, Fliki | Differentiator | Medium |
| **Audio looping** | No | Most | Low | Low |

**Recommendation:** For v1, single audio track with volume + fade is sufficient. For v2, prioritize:
1. Multiple audio tracks
2. Text-to-speech integration (ElevenLabs)
3. Audio ducking for voiceover scenarios

### Category 5: API Features

**Table stakes:**

| Feature | PRD Status | Competitor Support | Priority |
|---------|-----------|-------------------|----------|
| REST API | Yes | All | Table stakes |
| API key authentication | Yes | All | Table stakes |
| Async rendering | Yes | All | Table stakes |
| Job status polling | Yes | All | Table stakes |
| Rate limiting | Yes | All | Table stakes |
| Sync rendering (short videos) | Yes | Creatomate Direct API | Nice to have |
| JSON validation with errors | Yes (Zod) | All | Table stakes |

**Gaps (consider for v1 or v2):**

| Feature | PRD Status | Competitor Support | Value | Complexity |
|---------|-----------|-------------------|-------|------------|
| **Webhooks** | No | Shotstack, Creatomate | High | Medium |
| **Batch rendering** | No | Shotstack | Medium | Medium |
| **Template endpoints** | Yes (basic) | All | Table stakes | Low |
| **Video preview/thumbnail** | No | Some | Medium | Low |

**Webhook recommendation:** Strongly recommend webhooks for v1 or early v2. Production integrations prefer webhooks over polling. Add a simple `webhookUrl` parameter to render requests.

### Category 6: AI & Template Features

**GameMotion's Differentiator**

| Feature | PRD Status | Competitor Support | Notes |
|---------|-----------|-------------------|-------|
| **AI template generation from NL** | Yes | **None have this** | Primary differentiator |
| Variable substitution ({{placeholder}}) | Yes | All | Table stakes |
| Built-in starter templates | Yes | All | Table stakes |
| Platform presets (TikTok, YouTube, etc.) | Yes | All | Table stakes |

**AI Integration Opportunities:**

| Feature | PRD Status | Value | Complexity |
|---------|-----------|-------|------------|
| Template generation from description | Yes | Core value | High |
| Auto-generated placeholder suggestions | Yes | Nice | Medium |
| **Style transfer/mood detection** | No | Differentiator | High |
| **Auto-scene generation** | No | Future | Very High |
| **Auto-image selection** | No | Future | High |

**Template System Comparison:**

| Vendor | Template Approach |
|--------|-------------------|
| json2video | JSON templates with variables, visual editor |
| Creatomate | Responsive templates, cloud editor, JSON or visual |
| Shotstack | JSON templates with merge fields |
| Remotion | React components as templates |
| **GameMotion** | JSON templates + AI generation |

---

## Competitor Comparison Matrix

### Element Support

| Feature | json2video | Remotion | Creatomate | Shotstack | GameMotion (proposed) |
|---------|-----------|----------|------------|-----------|----------------------|
| Text | Yes | Yes | Yes | Yes | Yes |
| Image | Yes | Yes | Yes | Yes | Yes |
| Video clips | Yes | Yes | Yes | Yes | No (v1) |
| Shapes | Yes | Via React | Yes | Yes | Yes |
| HTML elements | Yes | Yes | No | Yes | No |
| SVG | Limited | Yes | No | Yes | No |
| Lottie | No | Yes | No | No | No (v2?) |
| Audio | Yes | Yes | Yes | Yes | Yes |

### Animation Capabilities

| Feature | json2video | Remotion | Creatomate | Shotstack | GameMotion (proposed) |
|---------|-----------|----------|------------|-----------|----------------------|
| Keyframes | Basic | Full | Full | Basic | Yes |
| Easing functions | Limited | Full (20+) | Full | Limited | Yes (12-15) |
| Enter/exit presets | Yes | DIY | Yes | Limited | Yes |
| Spring physics | No | Yes | No | No | No (consider v2) |
| Motion paths | No | DIY | No | No | No |
| Word-by-word text | Yes | DIY | Yes | No | No (consider) |

### API Features

| Feature | json2video | Remotion | Creatomate | Shotstack | GameMotion (proposed) |
|---------|-----------|----------|------------|-----------|----------------------|
| REST API | Yes | No (library) | Yes | Yes | Yes |
| Webhooks | Yes | N/A | Yes | Yes | No (add) |
| Sync mode | No | N/A | Yes (Direct API) | No | Yes |
| Templates API | Yes | N/A | Yes | Yes | Yes |
| Asset management | Yes | N/A | Yes | Yes | Yes |

### AI Features

| Feature | json2video | Remotion | Creatomate | Shotstack | GameMotion (proposed) |
|---------|-----------|----------|------------|-----------|----------------------|
| AI template gen | No | No | No | No | **Yes** |
| TTS voiceover | Yes (built-in) | No | Via API | Yes | No (v2) |
| Auto captions | No | No | Yes | Yes | No (v2) |
| AI image gen | No | No | Yes | Yes | No |

### Pricing Model

| Vendor | Model | Starting Price |
|--------|-------|----------------|
| json2video | Per minute | $14.95/mo for 600 min |
| Remotion | Per license + render | $149-749 one-time |
| Creatomate | Per minute | $39/mo for 300 min |
| Shotstack | Per minute | $49/mo for 200 min |
| **GameMotion** | TBD | Self-hostable + hosted option |

---

## Feature Dependencies

```
Foundation (Week 1-2)
├── JSON Schema & Validation
└── Variable Substitution

Rendering Core (Week 3-4)
├── Canvas Setup (skia-canvas)
├── Element Renderers
│   ├── Text Element
│   ├── Image Element (depends on Asset Loading)
│   └── Shape Element
├── Transform System
└── Asset Loading
    └── FFmpeg Integration

Animation System (Week 5-6)
├── Easing Functions Library
├── Keyframe Interpolation (depends on Easing)
├── Animation Presets (depends on Keyframes)
│   ├── Enter Animations
│   └── Exit Animations
└── Scene Transitions (depends on Render Loop)

API Layer (Week 7-8)
├── REST API (Fastify)
├── Authentication
├── Rate Limiting
├── Job Queue (p-queue)
└── AI Integration
    ├── OpenRouter Client
    └── Template Generator (depends on JSON Schema)
```

---

## Gaps in PRD

Features not in the PRD that should be considered:

### High Priority (Consider for v1)

| Feature | Why Important | Effort |
|---------|---------------|--------|
| **Webhooks** | Production integrations strongly prefer webhooks over polling | Medium |
| **Word-by-word text animation** | High demand for captions/subtitles style | Medium |
| **Image filters (brightness, contrast)** | Common design need | Low |
| **Additional easing functions** | Parity with competitors | Low |

### Medium Priority (v1.x or v2)

| Feature | Why Important | Effort |
|---------|---------------|--------|
| **Text-to-speech integration** | Natural pairing with AI templates | Medium |
| **Multiple audio tracks** | Common use case (voiceover + music) | Medium |
| **Auto-transcription/captions** | Accessibility, engagement | High |
| **Audio ducking** | Professional audio mixing | High |
| **Lottie animation support** | Design workflow integration | High |

### Lower Priority (v2+)

| Feature | Why Important | Effort |
|---------|---------------|--------|
| Video clip embedding | Common but complex | Very High |
| SVG path support | Advanced shapes | Medium |
| Spring physics animation | Remotion has this | Medium |
| Motion paths | After Effects parity | High |

---

## Recommendations Summary

### For MVP (v1)

1. **Keep** all features currently in PRD - they align with table stakes
2. **Add** webhooks endpoint for job completion
3. **Add** 3-4 more easing functions for parity
4. **Consider** word-by-word text animation (high value, medium effort)

### For Early Updates (v1.x)

1. Text-to-speech voiceover (ElevenLabs integration)
2. Multiple audio tracks
3. Image filters (brightness, contrast, saturation)
4. Batch rendering endpoint

### For v2

1. Auto-transcription and captions
2. Audio ducking
3. Lottie animation support
4. Video clip embedding
5. Spring physics animation

---

## Sources

### Competitor Documentation
- [JSON2Video API Documentation](https://json2video.com/docs/api/)
- [Creatomate JSON Introduction](https://creatomate.com/docs/json/introduction)
- [Shotstack API Reference](https://shotstack.io/docs/api/)
- [Remotion Animation Documentation](https://www.remotion.dev/docs/animating-properties)

### Feature Comparisons
- [Creatomate vs Shotstack Alternative](https://creatomate.com/compare/shotstack-alternative)
- [Best Video Generation APIs - Plainly](https://www.plainlyvideos.com/blog/best-video-editing-api)
- [Best Video Generation APIs - Creatomate](https://creatomate.com/blog/the-best-video-generation-apis)

### Animation & Easing
- [GSAP Keyframes Documentation](https://gsap.com/resources/keyframes/)
- [Remotion Easing Documentation](https://www.remotion.dev/docs/easing)
- [Remotion interpolate() Documentation](https://www.remotion.dev/docs/interpolate)

### API Best Practices
- [Shotstack Webhooks Guide](https://shotstack.io/docs/guide/architecting-an-application/webhooks/)
- [Creatomate Webhook Setup](https://creatomate.com/docs/api/reference/set-up-a-webhook)
- [API Rate Limiting Best Practices](https://zuplo.com/learning-center/10-best-practices-for-api-rate-limiting-in-2025)

### Audio Features
- [Aimi Sync API for Video Audio](https://aimi.fm/sync/api/)
- [Creatomate AI Voiceover Integration](https://creatomate.com/blog/how-to-create-voice-over-videos-using-an-api)
- [JSON2Video ElevenLabs Integration](https://json2video.com/docs/v2/api-reference/ai-integrations/elevenlabs)

### AI Video Tools
- [Fliki AI Features](https://fliki.ai/features)
- [Synthesia Features](https://www.synthesia.io/features)
- [ElevenLabs TTS API](https://elevenlabs.io/docs/api-reference/text-to-speech)
