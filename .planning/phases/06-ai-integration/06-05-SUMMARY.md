---
phase: 06-ai-integration
plan: 05
subsystem: api
tags: [hono, routes, templates, generate, rest-api]

dependency-graph:
  requires:
    - 06-02 (Built-in Templates)
    - 06-03 (Variable Substitution)
    - 06-04 (Template Generator)
  provides:
    - POST /generate endpoint for AI template generation
    - GET /templates endpoint for listing built-in templates
    - GET /templates/:id endpoint for template details
    - POST /templates/:id/render endpoint for template rendering
  affects:
    - API consumers
    - Frontend integration

tech-stack:
  added: []
  patterns:
    - Hono route modules with typed variables
    - zValidator for request validation
    - JobQueue integration for async rendering

key-files:
  created:
    - src/api/routes/generate.ts
    - src/api/routes/templates.ts
    - tests/api/routes/generate.test.ts
    - tests/api/routes/templates.test.ts
  modified:
    - src/api/routes/index.ts
    - src/api/app.ts

decisions:
  - title: Variable type inference from name
    choice: url/image in name -> url type, else text
    rationale: Simple heuristic covers most cases

metrics:
  duration: 5m
  completed: 2026-01-26
---

# Phase 6 Plan 5: Template API Routes Summary

REST API routes exposing AI template generation and built-in templates via /generate and /templates endpoints with auth/rate-limiting.

## What Was Built

### POST /generate Route (`src/api/routes/generate.ts`)
- Validates request with `GenerateRequestSchema` (description, platform, style)
- Calls `templateGenerator.generate()` and returns spec with variable metadata
- Maps variable types based on name patterns (url/image -> url, else text)
- Returns appropriate HTTP status codes:
  - 201: Success with spec and variables
  - 400: Invalid request (validation error)
  - 503: AI service not configured (missing API key)
  - 504: AI service timeout
  - 500: Generic generation errors

### Templates Routes (`src/api/routes/templates.ts`)
- **GET /templates**: Lists all built-in templates (metadata without spec)
- **GET /templates/:id**: Returns full template details including spec
- **POST /templates/:id/render**: Substitutes variables and queues render job
  - Validates substituted spec before queueing
  - Supports sync mode for short videos (<30s)
  - Supports webhook_url for async notifications
  - Returns poll_url for job status

### Route Integration (`src/api/app.ts`)
- Both routes protected by authMiddleware and rateLimitMiddleware
- Route order: health, render, assets, generate, templates, download, 404

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create POST /generate route | 550d7f0 | src/api/routes/generate.ts |
| 2 | Create templates routes | e6f0624 | src/api/routes/templates.ts |
| 3 | Wire routes into app | 0e44db2 | src/api/routes/index.ts, src/api/app.ts |
| 4 | Add route tests | ad4b547 | tests/api/routes/generate.test.ts, tests/api/routes/templates.test.ts |

## Test Coverage

- **generate.test.ts**: 9 tests
  - Success cases with spec and variables
  - Validation errors (short description, invalid platform, missing fields)
  - AI service errors (not configured, timeout, generic)
  - Authentication requirement
  - Variable type mapping

- **templates.test.ts**: 14 tests
  - List templates (metadata without spec)
  - Get template by ID (with spec)
  - 404 for non-existent templates
  - Render with variable substitution
  - Webhook URL support
  - Authentication requirement

## API Reference

```bash
# Generate template from description
POST /generate
Authorization: Bearer <api-key>
Content-Type: application/json
{
  "description": "Create a TikTok video...",
  "platform": "tiktok",
  "style": "energetic"
}

# List all templates
GET /templates
Authorization: Bearer <api-key>

# Get template details
GET /templates/:id
Authorization: Bearer <api-key>

# Render template with variables
POST /templates/:id/render
Authorization: Bearer <api-key>
Content-Type: application/json
{
  "variables": { "headline": "Hello World" },
  "webhook_url": "https://...",
  "sync": false
}
```

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Variable type inference from name | Simple heuristic (url/image -> url) covers most cases without complex schema |
| Separate job infrastructure per route module | Allows independent scaling and testing |

## Deviations from Plan

None - plan executed exactly as written.

## What's Next

Phase 6 (AI Integration) is now complete with all TMPL requirements implemented:
- TMPL-01: Built-in templates (06-02)
- TMPL-02: Variable substitution (06-03)
- TMPL-03: AI template generation (06-04, 06-05)

The API now supports:
- Video rendering from JSON specs
- Asset uploads
- AI-powered template generation
- Built-in templates with variable substitution
