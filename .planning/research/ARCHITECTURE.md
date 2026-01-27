# Architecture Patterns: React Frontend + Hono API Integration

**Domain:** Local dev studio UI for JSON-to-video rendering engine
**Researched:** 2026-01-27
**Confidence:** HIGH (based on existing codebase analysis + official documentation)

## Executive Summary

The GameMotion Studio frontend should integrate with the existing Hono API using a **single-process monorepo architecture** where React (Vite) talks to the existing Hono server. For local development, this is the simplest approach that avoids CORS complexity while maintaining type safety via Hono RPC.

**Key architectural decision:** Keep the existing Hono server as-is, add React frontend in a separate package within the monorepo, use Vite proxy in development, and serve static files from Hono in production.

---

## Recommended Architecture

```
gamemotion/
├── package.json              # Root workspace config
├── packages/
│   ├── api/                  # Existing Hono backend (move src/ here)
│   │   ├── src/
│   │   │   ├── api/          # Existing routes, services, middleware
│   │   │   ├── render/       # Existing rendering engine
│   │   │   ├── schemas/      # Zod schemas (shared)
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── studio/               # NEW: React frontend
│   │   ├── src/
│   │   │   ├── components/   # React components
│   │   │   ├── hooks/        # Custom hooks (useChat, useLibrary)
│   │   │   ├── pages/        # Route pages
│   │   │   ├── lib/          # Utilities, API client
│   │   │   └── main.tsx
│   │   ├── vite.config.ts    # Proxy to API in dev
│   │   └── package.json
│   │
│   └── shared/               # NEW: Shared types (optional)
│       ├── src/
│       │   └── types.ts      # Types used by both packages
│       └── package.json
│
├── data/                     # NEW: Persistent storage
│   ├── studio.db             # SQLite database
│   ├── templates/            # User template JSON files
│   └── videos/               # Rendered video metadata
│
└── outputs/                  # Existing: Rendered MP4 files
```

### Alternative: Flat Structure (Simpler Start)

For MVP, consider a simpler flat structure without moving existing code:

```
gamemotion/
├── src/                      # Existing backend code (unchanged)
│   ├── api/
│   ├── render/
│   └── ...
├── studio/                   # NEW: React frontend (adjacent)
│   ├── src/
│   ├── vite.config.ts
│   └── package.json
├── data/                     # NEW: SQLite + metadata
│   └── studio.db
├── outputs/                  # Existing
└── package.json              # Add workspaces config
```

**Recommendation:** Start with flat structure. Refactor to full monorepo only if needed.

---

## Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **Hono API** (existing) | Video rendering, AI generation, job queue | SQLite (new), file system |
| **React Studio** (new) | Chat UI, library browsing, video preview | Hono API via HTTP |
| **SQLite Database** (new) | Templates, videos, conversations persistence | Hono API only |
| **System Player** | Video playback | Spawned by Studio via Hono API |

### Data Flow

```
User Input (Chat)
       │
       ▼
┌──────────────────┐
│  React Studio    │  ← Vite dev server (port 5173)
│  (Browser)       │
└────────┬─────────┘
         │ HTTP (fetch/hc)
         │ /api/* proxied to :3000 in dev
         ▼
┌──────────────────┐
│   Hono API       │  ← Node.js server (port 3000)
│   (Express-like) │
├──────────────────┤
│ Routes:          │
│  /generate       │ → AI template generation
│  /render         │ → Video rendering queue
│  /templates      │ → Template CRUD
│  /library/*      │ → NEW: Library management
│  /chat/*         │ → NEW: Conversation history
│  /preview/*      │ → NEW: System player launch
└────────┬─────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌─────────┐
│ SQLite │ │ FFmpeg  │
│  (DB)  │ │ (Video) │
└────────┘ └─────────┘
```

---

## Integration Points with Existing Hono API

### Existing Endpoints (No Changes Needed)

