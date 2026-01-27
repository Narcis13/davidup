# Phase 7: Project Setup - Research

**Researched:** 2026-01-27
**Domain:** Vite + React + Tailwind frontend integration with existing Hono API + SQLite persistence
**Confidence:** HIGH

## Summary

Phase 7 establishes the foundation for the v0.2 Studio UI by integrating a Vite-powered React frontend with the existing Hono API backend. The primary technical challenges are: (1) configuring Vite proxy correctly to avoid CORS issues during development, (2) setting up Tailwind v4 with the native Vite plugin, (3) initializing SQLite database with better-sqlite3 for studio data persistence, and (4) creating a single `npm run dev` command that starts both servers.

The stack decisions from v0.2 planning are locked: Vite 7, React 19, Tailwind v4, shadcn/ui, and better-sqlite3. This research focused on verifying current versions, correct configuration patterns, and identifying pitfalls specific to this integration pattern. The existing research in `.planning/research/` provided excellent background; this phase-specific research adds implementation details and verified code patterns.

Key findings: Use IPv4 (127.0.0.1) not localhost in Vite proxy to avoid Node 17+ DNS resolution issues. Tailwind v4 requires no PostCSS config - just `@tailwindcss/vite` plugin and `@import "tailwindcss"` in CSS. The frontend should live in `/studio` subdirectory with its own package.json to avoid dependency conflicts. Use `concurrently` or `npm-run-all2` to start both servers with a single command.

**Primary recommendation:** Start with Vite proxy for development and Hono serveStatic for production - this is the standard pattern and avoids CORS complexity entirely.

## Standard Stack

The established libraries/tools for this phase:

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vite | ^7.3.1 | Build tool & dev server | Latest stable (June 2025), fastest HMR, native Tailwind v4 support |
| @vitejs/plugin-react | ^4.5.0 | React plugin for Vite | Official plugin, required for JSX/React |
| react | ^19.2.4 | UI framework | Latest stable (Jan 2026), project scope requirement |
| react-dom | ^19.2.4 | React DOM bindings | Required for browser rendering |
| tailwindcss | ^4.1.18 | Utility CSS framework | Project scope, v4 has simpler Vite integration |
| @tailwindcss/vite | ^4.1.18 | Vite plugin for Tailwind | Native integration, no PostCSS config needed |
| better-sqlite3 | ^12.6.2 | SQLite database | Fastest SQLite for Node.js, synchronous API, zero config |
| @types/better-sqlite3 | ^7.6.14 | TypeScript types | Required for type safety |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| concurrently | ^9.2.1 | Run multiple npm scripts | Start both frontend and backend with one command |
| shadcn/ui | CLI (latest) | Component primitives | After Vite/Tailwind setup, add components as needed |
| lucide-react | ^0.563.0 | Icons | shadcn default icon library |
| class-variance-authority | ^0.7.1 | Component variants | shadcn dependency |
| clsx | ^2.1.1 | Class merging utility | shadcn dependency |
| tailwind-merge | ^3.0.1 | Tailwind class conflict resolution | shadcn dependency |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| concurrently | npm-run-all2 | npm-run-all2 has glob patterns and race mode; concurrently is simpler |
| /studio subdirectory | monorepo with pnpm | Monorepo adds complexity for single developer; simple subdirectory sufficient |
| better-sqlite3 | drizzle-orm | Drizzle adds abstraction layer; direct SQL simpler for schema setup |

**Installation:**

```bash
# Root package.json - add dev dependency
npm install -D concurrently

# Create studio directory and initialize
mkdir studio && cd studio
npm create vite@latest . -- --template react-ts
npm install tailwindcss @tailwindcss/vite
npm install lucide-react class-variance-authority clsx tailwind-merge

# Backend - add SQLite
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

## Architecture Patterns

### Recommended Project Structure

```
davidup/
  src/                      # Existing backend
    api/
      app.ts               # Add /studio/* routes here
      routes/
        studio.ts          # NEW: Studio-specific routes
      services/
        studio-db.ts       # NEW: SQLite database service
  studio/                   # NEW: Frontend
    src/
      components/
        ui/                # shadcn components
      lib/
        utils.ts           # cn() helper for Tailwind
      App.tsx
      main.tsx
      index.css            # @import "tailwindcss"
    index.html
    vite.config.ts
    tsconfig.json
    tsconfig.app.json
    package.json
  data/                     # NEW: SQLite database location
    studio.db
  package.json             # Root - add concurrently script
