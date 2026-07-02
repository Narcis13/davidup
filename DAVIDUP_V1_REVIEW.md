# Davidup — Complete Review & v1 Product Proposal

**Date:** 2026-07-03 · **Branch:** `v0.2` @ `05a57c4` (S7) · **Method:** 15+ specialized agents — 6 subsystem deep-dives, adversarial verification of every "implemented" claim, and 4 hands-on proof runs that built, rendered, booted, and drove the system for real. Every claim below carries `file:line` evidence or a measured number.

---

## 1. Verdict

**Davidup is a real engine with a real moat, one milestone away from being a product.** The core promise — one canonical JSON composition rendering deterministically across browser preview, server MP4, an AI-agent MCP surface, and a human editor — is not marketing: this review rendered three complex compositions to MP4 (93 tweens, all 19 easings, custom fonts, template expansion), verified durations exact to the millisecond, visually inspected frames, and confirmed that a `$ref`-split source and its monolithic equivalent produce **byte-identical frames**. Render throughput measured at **235–302 fps** for 720p on this machine — a 20-second clip renders in under 5 seconds.

The architecture is unusually disciplined for a solo project: a pure `(composition, t) → pixels` core with zero RNG/clock calls, a four-pass authoring compiler, 56 manifest-synced MCP tools with exceptional agent ergonomics, and an editor whose every mutation — human or agent — flows through one Zod-validated CommandBus, making UI and MCP edits byte-equal by construction.

**But v0.2 is not shippable today**, for reasons that are cheap to fix and expensive to ignore:

1. **The test suite is red at HEAD** (3 stale tests), which means the safety net is down exactly when the video milestone is mid-flight.
2. **The editor's 298 tests cannot run at all** (a two-line import bug crashes the test loader), and its typecheck fails with 34 errors.
3. **Video is a half-shipped lie**: agents can register video assets, validate video items, tween them — and they render as *nothing* (S8/S9 unshipped). A validated composition silently produces blank space.
4. **`kenburns` — the single most-used motion-graphics move — is broken**: it stretches images horizontally instead of zooming (confirmed independently by two verifiers).
5. **There is no headless render command.** A video engine whose CLI cannot render a video.
6. **The live agent drive found engine bugs no test or code-reader caught**: scene expansion silently *alphabetizes paint order* (two of five scene items rendered invisible under an opaque sibling), scene instances never end, and the MCP overlap check rejects mathematically-abutting tweens over IEEE-754 noise — `colorCycle` can collide with its own segments. All were found only by looking at rendered pixels (§2.4, §4.1b).