| Endpoint | Method | Purpose | Studio Usage |
|----------|--------|---------|--------------|
| `/health` | GET | Health check | Connection test |
| `/generate` | POST | AI template generation | Chat flow |
| `/render` | POST | Submit render job | After template approval |
| `/render/:jobId` | GET | Poll job status | Progress tracking |
| `/templates` | GET | List built-in templates | Template browser |
| `/templates/:id` | GET | Get template details | Template preview |
| `/templates/:id/render` | POST | Render with variables | Quick render |
| `/download/:jobId` | GET | Download video | System player |
| `/assets` | POST | Upload file | Asset management |

### New Endpoints Needed

| Endpoint | Method | Purpose | Priority |
|----------|--------|---------|----------|
| `/studio/conversations` | GET | List chat conversations | P1 |
| `/studio/conversations` | POST | Create conversation | P1 |
| `/studio/conversations/:id` | GET | Get conversation | P1 |
| `/studio/conversations/:id/messages` | POST | Add message | P1 |
| `/studio/templates` | GET | List user templates | P1 |
| `/studio/templates` | POST | Save template | P1 |
| `/studio/templates/:id` | GET/PUT/DELETE | CRUD | P1 |
| `/studio/templates/:id/versions` | GET | Version history | P2 |
| `/studio/videos` | GET | List rendered videos | P1 |
| `/studio/videos/:id` | GET | Video metadata | P1 |
| `/studio/preview/:jobId` | POST | Open in system player | P1 |

### Authentication Strategy

**For local dev studio:** Skip API key auth entirely for `/studio/*` routes.

```typescript
// In app.ts - NO auth for studio routes (local dev only)
app.route('/studio', studioRoutes);  // No authMiddleware

// Keep auth for external API routes
app.use('/render/*', authMiddleware);
app.use('/generate/*', authMiddleware);
```

**Rationale:** Studio is for local development. Adding auth friction makes no sense. The existing auth remains for API consumers (Postman, curl, integrations).

---

## Data Storage Approach

### Recommendation: SQLite with better-sqlite3

**Why SQLite over JSON files:**
- Atomic operations (no race conditions)
- Query capabilities (search, filter, sort)
- Transactions for related updates
- Single file backup
- Zero configuration

**Why better-sqlite3:**
- Synchronous API (simpler code)
- Fastest SQLite library for Node.js
- No async callback hell
- Battle-tested

### Database Schema

```sql
-- Conversations (chat history)
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Messages within conversations
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  metadata TEXT,  -- JSON: template_id, video_id references
  created_at INTEGER NOT NULL
);

-- User templates (saved from AI generation or manual)
CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  spec TEXT NOT NULL,  -- JSON VideoSpec
  variables TEXT,      -- JSON array of variable definitions
  source_conversation_id TEXT REFERENCES conversations(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Template versions (for history)
CREATE TABLE template_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id),
  version INTEGER NOT NULL,
  spec TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Rendered videos (metadata, links to outputs/)
CREATE TABLE videos (
  id TEXT PRIMARY KEY,          -- Same as job_id
  template_id TEXT REFERENCES templates(id),
  conversation_id TEXT REFERENCES conversations(id),
  status TEXT NOT NULL,
  output_path TEXT,             -- Path to MP4 in outputs/
  duration_ms INTEGER,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);

-- Indexes
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_templates_updated ON templates(updated_at DESC);
CREATE INDEX idx_videos_created ON videos(created_at DESC);
```

### Database Location

```
data/studio.db
```

Add to `.gitignore`:
```
data/
```

---

## Frontend/Backend Communication Patterns

### Option A: Hono RPC (Recommended)

Type-safe API client with zero code generation.

