# Product Requirements Document (PRD)
# GameMotion: AI-First JSON Video Rendering Engine

**Version:** 2.0  
**Status:** Draft  
**Author:** Narcis  
**Date:** January 2026  
**Last Updated:** January 22, 2026

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Goals & Success Metrics](#3-goals--success-metrics)
4. [Target Users](#4-target-users)
5. [Product Overview](#5-product-overview)
6. [Technical Architecture](#6-technical-architecture)
7. [JSON Schema Specification](#7-json-schema-specification)
8. [API Specification](#8-api-specification)
9. [AI Integration](#9-ai-integration)
10. [Non-Functional Requirements](#10-non-functional-requirements)
11. [Implementation Plan](#11-implementation-plan)
12. [Risks & Mitigations](#12-risks--mitigations)
13. [Future Considerations](#13-future-considerations)

---

## 1. Executive Summary

### 1.1 Vision

GameMotion is a high-performance, JSON-driven video rendering engine that enables content creators and marketers to generate professional videos programmatically. Unlike existing solutions that rely on browser-based rendering (Remotion) or complex proprietary schemas (json2video), GameMotion uses game engine techniques for 3-10x faster rendering while providing AI-powered template generation via natural language descriptions.

### 1.2 Value Proposition

**"Describe your video in words, get a professional MP4 in seconds."**

- **For Content Creators:** No coding required. Describe what you want, AI generates the template.
- **For Developers:** Simple JSON API, predictable rendering, easy integration.
- **For Businesses:** Cost-effective at scale, self-hostable, no per-minute fees.

### 1.3 Key Differentiators

| Feature | json2video | Remotion | GameMotion |
|---------|------------|----------|------------|
| Rendering Speed | Baseline | 0.5-1x | 3-10x faster |
| Template Format | Proprietary JSON | React/JSX | Universal JSON |
| AI Generation | None | None | First-class |
| Memory Usage | ~200MB | ~500MB | ~50-100MB |
| Self-Hostable | No | Yes (complex) | Yes (simple) |
| Infrastructure | Complex | Chrome + Lambda | Single Node.js process |

---

## 2. Problem Statement

### 2.1 Current Market Pain Points

1. **High Technical Barrier:** Existing programmatic video tools require developers to learn complex schemas or React.

2. **Slow Rendering:** Browser-based solutions (Remotion, Puppeteer-based) are slow due to DOM overhead and screenshot-based frame capture.

3. **Expensive at Scale:** Credit-based pricing models (json2video: $0.25/min, Creatomate: $0.38/min) become prohibitive for high-volume users.

4. **No AI Integration:** No existing solution offers AI-powered template generation from natural language.

5. **Over-engineered Infrastructure:** Most solutions require Redis, message queues, and complex orchestration for basic functionality.

### 2.2 Opportunity

The programmatic video generation market is projected to reach $2.56B by 2032. Content creators produce 500M+ videos daily for social media. There's a gap for a solution that is:
- Fast (game engine approach)
- Simple (JSON-based, minimal infrastructure)
- Smart (AI-powered)
- Affordable (self-hostable or fair pricing)

---

## 3. Goals & Success Metrics

### 3.1 MVP Goals

| Goal | Description | Timeline |
|------|-------------|----------|
| **G1** | Functional rendering engine that outputs MP4 from JSON | Week 6 |
| **G2** | AI template generation from text descriptions | Week 8 |
| **G3** | Public API with authentication | Week 9 |
| **G4** | 10 beta users actively using the product | Week 10 |

### 3.2 Success Metrics (KPIs)

| Metric | Target (MVP) | Target (6 months) |
|--------|--------------|-------------------|
| Render time (30s video @1080p) | < 15 seconds | < 10 seconds |
| API uptime | 99% | 99.9% |
| AI template accuracy | 70% usable | 85% usable |
| Active users | 10 beta | 100 paying |
| Videos rendered/day | 50 | 1,000 |

### 3.3 Non-Goals (Out of Scope for MVP)

- Browser-based preview/editor
- Real-time collaboration
- Mobile app
- Video-in-video (embedded videos)
- 3D animations
- Live streaming output
- Redis/BullMQ job queue (use simple in-memory queue)
- Horizontal scaling (single instance for MVP)

---

## 4. Target Users

### 4.1 Primary Persona: Content Creator (Maya)

**Demographics:**
- Age: 25-35
- Role: Social media manager, YouTuber, TikToker
- Technical skill: Low-medium
- Budget: $50-200/month for tools

**Pain Points:**
- Spends 2-3 hours per video in traditional editors
- Can't code but needs automated video creation
- Wants consistency across multiple videos

**Jobs to be Done:**
- Create 5-10 social media videos per week
- Maintain brand consistency
- Batch-produce video variations

### 4.2 Secondary Persona: Developer (Alex)

**Demographics:**
- Age: 28-40
- Role: Full-stack developer, SaaS builder
- Technical skill: High
- Budget: Usage-based or self-hosted

**Pain Points:**
- Existing APIs are expensive at scale
- Remotion is complex to set up and maintain
- Needs to integrate video generation into product

**Jobs to be Done:**
- Add video generation to their SaaS product
- Automate video creation pipeline
- Control costs at scale

---

## 5. Product Overview

### 5.1 Core Features (MVP)

#### F1: JSON-to-Video Rendering Engine
- Accept JSON specification
- Render to MP4 (H.264)
- Support: images, text, shapes, solid colors
- Basic animations: fade, slide, scale, rotate
- Transitions between scenes
- Audio track (background music)

#### F2: AI Template Generation
- Natural language input → JSON template output
- Support for common video types (promo, testimonial, explainer)
- Platform-aware (TikTok 9:16, YouTube 16:9, Instagram 1:1)
- Placeholder detection for dynamic content

#### F3: REST API
- Authentication (API keys)
- Synchronous rendering for short videos (<30s)
- Async rendering with polling for longer videos
- Rate limiting

#### F4: Asset Management
- Upload images, audio files
- Font management (Google Fonts + custom)
- Local file caching

### 5.2 User Flows

#### Flow 1: Render from JSON (Developer)
```
1. Developer creates JSON spec manually or programmatically
2. POST /api/v1/render with JSON body
3. For short videos: receive MP4 URL immediately
4. For long videos: receive job_id, poll for completion
5. Download MP4 from returned URL
```

#### Flow 2: AI-Generated Template (Creator)
```
1. User describes video: "30-second promo for fitness app, energetic, for TikTok"
2. POST /api/v1/ai/generate with description
3. Receive JSON template with placeholders
4. User fills in placeholders (app name, features, etc.)
5. POST /api/v1/render with completed JSON
6. Receive MP4
```

---

## 6. Technical Architecture

### 6.1 Simplified Architecture (MVP)

```
┌─────────────────────────────────────────────────────────────────────┐
│                           CLIENTS                                    │
│              (API consumers, curl, Postman)                         │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTPS
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     SINGLE NODE.JS SERVER                            │
│                       (Fastify + TypeScript)                        │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                      API Layer                               │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────────┐   │   │
│  │  │  Auth   │ │  Rate   │ │ Validate│ │     Routes      │   │   │
│  │  │Middleware│ │ Limiter │ │  (Zod)  │ │ /render /ai/gen │   │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│  ┌───────────────────────────┼───────────────────────────────────┐  │
│  │                    Service Layer                               │  │
│  │                           │                                    │  │
│  │  ┌────────────────────────┼────────────────────────────────┐  │  │
│  │  │              In-Memory Job Queue (p-queue)              │  │  │
│  │  │                   concurrency: 2                        │  │  │
│  │  └────────────────────────┬────────────────────────────────┘  │  │
│  │                           │                                    │  │
│  │         ┌─────────────────┼─────────────────┐                 │  │
│  │         ▼                 ▼                 ▼                 │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐       │  │
│  │  │   Render    │  │     AI      │  │     Asset       │       │  │
│  │  │   Service   │  │   Service   │  │    Service      │       │  │
│  │  │             │  │ (OpenRouter)│  │  (Local FS)     │       │  │
│  │  └──────┬──────┘  └─────────────┘  └─────────────────┘       │  │
│  │         │                                                     │  │
│  │         ▼                                                     │  │
│  │  ┌─────────────────────────────────────────────────────────┐ │  │
│  │  │                  Render Pipeline                         │ │  │
│  │  │  JSON → Parse → Load Assets → Render Frames → Encode    │ │  │
│  │  │                    (skia-canvas)        (FFmpeg)        │ │  │
│  │  └─────────────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│  ┌───────────────────────────┼───────────────────────────────────┐  │
│  │                    Data Layer                                  │  │
│  │         ┌─────────────────┼─────────────────┐                 │  │
│  │         ▼                 ▼                 ▼                 │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐       │  │
│  │  │  SQLite/    │  │   Local     │  │    Output       │       │  │
│  │  │  PostgreSQL │  │   Assets    │  │    Videos       │       │  │
│  │  │  (jobs,     │  │   /assets   │  │   /outputs      │       │  │
│  │  │   users)    │  │             │  │                 │       │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘       │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2 Technology Stack (Simplified)

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Runtime** | Node.js 20+ / Bun | Ecosystem, performance |
| **API Framework** | Fastify | Fast, TypeScript-native |
| **Job Queue** | p-queue (in-memory) | Zero dependencies, sufficient for MVP |
| **Database** | SQLite (dev) / PostgreSQL (prod) | Simple, no setup needed |
| **2D Rendering** | skia-canvas | Fast, GPU-capable |
| **Video Encoding** | FFmpeg (binary) | Industry standard |
| **AI Provider** | OpenRouter | Multi-model, cost-effective |
| **Storage** | Local filesystem (MVP) → S3 (later) | Simplicity first |

### 6.3 Render Pipeline Detail

```
┌─────────────────────────────────────────────────────────────────┐
│                      RENDER PIPELINE                             │
│                                                                  │
│  Input: VideoSpec JSON + Variables                              │
│  Output: MP4 file path                                          │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ STEP 1: PARSE & VALIDATE                                   │ │
│  │                                                            │ │
│  │  • Parse JSON input                                        │ │
│  │  • Validate against Zod schema                             │ │
│  │  • Substitute {{variables}} with data                      │ │
│  │  • Calculate total frames = duration × fps                 │ │
│  │  • Build internal scene graph                              │ │
│  └────────────────────────────────────────────────────────────┘ │
│                           │                                      │
│                           ▼                                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ STEP 2: LOAD ASSETS                                        │ │
│  │                                                            │ │
│  │  • Download remote images (parallel, with cache)           │ │
│  │  • Load fonts (Google Fonts API or local)                  │ │
│  │  • Validate audio file exists                              │ │
│  │  • Store in /tmp for render session                        │ │
│  └────────────────────────────────────────────────────────────┘ │
│                           │                                      │
│                           ▼                                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ STEP 3: RENDER LOOP                                        │ │
│  │                                                            │ │
│  │  for (frame = 0; frame < totalFrames; frame++) {           │ │
│  │                                                            │ │
│  │    // Calculate current time                               │ │
│  │    time = frame / fps                                      │ │
│  │                                                            │ │
│  │    // Clear canvas with background                         │ │
│  │    canvas.fillStyle = scene.background                     │ │
│  │    canvas.fillRect(0, 0, width, height)                    │ │
│  │                                                            │ │
│  │    // Render each visible element                          │ │
│  │    for (element of getVisibleElements(time)) {             │ │
│  │      transform = interpolateKeyframes(element, time)       │ │
│  │      canvas.save()                                         │ │
│  │      applyTransform(canvas, transform)                     │ │
│  │      renderElement(canvas, element)                        │ │
│  │      canvas.restore()                                      │ │
│  │    }                                                       │ │
│  │                                                            │ │
│  │    // Send frame to FFmpeg                                 │ │
│  │    ffmpeg.stdin.write(canvas.toBuffer('raw'))             │ │
│  │  }                                                         │ │
│  └────────────────────────────────────────────────────────────┘ │
│                           │                                      │
│                           ▼                                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ STEP 4: ENCODE (FFmpeg)                                    │ │
│  │                                                            │ │
│  │  ffmpeg                                                    │ │
│  │    -f rawvideo -pix_fmt rgba                               │ │
│  │    -s {width}x{height} -r {fps}                            │ │
│  │    -i pipe:0                          # video from stdin   │ │
│  │    -i {audio.mp3}                     # audio track        │ │
│  │    -c:v libx264 -preset fast -crf 23  # H.264 encoding    │ │
│  │    -c:a aac -shortest                 # AAC audio          │ │
│  │    -movflags +faststart               # web optimization   │ │
│  │    output.mp4                                              │ │
│  └────────────────────────────────────────────────────────────┘ │
│                           │                                      │
│                           ▼                                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ STEP 5: OUTPUT                                             │ │
│  │                                                            │ │
│  │  • Move MP4 to /outputs/{job_id}.mp4                       │ │
│  │  • Update job status in database                           │ │
│  │  • Return URL: /outputs/{job_id}.mp4                       │ │
│  │  • Cleanup temp files                                      │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 6.4 Data Models

```typescript
// ============================================
// DATABASE SCHEMA (Prisma)
// ============================================

// User model
model User {
  id            String   @id @default(uuid())
  email         String   @unique
  apiKey        String   @unique
  apiKeyHash    String
  plan          Plan     @default(FREE)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  
  jobs          Job[]
  assets        Asset[]
  templates     Template[]
}

enum Plan {
  FREE
  PRO
  BUSINESS
}

// Render Job model
model Job {
  id            String    @id @default(uuid())
  userId        String
  user          User      @relation(fields: [userId], references: [id])
  
  status        JobStatus @default(PENDING)
  spec          Json      // VideoSpec JSON
  variables     Json?     // Variable substitution data
  
  outputPath    String?
  errorMessage  String?
  renderTimeMs  Int?
  
  createdAt     DateTime  @default(now())
  startedAt     DateTime?
  completedAt   DateTime?
}

enum JobStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

// Asset model (uploaded files)
model Asset {
  id            String   @id @default(uuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id])
  
  type          AssetType
  filename      String
  path          String   // local path
  sizeBytes     Int
  mimeType      String
  
  createdAt     DateTime @default(now())
}

enum AssetType {
  IMAGE
  AUDIO
  FONT
}

// Template model (saved/AI-generated templates)
model Template {
  id            String   @id @default(uuid())
  userId        String?  // null = public template
  user          User?    @relation(fields: [userId], references: [id])
  
  name          String
  description   String?
  category      String
  platform      String[] // ['tiktok', 'youtube', 'instagram']
  spec          Json     // VideoSpec JSON
  variables     String[] // extracted {{placeholder}} names
  isPublic      Boolean  @default(false)
  usageCount    Int      @default(0)
  
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

### 6.5 Directory Structure

```
gamemotion/
├── src/
│   ├── index.ts                 # Entry point
│   ├── config/
│   │   └── index.ts             # Environment config
│   ├── api/
│   │   ├── routes/
│   │   │   ├── render.ts        # POST /render, GET /render/:id
│   │   │   ├── ai.ts            # POST /ai/generate
│   │   │   ├── assets.ts        # POST /assets, GET /assets
│   │   │   └── templates.ts     # GET /templates
│   │   ├── middleware/
│   │   │   ├── auth.ts          # API key validation
│   │   │   ├── rateLimit.ts     # Rate limiting
│   │   │   └── validate.ts      # Request validation
│   │   └── index.ts             # Fastify app setup
│   ├── services/
│   │   ├── render/
│   │   │   ├── RenderService.ts # Main render orchestrator
│   │   │   ├── SceneGraph.ts    # Scene graph builder
│   │   │   ├── Renderer.ts      # Canvas rendering
│   │   │   ├── Encoder.ts       # FFmpeg wrapper
│   │   │   └── elements/
│   │   │       ├── TextElement.ts
│   │   │       ├── ImageElement.ts
│   │   │       └── ShapeElement.ts
│   │   ├── ai/
│   │   │   ├── OpenRouterClient.ts
│   │   │   ├── TemplateGenerator.ts
│   │   │   └── prompts/
│   │   │       └── templateGeneration.ts
│   │   ├── assets/
│   │   │   └── AssetService.ts
│   │   └── queue/
│   │       └── JobQueue.ts      # p-queue wrapper
│   ├── schemas/
│   │   ├── videoSpec.ts         # Zod schemas
│   │   └── api.ts               # API request/response schemas
│   ├── utils/
│   │   ├── easing.ts            # Easing functions
│   │   ├── interpolate.ts       # Keyframe interpolation
│   │   ├── fonts.ts             # Google Fonts loader
│   │   └── variables.ts         # {{placeholder}} substitution
│   └── db/
│       ├── client.ts            # Prisma client
│       └── migrations/
├── prisma/
│   └── schema.prisma
├── assets/                      # User uploaded assets
├── outputs/                     # Rendered videos
├── templates/                   # Built-in templates JSON
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── README.md
```

---

## 7. JSON Schema Specification

### 7.1 Complete VideoSpec Schema

```typescript
// ============================================
// VIDEO SPEC SCHEMA (TypeScript + Zod)
// ============================================

import { z } from 'zod';

// Color: hex string or gradient
const ColorSchema = z.union([
  z.string().regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/),
  z.object({
    type: z.enum(['linear', 'radial']),
    angle: z.number().optional(), // for linear
    stops: z.array(z.object({
      offset: z.number().min(0).max(1),
      color: z.string()
    }))
  })
]);

// Easing function names
const EasingSchema = z.enum([
  'linear',
  'easeIn', 'easeOut', 'easeInOut',
  'easeInQuad', 'easeOutQuad', 'easeInOutQuad',
  'easeInCubic', 'easeOutCubic', 'easeInOutCubic',
  'easeInElastic', 'easeOutElastic',
  'easeInBounce', 'easeOutBounce'
]);

// Keyframe value
const KeyframeValueSchema = z.object({
  time: z.number().min(0).max(1), // 0-1 percentage
  value: z.number(),
  easing: EasingSchema.optional()
});

// Keyframes (animated value)
const KeyframesSchema = z.object({
  values: z.array(KeyframeValueSchema).min(2)
});

// Animatable value: static or keyframed
const AnimatableNumber = z.union([z.number(), KeyframesSchema]);

// Animation preset
const AnimationSchema = z.object({
  type: z.enum(['fade', 'slide', 'scale', 'bounce']),
  duration: z.number().min(0.1).max(5),
  direction: z.enum(['left', 'right', 'up', 'down']).optional(),
  easing: EasingSchema.optional()
});

// Shadow
const ShadowSchema = z.object({
  color: z.string(),
  blur: z.number().min(0),
  offsetX: z.number(),
  offsetY: z.number()
});

// Base element (shared properties)
const BaseElementSchema = z.object({
  id: z.string().optional(),
  x: AnimatableNumber,
  y: AnimatableNumber,
  width: AnimatableNumber.optional(),
  height: AnimatableNumber.optional(),
  scale: AnimatableNumber.optional().default(1),
  rotation: AnimatableNumber.optional().default(0),
  opacity: AnimatableNumber.optional().default(1),
  anchorX: z.number().min(0).max(1).optional().default(0.5),
  anchorY: z.number().min(0).max(1).optional().default(0.5),
  start: z.number().min(0).optional().default(0),
  duration: z.number().min(0).optional(),
  enter: AnimationSchema.optional(),
  exit: AnimationSchema.optional()
});

// Text element
const TextElementSchema = BaseElementSchema.extend({
  type: z.literal('text'),
  text: z.string(),
  fontFamily: z.string().optional().default('Inter'),
  fontSize: z.number().min(1).optional().default(32),
  fontWeight: z.number().min(100).max(900).optional().default(400),
  fontStyle: z.enum(['normal', 'italic']).optional().default('normal'),
  color: ColorSchema.optional().default('#ffffff'),
  backgroundColor: ColorSchema.optional(),
  padding: z.number().optional(),
  borderRadius: z.number().optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional().default('left'),
  lineHeight: z.number().optional().default(1.2),
  maxWidth: z.number().optional(),
  shadow: ShadowSchema.optional(),
  stroke: z.object({
    color: z.string(),
    width: z.number()
  }).optional()
});

// Image element
const ImageElementSchema = BaseElementSchema.extend({
  type: z.literal('image'),
  src: z.string(), // URL or "asset:{id}"
  fit: z.enum(['cover', 'contain', 'fill', 'none']).optional().default('cover'),
  borderRadius: z.number().optional()
});

// Shape element
const ShapeElementSchema = BaseElementSchema.extend({
  type: z.literal('shape'),
  shape: z.enum(['rectangle', 'circle', 'ellipse', 'line']),
  fill: ColorSchema.optional(),
  stroke: z.object({
    color: z.string(),
    width: z.number()
  }).optional(),
  borderRadius: z.number().optional()
});

// Element (union)
const ElementSchema = z.discriminatedUnion('type', [
  TextElementSchema,
  ImageElementSchema,
  ShapeElementSchema
]);

// Transition
const TransitionSchema = z.object({
  type: z.enum(['none', 'fade', 'slideLeft', 'slideRight', 'slideUp', 'slideDown', 'zoom']),
  duration: z.number().min(0.1).max(2),
  easing: EasingSchema.optional()
});

// Scene
const SceneSchema = z.object({
  id: z.string().optional(),
  duration: z.number().min(0.1).max(60),
  background: ColorSchema.optional(),
  transition: TransitionSchema.optional(),
  elements: z.array(ElementSchema)
});

// Asset definition
const AssetDefinitionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('image'), src: z.string() }),
  z.object({ type: z.literal('audio'), src: z.string() }),
  z.object({
    type: z.literal('font'),
    family: z.string(),
    src: z.string().optional(),
    weight: z.number().optional()
  })
]);

// Audio track
const AudioSchema = z.object({
  src: z.string(),
  volume: z.number().min(0).max(1).optional().default(1),
  fadeIn: z.number().optional(),
  fadeOut: z.number().optional()
});

// Root VideoSpec schema
export const VideoSpecSchema = z.object({
  version: z.literal('1.0'),
  meta: z.object({
    width: z.number().min(1).max(3840),
    height: z.number().min(1).max(2160),
    fps: z.number().min(1).max(60).optional().default(30),
    duration: z.number().min(0.1).max(300),
    background: ColorSchema
  }),
  assets: z.record(AssetDefinitionSchema).optional(),
  scenes: z.array(SceneSchema).min(1),
  audio: AudioSchema.optional()
});

export type VideoSpec = z.infer<typeof VideoSpecSchema>;
```

### 7.2 Example: Product Promo Video

```json
{
  "version": "1.0",
  "meta": {
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "duration": 15,
    "background": "#1a1a2e"
  },
  "assets": {
    "logo": { "type": "image", "src": "https://example.com/logo.png" },
    "product": { "type": "image", "src": "https://example.com/product.png" },
    "music": { "type": "audio", "src": "https://example.com/upbeat.mp3" }
  },
  "scenes": [
    {
      "id": "intro",
      "duration": 5,
      "elements": [
        {
          "type": "image",
          "src": "asset:logo",
          "x": 540,
          "y": 200,
          "width": 200,
          "height": 200,
          "anchorX": 0.5,
          "anchorY": 0.5,
          "enter": { "type": "scale", "duration": 0.3 }
        },
        {
          "type": "text",
          "text": "{{headline}}",
          "x": 540,
          "y": 450,
          "fontSize": 64,
          "fontWeight": 700,
          "color": "#ffffff",
          "textAlign": "center",
          "anchorX": 0.5,
          "enter": { "type": "fade", "duration": 0.5 }
        }
      ],
      "transition": { "type": "fade", "duration": 0.5 }
    },
    {
      "id": "features",
      "duration": 7,
      "elements": [
        {
          "type": "image",
          "src": "asset:product",
          "x": 540,
          "y": 600,
          "width": 500,
          "height": 500,
          "anchorX": 0.5,
          "scale": {
            "values": [
              { "time": 0, "value": 0.8, "easing": "easeOutCubic" },
              { "time": 0.3, "value": 1.05 },
              { "time": 1, "value": 1 }
            ]
          }
        },
        {
          "type": "text",
          "text": "{{feature_1}}",
          "x": 540,
          "y": 1100,
          "fontSize": 42,
          "color": "#e94560",
          "textAlign": "center",
          "anchorX": 0.5,
          "start": 1,
          "enter": { "type": "slide", "direction": "up", "duration": 0.3 }
        },
        {
          "type": "text",
          "text": "{{feature_2}}",
          "x": 540,
          "y": 1180,
          "fontSize": 42,
          "color": "#e94560",
          "textAlign": "center",
          "anchorX": 0.5,
          "start": 2,
          "enter": { "type": "slide", "direction": "up", "duration": 0.3 }
        }
      ],
      "transition": { "type": "slideLeft", "duration": 0.4 }
    },
    {
      "id": "cta",
      "duration": 3,
      "background": "#e94560",
      "elements": [
        {
          "type": "text",
          "text": "{{cta}}",
          "x": 540,
          "y": 900,
          "fontSize": 56,
          "fontWeight": 700,
          "color": "#ffffff",
          "textAlign": "center",
          "anchorX": 0.5,
          "enter": { "type": "bounce", "duration": 0.5 }
        }
      ]
    }
  ],
  "audio": {
    "src": "asset:music",
    "volume": 0.4,
    "fadeOut": 1
  }
}
```

---

## 8. API Specification

### 8.1 Base URL

```
Development: http://localhost:3000/api/v1
Production:  https://api.gamemotion.io/v1
```

### 8.2 Authentication

All requests require API key in header:

```http
Authorization: Bearer gm_sk_xxxxxxxxxxxxxxxxxxxx
```

### 8.3 Endpoints

#### POST /render

Start a render job.

**Request:**
```json
{
  "spec": { /* VideoSpec JSON */ },
  "data": {
    "headline": "Amazing Product",
    "feature_1": "Lightning Fast",
    "feature_2": "Easy to Use",
    "cta": "Try It Free"
  },
  "sync": false
}
```

**Response (202 Accepted - async):**
```json
{
  "jobId": "job_abc123def456",
  "status": "pending",
  "estimatedSeconds": 12,
  "createdAt": "2026-01-22T10:30:00Z"
}
```

**Response (200 OK - sync, for short videos):**
```json
{
  "jobId": "job_abc123def456",
  "status": "completed",
  "outputUrl": "/outputs/job_abc123def456.mp4",
  "renderTimeMs": 8432,
  "createdAt": "2026-01-22T10:30:00Z",
  "completedAt": "2026-01-22T10:30:08Z"
}
```

#### GET /render/:jobId

Get job status.

**Response (200 OK):**
```json
{
  "jobId": "job_abc123def456",
  "status": "completed",
  "outputUrl": "/outputs/job_abc123def456.mp4",
  "renderTimeMs": 8432,
  "createdAt": "2026-01-22T10:30:00Z",
  "completedAt": "2026-01-22T10:30:08Z"
}
```

**Status values:** `pending` | `processing` | `completed` | `failed`

#### POST /ai/generate

Generate template from description.

**Request:**
```json
{
  "description": "30-second energetic product promo for a fitness app, TikTok format",
  "platform": "tiktok",
  "style": "energetic"
}
```

**Response (200 OK):**
```json
{
  "templateId": "tpl_xyz789",
  "spec": { /* Generated VideoSpec */ },
  "variables": ["headline", "feature_1", "feature_2", "cta", "logo_url", "product_image"],
  "suggestions": {
    "headline": "Transform Your Fitness",
    "cta": "Download Now"
  }
}
```

#### POST /assets

Upload an asset.

**Request:** `multipart/form-data`
- `file`: Binary file
- `type`: `image` | `audio` | `font`

**Response (201 Created):**
```json
{
  "assetId": "ast_img_123",
  "type": "image",
  "filename": "logo.png",
  "url": "/assets/ast_img_123.png",
  "sizeBytes": 24567
}
```

#### GET /templates

List available templates.

**Query params:**
- `category` - filter by category
- `platform` - filter by platform
- `page`, `limit` - pagination

**Response (200 OK):**
```json
{
  "templates": [
    {
      "id": "tpl_001",
      "name": "Product Promo",
      "description": "Energetic product showcase",
      "category": "promo",
      "platforms": ["tiktok", "instagram"],
      "variables": ["headline", "product_name", "cta"]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 15
  }
}
```

### 8.4 Error Responses

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid video specification",
    "details": [
      { "path": "meta.width", "message": "Must be between 1 and 3840" }
    ]
  }
}
```

**Error codes:**
- `VALIDATION_ERROR` (400)
- `UNAUTHORIZED` (401)
- `RATE_LIMITED` (429)
- `RENDER_FAILED` (500)
- `NOT_FOUND` (404)

### 8.5 Rate Limits

| Plan | Requests/min | Concurrent Renders |
|------|--------------|-------------------|
| Free | 10 | 1 |
| Pro | 60 | 3 |
| Business | 200 | 10 |

---

## 9. AI Integration

### 9.1 OpenRouter Configuration

**Provider:** OpenRouter (https://openrouter.ai)

**Models:**
- Primary: `anthropic/claude-3.5-sonnet` - Best structured output
- Fallback: `openai/gpt-4-turbo`
- Fast/cheap: `anthropic/claude-3-haiku` - Simple templates

### 9.2 Template Generation Flow

```
┌──────────────────────────────────────────────────────────────┐
│ INPUT: "30-second fitness app promo, energetic, TikTok"      │
└─────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ 1. PARSE INTENT                                              │
│    • Video type: promo                                       │
│    • Duration: 30s                                           │
│    • Platform: TikTok (1080x1920)                           │
│    • Style: energetic                                        │
│    • Subject: fitness app                                    │
└─────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ 2. BUILD PROMPT                                              │
│    System: "You are a video template generator..."           │
│    User: Structured prompt with constraints                  │
└─────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ 3. CALL OPENROUTER                                           │
│    POST https://openrouter.ai/api/v1/chat/completions       │
│    Model: anthropic/claude-3.5-sonnet                       │
│    response_format: { type: "json_object" }                  │
└─────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ 4. VALIDATE & REPAIR                                         │
│    • Parse JSON response                                     │
│    • Validate against VideoSpecSchema                        │
│    • Fix common issues (missing fields, wrong types)         │
│    • Extract {{variables}} list                              │
└─────────────────────────────┬────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│ OUTPUT: { spec: VideoSpec, variables: string[] }             │
└──────────────────────────────────────────────────────────────┘
```

### 9.3 System Prompt

```markdown
You are a professional video template generator for GameMotion. Generate valid JSON video specifications.

## Output Rules
1. Output ONLY valid JSON matching VideoSpec schema
2. No text outside JSON
3. Use {{variable_name}} for dynamic content

## Platform Dimensions  
- TikTok/Reels/Shorts: 1080x1920 (9:16)
- YouTube: 1920x1080 (16:9)
- Instagram Square: 1080x1080 (1:1)

## Style Guidelines
- Energetic: Fast transitions (0.3s), bold colors, scale animations
- Professional: Subtle fades (0.5s), muted colors
- Playful: Bounce animations, bright colors

## Common Variables
{{headline}}, {{tagline}}, {{cta}}, {{product_name}}, {{feature_1}}, {{feature_2}}, {{logo_url}}, {{product_image}}

## Animation Best Practices
- Scene transitions: 0.3-0.5s
- Text enter: 0.2-0.4s
- Stagger elements: 0.1-0.2s apart
```

### 9.4 Cost Estimate

| Operation | Model | Tokens | Cost |
|-----------|-------|--------|------|
| Simple template | Haiku | ~2500 | ~$0.001 |
| Complex template | Sonnet | ~4000 | ~$0.02 |

**Average: $0.01-0.03 per generated template**

---

## 10. Non-Functional Requirements

### 10.1 Performance

| Metric | Target |
|--------|--------|
| Render speed | ≥2x realtime (30s video in ≤15s) |
| API latency (non-render) | <200ms p95 |
| Concurrent renders | 2 (single instance) |

### 10.2 Reliability

| Metric | Target |
|--------|--------|
| Uptime | 99% |
| Job success rate | >98% |
| Data durability | Local backups daily |

### 10.3 Security

| Area | Implementation |
|------|----------------|
| Transport | HTTPS (TLS 1.3) |
| API keys | Hashed, rotatable |
| Input validation | Zod schemas |
| Rate limiting | Per API key |

### 10.4 Scalability Path

MVP is single-instance. Future scaling:

1. **Vertical:** Bigger server (8+ cores)
2. **Horizontal:** Add Redis + BullMQ when needed
3. **Storage:** Move to S3 when local fills up

---

## 11. Implementation Plan

### Overview

| Phase | Duration | Goal |
|-------|----------|------|
| Phase 1 | Week 1-2 | Project setup & JSON schema |
| Phase 2 | Week 3-4 | Core rendering engine |
| Phase 3 | Week 5-6 | Animation system & polish |
| Phase 4 | Week 7-8 | API & AI integration |
| Phase 5 | Week 9-10 | Production & beta launch |

**Total: 10 weeks to beta**

---

### Phase 1: Foundation (Week 1-2)

#### Week 1: Project Setup

**Environment & Tooling**
- [ ] Initialize git repository
- [ ] Setup Node.js 20+ / Bun project with TypeScript
- [ ] Configure `tsconfig.json` with strict mode
- [ ] Setup ESLint + Prettier with recommended rules
- [ ] Create `.env.example` with all config variables
- [ ] Setup `dotenv` for environment management
- [ ] Create basic `Dockerfile` (Node + FFmpeg)
- [ ] Create `docker-compose.yml` for local development

**Database Setup**
- [ ] Install Prisma ORM
- [ ] Create initial `schema.prisma` with User, Job, Asset, Template models
- [ ] Setup SQLite for development
- [ ] Run initial migration
- [ ] Create seed script with test user

**Project Structure**
- [ ] Create directory structure as per section 6.5
- [ ] Setup path aliases in tsconfig (`@/services`, `@/api`, etc.)
- [ ] Create placeholder files for main modules

#### Week 2: JSON Schema & Validation

**Zod Schemas**
- [ ] Implement `ColorSchema` (hex, rgba, gradient)
- [ ] Implement `EasingSchema` (all easing function names)
- [ ] Implement `KeyframesSchema` (animated values)
- [ ] Implement `AnimationSchema` (enter/exit presets)
- [ ] Implement `TextElementSchema`
- [ ] Implement `ImageElementSchema`
- [ ] Implement `ShapeElementSchema`
- [ ] Implement `SceneSchema`
- [ ] Implement `VideoSpecSchema` (root)
- [ ] Export TypeScript types from schemas

**Variable Substitution**
- [ ] Create `extractVariables(spec)` - finds all `{{var}}` in JSON
- [ ] Create `substituteVariables(spec, data)` - replaces placeholders
- [ ] Handle nested variable access `{{user.name}}`
- [ ] Handle default values `{{title|Untitled}}`
- [ ] Write unit tests for variable substitution

**Test Fixtures**
- [ ] Create `fixtures/simple-text.json` - single text element
- [ ] Create `fixtures/image-gallery.json` - multiple images
- [ ] Create `fixtures/promo-video.json` - full promo template
- [ ] Create `fixtures/invalid-spec.json` - for error testing

---

### Phase 2: Core Rendering Engine (Week 3-4)

#### Week 3: Canvas & Element Rendering

**Canvas Setup**
- [ ] Install `skia-canvas` package
- [ ] Create `Renderer` class with canvas initialization
- [ ] Implement `createCanvas(width, height)` method
- [ ] Implement `clearCanvas(color)` method
- [ ] Test canvas creation and basic drawing

**Element Renderers**
- [ ] Create `ElementRenderer` interface/base class
- [ ] Implement `TextElementRenderer`
  - [ ] Basic text drawing
  - [ ] Font family & size
  - [ ] Font weight & style
  - [ ] Text color
  - [ ] Text alignment
  - [ ] Line height & wrapping (maxWidth)
  - [ ] Background color & padding
  - [ ] Border radius
  - [ ] Text shadow
  - [ ] Text stroke/outline
- [ ] Implement `ImageElementRenderer`
  - [ ] Load image from URL
  - [ ] Load image from local path (`asset:{id}`)
  - [ ] Implement fit modes: cover, contain, fill, none
  - [ ] Border radius (clipping)
  - [ ] Image caching in memory
- [ ] Implement `ShapeElementRenderer`
  - [ ] Rectangle
  - [ ] Circle
  - [ ] Ellipse
  - [ ] Fill color (solid & gradient)
  - [ ] Stroke (color & width)
  - [ ] Border radius for rectangles

**Transform System**
- [ ] Implement `applyTransform(ctx, element, time)`
- [ ] Handle x, y positioning
- [ ] Handle anchor point (anchorX, anchorY)
- [ ] Handle scale
- [ ] Handle rotation (degrees)
- [ ] Handle opacity

**Asset Loading**
- [ ] Create `AssetLoader` class
- [ ] Implement remote image fetching (with timeout)
- [ ] Implement local asset loading
- [ ] Implement parallel loading with `Promise.all`
- [ ] Add in-memory cache for loaded assets
- [ ] Implement Google Fonts loading

#### Week 4: Render Loop & FFmpeg

**Scene Graph**
- [ ] Create `SceneGraph` class
- [ ] Parse VideoSpec into internal timeline
- [ ] Calculate scene start/end times
- [ ] Method: `getActiveScene(time)`
- [ ] Method: `getVisibleElements(time)`
- [ ] Handle element start/duration within scenes

**Render Loop**
- [ ] Create `RenderService` orchestrator class
- [ ] Implement frame-by-frame render loop
- [ ] Calculate total frames from duration × fps
- [ ] Progress callback for monitoring
- [ ] Memory management (cleanup between frames)

**FFmpeg Integration**
- [ ] Create `Encoder` class wrapping FFmpeg
- [ ] Spawn FFmpeg process with correct arguments
- [ ] Pipe raw RGBA frames to stdin
- [ ] Configure H.264 encoding (preset, crf)
- [ ] Handle process completion/errors
- [ ] Add audio track muxing (simple overlay)
- [ ] Implement audio fade in/out with FFmpeg filters

**End-to-End Test**
- [ ] Test: JSON fixture → MP4 output
- [ ] Verify video plays correctly
- [ ] Verify dimensions and duration match spec
- [ ] Benchmark: measure render time vs video duration

---

### Phase 3: Animation System (Week 5-6)

#### Week 5: Keyframes & Easing

**Easing Functions Library**
- [ ] Implement `linear`
- [ ] Implement `easeIn`, `easeOut`, `easeInOut` (quad)
- [ ] Implement `easeInCubic`, `easeOutCubic`, `easeInOutCubic`
- [ ] Implement `easeInQuad`, `easeOutQuad`, `easeInOutQuad`
- [ ] Implement `easeInElastic`, `easeOutElastic`
- [ ] Implement `easeInBounce`, `easeOutBounce`
- [ ] Create `getEasingFunction(name)` lookup
- [ ] Unit tests for all easing functions

**Keyframe Interpolation**
- [ ] Create `interpolateKeyframes(keyframes, time)`
- [ ] Handle 2+ keyframes
- [ ] Apply easing between keyframes
- [ ] Clamp values outside 0-1 range
- [ ] Handle single static value (no keyframes)

**Animation Presets**
- [ ] Implement `fade` animation (opacity 0→1 or 1→0)
- [ ] Implement `slide` animation (from direction)
- [ ] Implement `scale` animation (0→1 or 1→0)
- [ ] Implement `bounce` animation (overshoot effect)
- [ ] Create `applyEnterAnimation(element, time)`
- [ ] Create `applyExitAnimation(element, time)`

#### Week 6: Transitions & Polish

**Scene Transitions**
- [ ] Implement `fade` transition
- [ ] Implement `slideLeft` transition
- [ ] Implement `slideRight` transition
- [ ] Implement `slideUp` transition
- [ ] Implement `slideDown` transition
- [ ] Implement `zoom` transition
- [ ] Handle overlapping frames during transition

**Visual Polish**
- [ ] Implement linear gradient backgrounds
- [ ] Implement radial gradient backgrounds
- [ ] Verify text rendering quality at various sizes
- [ ] Test with different fonts (Google Fonts)
- [ ] Add anti-aliasing for shapes

**Testing & Benchmarks**
- [ ] Create visual test suite (render → compare snapshots)
- [ ] Test all animation types
- [ ] Test all transitions
- [ ] Performance benchmark: various resolutions
- [ ] Performance benchmark: various durations
- [ ] Document performance characteristics

---

### Phase 4: API & AI (Week 7-8)

#### Week 7: REST API

**Fastify Setup**
- [ ] Install Fastify + TypeScript plugin
- [ ] Create app factory function
- [ ] Setup CORS configuration
- [ ] Setup request logging (pino)
- [ ] Create health check endpoint `GET /health`

**Authentication Middleware**
- [ ] Create `authMiddleware`
- [ ] Parse `Authorization: Bearer` header
- [ ] Lookup API key in database
- [ ] Attach user to request context
- [ ] Return 401 for invalid/missing key

**Rate Limiting**
- [ ] Install `@fastify/rate-limit`
- [ ] Configure per-plan limits
- [ ] Return 429 with retry-after header
- [ ] Use in-memory store (simple for MVP)

**Job Queue (p-queue)**
- [ ] Create `JobQueue` class wrapping p-queue
- [ ] Configure concurrency: 2
- [ ] Method: `enqueue(jobFn)` returns Promise
- [ ] Track active/pending counts
- [ ] Add timeout per job (5 minutes)

**Render Endpoints**
- [ ] `POST /api/v1/render`
  - [ ] Validate request body (Zod)
  - [ ] Create job in database
  - [ ] Enqueue render task
  - [ ] Return job ID immediately (async)
  - [ ] Option: wait for result (sync, short videos)
- [ ] `GET /api/v1/render/:jobId`
  - [ ] Lookup job in database
  - [ ] Return status and output URL
  - [ ] Handle not found (404)

**Asset Endpoints**
- [ ] `POST /api/v1/assets`
  - [ ] Handle multipart file upload
  - [ ] Validate file type and size
  - [ ] Save to `/assets` directory
  - [ ] Create database record
  - [ ] Return asset ID and URL
- [ ] `GET /api/v1/assets/:assetId`
  - [ ] Serve asset file
  - [ ] Set proper Content-Type

**Static File Serving**
- [ ] Serve `/outputs` directory for video downloads
- [ ] Serve `/assets` directory for uploaded assets
- [ ] Add cache headers

#### Week 8: AI Integration

**OpenRouter Client**
- [ ] Create `OpenRouterClient` class
- [ ] Implement `chat(messages, options)` method
- [ ] Handle API key from environment
- [ ] Add retry logic (3 attempts)
- [ ] Add timeout handling
- [ ] Track token usage for cost monitoring

**Template Generator**
- [ ] Create `TemplateGenerator` service
- [ ] Build system prompt (section 9.3)
- [ ] Build user prompt from description
- [ ] Parse intent (duration, platform, style)
- [ ] Call OpenRouter for generation
- [ ] Parse and validate response JSON
- [ ] Repair common JSON issues
- [ ] Extract variables from template

**AI Endpoint**
- [ ] `POST /api/v1/ai/generate`
  - [ ] Accept description, platform, style
  - [ ] Call TemplateGenerator
  - [ ] Save template to database
  - [ ] Return spec + variables + suggestions

**Template Endpoints**
- [ ] `GET /api/v1/templates`
  - [ ] List public templates
  - [ ] Filter by category, platform
  - [ ] Pagination
- [ ] `GET /api/v1/templates/:id`
  - [ ] Return single template
  - [ ] Include full spec

**Built-in Templates**
- [ ] Create 5 starter templates:
  - [ ] Product promo (energetic, TikTok)
  - [ ] Product promo (professional, YouTube)
  - [ ] Quote/testimonial (Instagram)
  - [ ] Announcement (general)
  - [ ] Sale/discount (TikTok)
- [ ] Load templates on startup
- [ ] Insert into database if not exists

---

### Phase 5: Production Ready (Week 9-10)

#### Week 9: DevOps & Hardening

**Production Dockerfile**
- [ ] Multi-stage build (builder + runtime)
- [ ] Install FFmpeg in runtime stage
- [ ] Non-root user for security
- [ ] Optimize layer caching
- [ ] Health check instruction

**Environment Configuration**
- [ ] Validate all required env vars on startup
- [ ] Create `.env.production.example`
- [ ] Document all configuration options
- [ ] Secure defaults for production

**Database Migration**
- [ ] Setup PostgreSQL connection for production
- [ ] Test Prisma migrations
- [ ] Create migration deployment script
- [ ] Backup strategy documentation

**Error Handling**
- [ ] Global error handler in Fastify
- [ ] Structured error responses
- [ ] Don't leak stack traces in production
- [ ] Log errors with context

**Cleanup Jobs**
- [ ] Create cleanup script for old outputs (>24h)
- [ ] Create cleanup for failed job temp files
- [ ] Setup cron or setTimeout for periodic cleanup

**Monitoring**
- [ ] Add basic metrics endpoint `/metrics`
  - [ ] Total jobs processed
  - [ ] Jobs by status
  - [ ] Average render time
  - [ ] Queue depth
- [ ] Setup health check endpoint
- [ ] Document monitoring approach

#### Week 10: Documentation & Beta Launch

**API Documentation**
- [ ] Create OpenAPI/Swagger spec
- [ ] Setup Swagger UI at `/docs`
- [ ] Document all endpoints with examples
- [ ] Document error codes
- [ ] Document rate limits

**README & Guides**
- [ ] Write comprehensive README.md
- [ ] Quick start guide
- [ ] Self-hosting guide
- [ ] JSON schema reference
- [ ] Example integrations (curl, Node.js, Python)

**Landing Page (Simple)**
- [ ] Create simple landing page
- [ ] Value proposition
- [ ] API example
- [ ] Sign up form (collect emails)
- [ ] Link to documentation

**Beta Preparation**
- [ ] Create 10 beta invite codes
- [ ] Setup feedback collection (form or email)
- [ ] Create onboarding email template
- [ ] Test end-to-end user flow
- [ ] Load test with realistic workload

**Launch Checklist**
- [ ] SSL certificate configured
- [ ] Domain DNS configured
- [ ] Database backups verified
- [ ] Monitoring alerts configured
- [ ] Rate limits tested
- [ ] Error handling tested
- [ ] Documentation reviewed
- [ ] Beta users invited

---

### Post-MVP Backlog (Not in scope, for later)

**Performance**
- [ ] Add Redis for caching
- [ ] Add BullMQ for job queue
- [ ] Horizontal scaling support
- [ ] GPU acceleration research

**Features**
- [ ] Video-in-video support
- [ ] Lottie animation support
- [ ] More transitions
- [ ] Batch rendering endpoint
- [ ] Webhook notifications
- [ ] S3 storage integration

**Platform**
- [ ] Web-based template editor
- [ ] User dashboard
- [ ] Usage analytics
- [ ] Billing integration (Stripe)

---

## 12. Risks & Mitigations

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| skia-canvas too slow | Low | High | Fallback to node-canvas; optimize hot paths |
| Font rendering issues | Medium | Medium | Test early; use Google Fonts; fallback fonts |
| FFmpeg memory on long videos | Medium | Medium | Limit max duration (60s MVP); stream frames |
| AI generates bad JSON | High | Low | JSON repair; strict validation; fallbacks |
| In-memory queue loses jobs | Medium | Medium | Persist to DB before queue; acceptable for MVP |

### Business Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Low adoption | Medium | High | Focus on specific niche; AI differentiator |
| OpenRouter pricing changes | Low | Medium | Abstract provider; can switch models |
| Competition adds AI | High | Medium | Move fast; specialize; build community |

---

## 13. Future Considerations

### Scaling Path

1. **v1.1:** Add Redis + BullMQ when >100 jobs/day
2. **v1.2:** Add S3 storage when local fills up
3. **v2.0:** Horizontal scaling with multiple workers

### Pricing Model (Post-MVP)

| Tier | Price | Videos/Month | Features |
|------|-------|--------------|----------|
| Free | $0 | 10 | Watermarked, 720p |
| Pro | $29/mo | 100 | 1080p, no watermark |
| Business | $99/mo | 500 | 4K, API priority |
| Self-Host | $199 once | Unlimited | Full source code |

### Feature Roadmap

**Q2 2026:**
- Browser-based preview
- More templates
- Webhook notifications

**Q3 2026:**
- Team accounts
- Template marketplace
- White-label option

**Q4 2026:**
- AI voiceover (ElevenLabs)
- AI music selection
- Video analytics

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-22 | Narcis | Initial PRD |
| 2.0 | 2026-01-22 | Narcis | Simplified architecture (no Redis/BullMQ), detailed implementation checklist |

---

*This document is a living artifact and will be updated as the project evolves.*
