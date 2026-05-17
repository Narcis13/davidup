---
doc_type: prd + build-plan
doc_title: davidup v1.0 — Visual Editor PRD & Build Plan
version: v1.0
date: 2026-05-14
author_email: narcis75@gmail.com
companion_to: davidup-saas-vision.html
target_ship: 12 weeks (3 months) from start, +1 week buffer for experiments
stack_decision: AdonisJS 6 (or v7) + Inertia + Vue 3 + Postgres on Hetzner Falkenstein
distribution: single npm package; `npx davidup edit ./project`
sections:
  - 01 eval — state of the codebase today
  - 02 stack — AdonisJS vs Laravel decision
  - 03 prd — goals, non-goals, personas, FRs, NFRs
  - 04 architecture — three layers, one process
  - 05 phases — 5 implementation phases (+1 buffer)
  - 06 steps — first 20 sequenced build tasks
  - 07 risks — 6 risks with mitigations
  - 08 dod — 8 un-skippable gates
---

# davidup v1.0 — Visual Editor PRD & Build Plan

## Thesis

Build the editor on the stack that **already lives inside the engine** — not the one optimised for someone else's market.

This document does three things:
1. Evaluates what davidup is today against what v1.0 has to be.
2. Argues explicitly (with receipts) that AdonisJS 6 (soon 7) is the right SaaS shell for davidup, even though Laravel is the right answer for the EU-B2B CRMs that the boring-saas research targets.
3. Lays out a PRD, an architecture sketch, and a phased build plan tight enough to commit to.

Key principles (hero meta):
- One TypeScript runtime, end to end.
- Engine is already the renderer; editor just orchestrates it.
- MCP server keeps a process, not a translation layer.
- Local-first v1.0 — SaaS-ready architecture from day one.

---

## 01 — State of the codebase (2026-05-14)

**Headline:** The engine is roughly 80% of v1.0. The other 20% is a UI.

The repo on `main` today contains a real, working composition runtime:
- Dual-driver renderer: Node skia-canvas + ffmpeg / Browser Canvas2D + RAF.
- Canonical Zod schema.
- Precompile pipeline that handles templates, scenes, behaviors, `$ref`, params.
- MCP server (stdio).
- Comprehensive 20s example exercising 17 items / 7 layers / 93 tweens.
- Composability layer specified down to error codes (`ARCHITECTURE.md` §8).
- v0.2 primitive proposal fully written (`COMPOSITION_PRIMITIVES.md`).

What's missing: the surface a human authoring through clicks would touch.

### Readiness matrix

| Area | What's there | Readiness |
|---|---|---|
| Engine core | `computeStateAt`, polymorphic `lerp`, hold-after-end, group/anchor transform stack. Determinism is a load-bearing invariant. | 100% — production |
| Schema & validator | Zod-typed composition; 8 validation rules including tween-overlap and group-cycle detection. | 95% — versioning TBD |
| Renderer (Node) | skia-canvas → ffmpeg stdin pipe, backpressure handled, canvas reuse. Real MP4 output validated. | 90% — codec edge cases |
| Renderer (Browser) | `attach()` + RAF loop; same `Canvas2DContext` contract as Node. Vite-served demos in `examples/`. | 90% — same code path |
| Composability (v0.2) | Templates, scenes (sealed), behaviors, `$ref`, params, precompile — implemented in `src/compose`. | 75% — content-addressed library still on paper |
| MCP server | 22 tools dispatched (add_*, update_*, define_scene, render_preview_frame, render_to_video, validate, etc.). stdio transport. In-memory store. | 85% — persistence layer missing |
| Visual editor | Nothing yet. The browser examples are *viewers*, not editors — no inspector, no timeline UI, no drag, no source-map. | 0% — v1.0 work |
| Persistence / multi-doc | JSON files on disk, manually authored. No project model, no asset registry, no library index. | 10% — needs a real store |
| Source maps (authored → resolved) | Mentioned in vision as the "killer demo"; no implementation. Precompile currently throws away authorship. | 0% — explicit v1.0 scope |
| Render queue / progress | Synchronous CLI render today. No job model, no progress events, no SSE. | 5% — v1.0 deferred to v1.1 |
| Auth / multi-tenancy | None — single user, local. Correct for v1.0; will be the v2.0 turn. | N/A for v1.0 |

**Takeaway:** The engine is not the bottleneck. v1.0 work is a *shell* — a project model, a library index, a four-panel editor surface that talks to the engine, and source maps so "click in stage → highlight in JSON" actually works. None of that requires re-engineering the runtime; all of it lives on top of code that already exists.

---

## 02 — Stack decision

### Verdict