```

### Pattern 1: Vite Proxy to Hono (Development)

**What:** Vite dev server proxies API requests to Hono backend
**When to use:** Always during development
**Example:**

```typescript
// studio/vite.config.ts
// Source: https://vite.dev/config/server-options.html#server-proxy
import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy all /studio/* API calls to Hono backend
      '/studio': {
        target: 'http://127.0.0.1:3000',  // CRITICAL: Use 127.0.0.1 not localhost
        changeOrigin: true,
      },
      // Also proxy existing API routes for convenience
      '/render': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/generate': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/templates': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../dist/studio',
    emptyOutDir: true,
  },
})
```

### Pattern 2: Hono serveStatic (Production)

**What:** Hono serves built React app as static files
**When to use:** Production deployment (single process)
**Example:**

```typescript
// src/api/app.ts - add at end of file
// Source: https://hono.dev/docs/getting-started/nodejs
import { serveStatic } from '@hono/node-server/serve-static';

// In production, serve the built studio UI
if (process.env.NODE_ENV === 'production') {
  // Serve static files from dist/studio
  app.use('/assets/*', serveStatic({ root: './dist/studio' }));

  // SPA fallback - serve index.html for all other routes
  app.get('*', serveStatic({ path: './dist/studio/index.html' }));
}
```

### Pattern 3: SQLite Database Initialization

**What:** Initialize SQLite database with schema on first run
**When to use:** Backend startup
**Example:**

```typescript
// src/api/services/studio-db.ts
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'studio.db');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  -- Conversations table for chat history
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Messages within conversations
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  -- Templates saved from conversations
  CREATE TABLE IF NOT EXISTS studio_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    spec TEXT NOT NULL,
    conversation_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL
  );

  -- Template version history
  CREATE TABLE IF NOT EXISTS template_versions (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    spec TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (template_id) REFERENCES studio_templates(id) ON DELETE CASCADE
  );

  -- Video render history
  CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    template_id TEXT,
    filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    duration_ms INTEGER,
    file_size_bytes INTEGER,
    status TEXT DEFAULT 'completed',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (template_id) REFERENCES studio_templates(id) ON DELETE SET NULL
  );

  -- Create indexes for common queries
  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_template_versions_template ON template_versions(template_id);
  CREATE INDEX IF NOT EXISTS idx_videos_template ON videos(template_id);
`);

export default db;
```

### Pattern 4: Single Dev Command

**What:** One command starts both Vite and Hono servers
**When to use:** Development workflow
**Example:**

```json
// package.json (root)
{
  "scripts": {
    "dev": "concurrently -n api,studio -c blue,magenta \"npm run dev:api\" \"npm run dev:studio\"",
    "dev:api": "node --import tsx src/api/server.ts",
    "dev:studio": "npm run dev --prefix studio",
    "build": "npm run build:api && npm run build:studio",
    "build:api": "tsc",
    "build:studio": "npm run build --prefix studio",
    "start": "NODE_ENV=production node dist/api/server.js"
  }
}
```

### Anti-Patterns to Avoid

- **Using `localhost` in Vite proxy:** Node 17+ prefers IPv6 (::1) which may not match Hono's binding. Always use `127.0.0.1`.
- **Forgetting production static serving:** Vite proxy only works in dev. Must configure Hono to serve static files in production.
- **Shared package.json for frontend/backend:** Creates dependency conflicts (React vs Hono deps). Keep separate package.json files.
- **Dynamic Tailwind classes:** `bg-${color}-500` won't work - Tailwind can't detect dynamic class names. Use complete class names.
- **Running `npm install` in studio without `cd`:** Use `npm install --prefix studio` or `cd studio && npm install`.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Class name merging | Custom string concatenation | `clsx` + `tailwind-merge` | Edge cases with conflicting classes |
| Component variants | Inline conditionals | `class-variance-authority` | Type safety, maintainability |
| Dev server proxy | CORS middleware alone | Vite proxy | Eliminates CORS entirely in dev |
| Concurrent processes | Shell `&` operator | `concurrently` | Cross-platform, better output |
| SQLite connection | Manual file handling | `better-sqlite3` | Connection pooling, prepared statements |
| UUID generation | Custom implementation | `crypto.randomUUID()` | Built into Node.js, RFC 4122 compliant |

**Key insight:** The dev environment setup has many moving parts that interact. Using established patterns (Vite proxy, concurrently, better-sqlite3) means these interactions are already solved.

## Common Pitfalls

### Pitfall 1: IPv6 DNS Resolution Breaks Vite Proxy

**What goes wrong:** Vite proxy fails with `ECONNREFUSED ::1:3000` even though Hono is running
**Why it happens:** Node.js 17+ changed DNS resolution to prefer IPv6. `localhost` resolves to `::1` but Hono may bind to `127.0.0.1`
**How to avoid:** Always use `127.0.0.1` in Vite proxy target, never `localhost`
**Warning signs:** `Error: connect ECONNREFUSED ::1:3000` in console

### Pitfall 2: Tailwind Styles Missing in Production

**What goes wrong:** Styles work in dev but disappear after `npm run build`
**Why it happens:** Tailwind v4 scans files for class names. If content paths don't include all files, classes are purged
**How to avoid:** Verify all component paths are included. Test production build early with `npm run build && npm run start`
**Warning signs:** Some components styled, others unstyled in production

### Pitfall 3: Vite Config Changes Don't Take Effect

**What goes wrong:** Changes to `vite.config.ts` (especially proxy) don't work
**Why it happens:** Vite caches config. Config changes require full restart, not just HMR
**How to avoid:** Always restart `npm run dev` after config changes
**Warning signs:** "I added proxy config but it's not working"

### Pitfall 4: SQLite Database Locked

**What goes wrong:** Multiple requests cause "database is locked" errors
**Why it happens:** SQLite doesn't handle concurrent writes well without WAL mode
**How to avoid:** Enable WAL mode: `db.pragma('journal_mode = WAL')` - already in pattern above
**Warning signs:** Sporadic 500 errors during concurrent API calls

### Pitfall 5: React App Returns 404 in Production

**What goes wrong:** Direct URL navigation (e.g., `/templates/123`) returns 404 in production
**Why it happens:** Hono doesn't know about client-side routes. SPA needs index.html for all routes
**How to avoid:** Add SPA fallback: serve `index.html` for all non-API routes
**Warning signs:** Works from homepage, breaks on refresh or direct navigation

## Code Examples

Verified patterns from official sources:

### Tailwind v4 CSS Entry Point

```css
/* studio/src/index.css */
/* Source: https://tailwindcss.com/docs */
@import "tailwindcss";
```

No `@tailwind base/components/utilities` needed in v4. Just the single import.

### shadcn/ui cn() Helper

```typescript
// studio/src/lib/utils.ts
// Source: https://ui.shadcn.com/docs/installation/vite
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

