# Project Research Summary

**Project:** GameMotion v0.2 Studio
**Domain:** Local development UI for JSON-to-video rendering engine
**Researched:** 2026-01-27
**Confidence:** HIGH

## Executive Summary

GameMotion v0.2 adds a React + Tailwind frontend to the existing Hono API, creating a local development studio for AI-assisted video template creation. Research confirms this is a straightforward integration using battle-tested patterns from API dev tools (Postman, Insomnia), AI chat interfaces (Cursor, ChatGPT), and creative software (Figma). The recommended approach is to build with Vite + React 19 + Tailwind v4, use shadcn/ui components instead of chat libraries, manage server state with TanStack Query and UI state with Zustand, and serve the built frontend from the existing Hono server.

The key architectural decision is to use a flat monorepo structure with Vite proxy in development and static serving from Hono in production, avoiding the complexity of SSR frameworks, separate deployment, or authentication systems. This keeps the tool fast and frictionless for single-user local development.

The primary risks are CORS/proxy misconfiguration between Vite and Hono (which will block first API calls), SSE streaming state corruption (which will cause chat message duplication), and browser limitations around system player integration (which requires backend-triggered file opening). All three are preventable with proper configuration and architecture decisions made in Phase 1.

## Key Findings

### Recommended Stack

The research identified a minimal, modern stack that prioritizes developer experience and simplicity for local dev tools. Vite 7 provides the fastest HMR with native Tailwind v4 support, React 19 offers the latest stable features, and shadcn/ui delivers accessible, Tailwind-native components without opinionated styling conflicts.

**Core technologies:**
- **Vite 7.3.1**: Build tool and dev server — fastest HMR, native Tailwind v4 plugin, simple SPA build
- **React 19.2.4**: UI framework — latest stable, project scope requirement
- **Tailwind v4.1.18**: Styling — project scope, v4 has simpler Vite integration without PostCSS
- **shadcn/ui**: Component primitives — accessible, copy-paste model, no library lock-in
- **TanStack Query 5**: Server state management — auto caching, background refetch, optimistic updates
- **Zustand 5**: Client state management — 3KB, zero boilerplate, perfect for chat UI state
- **better-sqlite3**: Data persistence — synchronous API, fastest for Node.js, zero config
- **Hono serveStatic**: Production serving — single process, no separate deployment

**Anti-stack (explicitly avoid):**
- Next.js, Remix — SSR/RSC overkill for local dev tool
- Redux — over-engineered state management for single user
- WebSocket, Socket.io — polling + SSE sufficient for localhost
- Chat UI libraries — conflicts with Tailwind, simple to build from shadcn
- Monorepo tools — adds complexity without benefits at this scale

### Expected Features

Research identified clear feature priorities based on patterns from established dev tools and AI interfaces. The MVP should focus on the core workflow: chat for template generation/refinement, basic library for organization, and frictionless render-preview flow.

**Must have (table stakes):**
- Chat input at bottom with clear send button — universal pattern, expected by all users
- Visible conversation history with AI typing indicator — 77% of conversations are multi-turn
- Template library with grid/card view, names, and delete — basic CRUD, standard gallery pattern
- Video thumbnail grid linked to source templates — core value proposition of the tool
- One-click render with status indicator — Postman/Insomnia pattern for API dev tools
- Click to open video in system player — project spec, avoids streaming complexity
- Copy JSON output from chat — primary deliverable from AI conversation

**Should have (competitive):**
- Multi-turn refinement with context ("make it shorter") — Cursor pattern, enables iterative workflow
- Template version history timeline — Figma pattern, enables experimentation without fear
- Template-video linkage tracking — trace video back to source, debugging aid
- Variable substitution for testing — test templates with different data inputs
- Search and filter in libraries — scales as content grows
- Auto-open video in player after render — zero-friction workflow

**Defer (v2+):**
- Version comparison side-by-side — high complexity, nice-to-have
- @ mentions for templates in chat — power user feature, complex context injection
- Suggested refinement prompts — requires AI sophistication beyond MVP
- Visual template editor — scope creep, contradicts AI-first approach
- In-browser video playback — streaming complexity, out of scope

### Architecture Approach