**Use AdonisJS 6 (or v7 if it's stable when you start) + Inertia + Vue 3 + Postgres on Hetzner Falkenstein.**

The boring-saas docs recommend Laravel because they assume forms-heavy, ANAF/e-Factura-heavy, Filament-shaped CRM products. Davidup is none of those. It is:
1. A highly interactive single-page editor,
2. Whose core domain logic is already TypeScript,
3. Whose extensibility surface is MCP.

Those three properties flip the default.

### Nine explicit arguments for AdonisJS

**ARG 01 — DOMAIN LOGIC IS TS.** The engine, schema, and MCP server are all TypeScript. Pick Laravel and you build a translation layer: Zod schemas re-expressed in PHP, the engine running in a sidecar Node process, two type systems drifting. Pick AdonisJS and the editor server *imports* `davidup/schema`. The same `Composition` type validates a POST body and runs the renderer.

**ARG 02 — THE UI IS A SPA.** Inertia + Vue 3 is the right shape for a video editor. Timeline drag, stage-canvas hit-testing, inspector reactivity, panel resizing, undo/redo — rich client-state territory. Livewire round-trips per interaction would hurt. Boring-saas docs literally name this case: *"App is frontend-interactive — Inertia + Vue 3 beats Livewire here."*

**ARG 03 — MCP STAYS A PROCESS.** The MCP server is already TS. In AdonisJS, the existing MCP entry point is just another `start/` file. The agent talks to the same composition store the editor mutates. In a Laravel world it would be a separate Node process behind an HTTP wall — extra moving parts for zero benefit.

**ARG 04 — RENDER QUEUE PRIMITIVES.** BullMQ + Redis (Node-native) maps cleanly to per-frame work. Skia-canvas + ffmpeg already lives in Node. A worker is `node ace queue:work` + an existing function call. With Laravel/Horizon you'd shell out, parse stdout, lose backpressure on the ffmpeg stdin pipe, and gain nothing.

**ARG 05 — SSE FOR RENDER PROGRESS.** AdonisJS Transmit is first-party. Laravel Reverb is overkill. Render progress is one-way (server → editor), low-volume, per-job. Transmit's SSE model is exactly the right shape and survives Cloudflare proxying cleanly. Reverb adds a WebSocket server and a broadcaster you don't need.

**ARG 06 — NO E-FACTURA / NO FILAMENT.** Davidup's domain isn't Romanian invoicing. The two strongest Laravel wins in the boring-saas comparison — mature ANAF/e-Factura libs and Filament admin — don't apply to a content platform. Filament's CRUD-table aesthetic is the wrong shape for a video editor surface, period.

**ARG 07 — ASSETS & STREAMING.** Node handles uploads, video transcodes, and stdin pipes natively. Multipart upload → ffprobe → thumbnail extraction → S3/R2 put. In Node this is a single async pipeline with backpressure. In PHP-FPM it's a chain of shell-outs you babysit with timeouts.

**ARG 08 — CLAUDE WRITES CODE FOR THIS.** AI-code quality on AdonisJS is excellent in 2026. The Laravel-has-more-training-data argument is real for raw CRUD scaffolds, but AdonisJS 6 is documented well enough that Claude handles it cleanly — and the rest of davidup is TypeScript anyway, where Claude is strongest. No translation overhead.

**ARG 09 — ONE BINARY MENTAL MODEL.** Local dev is `bun`, prod is `node`, both runs share a tsconfig. Engine already targets Bun in dev. AdonisJS runs cleanly on Node 22 (or 24 with v7). One language, one package manager, one lockfile, one type-checker. The PHP context-switch cost every time you cross the server/engine boundary disappears.

### Stack comparison (davidup-specific)

| Factor | Laravel + Livewire + Filament | AdonisJS 6 + Inertia + Vue | Tiebreaker |
|---|---|---|---|
| Share schema with TS engine | LOSE — re-implement in PHP | WIN — import `davidup/schema` | AdonisJS — by miles |
| Mount existing MCP server in-process | LOSE — requires sidecar | WIN — native | AdonisJS |
| Highly interactive editor UI | MEH — Livewire workable | WIN — Inertia + Vue native | AdonisJS |
| Render worker invokes the engine | LOSE — shell-out to Node | WIN — direct function call | AdonisJS |
| SSE render-progress streaming | MEH — Reverb | WIN — Transmit (first-party) | AdonisJS |
| Admin / staff panel | WIN — Filament 4 strong | MEH — build a Vue page | Laravel (but not v1.0 priority) |
| Romanian e-Factura | WIN — mature libs | MEH — DIY if ever needed | N/A — davidup isn't EU B2B invoicing |
| Forms-heavy CRUD | WIN — Filament generators | MEH — hand-rolled | N/A — editor isn't forms |
| Asset uploads / ffprobe / thumbnails | MEH — PHP-FPM + shell-out | WIN — native Node streams | AdonisJS |
| Memory footprint per app | MEH — ~150 MB / FPM worker | WIN — ~60 MB RSS / PM2 instance | AdonisJS — matters for cheap VPS |
| One mental model across stack | LOSE — PHP server + TS engine | WIN — TS end-to-end | AdonisJS |
| Solo founder deploy automation | WIN — Ploi €8/mo | MEH — Coolify or GH Actions + SSH | Laravel — but one-time cost |

**Shape of the decision:** Laravel wins on *ecosystem maturity* for B2B-CRM specifics that davidup doesn't have. AdonisJS wins on *structural fit* for the product davidup actually is. Structural fit beats ecosystem maturity when the ecosystem advantages don't apply to your domain. They don't.

**v6 vs v7 caveat (imported from boring-saas docs):** *"AdonisJS v7 shipped Feb 25 2026 — incremental upgrade to v6 with minimal breaking changes."* If you start the editor in May/June 2026 and v7's plugin ecosystem is healthy, start on v7. Otherwise start on v6 and migrate after Filament-style stabilisation (~6 months post-release).

---

## 03 — PRD (v1.0 Visual Editor — local-first, SaaS-ready)

**Mission:** An editor that earns the right to exist by being the fastest way to ship a deterministic clip.

### Goals
- One-line install runs a local server with a real editor in the browser.
- Open / create / save a `composition.json` project as a first-class document.
- Per-scene tabbed editing surface over canonical JSON — never a raw-text editor.
- Three-panel layout: Library (left), Stage (center), Inspector (right), Timeline (bottom).
- Drag-to-add for templates, behaviors, scenes from a local library index.
- Click stage item → highlight in inspector + reveal source line (source-map driven).
- Render to MP4 from the editor with progress feedback.
- Single-binary distribution: `npx davidup edit ./my-project`.
- Engine determinism preserved end-to-end — pixels match server render.
- Architecture chosen so v2.0 SaaS turn is a deploy + auth bolt-on, not a rewrite.

### Non-goals (v1.0)
- Multi-user collaboration, auth, billing, multi-tenancy — that's v2.0.
- Hosted render farm — v1.0 renders on the user's machine.
- Marketplace / public library publishing — that's v2.1.
- AI brain inline — deferred to v1.2 (MCP is wired, but no UI strip).
- Brand-kit enforcement — deferred to v1.1.
- Comments / review links / shareable preview URLs — v2.0+.
- Mobile / tablet — desktop Chromium-class browser only.
- Beating After Effects on motion depth — wrong battle.
- A new audio engine. Audio is v0.2+ engine work, not editor work.

### Personas

**P1 · Narcis — the dogfooder (solo founder / engine author).**
Builds davidup, runs the experiments listed in the vision doc, ships personal launch videos and investor updates using the engine he wrote. Has been authoring JSON by hand and feels the pain.
*Wants from v1.0:* "Stop forcing me to alt-tab between VS Code and a viewer. Show me my JSON visually. Let me drop a kenburnsImage on a scene without re-reading the spec."

**P2 · Iulia — the dev-adjacent creator (indie creator, ships YouTube intros).**
Comfortable in a terminal, can read JSON, won't write JSX. Has a portfolio site, wants reproducible, parameterised motion graphics for her video channel.
*Wants from v1.0:* "Drop my logo, my fonts, my colors once — then make me ten 15-second intros without touching code. Render locally; my laptop can handle it."

**P3 · Claude — the LLM (agent driving via MCP).**
Already drives the engine via the existing MCP server. In v1.0 it stays a first-class peer — the editor surface is one of two ways to mutate the same in-memory composition store; the MCP is the other.
*Wants from v1.0:* "When the user clicks a tween in the timeline and I'm asked to modify it, give me the exact same handle the UI used. Don't fork the data model."

### Functional requirements

Priority: **P0** = must, **P1** = should, **P2** = nice. Numbered for traceability.

- **FR-01 (P0) Local project model.** A "project" is a directory: `composition.json`, `library/`, `assets/`, `renders/`. Editor opens any directory containing a valid `composition.json`; `davidup new` scaffolds one.
  - *Acceptance:* open + save round-trips byte-equal canonical JSON; broken JSON shows error overlay, doesn't crash editor.

- **FR-02 (P0) Three-panel editor shell.** Library (left), Stage (center), Inspector (right), Timeline (bottom). Panels resizable; layout persisted per-project. Matches the mockup in the vision doc — same panel taxonomy, same color-code legend.
  - *Acceptance:* all four panels render against the comprehensive demo composition with no errors.

- **FR-03 (P0) Stage: live preview through the production engine.** Center stage uses the *existing* browser driver (`attach()` + Canvas2D) — never a parallel renderer. Playhead scrub seeks deterministically. Hit-testing on click identifies the topmost item by id.
  - *Acceptance:* pixel-diff between `attach()` at `t=2.4s` and `renderFrame()` at `t=2.4s` is byte-identical for the demo comps.

- **FR-04 (P0) Inspector: typed param editing.** Reads the Zod schema for the selected item; renders each field with a typed input (number, color picker, enum, percent, time). Overridden values are visually distinct from defaults. Edits debounce-write through the same mutator the MCP uses.
  - *Acceptance:* changing `opacity` to 0.5 immediately updates the stage; reload re-applies it from disk.

- **FR-05 (P0) Timeline: semantic, color-coded bars.** One row per item; bars are templates (orange), behaviors (green), scenes (gold). Drag-to-move, drag-to-resize, snap to 0.25s grid. Sealed scenes are non-editable from the timeline; double-click tabs into them.
  - *Acceptance:* drag a behavior bar 0.5s right → tween's `from` and `to` shift; serialised JSON matches expectation.

- **FR-06 (P0) Library panel: search & drag-to-add.** Tabs: Templates, Behaviors, Scenes, Assets, Fonts. Cards show name, source pack, 1-second auto-generated preview. Drag a template onto a track → emits typed instance with brand defaults pre-bound.
  - *Acceptance:* dropping `brand::titleCard` on an empty track creates a valid composition; engine renders it without warnings.

- **FR-07 (P0) Local library index.** Project-scoped: `library/index.json` lists every behavior / template / scene / asset / font available in this project. `davidup pack add <path>` imports a third-party pack; the index regenerates on watch.
  - *Acceptance:* adding a new `.behavior.json` to `library/` appears in the Library panel within 1s.

- **FR-08 (P0) Source maps: authored ↔ resolved.** The precompile pipeline emits a per-item map: resolved item / tween → originating template instance / behavior call / source line. Clicking an item in the stage reveals (and scrolls to) its source location.
  - *Acceptance:* the "Reveal in source ⌘J" shortcut in the mockup actually works on the comprehensive demo.

- **FR-09 (P0) Undo / redo (linear, project-scoped).** Every mutation goes through a single command bus. Undo stack is 50 deep, in-memory. AI-driven mutations and UI-driven mutations share the same stack.
  - *Acceptance:* 10 mixed edits + 10 undos restores byte-equal JSON.

- **FR-10 (P0) Render-to-file from the editor.** "Render ▸" button kicks off a local skia-canvas + ffmpeg render. Progress strip shows frame N / total, ETA, current bitrate. Output lands in `renders/<timestamp>.mp4`.
  - *Acceptance:* 12s comp at 1080p30 renders, file opens in QuickTime, ffprobe metadata is sane.

- **FR-11 (P1) Per-scene tab navigation.** Top tabs list all scenes in the composition. Switching tabs changes the focused stage / timeline / inspector to that scene's contents. Tabs are reorderable.
  - *Acceptance:* the four-scenes example loads with four tabs; each scene previews correctly.

- **FR-12 (P1) Assets panel — drag-in upload.** Drop a PNG/JPG/MP3/MP4 on the editor → copied to `assets/`, registered in `library/index.json`, hash-named for dedupe. Thumbnail extracted (video → ffprobe; audio → waveform).
  - *Acceptance:* drop a logo, drag it to the stage, reload — same hash, same pixels.

- **FR-13 (P1) Diff overlay for AI edits (foundation only).** When a mutation enters the command bus tagged `source: "mcp"`, the inspector shows a one-line rationale and a "what changed" diff. Full AI strip is v1.2; the plumbing ships in v1.0.
  - *Acceptance:* MCP-driven `update_item` call shows in undo-stack with `source: "mcp"`.

- **FR-14 (P1) Validation surfacing.** The 8 validator rules run on every save. Errors render in a bottom status bar; warnings in a sidebar. Clicking an error reveals the source location.
  - *Acceptance:* introduce a tween overlap → red dot in timeline + error in status bar.

- **FR-15 (P2) Thumbnail strip in timeline.** Below the ruler, a horizontal strip of 8–16 rendered thumbnails of the current scene. Re-rendered on idle. Same code path as `render_thumbnail_strip`.
  - *Acceptance:* strip generates < 500ms after scene becomes idle.

- **FR-16 (P2) Keyboard-first shortcuts.** Play/pause: Space. Split clip: S. Delete: Backspace. Fit timeline: ⌘0. Reveal in source: ⌘J. Render: ⌘R. Save: ⌘S.
  - *Acceptance:* documented in a help overlay; all P0 shortcuts implemented.

### Non-functional requirements

- **NFR-01 (P0) Stage frame budget.** Playback ≥ 30 fps on a 2023 MacBook Air for the comprehensive demo (17 items, 7 layers, 93 tweens). Scrubbing the playhead is sub-100ms perceived.
- **NFR-02 (P0) Determinism preserved.** Edits made through the UI must produce JSON byte-identical to the equivalent edits made via MCP. Pixel output of stage at time `t` equals server render at `t`.
- **NFR-03 (P0) Cold-start to first edit.** From `npx davidup edit .` to the editor showing the project < 3 seconds on a warm cache.
- **NFR-04 (P1) One-binary distribution.** Editor server, engine, MCP, and the Vite-built frontend ship as a single Node-compatible package on npm. No separate frontend deploy.
- **NFR-05 (P1) Stack discipline.** Server: AdonisJS 6 (or v7) on Node 22, session auth scaffolded but no-op locally. Frontend: Inertia + Vue 3 + Vite. DB: SQLite locally (Lucid + better-sqlite3), Postgres-ready for v2.0. Same project structure as the boring-saas-template's `adonis-app`.

---

## 04 — Architecture sketch (v1.0)

**Headline:** Three layers. One process. No translation.

The editor is an AdonisJS HTTP + WebSocket server that owns the project's *session state*, imports the engine package directly, and serves an Inertia + Vue 3 SPA. The MCP server is the same composition store, exposed over stdio. Renders run in-process for the first frame, in a worker thread for the full file.

### Components

**Client — Editor SPA**
- Inertia + Vue 3 + Vite.
- Owns: panel layout, timeline drag, stage canvas (mounts the engine's browser driver), inspector, library panel, undo/redo.
- Files: `inertia/pages/editor.vue`, `composables/useStage.ts`, `composables/useCommandBus.ts`, `davidup/browser → attach()`.

**Server — AdonisJS shell**
- Loads a project from disk on boot.
- Exposes HTTP routes (open / save / render-start / asset-upload).
- An SSE channel for render progress.
- An in-process command bus that mediates all mutations.
- Files: `app/controllers/projects_controller.ts`, `app/controllers/renders_controller.ts`, `app/services/command_bus.ts`, `app/services/project_store.ts`.

**Engine — davidup core (unchanged)**
- Imported as `davidup/engine`, `davidup/schema`, `davidup/browser`, `davidup/node`, `davidup/mcp`. The editor is a consumer; no engine APIs change for v1.0.
- Files: `src/schema` (Zod), `src/compose` (precompile), `src/engine` (resolver), `src/drivers/{browser,node}`, `src/mcp` (stdio).

### Flow

1. User drops `brand::titleCard` on a track.
2. Vue component dispatches `command.addTemplate`.
3. AdonisJS command bus validates against Zod, applies to `project_store` (in-memory), writes to disk debounced.
4. Stage observable emits → browser driver's `seek()` re-renders.
5. On Render ▸, controller spawns worker thread → engine + ffmpeg → SSE progress events → editor strip updates.

### Why one bus, two clients

Every mutation — from the UI *or* from the MCP server — goes through the same `command_bus`. The UI client opens a WebSocket; the MCP client opens stdio. Both produce typed `Command` objects validated by the same Zod schema as the composition itself. Determinism, undo, and source-tagging all fall out of this naturally.

```ts
// app/services/command_bus.ts
export type Command =
  | { kind: 'addItem',    payload: AddItemInput,    source: 'ui' | 'mcp' }
  | { kind: 'updateItem', payload: UpdateItemInput, source: 'ui' | 'mcp' }
  | { kind: 'addTween',   payload: AddTweenInput,   source: 'ui' | 'mcp' }
  | /* ...22 of these, one per existing MCP tool */

export class CommandBus {
  async apply(cmd: Command): Promise<CommandResult> {
    const validated = commandSchema.parse(cmd)
    const next = applyCommand(this.store.composition, validated)
    const errors = validateComposition(next)         // engine's existing validator
    if (errors.length) throw new ValidationError(errors)
    this.undoStack.push(this.store.composition)
    this.store.composition = next
    this.observers.emit('change', { cmd, next })
    await this.store.persistDebounced()
    return { ok: true, sourceMap: this.store.sourceMap }
  }
}
```

### Persistence — local v1.0 vs hosted v2.0

- **v1.0:** reads/writes `composition.json` directly on disk; uses SQLite (via Lucid) only for the local editor's session state — open panels, last cursor position, recent projects.
- **v2.0:** swaps the SQLite session store for Postgres, the filesystem project loader for an S3/R2 object store, and bolts `@adonisjs/auth` onto the existing controllers. **No controller signature changes.**

---

## 05 — Implementation phases (5 phases + 1 buffer, ~12 weeks)

Phasing is goal-backwards from the vision doc's v1.0 deadline (now → +3 months). Each phase produces something runnable; no phase is "infrastructure only." Demos use existing `examples/` comps — they're already the validation set.

### P1 · AdonisJS shell + project model — Weeks 1–2 (setup + shell)
Bootstrap the AdonisJS 6 app from the boring-saas-template scaffold. Wire the engine packages, the project loader, and one Inertia page that renders the comprehensive demo via `attach()`.
Deliverables:
- Repo scaffold: `apps/editor/`.
- `davidup edit .` CLI.
- Open / save / autosave to disk.
- Inertia page mounts the engine's browser driver.
- Demo: comprehensive comp plays end-to-end in the editor window.

### P2 · Library / Inspector / Timeline panels — Weeks 3–5 (three panels live)
Build the three panels against the existing composition schema. Inspector reads Zod, renders typed inputs. Timeline reads tweens, renders semantic bars. Library reads `library/index.json`, renders cards.
Deliverables:
- Library panel reads local index.
- Inspector reflects selection, edits flow through command bus.
- Timeline drag-to-move + drag-to-resize.
- Undo/redo bus shared by all three panels.
- Demo: edit titleCard params live; reload preserves edits.

### P3 · Source maps end-to-end — Weeks 6–7 (source maps + reveal)
The killer feature in the vision doc. Modify the precompile pipeline to emit a resolved-item → authored-location map. Stage hit-testing uses it. Inspector "Reveal in source" jumps to the originating template instance / behavior call.
Deliverables:
- Source-map output from `precompile()`.
- Stage click → inspector selects + scrolls source pane.
- "Reveal in source ⌘J" shortcut.
- Diff overlay placeholder for AI edits.
- Demo: click a pixel in a sealed scene → highlights the scene definition file + the offending behavior call.

### P4 · Drag-to-compose + assets pipeline — Weeks 8–10 (library + drag + assets)
Library cards become draggable. Drop on track / stage emits typed instances with brand defaults bound. Drop a file on the editor → asset upload pipeline runs ffprobe / thumbnail extraction, writes to `assets/`, registers in the library index.
Deliverables:
- Drag-to-add for templates / behaviors / scenes.
- Asset upload pipeline (image / video / audio).
- Auto-thumbnail strip on library cards.
- Validation surfacing in status bar.
- Demo: build a 30s clip from scratch by dragging only — no manual JSON.

### P5 · Render-from-editor + polish + ship — Weeks 11–12 (render + ship)
Render ▸ kicks off worker-thread render with SSE progress. Keyboard shortcuts. Validation polish. `npx davidup edit` as a single-binary install. README + a 90-second demo video (rendered with the editor, naturally).
Deliverables:
- Worker-thread render path.
- SSE progress channel via Transmit.
- Keyboard shortcuts (all P0).
- Help overlay.
- `npx davidup edit ./project` as the install path.
- Demo: 90s clip rendered, exported, posted.

### P6 · Run the five vision-doc experiments — +1 wk buffer (validation experiments)
Vision doc names five experiments that gate any SaaS work. Each experiment is a real project authored in the editor you just built.
Deliverables:
- One real personal project shipped (Experiment 1).
- One brand kit + three scenes self-authored (Experiment 2).
- Three AI-driven videos via MCP (Experiment 3).
- Three target-buyer demo sessions (Experiment 4).
- One paid render delivery (Experiment 5).

---

## 06 — Step-by-step build (first 20 steps)

Concrete sequenced tasks for solo execution with Claude as co-engineer. Each step has explicit inputs, outputs, and files touched. No step depends on a future step's design decisions. Steps 21+ are P1/P2 polish (per-scene tabs, thumbnail strip in timeline, more inspector input types, diff overlay for AI edits) — none gate 1.0 ship.

**01 — Bootstrap the AdonisJS editor app.**
From the boring-saas-template's adonis-app scaffold (or fresh `npm init adonisjs@latest editor -- --kit=inertia --adapter=vue --ssr`), create `apps/editor/`. Drop Filament / e-Factura / Ploi config — none of it applies. Keep Postgres scaffold disabled; SQLite for local.
- Depends: none.
- Out: runnable adonis app on :3333.
- Files: `apps/editor/`, `apps/editor/start/routes.ts`, `apps/editor/config/database.ts`.

**02 — Workspace the engine into the editor app.**
Make the davidup root a workspace; `apps/editor` depends on the engine packages via path imports. `davidup/schema`, `davidup/browser`, `davidup/node`, `davidup/mcp` resolve in TypeScript from the editor's `tsconfig.json`.
- Depends: 01.
- Out: editor can `import { validateComposition } from 'davidup/schema'`.
- Files: root `package.json` (workspaces), `apps/editor/package.json`, `apps/editor/tsconfig.json`.

**03 — Project loader service.**
An AdonisJS service that, given a directory, validates a `composition.json` + finds `library/index.json` + `assets/`. Loaded project is held in `ProjectStore` — single in-memory composition with a debounced disk writer.
- Depends: 02.
- Out: GET `/api/project` returns the loaded composition.
- Files: `app/services/project_store.ts`, `app/controllers/projects_controller.ts`.

**04 — The `davidup edit` CLI.**
A thin CLI: `davidup edit ./path` → boots the AdonisJS server, opens the browser, watches the project directory. `davidup new ./path` scaffolds a project from a template.
- Depends: 03.
- Out: `davidup edit examples/comprehensive-browser` opens working editor.
- Files: `src/cli/bin.ts`, root `bin` entry in `package.json`.

**05 — Single Inertia page that mounts the engine.**
One Vue 3 page: `pages/editor.vue`. Inside it, instantiate the browser driver's `attach(composition, canvasEl)`. No panels yet — full-bleed canvas. Confirms the engine renders inside the editor process.
- Depends: 04.
- Out: comprehensive demo plays in the editor window.
- Files: `inertia/pages/editor.vue`, `inertia/composables/useStage.ts`.

**06 — Command bus & mutation contracts.**
Define the `Command` discriminated union — one variant per existing MCP tool. Implement `applyCommand` as a pure function on a composition. Wrap in a CommandBus service with undo stack + Zod validation + change emission.
- Depends: 03.
- Out: POST `/api/command` applies a typed mutation and returns next state.
- Files: `app/services/command_bus.ts`, `app/services/apply_command.ts`, `app/types/commands.ts`.

**07 — Mount MCP inside the editor process.**
The existing MCP server's tools route to `commandBus.apply()` instead of mutating directly. Now the UI client and the agent share the same store — sourced as `"ui"` vs `"mcp"`.
- Depends: 06.
- Out: Claude Code can edit the same composition the editor shows.
- Files: `app/services/mcp_bridge.ts`, `src/mcp/dispatch.ts` (route changes).

**08 — Three-panel layout shell.**
CSS-grid layout matching the mockup: Library (left) / Stage (center) / Inspector (right) / Timeline (bottom). Resize handles. Persisted to `~/.davidup/state.json`.
- Depends: 05.
- Out: resizable layout with empty Library / Inspector / Timeline placeholders.
- Files: `inertia/layouts/editor.vue`, `inertia/composables/usePanelLayout.ts`.

**09 — Inspector v1, typed param editing.**
Inspector reads the Zod schema for the selected item type, renders one input per param (number, string, color, enum, time). Edits dispatch `updateItem` commands. Overridden values get the orange dot.
- Depends: 06, 08.
- Out: changing `opacity` updates the stage live.
- Files: `inertia/components/Inspector.vue`, `inertia/components/inputs/{Number,Color,Time,Enum}.vue`.

**10 — Timeline v1, render bars from tweens.**
One track per item. Bars colored by source: template (orange), behavior (green), scene (gold). Ruler at top. Playhead synced to `useStage()`. Click bar → selects target in inspector.
- Depends: 08.
- Out: comprehensive demo timeline visualises all 93 tweens correctly.
- Files: `inertia/components/Timeline.vue`, `inertia/components/TimelineTrack.vue`.

**11 — Timeline drag-to-move + resize.**
Pointer events on bars: drag horizontally → emit `updateTween {from,to}`; resize handles on bar edges. Snap to 0.25s grid (configurable). Visual feedback during drag.
- Depends: 10, 06.
- Out: drag a behavior bar → JSON reflects new times exactly.
- Files: `inertia/components/Timeline.vue`, `inertia/composables/useTimelineDrag.ts`.

**12 — Library index reader.**
Service watches `library/index.json` + `library/**/*.{behavior,template,scene}.json`. Builds an in-memory library catalog. Exposes a searchable list to the Library panel via a JSON endpoint.
- Depends: 03.
- Out: GET `/api/library` returns catalog; updates within 1s of file edit.
- Files: `app/services/library_index.ts`, `app/controllers/library_controller.ts`.

**13 — Library panel v1.**
Vue panel with tabs (Templates / Behaviors / Scenes / Assets / Fonts), search box, cards with name + provenance + auto-generated 1s preview thumbnail. Thumbnails generated via the existing `render_preview_frame` path.
- Depends: 12.
- Out: library renders catalog cards for the comprehensive demo's library.
- Files: `inertia/components/Library.vue`, `inertia/components/LibraryCard.vue`.

**14 — Drag from library → timeline / stage.**
HTML5 drag-and-drop. Drop on a track → `addTemplate` / `addBehavior` with brand defaults pre-bound. Drop on stage → places at drop coordinates. Hit zones visualised during drag.
- Depends: 13, 11.
- Out: drop `brand::titleCard` on empty track → valid instance appears, renders.
- Files: `inertia/composables/useLibraryDrag.ts`, `inertia/components/{Timeline,Stage}.vue`.

**15 — Source-map emission in precompile.**
Modify `src/compose/precompile.ts` to thread an authorship trail through every emitted item / tween. Resolved object gets a `__source: { file, jsonPointer, originKind }` sidecar (stripped before validation runs).
- Depends: none (engine work).
- Out: `precompile()` returns `{ resolved, sourceMap }`.
- Files: `src/compose/precompile.ts`, `src/compose/index.ts`, `src/engine/types.ts`.

**16 — Stage hit-testing → inspector selection.**
Browser driver exposes a `pickItemAt(x, y, t)` method — uses a hidden ID-buffer canvas to read pixel-perfect item IDs. Click on stage → resolves to item id → inspector selects + emits source-map info to client.
- Depends: 09, 15.
- Out: click ball in stage → inspector shows ball's params.
- Files: `src/drivers/browser/index.ts`, `inertia/components/Stage.vue`.

**17 — Reveal-in-source pane.**
A bottom drawer (toggle: ⌘J) showing the *authored* JSON pane with the originating source location highlighted for the current selection. Read-only for v1.0; editing the JSON is v1.1 territory.
- Depends: 16.
- Out: click in stage → ⌘J opens drawer scrolled to the right line.
- Files: `inertia/components/SourceDrawer.vue`, `inertia/composables/useSelection.ts`.

**18 — Asset upload pipeline.**
HTTP POST `/api/assets` accepts a multipart upload. Compute content hash → name file → run ffprobe (video / audio) → extract thumbnail → register in `library/index.json` → return the asset record.
- Depends: 12.
- Out: `curl -F file=@logo.png /api/assets` returns a `201` with the asset record; the file lands at `library/assets/<hash>.png` and `library/index.json` gains the entry.
- Files: `app/controllers/assets_controller.ts`, `app/services/asset_pipeline.ts`.

**18b — Asset drag-in upload UI.**
Wire the browser side of FR-12. The Library panel (Assets tab) and the editor shell accept native file drops: `dragover` shows a hit-zone overlay; `drop` reads `DataTransfer.files`, POSTs each to `/api/assets` via a `useAssetUpload` composable, and surfaces per-file progress + success/error toasts. On success the Library catalog auto-refreshes via the existing `library_index` watcher; the new card is selectable and immediately draggable to the stage (re-uses step 14's drag flow).
- Depends: 13, 14, 18.
- Out: drop a PNG on the editor window → it appears in Library / Assets within 2s; drag it to the stage; reload → same hash, same pixels (closes FR-12 acceptance).
- Files: `inertia/composables/useAssetUpload.ts`, `inertia/components/LibraryPanel.vue`, `inertia/components/EditorShell.vue`, `inertia/components/UploadToasts.vue`.

**19 — Render-from-editor + SSE progress.**
Render ▸ button → POST `/api/renders` kicks off a worker thread invoking the existing Node driver. Worker emits progress messages; controller pipes them to a Transmit SSE channel; editor strip subscribes and updates.
- Depends: 05.
- Out: 12s comp renders end-to-end, file at `renders/<ts>.mp4`, progress bar reflects reality.
- Files: `app/controllers/renders_controller.ts`, `app/workers/render_worker.ts`, `inertia/components/RenderStrip.vue`.

**20 — Polish, validation surfacing, ship.**
Status bar shows validator errors / warnings live. Keyboard shortcuts wired. Help overlay. README + a 90-second demo video shot using the editor itself. `npm publish` the package; `npx davidup edit` works from a clean machine.
- Depends: all prior.
- Out: v1.0 shipped, vision-doc Experiment 1 ready to run.
- Files: `inertia/components/StatusBar.vue`, `inertia/components/HelpOverlay.vue`, `README.md`, `package.json` (publish config).

---

## 07 — Risks (v1.0-specific, with mitigations)

**R1 — Source maps add scope creep to the engine.**
Threading authorship through `precompile()` changes a hot, well-tested code path. Every existing test must keep passing byte-equal; new tests assert that the sidecar matches.
*Mitigation:* Source-map data lives on a sidecar, never in the resolved object that the renderer sees. Add it under an opt-in flag (`precompile(comp, { emitSourceMap: true })`). The renderer still hashes byte-identical input.

**R2 — Inspector schema reflection isn't free.**
Auto-generating typed inputs from Zod is fine for primitives. Discriminated unions, conditional `refine`s, and the polymorphic Item type make it harder than it looks.
*Mitigation:* Ship a registry: one Vue input component per Zod meta-type, with a fallback raw-JSON editor for cases the registry doesn't cover yet. Cover ~80% of fields in P2; the rest of v1.0.

**R3 — Stage hit-testing on Canvas2D is annoying.**
Canvas2D doesn't expose a "what item is at this pixel" API. Either re-render to an ID buffer (off-screen canvas, integer IDs as colors) or maintain a JS-side scene graph in parallel.
*Mitigation:* ID-buffer approach. Same render pipeline, second pass to a hidden offscreen canvas. Adds < 1ms per frame. Implementation lives entirely in the browser driver — no engine API change.

**R4 — AdonisJS 6 → 7 transition lands mid-build.**
v7 stable in Feb 2026; some plugins lag. Starting on v6 means a v7 upgrade in months 6–12; starting on v7 means betting on early ecosystem maturity.
*Mitigation:* Default to v6 unless the v7 Inertia adapter is healthy when you start (check Adonis Discord, GitHub issue counts). The boring-saas-template explicitly handles this branch.

**R5 — Solo founder bandwidth (still).**
Same risk as the vision doc's R6. The editor is 12 weeks of focused work. Distractions (one-off renders, Twitter, the engine's audio backlog) will try to extend that.
*Mitigation:* Each phase ends in a demo. Each demo is on a real existing example comp. If a phase slips past its 2–3 week window, drop the lowest-priority FR rather than cut the demo.

**R6 — Determinism regressions during UI development.**
Every UI mutation runs the same code as the MCP server, but the order of operations differs. Subtle floating-point or insertion-order bugs could make UI-built comps render differently from MCP-built comps.
*Mitigation:* Property-based tests on the command bus: random sequences of commands must produce byte-identical compositions regardless of source. Add to CI from step 06.

---

## 08 — Definition of done (8 un-skippable gates)

v1.0 ships when, and only when, all eight are green. Each item is binary, observable, and demoable. Half-done counts as not done.

- **D1 · npx works.** `npx davidup edit ./examples/comprehensive-browser` from a clean machine, network only, opens the editor with the demo loaded in < 3 seconds.
- **D2 · Three panels live.** Library, Inspector, Timeline render meaningfully against every example comp in `examples/`. No "todo" placeholders.
- **D3 · Stage uses production engine.** Pixel-diff between `attach()` output at `t` and Node-driver `renderFrame()` at `t` is zero for the four-scenes comp.
- **D4 · UI ↔ MCP parity.** A sequence of UI edits and the equivalent MCP edits produce byte-identical `composition.json`. Property-based test in CI proves it.
- **D5 · Reveal-in-source works.** Click any pixel in the stage → ⌘J → source drawer opens at the correct file + JSON pointer for that resolved item. Sealed-scene case included.
- **D6 · Render from editor.** 12s comp at 1080p30 renders end-to-end via the Render ▸ button, file plays in QuickTime, ffprobe reports sane metadata. Progress bar reflects reality ±1 frame.
- **D7 · Architecture is SaaS-ready.** Diff between local-v1.0 and a hypothetical hosted-v2.0 is documented to be: swap SQLite → Postgres, swap filesystem loader → object store, mount `@adonisjs/auth`. **No controller signature changes.**
- **D8 · Experiment 1 from the vision doc has been run.** One real personal project — launch reel, portfolio video, investor update — was authored in the editor and shipped publicly. The hurt points are documented as the v1.1 backlog.

D7 is the architectural promise; the others are user-facing. Together they make v1.0 a real product instead of a tech demo. None of D1–D8 requires capability the engine doesn't already have. The editor is a shell around code that works.

---

## Footer signature

> davidup v1.0 — visual editor, deterministic to the pixel.
> PRD & build plan · 2026-05-14 · drafted as a self-test for narcis75@gmail.com