**Server side (api/src/api/routes/studio.ts):**
```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

const studioRoutes = new Hono()
  .get('/conversations', async (c) => {
    const conversations = db.getConversations();
    return c.json({ conversations });
  })
  .post('/conversations',
    zValidator('json', z.object({ title: z.string() })),
    async (c) => {
      const { title } = c.req.valid('json');
      const conversation = db.createConversation(title);
      return c.json(conversation, 201);
    }
  );

// Export type for client
export type StudioRoutes = typeof studioRoutes;
```

**Client side (studio/src/lib/api.ts):**
```typescript
import { hc } from 'hono/client';
import type { StudioRoutes } from '@gamemotion/api/routes/studio';

// Create typed client
export const api = hc<StudioRoutes>('/api/studio');

// Usage with full type inference
const res = await api.conversations.$get();
const data = await res.json();
// data.conversations is typed!
```

### Option B: Plain Fetch with Shared Types

If Hono RPC setup is complex, fall back to standard fetch with manually shared types.

**Shared types (shared/src/types.ts):**
```typescript
export interface Conversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface ConversationListResponse {
  conversations: Conversation[];
}
```

**Client (studio/src/lib/api.ts):**
```typescript
import type { ConversationListResponse } from '@gamemotion/shared';

export async function getConversations(): Promise<ConversationListResponse> {
  const res = await fetch('/api/studio/conversations');
  return res.json();
}
```

**Recommendation:** Start with Option B (simpler), migrate to Option A once types stabilize.

---

## Development Workflow

### Vite Proxy Configuration

**studio/vite.config.ts:**
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // Proxy download routes for video preview
      '/download': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
```

### Development Commands

**Root package.json:**
```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:api\" \"npm run dev:studio\"",
    "dev:api": "node --import tsx src/api/server.ts",
    "dev:studio": "npm run dev --workspace=studio",
    "build": "npm run build --workspaces",
    "start": "node dist/api/server.js"
  },
  "workspaces": ["studio"]
}
```

### Single-Command Development

```bash
npm run dev
# Starts:
# - Hono API on http://localhost:3000
# - Vite dev server on http://localhost:5173
# - Vite proxies /api/* to :3000
```

---

## Production Deployment (Local)

### Option A: Serve Static from Hono (Recommended)

Build React, serve from Hono. Single process.

**api/src/api/app.ts (modified):**
```typescript
import { serveStatic } from '@hono/node-server/serve-static';

// API routes first (higher priority)
app.route('/render', renderRoutes);
app.route('/generate', generateRoutes);
app.route('/studio', studioRoutes);

// Serve React build for all other routes
app.use('/*', serveStatic({ root: './studio/dist' }));

// SPA fallback - serve index.html for client-side routing
app.get('*', serveStatic({ path: './studio/dist/index.html' }));
```

**Build & Start:**
```bash
npm run build           # Builds API + Studio
npm start              # Single process serves everything
# Open http://localhost:3000
```

### Option B: Separate Processes

If you need separate scaling (unlikely for local dev):

```bash
# Terminal 1
npm run start:api       # Port 3000

# Terminal 2
npm run preview --workspace=studio  # Port 4173
```

**Recommendation:** Option A. Single process is simpler for local dev tool.

---

## Build Order Considerations

### Dependency Graph

```
shared (types)
    │
    ├──► api (backend)
    │       │
    │       └──► studio (frontend, needs API types)
    │
    └──► studio (frontend, uses shared types)
```

### Build Sequence

1. **shared** - TypeScript types (if using separate package)
2. **api** - Backend, exports route types
3. **studio** - Frontend, imports API types

**Turbo or npm workspaces** handle this automatically via dependency declaration.

### TypeScript Configuration

**api/tsconfig.json:**
```json
{
  "compilerOptions": {
    "composite": true,  // Enable project references
    "outDir": "./dist",
    "declaration": true
  }
}
```

**studio/tsconfig.json:**
```json
{
  "compilerOptions": {
    "paths": {
      "@gamemotion/api/*": ["../src/*"]  // Or via workspace package
    }
  },
  "references": [
    { "path": "../" }  // Reference main project
  ]
}
```

---

## Patterns to Follow

### Pattern 1: Optimistic Updates for Chat

**What:** Update UI immediately, reconcile with server response.

**Why:** Chat feels instant. User doesn't wait for AI.

**Example:**
```typescript
// Add message optimistically
setMessages(prev => [...prev, { role: 'user', content: input }]);

