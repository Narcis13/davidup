# Roadmap: GameMotion v0.2 Studio

## Milestones

- v0.1 MVP - Phases 1-6 (shipped 2026-01-26) - archived in milestones/v0.1-ROADMAP.md
- **v0.2 Studio** - Phases 7-10 (in progress)

## Overview

v0.2 adds a local development studio UI to GameMotion. The user creates video templates through conversational AI refinement, organizes them in a template library, triggers renders, and previews results in their system video player. Four phases deliver this workflow: project setup establishes Vite + React + SQLite integration with the existing Hono API, chat interface enables AI-assisted template creation, template library provides organization and persistence, and video library completes the render-to-preview loop.

## Phases

**Phase Numbering:**
- Continues from v0.1 (Phases 1-6)
- v0.2 uses Phases 7-10

- [ ] **Phase 7: Project Setup** - React + Vite + SQLite integrated with Hono API
- [ ] **Phase 8: Chat Interface** - Conversational AI template creation with streaming
- [ ] **Phase 9: Template Library** - Template CRUD with grid view and persistence
- [ ] **Phase 10: Video Library & Preview** - Video grid, template linkage, and render-to-player workflow

## Phase Details

### Phase 7: Project Setup
**Goal**: Developer can run single command to start integrated frontend + backend
**Depends on**: v0.1 complete (Phase 6)
**Requirements**: SETUP-01, SETUP-02, SETUP-03, SETUP-04, SETUP-05
**Success Criteria** (what must be TRUE):
  1. Running `npm run dev` starts both Vite dev server and Hono API
  2. React app loads in browser at localhost:5173 without errors
  3. API calls from React reach Hono backend via Vite proxy (no CORS errors)
  4. SQLite database file exists and studio tables are created
  5. Studio routes (/studio/*) respond on Hono API
**Plans**: TBD

Plans:
- [ ] 07-01: TBD
- [ ] 07-02: TBD

### Phase 8: Chat Interface
**Goal**: User can create and refine video templates through conversation with AI
**Depends on**: Phase 7
**Requirements**: CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06, CHAT-07, CHAT-08, CHAT-09
**Success Criteria** (what must be TRUE):
  1. User can type message and send it with visible send button
  2. Conversation history displays with clear visual distinction between user and AI messages
  3. AI response streams in real-time with typing indicator while generating
  4. User can copy generated JSON template to clipboard with one click
  5. User can send follow-up messages to refine template ("make it shorter", "change font")
  6. User can start fresh conversation that clears previous context
**Plans**: TBD

Plans:
- [ ] 08-01: TBD
- [ ] 08-02: TBD
- [ ] 08-03: TBD

### Phase 9: Template Library
**Goal**: User can save, organize, and manage their video templates
**Depends on**: Phase 8
**Requirements**: TMPL-01, TMPL-02, TMPL-03, TMPL-04, TMPL-05, TMPL-06
**Success Criteria** (what must be TRUE):
  1. User sees templates in grid/card layout showing name and last modified date
  2. User can click template card to view full JSON content
  3. User can save generated template from chat conversation to library
  4. User can delete templates from library
  5. User can name new templates and rename existing ones
**Plans**: TBD

Plans:
- [ ] 09-01: TBD
- [ ] 09-02: TBD

### Phase 10: Video Library & Preview
**Goal**: User can browse rendered videos and trigger new renders with one-click preview
**Depends on**: Phase 9
**Requirements**: VID-01, VID-02, VID-03, VID-04, VID-05, VID-06, PREV-01, PREV-02, PREV-03, PREV-04
**Success Criteria** (what must be TRUE):
  1. User sees rendered videos in thumbnail grid showing duration and file size
  2. User can click video to open it in system video player
  3. User can see which template created each video (template linkage visible)
  4. User can filter video grid by source template
  5. User can trigger render from template view and see progress indicator
  6. Video auto-opens in system player when render completes successfully
  7. User sees clear error message if render fails
  8. User can delete videos individually or in batch
**Plans**: TBD

Plans:
- [ ] 10-01: TBD
- [ ] 10-02: TBD
- [ ] 10-03: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 7 -> 8 -> 9 -> 10

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 7. Project Setup | 0/TBD | Not started | - |
| 8. Chat Interface | 0/TBD | Not started | - |
| 9. Template Library | 0/TBD | Not started | - |
| 10. Video Library & Preview | 0/TBD | Not started | - |

---
*Roadmap created: 2026-01-27*
*Requirements coverage: 30/30 (100%)*