The recommended architecture keeps the existing Hono API intact and adds React in an adjacent `/studio` directory with separate package.json. For development, Vite proxies API calls to Hono (avoiding CORS). For production, Vite builds static files served by Hono via serveStatic, creating a single-process deployment. All studio data (conversations, templates, videos) persists in a single SQLite database accessed only by the Hono backend, maintaining clean separation.

**Major components:**
1. **Hono API (existing)** — handles all business logic, adds `/studio/*` routes for UI-specific endpoints (conversations, template CRUD, video metadata, system player trigger)
2. **React Studio (new)** — browser-based UI in `/studio` subdirectory, communicates with API via fetch, manages UI state with Zustand and server state with TanStack Query
3. **SQLite Database (new)** — single `data/studio.db` file stores conversations, messages, templates, template versions, and video metadata with referential integrity
4. **System Player** — external process spawned by Hono backend when user clicks preview, avoids browser streaming limitations

**Key patterns:**
- Optimistic updates for chat — add message to UI immediately, reconcile with server
- Polling for job status — existing pattern, use `setInterval` with 1s delay until completion
- Backend-triggered player — POST `/studio/preview/:jobId` triggers `exec('open "path"')` on server
- Type sharing via Hono RPC or manual sync — start manual, migrate to Hono RPC when types stabilize
- Vite proxy with IPv4 addresses — use `127.0.0.1` not `localhost` to avoid Node 17+ IPv6 issues

### Critical Pitfalls

Research identified five critical pitfalls that will block progress if not addressed proactively. All have proven solutions.

1. **CORS misconfiguration between Vite and Hono** — Use Vite proxy in dev (eliminates cross-origin), configure `target: 'http://127.0.0.1:3000'` not `localhost`, serve static from Hono in production for same-origin
2. **Vite proxy only works in dev, fails in production** — Design API base URL to be empty string (same-origin) in production, serve React build from Hono with `serveStatic`
3. **SSE streaming state corruption in React** — Use AbortController for cleanup, functional setState updates for concurrent chunks, single message reference updated incrementally
4. **Browser cannot launch system player** — Accept browser limitation, implement POST `/studio/preview/:jobId` that triggers `exec('open')` on backend (safe for local dev tool)
5. **Tailwind styles missing in production build** — Configure content paths correctly in `tailwind.config.js`, avoid dynamic class names, test production build early

## Implications for Roadmap

Based on research, suggested phase structure follows dependency order and risk mitigation:

### Phase 1: Project Setup & Integration Foundation
**Rationale:** Must establish correct Vite-Hono integration before building features. CORS/proxy issues will block all API calls if not configured correctly from the start. Setting up SQLite, TypeScript paths, and development workflow prevents rework later.

**Delivers:**
- Vite + React project in `/studio` with Tailwind v4 and shadcn/ui installed
- Vite proxy configured for all API routes with IPv4 addresses
- SQLite database schema created with tables for conversations, messages, templates, videos
- Single `npm run dev` command that starts both servers
- Validation route (`/test-cors`) confirms API connectivity