### TypeScript Path Alias Configuration

```json
// studio/tsconfig.json
// Source: https://ui.shadcn.com/docs/installation/vite
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

```json
// studio/tsconfig.app.json - also needs paths
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

### Basic Studio Routes

```typescript
// src/api/routes/studio.ts
import { Hono } from 'hono';
import db from '../services/studio-db.js';

export const studioRoutes = new Hono();

// Health check for studio API
studioRoutes.get('/health', (c) => {
  return c.json({ status: 'ok', db: 'connected' });
});

// Get all conversations
studioRoutes.get('/conversations', (c) => {
  const conversations = db.prepare(`
    SELECT * FROM conversations ORDER BY updated_at DESC
  `).all();
  return c.json(conversations);
});

// Get all templates
studioRoutes.get('/templates', (c) => {
  const templates = db.prepare(`
    SELECT * FROM studio_templates ORDER BY updated_at DESC
  `).all();
  return c.json(templates);
});

// Get all videos
studioRoutes.get('/videos', (c) => {
  const videos = db.prepare(`
    SELECT * FROM videos ORDER BY created_at DESC
  `).all();
  return c.json(videos);
});
```

### Register Studio Routes in App

```typescript
// src/api/app.ts - add after existing routes
import { studioRoutes } from './routes/studio.js';

// Studio routes - no auth for local dev tool
app.route('/studio', studioRoutes);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PostCSS + autoprefixer for Tailwind | @tailwindcss/vite native plugin | Tailwind v4 (Jan 2025) | Simpler config, faster builds |
| tailwind.config.js required | Config optional (CSS-based config) | Tailwind v4 | Zero-config possible |
| `@tailwind base/components/utilities` | `@import "tailwindcss"` | Tailwind v4 | Single import |
| Vite 6 | Vite 7 | June 2025 | New browser targets, requires Node 20.19+ |
| npm-run-all (unmaintained) | npm-run-all2 or concurrently | 2024 | npm-run-all2 is maintained fork |

**Deprecated/outdated:**
- **PostCSS config for Tailwind v4:** Not needed with @tailwindcss/vite plugin
- **tailwind.config.js:** Optional in v4, can configure in CSS with `@theme`
- **CRA (Create React App):** Deprecated, use Vite
- **Node 18:** Dropped in Vite 7, use Node 20.19+ or 22.12+

## Open Questions

Things that couldn't be fully resolved:

1. **shadcn init with Tailwind v4**
   - What we know: shadcn CLI has v4 support, but may prompt for v3 vs v4 choice
   - What's unclear: Exact prompts and options during `npx shadcn@latest init`
   - Recommendation: Run init interactively, select v4/Tailwind options when prompted

2. **better-sqlite3 native module compilation**
   - What we know: better-sqlite3 requires native compilation, has prebuilts for LTS Node
   - What's unclear: Whether prebuilts exist for Node 22.12+ on macOS ARM
   - Recommendation: Install with npm, let it compile if prebuilt unavailable. If issues, use `--build-from-source`

## Sources

### Primary (HIGH confidence)
- [Vite Official Documentation](https://vite.dev/config/server-options.html) - proxy configuration verified
- [Vite 7.0 Announcement](https://vite.dev/blog/announcing-vite7) - version and requirements verified
- [Tailwind CSS v4 Installation](https://tailwindcss.com/docs) - Vite plugin setup verified
- [shadcn/ui Vite Installation](https://ui.shadcn.com/docs/installation/vite) - configuration verified
- [Hono Node.js Static Files](https://hono.dev/docs/getting-started/nodejs) - serveStatic API verified
- [better-sqlite3 NPM](https://www.npmjs.com/package/better-sqlite3) - version 12.6.2 verified
- [concurrently NPM](https://www.npmjs.com/package/concurrently) - version 9.2.1 verified

### Secondary (MEDIUM confidence)
- [React 19.2 Blog Post](https://react.dev/blog/2025/10/01/react-19-2) - version history verified
- [npm-run-all2 GitHub](https://github.com/bcomnes/npm-run-all2) - alternative to concurrently
- Project's existing research in `.planning/research/STACK.md` and `.planning/research/PITFALLS.md`

### Tertiary (LOW confidence)
- Community tutorials on Vite + React + Tailwind setup (patterns consistent with official docs)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All versions verified against npm registry and official announcements
- Architecture: HIGH - Patterns from official documentation, consistent with prior project research
- Pitfalls: HIGH - Documented in project research, verified against GitHub issues

**Research date:** 2026-01-27
**Valid until:** 30 days (stable technologies, unlikely to change significantly)