// Then send to server
const response = await api.conversations[':id'].messages.$post({
  param: { id: conversationId },
  json: { content: input }
});

// Update with server response (includes AI reply)
const { messages } = await response.json();
setMessages(messages);
```

### Pattern 2: Polling for Job Status

**What:** Poll `/render/:jobId` until complete.

**Why:** Existing pattern, works reliably.

**Example:**
```typescript
async function waitForRender(jobId: string): Promise<Video> {
  while (true) {
    const res = await fetch(`/api/render/${jobId}`);
    const job = await res.json();

    if (job.status === 'completed') return job;
    if (job.status === 'failed') throw new Error(job.error);

    await sleep(1000);  // Poll every second
  }
}
```

### Pattern 3: Video Preview via System Player

**What:** Trigger OS to open MP4 file.

**Why:** Avoids in-browser streaming complexity.

**Implementation:**
```typescript
// Server: POST /studio/preview/:jobId
import { exec } from 'node:child_process';
import { platform } from 'node:os';

function openVideo(filePath: string) {
  const cmd = platform() === 'darwin'
    ? `open "${filePath}"`
    : platform() === 'win32'
    ? `start "" "${filePath}"`
    : `xdg-open "${filePath}"`;

  exec(cmd);
}
```

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: WebSocket for Everything

**What:** Using WebSocket for chat, job status, library updates.

**Why bad:** Complexity for local dev. Connection management, reconnection logic.

**Instead:** HTTP polling + optimistic updates. Simpler, sufficient for single-user.

### Anti-Pattern 2: Separate Database per Feature

**What:** SQLite for templates, JSON files for conversations, another DB for videos.

**Why bad:** Inconsistent data access, no referential integrity, backup complexity.

**Instead:** Single SQLite database for all studio state.

### Anti-Pattern 3: Complex State Management

**What:** Redux, MobX, or similar for a local dev tool.

**Why bad:** Over-engineering. Single user, limited state.

**Instead:** React Query for server state, useState/useReducer for UI state.

### Anti-Pattern 4: Building Auth UI

**What:** Login pages, session management, user accounts.

**Why bad:** This is a local dev tool. No users except the developer.

**Instead:** Skip auth entirely for studio routes. Keep API key auth only for external integrations.

---

## Scalability Considerations

| Concern | Local Dev (Target) | If Scaled Later |
|---------|-------------------|-----------------|
| Concurrent users | 1 | Add sessions, auth |
| Database | SQLite (sufficient) | PostgreSQL |
| Job queue | p-queue (in-memory) | BullMQ + Redis |
| File storage | Local disk | S3/R2 |
| Video streaming | System player | HLS with CDN |

**For v0.2:** All left-column approaches are correct. Don't optimize prematurely.

---

## Sources

- [Hono Node.js Documentation](https://hono.dev/docs/getting-started/nodejs) - serveStatic, production patterns
- [Hono RPC Guide](https://hono.dev/docs/guides/rpc) - Type-safe client creation
- [Hono CORS Middleware](https://hono.dev/docs/middleware/builtin/cors) - Local dev configuration
- [Vite Server Options](https://vite.dev/config/server-options) - Proxy configuration
- [better-sqlite3 GitHub](https://github.com/WiseLibs/better-sqlite3) - Fastest SQLite for Node.js
- [BHVR Monorepo Template](https://github.com/stevedylandev/bhvr) - Bun + Hono + Vite + React structure
- Existing codebase analysis: `src/api/app.ts`, `src/api/routes/*.ts`