**Addresses:**
- CORS configuration (Pitfall #1)
- Vite proxy production gap (Pitfall #2)
- Tailwind config (Pitfall #5)
- Monorepo package resolution (Pitfall #12)

**Avoids:**
- Over-engineering with monorepo tools — use simple flat structure
- Authentication UI — skip entirely for local dev
- Complex state management — defer until needed

**Research flag:** No additional research needed. Standard Vite + Hono integration with official documentation.

---

### Phase 2: Chat Interface with Streaming
**Rationale:** Chat is the core value proposition and most complex feature. Build early to validate streaming approach and state management patterns. Multi-turn refinement requires conversation context, so database integration happens here.

**Delivers:**
- Chat UI with input at bottom, message history, user/assistant styling
- POST `/studio/conversations` and `/studio/conversations/:id/messages` endpoints
- Streaming AI responses via SSE (Hono `streamSSE`)
- Conversation persistence in SQLite
- Copy JSON button for extracting templates
- AbortController cleanup preventing memory leaks

**Addresses:**
- Chat input, history, typing indicator (table stakes from FEATURES.md)
- Multi-turn refinement with context (competitive differentiator)
- Conversation history persistence

**Uses:**
- Zustand for chat state (isStreaming, messages)
- Hono SSE streaming helper
- better-sqlite3 for conversation storage

**Implements:**
- Optimistic updates pattern
- SSE with proper keep-alive and cleanup

**Avoids:**
- SSE connection limit issues — accept 6-connection limit for local dev (Pitfall #4)
- State corruption — use functional updates and AbortController (Pitfall #6)
- EventSource POST limitation — use fetch with ReadableStream instead (Pitfall #7)

**Research flag:** May need `/gsd:research-phase` for AI provider integration (OpenRouter, Anthropic, OpenAI) depending on provider choice.

---

### Phase 3: Template Library with Version History
**Rationale:** Users need to save and organize templates generated in chat. Version history enables experimentation without fear of losing work. Builds on SQLite foundation from Phase 2.

**Delivers:**
- Grid view of templates with cards (shadcn Card component)
- POST `/studio/templates`, GET `/studio/templates`, GET/PUT/DELETE `/studio/templates/:id`
- Template CRUD operations stored in SQLite
- Version history timeline (automatic on every save)
- "Edit in chat" action that loads template context into conversation
- Duplicate template for fast iteration
- Search/filter functionality

**Addresses:**
- Template library grid, names, delete (table stakes)
- Version history timeline (competitive differentiator)
- Duplicate template (competitive differentiator)

**Uses:**
- TanStack Query for template fetching and caching
- shadcn Card, ScrollArea, Button components
- SQLite template_versions table

**Implements:**
- Card view pattern from research (entire card clickable)
- Figma-style version timeline (named versions, preview before restore)

**Avoids:**
- Version comparison side-by-side — defer to v2+ (high complexity)
- Visual template editor — out of scope, contradicts AI-first approach

**Research flag:** No additional research needed. Standard CRUD + versioning patterns.

---

### Phase 4: Video Library & Preview Integration
**Rationale:** Completing the workflow loop from chat → template → render → preview. Video library provides visibility into render history. System player integration is the biggest unknown and should be validated before polish phase.

**Delivers:**
- Grid view of videos with thumbnails (extracted from first frame)
- POST `/studio/videos`, GET `/studio/videos`, GET `/studio/videos/:id`
- Video metadata stored in SQLite with link to template_id and conversation_id
- POST `/studio/preview/:jobId` endpoint that triggers system player via `exec('open')`
- Filter videos by source template
- "Render" button from template detail view

**Addresses:**
- Video thumbnail grid, click to play, template linkage (table stakes)
- Auto-open in player after render (competitive differentiator)
- Render button with status indicator (table stakes)

**Uses:**
- Hono backend to trigger system player (only safe approach)
- FFmpeg for thumbnail extraction (already in dependencies)
- Polling pattern for job status (existing pattern)

**Implements:**
- Backend-triggered player pattern (Pitfall #8 solution)
- File path normalization for cross-platform support (Pitfall #9)
- Video-template linkage tracking

**Avoids:**
- In-browser video playback — out of scope, use system player
- Batch delete — defer to post-MVP

**Research flag:** May need `/gsd:research-phase` for FFmpeg thumbnail extraction if not already implemented.

---

### Phase 5: Polish & Production Build
**Rationale:** Validate production deployment works correctly. Test on different OS (macOS/Windows) if possible. Add final UX improvements based on dogfooding.

**Delivers:**
- Production build configuration (Vite builds to `dist/ui`, Hono serves static)
- Loading states for all API calls (spinners, skeletons)
- Error handling with retry actions
- Empty states for libraries
- Keyboard shortcuts (Enter to send, Cmd+K to clear chat)
- Production build testing on macOS and Windows

**Addresses:**
- Loading/error states (Pitfall #14)
- Production build differences (Pitfall #2)
- OS path handling (Pitfall #9)

**Uses:**
- Hono `serveStatic` for production serving
- shadcn Skeleton components for loading states

**Avoids:**
- Custom themes — single clean theme sufficient
- Notification system — status indicators sufficient for single user
- Keyboard shortcut customization — fixed sensible defaults

**Research flag:** No additional research needed. Standard production hardening.

---

### Phase Ordering Rationale

- **Phase 1 first:** Infrastructure must be correct before building features. CORS/proxy issues block all API communication.
- **Phase 2 next:** Chat is the core differentiator and most complex feature. Validates state management and streaming patterns early.
- **Phase 3 before Phase 4:** Templates are created before videos, dependency order follows user workflow.
- **Phase 4 before Phase 5:** System player integration is the biggest unknown, validate before polish.
- **Phase 5 last:** Production build and UX polish after core features proven.

**Dependency chain:**
```
Phase 1 (setup)
    ↓
Phase 2 (chat) → creates templates
    ↓
Phase 3 (template library) → organizes templates
    ↓
Phase 4 (video library) → renders from templates
    ↓
Phase 5 (polish) → production hardening
```

### Research Flags

**Phases likely needing deeper research during planning:**
- **Phase 2:** AI provider integration — need to choose between OpenRouter, Anthropic, OpenAI and research specific streaming implementation
- **Phase 4:** FFmpeg thumbnail extraction — if not already implemented, need to research command syntax and error handling

**Phases with standard patterns (skip research-phase):**
- **Phase 1:** Vite + Hono integration well-documented, official docs sufficient
- **Phase 3:** CRUD operations and version history are standard patterns
- **Phase 5:** Production build and error handling are standard React patterns

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies verified against official docs and npm registry, versions confirmed available |
| Features | HIGH | Patterns validated against 5+ reference tools (Cursor, ChatGPT, Postman, Insomnia, Figma) |
| Architecture | HIGH | Based on existing codebase analysis and official Hono/Vite documentation |
| Pitfalls | HIGH | All pitfalls sourced from GitHub issues, official discussions, and production experience reports |

**Overall confidence:** HIGH

Research is backed by official documentation, verified package versions, and established patterns from production tools. The local dev tool scope reduces uncertainty around scaling, authentication, and deployment complexity.

### Gaps to Address

- **AI provider choice:** Research doesn't recommend specific provider (OpenRouter vs Anthropic vs OpenAI). Decision needed in Phase 2 based on cost, rate limits, and model quality preferences.
- **FFmpeg thumbnail extraction:** Assumed existing FFmpeg integration can handle thumbnail generation. Verify in Phase 4 or add as research task.
- **Windows testing:** Research based primarily on macOS patterns. File path handling and system player commands need validation on Windows (alternative: accept macOS-only for MVP).
- **SSE connection limits:** Research identifies 6-connection limit but recommends accepting limitation for local dev. Monitor during testing — if it's painful, implement BroadcastChannel sharing pattern.

## Sources

### Primary (HIGH confidence)
- [Vite Official Documentation](https://vite.dev/config/server-options.html) — proxy configuration, build options
- [Hono Official Documentation](https://hono.dev/docs/) — CORS middleware, streaming, serveStatic
- [Tailwind CSS v4 Documentation](https://tailwindcss.com/docs) — Vite plugin integration
- [shadcn/ui Documentation](https://ui.shadcn.com/docs/installation/vite) — Vite installation, component usage
- [TanStack Query Documentation](https://tanstack.com/query/latest/docs/framework/react/overview) — caching, optimistic updates
- [React Official Documentation](https://react.dev/) — hooks, cleanup, streaming patterns
- NPM Registry — all package versions verified as available and stable

### Secondary (MEDIUM confidence)
- [Cursor AI Features](https://cursor.com/features) — chat patterns, @ mentions, diff view
- [Postman vs Insomnia Comparison](https://apyhub.com/blog/postman-vs-insomnia) — dev tool UX patterns
- [Figma Version History Strategies](https://www.nobledesktop.com/learn/figma/strategies-for-managing-design-updates-with-figmas-version-history) — version timeline patterns
- [Chat UI Design Patterns 2025](https://bricxlabs.com/blogs/message-screen-ui-deisgn) — input placement, hierarchy
- [PatternFly Design System](https://www.patternfly.org/) — conversation design, card views
- [GitHub Issues and Discussions](https://github.com/vitejs/vite/discussions/) — Vite proxy IPv6, CORS, production build

### Tertiary (LOW confidence)
- [State Management in 2026](https://www.nucamp.co/blog/state-management-in-2026-redux-context-api-and-modern-patterns) — trends and patterns, needs validation in practice
- [Monorepo Setup Tutorials](https://blog.abrocadabro.com/set-up-a-turborepo-monorepo-with-vite-typescript-tailwind-express-and-react-vue) — setup patterns, not official docs

---
*Research completed: 2026-01-27*
*Ready for roadmap: yes*