None of these is architectural. The gap between v0.2 and a credible v1 is roughly **6–8 focused weeks**. The gap between v1 and a revenue-generating SaaS alpha is another ~3 weeks of shell (per the repo's own excellent `.eval/saas.md` audit, which this review confirms and extends). Section 6 lays out the exact path.

---

## 2. Proven usability — what was actually run

This review did not just read code. Four proof agents exercised the product surfaces end-to-end:

### 2.1 Complex example renders (PASS — impressive)

| Example | Content | Result | Throughput |
|---|---|---|---|
| `comprehensive.ts` | 20s, 14 items, 7 layers, **93 tweens, all 19 easings**, 2 custom TTF fonts | 1200 frames → MP4 in 4.70s; ffprobe: h264 yuv420p 1280×720@60, duration **20.000000s exact** | 255.6 fps |
| `two-templates-30s.ts` | 30s authored as 87-line JSON with two `$template` instances → precompiles to 5 items / 7 tweens | 900 frames → MP4 in 2.98s; duration 30.000000s exact | 302.0 fps |
| `comprehensive-split.ts` | Same 20s comp split across files via `$ref` | 1200 frames in 5.10s | 235.4 fps |

Frames extracted at 10%/50%/90% and visually inspected: real text in custom fonts, stroked rounded rects, mid-flight background color tweens, template-generated lower thirds. No blank/black frames.

**Determinism, measured:** the frame at t=10s of the `$ref`-split render is **byte-identical** to the monolithic render's frame (`cmp` clean). The MP4 *containers* differ by ~255 bytes (encoder metadata) — the "byte-identical MP4" claim in `src/drivers/node/render.ts` should be scoped to pixels or fixed with `-fflags +bitexact` (see Finding R-16).

### 2.2 Quality gates (FAIL — the headline problem)

- `bun run typecheck` (root): **PASS**, 1.3s.
- `bunx vitest run`: **FAIL — 569/572 pass, 3 deterministic failures** (verified twice, identical both runs):
  - `tests/engine/render.test.ts:272` — asserts the *removed* multiply+destination-in tint algorithm; `src/engine/render.ts:199-207` now uses source-atop. **The shipping tint code has zero green test coverage.**
  - `tests/drivers/browser.test.ts:219` and `:373` — encode the old "never paint past duration" contract; the driver now intentionally clamps and paints the final frame (`src/drivers/browser/index.ts:244-265`). Tests were never updated.
- All **21 integration tests ran for real** (real skia-canvas, real ffmpeg, real fixtures — no skip guards): node MP4 render + ffprobe, audio mux with waveform sampling at 3 time points, video extraction cache-hit >5× speedup. This is genuinely rare test hygiene.
- `apps/editor` typecheck: **FAIL, 34 errors** — 2 real bugs (TS2835 extensionless `'./useToasts'` imports), DOM-lib config gaps, unresolvable `~/composables/*` aliases, and the engine snapshot failing under the editor's stricter tsconfig. The root's green typecheck is a weaker signal than it looks.
- `node ace test` (editor, 298 tests): **CRASHES at module load** — the same extensionless imports (`useCommandBus.ts:17`, `useLibrary.ts:16`) are fine under Vite but fatal under Japa's ts-node ESM loader; the runner then **hangs indefinitely** (reproduced twice). The editor's entire test suite currently provides zero verification.

### 2.3 Editor boot (PASS)

`bun run src/cli/bin.ts edit examples/editor-demo --no-open --port=3947` → ready in 6.9s wall (AdonisJS itself: 655ms). `/`, `/editor`, `/api/project`, `/api/library`, `/api/editor-state` all 200; Inertia payload present; project loaded with 0 warnings. One non-fatal wart: Vite's HMR websocket port (24678) is not derived from `--port`, so a second dev server on the machine silently degrades HMR.

### 2.4 Live MCP agent drive (PASS — with the most valuable findings of the whole review)

An agent drove the session's live standalone `davidup-mcp` server exactly as a customer's AI agent would, using **25 distinct tools**, and succeeded end-to-end:

- **Authored from scratch**: a 15s 1280×720@30 composition — 4 layers, 2 registered font assets, **24 items** (shapes, text, a group via `add_group`, template-emitted items, 2×5 scene-expanded items), a 5-item/5-param scene **defined and instanced twice** with different params/starts/transforms, the `titleCard` built-in template, **7 `apply_behavior` calls** (popIn, fadeOut, pulse — legally applied to a sealed scene-instance group — colorCycle), 17 literal `add_tween` calls → **53 final tweens across 11 easings** with staggered timing.
- **Validated clean** (`{"valid":true,"errors":[],"warnings":[]}`), rendered via `render_to_video`: **450 frames in 1912ms (~235 fps)**; ffprobe: h264 High, yuv420p, 1280×720@30, duration 15.00s exact, 853 KB.
- **Atomic rollback confirmed live**: a failed `apply_behavior` (colorCycle FP collision, see R-25) left zero orphaned tween segments; the retry succeeded with no overlap.
- Frames at t=1.8/6.2/12.9 visually verified: title pop-in, rotating hero badge, crawling ticker, staggered bouncing dots, both stat panels with correct per-instance params and colors.

The run also demonstrated why pixel-level proof matters: **two engine defects (R-24, R-26) were invisible to every code-reading agent and every test, and were caught only by looking at rendered frames** — which the agent could only do by rendering the MP4 and extracting frames, because `render_preview_frame` returns base64-in-JSON that an agent cannot view (R-17 confirmed in the most concrete way possible).

---

## 3. Subsystem scorecard

| Subsystem | Grade | One-line assessment |
|---|---|---|
| Engine core (`src/engine`, `schema`, `easings`, `color`) | **A−** | Exemplary layering, genuine determinism, precise tween semantics; docked for the red tint test, the `::` id hole, and untested enter/exit lifespans |
| Compose layer (`src/compose`) | **A−** | Four-pass pure compiler, 142/142 tests green, source maps byte-safe; docked for kenburns defect and no expressions/stagger |
| MCP server (`src/mcp`) | **A** | The strongest subsystem. 56 manifest-synced tools, exceptional descriptions, structured errors with hints, atomic rollback, session isolation |
| Drivers + assets + CLI (`src/drivers`, `assets`, `cli`) | **B+** | Node pipeline robust (backpressure, stderr tails, temp cleanup); docked for no render CLI, inconsistent ffmpeg resolution, S7-cache-written-never-read |
| Editor (`apps/editor`) | **B** | Feature-far-beyond-its-own-docs (all 20 UX_GAPS sections + all 15 UX-findings fixed); docked hard for unrunnable tests, red typecheck, missing audio/video UI |
| Docs & product discipline | **B−** | Spec-first culture and five honest self-audits; docked for systemic staleness (KNOWN_BUGS.md is a postmortem, README roadmap contradicts shipped code, version strings say 0.1.0) |

### 3.1 Engine core — what's real

**Renders:** sprite (with tint), text, shape (rect/circle/polygon), group — via the switch at `src/engine/render.ts:110-123`. Anchor math correctly pivots rotation/scale on the anchor point (`render.ts:96-107`, order-verified in tests). Stable z-sort with declaration-order tiebreak. Layer opacity/blendMode, blend modes locked to a 26-op Canvas2D enum (`zod.ts:17-47`).

**Tween semantics** are precise and well-tested: hold-`from` before, eased lerp inside, hold-`to` after, gaps hold the most recent `to` (`resolver.ts:126-152`). Overlap rejected at validation with a 1µs epsilon absorbing IEEE-754 drift (`validator.ts:41,316-334` — with a regression test chaining drifting `start+duration` sums). Post-lerp clamps guard opacity and non-negative dimensions against `easeOutBack` overshoot.

**Determinism is engineered, not claimed:** grep-clean of RNG/clock in the entire core; resolver proven non-mutating; precomputed `TweenIndex` proven equivalent to on-the-fly indexing.

**What's not real:** the fifth schema item type, `video`, validates and tweens but has **no draw case** — silently invisible (S8). Text is single-line `fillText` only — no wrapping, no measurement, and text `anchorX/anchorY` are declared tweenable but are render no-ops (`render.ts:158-174`). Enter/exit lifespans (`resolver.ts:53-73`) have **zero test coverage** anywhere.

### 3.2 Compose layer — what's real

Four deterministic passes (`precompile.ts:148-163`): `$ref` imports (with cycle detection, browser-safe path code) → `$template` expansion (root **and inside scene definitions** — the gap `COMPOSITION_GAP.md` still claims is "Not implemented" was closed and tested) → scene instances (sealed, namespaced, four time-mapping modes incl. loop with drift-bounded multiply) → `$behavior` macros. Source-map mode threads `__source` sidecars through all passes and strips them with byte-identical output — verified by dedicated tests.

**Ceilings that matter for LLM authors:** param substitution is whole-string only — no arithmetic (`bulletList` is hard-fixed at exactly 3 bullets; templates expose pre-computed params like `stagger2` documented as "compute as 2*stagger"). No stagger/repeat primitive. User-defined behaviors are catalog-metadata stubs that **throw `E_BEHAVIOR_UNKNOWN` at apply time** (`behaviors.ts:169-175`) despite `define_user_behavior` existing as an MCP tool. Loop iterations are exact repeats (no per-iteration variation).

### 3.3 MCP server — what's real

Exactly **56 tools**, counted and manifest-locked (`tests/mcp/manifest.test.ts` forces `server.json`/README/mcp-demo sync — the tool-count drift disease from the v1.0 manual is cured). Nearly every finding from the old `.polish-audit/mcp-agent-ergonomics.md` is fixed, several exceeded: async render jobs with `get_render`/`cancel_render`, `list_engine_capabilities` returning the full vocabulary (easings, blend modes, tweenable paths per type) in one call, coordinate conventions embedded in tool descriptions, preview-frame asset-loader LRU cache, session-scoped user templates fixing the multi-tenant registry leak (`tools.ts:1718-1723`).

**Verified caveats:** discovery tools have zero behavioral tests; `import_scene`'s sandbox is real but untested; the standalone server's render is always blocking (queue exists only editor-hosted); preview frames come back as base64-in-JSON rather than MCP image content blocks, so vision-capable clients can't render them natively and every preview burns agent context.

### 3.4 Editor — what's real

Far more complete than its own audit docs suggest: item toolbar, stage drag/resize/rotate handles, marquee multi-select, pause-before-pick, buffered number inputs, layers panel (z/opacity/blendMode/visible/locked), outliner, per-field "+ animate" tween authoring, apply-template param dialogs, asset upload with hash dedup, undo/redo with ⌘Z/⌘⇧Z, render dialog with quality presets + SSE progress, render history with rename/bulk-delete, project picker with recents, onboarding + help overlays. All 20 `UX_GAPS.md` sections and all 15 findings across both UX audit docs verified fixed with code citations.

**What separates it from production:** the unrunnable test suite (two-line fix, huge blast radius), no vue-tsc (≈5k lines of SFC script untypechecked), no component/E2E tests (UI correctness rests on extracted pure-math modules + HTTP specs), and **no audio or video UI at all** — the engine and MCP support audio tracks; a human using the editor cannot see or edit them.

---

## 4. Defects register — new findings from this review

Findings the repo's own audits do **not** already track, ranked. (E/M/D/S-series from `vision/davidup-v1.0-manual.md` are not repeated here; their open/closed status is summarized in §4.2.)

### P0 — correctness/trust, fix before anything else

| # | Finding | Evidence |
|---|---|---|
| R-1 | **Test suite red at HEAD**: 3 stale tests; shipping tint algorithm has no green coverage; masks all future regressions | `tests/engine/render.test.ts:272`, `tests/drivers/browser.test.ts:219,373` |
| R-2 | **Editor test suite unrunnable + hangs**: extensionless ESM imports crash Japa's loader; 298 tests dead | `inertia/composables/useCommandBus.ts:17`, `useLibrary.ts:16` |
| R-3 | **`::` in item ids silently kills animation**: comment claims schema forbids `::` — it doesn't (`z.string().min(1)`); resolver splits bucket key at first `::`, tween silently dropped from a *validated* composition | `src/engine/resolver.ts:24-26,76-82` vs `src/schema/zod.ts:297-306` |
| R-4 | **kenburns/kenburnsImage render a horizontal stretch, not a zoom**: behavior emits only `scaleX` (`popIn` correctly emits both); test enshrines the defect; fix changes existing renders → schedule as versioned behavior change | `src/compose/behaviors.ts:656-664`, `builtInTemplates.ts:541-555`, `tests/compose/behaviors.test.ts:218-233` |
| R-5 | **Video dead-end ships a lie**: `register_asset(video)` works, extraction cache fills, item validates and tweens — then renders as nothing, is invisible to the editor pick buffer, and the validator doesn't even check the video's asset reference exists | `render.ts:110-123` (no case), `validator.ts:159-218` (no video case), `browser/index.ts:686-699` |

### P1 — robustness/product-critical

| # | Finding | Evidence |
|---|---|---|
| R-6 | **ffmpeg resolution inconsistent across the 3 pipelines**: extraction prefers bundled ffmpeg-static; encode + mux use bare PATH `ffmpeg`. Proven live: this machine's homebrew ffmpeg is dyld-broken — extraction would succeed, then encode would fail | `videoExtract.ts:723-741` vs `node/index.ts:221`, `audioMux.ts:243` |
| R-7 | **Signal-killed ffmpeg can yield "success" + garbage file** — driver comment admits it; only a `stat()` belt-and-braces catches empty output | `src/drivers/node/render.ts` (≈:156-170) |
| R-8 | **No `davidup render` CLI** — headless render requires MCP or writing JS. The single most obvious missing command | `src/cli/cli.ts:99-158` |
| R-9 | Published `bin` entries point at `.ts` sources with a bun shebang; `edit` resolves `../../apps/editor` and spawns `node ace serve --hmr` — **`npm install -g davidup` on a node-only machine cannot work** | `package.json` bin, `cli.ts:28-31`, `edit.ts:249` |
| R-10 | Editor typecheck 34 errors; no vue-tsc; dual tsconfig strictness means root-green ≠ editor-green | proof logs, `apps/editor` |
| R-11 | Audio tracks can't start mid-file (`atrim` always from 0) — timeline placement only; no in-source offset | `audioMux.ts:129` |
| R-12 | Orphan `.tmp-*` extraction dirs are skipped by LRU prune and never swept — crash-loop = unbounded disk | `videoExtract.ts:636` |
| R-13 | `NodeAssetLoader.clear()` doesn't unregister skia `FontLibrary` families (browser loader does clean up) — font accumulation in long-lived servers | `src/assets/node.ts:46-50` |
| R-14 | Enter/exit lifespans and non-negative clamps: zero tests | `resolver.ts:53-73,158-177` |
| R-15 | Duplicate layer ids and duplicate tween ids pass validation — tween ids are the MCP addressing key | `src/schema/validator.ts` |
| R-16 | MP4 container bytes non-reproducible (metadata variance); add `-fflags +bitexact` or re-scope the claim to pixels | measured: 930,392 vs 930,647 bytes, first diff at byte 612 |

### P2 — polish/DX

| # | Finding | Evidence |
|---|---|---|
| R-17 | Preview frames as base64-in-JSON, not MCP image content blocks — costly and invisible to vision clients | `src/mcp/render.ts` |
| R-18 | `render_thumbnail_strip` has no `count` upper bound — `count:500` floods the tool channel | `render.ts:101-127` |
| R-19 | Doc drift, systemic: `COMPOSITION_GAP.md:3` says "Not implemented" for a shipped+tested feature; README roadmap lists audio muxing "still open" while S4 is committed and the audio tools are documented 300 lines earlier; `server.json`/`package.json`/`DEFAULT_VERSION` all say 0.1.0 on a v0.2 branch; `KNOWN_BUGS.md` contains only *fixed* bugs; `mcp-demo.md` lists 12 of 33 error codes | cited per-file |
| R-20 | Group opacity multiplies alpha instead of offscreen compositing — overlapping semi-transparent children double-blend | `render.ts:102` |
| R-21 | Scene/template `color` params accept any non-empty string; `rgb(999,0,0)` parses unclamped; polygons with <3 points validate | `scenes.ts:677`, `color/index.ts:81-95` |
| R-22 | Editor HMR websocket port not derived from `--port`; `apps/editor/package.json` still named `adonisjs-inertia-starter-kit@0.0.0`; three lockfile ecosystems in one app dir | proof logs |
| R-23 | Composition schema is not `.strict()` — typo'd keys silently stripped. Defensible for forward-compat, but agents never learn they misspelled `cornerRadius` | `zod.ts`, demonstrated `tests/schema/video.test.ts:141` |

### 4.1b Found only by driving the live MCP server (the pixel-level layer no code reader caught)

| # | Finding | Evidence |
|---|---|---|
| R-24 | **P0 — Scene expansion silently alphabetizes paint order**: `Object.keys(def.items).sort()` builds the synthetic group's children, discarding the scene author's declaration order. In the live run an opaque `panel` rect (alphabetically after `bar`/`label`) painted *on top of* them — two of five scene items invisible in both instances. Undocumented anywhere; required reading engine source to diagnose. Workaround was renaming ids so alphabetical = paint order | `src/compose/scenes.ts:262,335` |
| R-25 | **P1 — MCP-layer tween overlap check has no epsilon** (the validator's 1µs `OVERLAP_EPS` doesn't cover this path): `start=5.2, duration=0.4` yields end `5.6000000000000005`, so a following tween at `5.6` is rejected with `E_TWEEN_OVERLAP` — while `5.0+0.4` abuts cleanly. Worse, **`colorCycle` collides with its own emitted segments** (`[13.200000000000001, 14.000000000000002] vs [14, 14.8]`) — a single well-formed behavior call that cannot place its own tweens. Agents hit this twice and had to nudge starts by epsilon | live errors verbatim; `add_tween`/`apply_behavior` paths in `src/mcp/store.ts` |
| R-26 | **P1 — Scene instances don't clip to the scene's duration**: a 4s `statPanel` instance stays on screen to the end of the composition (visually confirmed colliding with the finale at t=12.9). `start` only time-shifts tweens. The `enter`/`exit` workaround exists but is only discoverable in `update_item`'s schema and cannot be passed at `add_scene_instance` time | live run + `scenes.ts` expansion |
| R-27 | **P1 — `remove_scene_instance` deletes more than documented**: it also removed separately-authored behavior tweens *targeting* the instance group (`list_tweens target=stat1` → `[]` afterwards); the docstring promises only "tweens added by the original expansion" | live run |
| R-28 | P2 — No server-flavor discovery: `list_engine_capabilities` doesn't say whether you're on the standalone or editor-hosted server; agents learn by hitting `E_FEATURE_UNAVAILABLE` | `tools.ts:2444-2480` |
| R-29 | P2 — Cross-session state leak: the standalone server persists across agent conversations; a "fresh" session's `create_composition` failed with `E_DUPLICATE_ID` from a prior session's composition (the hint to `reset` was actionable) | live run |
| R-30 | P2 — Font cold-start wall: `add_text` hard-requires `font` (a registered font-asset id, not a CSS family — stated nowhere), `list_fonts` returns empty/empty with no guidance, and the standalone server ships zero fonts. The agent had to hunt `.ttf` files in the repo before any text was possible | live run |
| R-31 | P2 — Expanded tween ids embed FP-noisy starts (`stat2__label_fadeIn_4.8999999999999995__opacity`) — fragile for later reference/removal and ugly in transcripts | live run |

### 4.2 Status of the repo's own bug ledgers (v1.0-manual E/M/D series)

Verified fixed: E1 (blendMode enum), E2 (tint → source-atop, but see R-1: fix landed, test didn't), E4 (color-tween parseability), E6 (negative clamps, untested), M1 (tool count, now CI-locked), M3 (import_scene sandbox, untested), M5/M7/M8 (discovery tools, coordinate docs, inline thumbnails), M6 (preview asset cache), M11 (cancel_render), D-series UX blockers (all 15 across both findings docs). Still open: M4 partially (built-in registry still process-global; session shadowing mitigates), all ten SaaS S-findings (S1 no auth … S10 no CSP), and the undocumented ledger problem itself (R-19).

---

## 5. What "v1" should mean

The vision docs already define v1.0 as the *local product* and defer SaaS to v2.0 — correct call. But v0.2's definition of done should be sharpened from "sessions S1–S10 committed" to a product statement:

> **v1 = a stranger with `bunx davidup` can scaffold, edit (with audio and video), render from the CLI, and trust it — because every advertised feature is green in CI and one real public video was shipped with it.**

Concretely, six gates:

1. **Green everything.** Suite green, editor tests running and green, CI (GitHub Actions: root typecheck + vitest + editor typecheck + `node ace test` + manifest sync). Without this, every other gate is unverifiable.
2. **Video is real** (S8 + S9 + S10): draw case in the renderer, `add_video`/`update_video` MCP tools, validator video-asset cross-check, pick-buffer support, the three planned sample compositions.
3. **Audio + video visible to humans** (U1–U8): timeline audio lane, video trim handles, stage video preview, inspector panels. The engine supports what the editor can't show — that asymmetry is the current product's biggest lie to human users.
4. **Headless path**: `davidup render <project|json> -o out.mp4` with `--codec/--crf/--fps` flags, exit codes, and progress; package installable via `npx` on plain Node (fix R-9).
5. **Determinism harness**: golden frame-hash tests per example, `-fflags +bitexact`, and a node↔browser SVG-only pixel-parity snapshot — this converts the marketing claim into a CI-enforced invariant, which no competitor can honestly say.
6. **Gate D8 from the PRD, finally**: ship one real public project (a launch video for davidup itself, made in davidup — the recursion is the demo).

---

## 6. Proposals to reach v1 — ordered by leverage

### Week 1 — stop the bleeding (all < 1 day each)

1. Update the 3 stale tests to the current (intentional) behavior; suite green. *(R-1)*
2. Add `.js` to the two imports; editor's 298 tests come back from the dead. *(R-2)*
3. `id` regex in the Zod schema: `^[^:]*$` or simply forbid `::`; add validator check + test. *(R-3)*
4. GitHub Actions workflow: typecheck ×2, vitest, ace test, manifest sync. The repo has *never had CI* and it shows (this exact class of red-at-HEAD drift is how R-1/R-2 happened).
5. Single shared ffmpeg resolver used by encode, mux, and extract; prefer ffmpeg-static, fall back to PATH, fail loudly on signal-kill with the stderr tail. *(R-6, R-7)*
6. Fix kenburns to emit scaleX+scaleY; bump behavior version; note in changelog that renders change. *(R-4)*
7. Preserve scene-item declaration order in expansion (drop the `.sort()`, or make z explicit); this changes existing renders — batch it with the kenburns fix in one versioned "expansion v2" change. *(R-24)*
8. Epsilon-tolerant endpoint comparison in the MCP overlap check + snap behavior segment boundaries to exact arithmetic; kills both the abutting-tween rejection and colorCycle self-collision. *(R-25)*
9. Sweep `.tmp-*` and `.davidup-tmpvideo-*` orphans on startup. *(R-12)*
10. One doc-truth pass: delete or update `COMPOSITION_GAP.md`, fix README roadmap, bump the three version strings, rename `KNOWN_BUGS.md` → `FIXED_BUGS.md` and open a real `BUGS.md` seeded from §4. *(R-19)*

### Weeks 2–4 — finish v0.2 (the plan already exists: `v0.2-plan.md`)

11. **S8**: video draw case (extraction cache → `drawImage` of PNG frames, fit modes, freeze/loop) + validator video case + pick-buffer case. The plan estimates 4–5h; budget 2 days with goldens.
12. **S9**: `add_video`/`update_video` MCP tools + `list_engine_capabilities` update + the DUAL `commands.ts` mirror (the repo's known trap).
13. **S10**: three sample compositions + doc sync.
14. **U1–U8**: audio lane, video trim handles with freeze/loop indicators, stage video preview, inspector panels, add-flow. This is the biggest block (~40h in the plan) and the one that makes the editor honest.
15. `davidup render` CLI + `npx`-able packaging (compile `dist/`, node-compatible bin shims). *(R-8, R-9)*
16. Scene-instance lifetime: default `enter`/`exit` to the instance's `[start, start + sceneDuration)` (or add an explicit `clipToScene` flag), accept them at `add_scene_instance` time, and make `remove_scene_instance` delete only expansion-owned tweens. *(R-26, R-27)*

### Weeks 5–6 — the credibility layer

17. Determinism harness (gate 5 above). Also fixes R-16.
18. Editor verification: vue-tsc in CI, one Playwright smoke (boot → add shape → animate → render draft → assert file exists). The webapp-testing infra needs ~a day.
19. Preview frames as MCP image content blocks (R-17 — the live drive proved an agent literally cannot see the current base64 output, and that this blindness masked R-24/R-26) + `count` cap (R-18) + server-flavor field in `list_engine_capabilities` (R-28) + a `fonts` starter pack or clear cold-start hint (R-30).
20. "Compose lint" warnings for *invisible outcomes* — item permanently opacity-0, item off-canvas for its whole lifespan, video item pre-S8, font id with no registered asset (currently silently non-deterministic across hosts), scene instance outliving its duration. Agents can't see; the validator must see for them.
21. **Agent eval harness** (creative, high-leverage): a scripted benchmark — 10 briefs ("15s product promo, logo + 3 bullets + CTA", "lower-third loop", "kenburns slideshow with music") each run by an LLM against the MCP server in CI-nightly, scored on validate-clean, render-success, and frame-inspection assertions. **Agent-authoring success rate becomes the product's north-star metric.** Nobody in this market measures that; davidup is uniquely positioned to. §2.4 of this review is the prototype of exactly this harness — it caught four bugs in one run.

### The two expressiveness bets (schedule for v1.1, design now)

22. **Text v2**: multiline + wrapping + `measureText`-backed extents + per-line/per-word stagger reveal. Single-line text is the hardest ceiling on real motion-graphics work; staggered text reveals are the #1 idiom in the genre.
23. **Stagger/repeat + bounded param expressions**: `{"$repeat": {"count": 5, "stagger": 0.12, "item": {...}}}` and `"${$.start + 0.2}"` arithmetic (already spec'd in `COMPOSITION_PRIMITIVES.md` §6.6 but unimplemented). This is *the* leverage feature for LLM authors: it collapses 30 tool calls into 1, cuts token cost, and removes the arithmetic errors agents actually make. It also unblocks real user-defined behaviors (currently descriptor-only stubs).

---

## 7. Why SaaS, and which SaaS

### 7.1 The wedge

The repo's own words are right: *"Hosted MCP with per-tenant auth is the singular feature that turns davidup from 'an editor with an LLM plugin' into 'an agent-native platform'"* (`.eval/saas.md`). This review's live proofs sharpen that: davidup's differentiation is not the editor (Canva/CapCut win humans) and not the render farm (Shotstack/Creatomate/JSON2Video sell that today). It is the combination nobody else has:

| Capability | Remotion | Creatomate / Shotstack / JSON2Video | Motion Canvas | **Davidup** |
|---|---|---|---|---|
| Declarative canonical JSON (diffable, patchable) | ✗ (React code) | ~ (template JSON, closed) | ✗ (imperative TS) | ✓ |
| Deterministic same-pixels contract | ~ | ✗ | ~ | ✓ (CI-enforceable) |
| Agent-native surface (MCP, structured errors, discovery) | ✗ | ✗ (REST only) | ✗ | ✓ 56 tools |
| Human + agent co-edit the *same* state byte-equal | ✗ | ✗ | ✗ | ✓ CommandBus bridge |
| Local-first, free engine | ✓ (license caveats) | ✗ | ✓ | ✓ |

**Positioning: "the deterministic video backend for AI agents."** The customer is not a video editor; it's a developer building an agent product (marketing-automation copilots, social-content agents, personalized-video features) who needs video *output* that is reviewable, patchable, reproducible, and cheap.

### 7.2 Unit economics (measured, not guessed)

Measured throughput: 255 fps at 720p60 on an M-series laptop → a 20s clip ≈ 4.7s of CPU. Assume 10× slower on cheap cloud vCPUs and 1080p: ~1 vCPU-minute per clip. A €7/mo Hetzner CX32 (4 vCPU) can theoretically render ~4,000 clips/day. At $0.03/render-minute pricing (below Shotstack's effective rates), one box generates ~$60–120/day of billable capacity against ~€0.25/day of cost. **Rendering is a >95% gross-margin business at this engine's speed** — the risk is not COGS, it's demand. Price render-seconds from day one via Stripe Meter (the `.eval/saas.md` metering plan is correct; build the `usage_events` table before there are 30 call sites).

### 7.3 The phased path (adopting `.eval/saas.md`, with three amendments)

**Phase 0 — before any SaaS code (now → v1):** everything in §6. A SaaS on a red test suite is a fire.

**Phase 1 — design-partner alpha (~3 weeks, per saas.md):** auth + `Project` model + the projectStore-to-tenant refactor (the keystone — do it first, it's the item that gets more expensive every week), SSRF fix on `asset.src`, APP_KEY rotation, render concurrency cap + timeout, quotas, Stripe Meter, Dockerfile, Hetzner. Charge the 5–10 partners real money from day one.

**Amendments to the saas.md plan:**
1. **Add a plain REST facade** (`POST /v1/renders` with composition JSON → job → webhook/poll). MCP is the moat, but half the early customers will be ordinary backends; don't force the transport. Same handlers, second door.
2. **Split web/render-worker before alpha, not after.** Agent traffic is bursty by nature (one agent = N preview frames + a render in 30 seconds); an in-process renderer will embarrass the demo. BullMQ + one worker is a week now vs. a migration later.
3. **Ship C2PA provenance in the alpha, not the launch.** "Every clip carries a signed 'AI-authored via davidup, tenant T, composition hash H' assertion" is an enterprise door-opener and an EU-AI-Act story, and the deterministic engine makes the hash *meaningful* — the composition JSON *is* the provenance. Competitors can't copy this cheaply because their renders aren't reproducible.

**Phase 2 — public launch (3–5 months, per saas.md):** Postgres, R2, Redis sessions, hosted MCP-over-HTTP with bearer tokens, rate limits, GDPR flows, observability. Plus two growth loops the audit doesn't mention:
- **A zero-cost playground** (`davidup.dev/play`): paste/generate JSON → live browser preview via `davidup/browser` — pure client-side, no server cost, every share is a demo of determinism.
- **Template gallery as content marketing**: the global library format already exists (`~/.davidup/library`, 11 seeded templates); publish it as a public, PR-able registry. Templates are SEO surface and agent-vocabulary at once.

**Deliberately deferred (the audit is right):** marketplace, collaboration/multiplayer, mobile, SOC2 — until paying tenants ask. The dominant risk remains premature platformification. Ten paying design partners choose the next ten features, not this document.

### 7.4 Pricing sketch

- **Local/OSS**: engine + CLI + editor free forever (it's the top of the funnel and the trust story).
- **Cloud Dev** — $0: 30 render-minutes/mo, 1GB storage, hosted MCP endpoint, watermark-free (watermarks poison the agent use case).
- **Pro** — $29/mo: 300 render-min included, then $0.03/min; 20GB; priority queue.
- **Team** — $99/mo: shared brand-kit library (fonts/colors/logos as first-class library objects — a small engine feature with outsized retention effect), 3 seats, API keys per environment.
- **Enterprise** — custom: C2PA signing, SSO, VPC/on-prem worker images, SLA. The determinism contract ("same JSON, same pixels, auditable") is the enterprise pitch.

---

## 8. 30 / 60 / 90

| Horizon | Outcome | Contents |
|---|---|---|
| **30 days** | Trustworthy v0.2-complete | §6 weeks 1–4: green CI, `::`/kenburns/ffmpeg fixes, S8–S10, U1–U8, `davidup render`, doc truth pass |
| **60 days** | **v1.0 tag** | Determinism harness, npx packaging, Playwright smoke, MCP image blocks + compose lint, agent eval harness, D8 public video, `BUGS.md` at zero P0/P1 |
| **90 days** | Paid alpha | Tenant refactor + auth + quotas + meter + Docker + queue split + REST facade; 5–10 design partners paying; C2PA prototype |

---

## 9. Methodology & artifacts

Produced by a 22-result multi-agent workflow (~2.4M subagent tokens, 800+ tool uses): six subsystem deep-dive readers (engine, compose, MCP, drivers/CLI, editor, docs/vision), adversarial verifiers that attempted to refute every "implemented" claim (refutations that survived are in §4 — notably R-3 and R-4 were verifier catches, and the verifiers independently identified commit `d282bec` as the origin of the red browser tests), and four proof agents that ran the quality gates, rendered the shipped examples to real MP4s with frame inspection, booted the editor over HTTP, and drove the live MCP server through 25 tools as an authoring agent (§2.4 — the single highest-yield probe: R-24 through R-31). Verification runs re-executed the test suites independently; three separate agents reproduced the same 3 failures, so they are deterministic, not environmental.

Artifacts — key evidence copied to **`.review-artifacts/`** in this repo (gitignored): `v1-review-stress-v2.mp4` (the composition an AI agent authored live through 25 MCP tools) + two frames, `comprehensive.mp4` + frame, `two-templates-30s.mp4`. Full logs (test runs, editor boot, all extracted frames) in the session scratchpad; per-agent structured findings in workflow journal `wf_ee03a10f-116`.

*This document supersedes none of the repo's own audits — `vision/davidup-v1.0-manual.md` and `.eval/saas.md` remain excellent and are confirmed by independent re-derivation here; this review adds the v0.2-era findings (§4), the measured proofs (§2), and the productization path (§5–8).*
