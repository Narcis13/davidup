# Davidup v1 — Implementation Plan (Claude Code session-granular)

**Source:** `DAVIDUP_V1_REVIEW.md` §5–§6 (2026-07-03, branch `v0.2`). Every session below cites the review findings (R-#) it closes.
**Granularity rule:** 1 session = 1 Claude Code conversation = 1 (or a few) atomic commit(s), ending with the stated verification commands green. If a session balloons, stop, commit what's green, and split the rest into a follow-up session.

## How to run a session

Paste this at the start of each Claude Code session:

> Read `v1_implementation_plan.md`, execute **Session N** exactly as written. Read the cited files and `DAVIDUP_V1_REVIEW.md` finding(s) first. Run the verification commands before declaring done. Commit with the suggested message.

**Standing traps (apply to every session):**
- **Dual schema trap:** any change to engine/MCP command shapes MUST also update `apps/editor/app/types/commands.ts`, or values get silently stripped (see `v0.2-plan.md` "Reminder critic — dual schema").
- **Stale editor snapshot:** `apps/editor` links a frozen (~May-22) copy of davidup; its pre-existing tsc errors (AudioTrack, DOM types) are not caused by your change. Don't chase them outside Session 2.
- **Verification baseline** (run at session end unless the session says otherwise):
  ```bash
  bun run typecheck          # root
  bunx vitest run            # root suite
  cd apps/editor && npm run typecheck && node ace test   # after Sessions 1–2 make these green
  ```
- Renders that change pixels (Sessions 6, 8) must say so in the changelog and bump the relevant behavior/expansion version.

## Dependency graph (what blocks what)

```
S1 ──► S2 ──► S3 (CI)                    ← do these first, in order
S3 ──► everything else (CI guards all later work)
S4, S5, S6, S7, S8, S9                   ← independent of each other, any order
S10 ──► S11 ──► S12                      ← video chain, strict order
S13..S20 (U1–U8)                         ← U1 first, then mostly linear per v0.2-plan.md
S10 ──► S18 (stage video preview needs engine draw case)
S21 ──► S22                              ← render CLI before packaging
S12 ──► S23 (determinism goldens want final sample comps)
S2  ──► S24 (vue-tsc/Playwright assumes typecheck green)
S25, S26, S27, S28                       ← independent, after Phase 2
everything ──► S29 (launch video is the final gate)
```

Suggested calendar: Phase 0 ≈ week 1 · Phases 1–3 ≈ weeks 2–4 · Phases 4–5 ≈ weeks 5–6 · S29 = v1.0 tag.

---

## Phase 0 — Unblock & guard (nothing else ships until these are green)

### Session 1 — Root suite green + editor tests resurrected *(R-1, R-2)*
**Goal:** `bunx vitest run` fully green; `node ace test` in `apps/editor` loads and runs 298 tests.
**Files:**
- `tests/engine/render.test.ts:272` — asserts the removed multiply+destination-in tint; rewrite against the shipping source-atop algorithm (`src/engine/render.ts:199-207`).
- `tests/drivers/browser.test.ts:219,373` — encode the old "never paint past duration" contract; update to the intentional clamp-and-paint-final-frame behavior (`src/drivers/browser/index.ts:244-265`).
- `apps/editor/inertia/composables/useCommandBus.ts:17`, `useLibrary.ts:16` — add `.js` to the extensionless imports (fine under Vite, fatal under Japa's ts-node ESM loader).
**Steps:** fix the two imports first (2 lines), confirm `node ace test` no longer crashes/hangs; then rewrite the 3 stale tests to the current intentional behavior (do NOT change engine/driver code — the code is right, the tests are stale).
**Verify:** `bunx vitest run` → 572/572; `cd apps/editor && node ace test` → runs to completion (fix trivial failures; if non-trivial failures surface, list them in `BUGS.md` and stop — that's a new session).
**Commit:** `fix: green root suite + unbreak editor test loader (R-1, R-2)`

### Session 2 — Editor typecheck green *(R-10)*
**Goal:** `npm run typecheck` in `apps/editor` exits 0.
**Context:** 34 errors today: the two TS2835 imports (fixed in S1), DOM-lib gaps in tsconfig, unresolvable `~/composables/*` aliases, and the frozen engine snapshot failing under the editor's stricter tsconfig. Per the standing trap: the snapshot's errors are pre-existing — prefer excluding/relaxing the snapshot path over editing snapshot code.
**Steps:** fix tsconfig `lib`/`paths`; exclude or isolate the stale snapshot from the editor's typecheck; fix any real remaining errors in editor-owned code.
**Verify:** `cd apps/editor && npm run typecheck` → 0 errors; `node ace test` still green; editor still boots (`bun run src/cli/bin.ts edit examples/editor-demo --no-open --port=3947` → 200s on `/`, `/api/project`).
**Commit:** `fix: editor typecheck green (R-10)`

### Session 3 — CI pipeline (first ever) *(§6 item 4)*
**Goal:** `.github/workflows/ci.yml` running on push/PR: root typecheck, `bunx vitest run`, editor typecheck, `node ace test`, MCP manifest sync test.
**Steps:** use `oven-sh/setup-bun` + Node LTS; install ffmpeg (integration tests use real ffmpeg — prefer `ffmpeg-static` already in deps, else apt ffmpeg); cache bun + npm; job matrix or sequential steps mirroring the verification baseline; make the manifest sync test (`tests/mcp/manifest.test.ts`) an explicit named step.
**Verify:** push a branch, watch the workflow pass; then intentionally break a test on a scratch branch and confirm CI fails.
**Commit:** `ci: add GitHub Actions (typecheck ×2, vitest, ace test, manifest sync)`

---

## Phase 1 — Correctness fixes (all < 1 day; each is one session)

### Session 4 — Schema/validator hardening *(R-3, R-15, R-21)*
**Goal:** validated compositions can no longer silently misrender due to id/color/geometry holes.
**Files:** `src/schema/zod.ts:297-306` (item id), `src/schema/validator.ts`, `src/engine/resolver.ts:24-26,76-82` (why `::` kills tweens), `src/compose/scenes.ts:677`, `src/color/index.ts:81-95`.
**Steps:**
1. Item/layer/tween id regex forbidding `::` (e.g. `^[^:]*$` or explicit `.refine`) — the resolver splits bucket keys at the first `::`.
2. Validator errors for duplicate layer ids and duplicate tween ids (tween ids are the MCP addressing key).
3. Clamp/reject invalid colors (`rgb(999,0,0)` currently parses unclamped); reject polygons with <3 points.
4. Tests for each (id with `::` must fail validation; a previously-"valid" comp with dup tween ids must now error).
**Trap:** these are schema changes → check `apps/editor/app/types/commands.ts` mirrors any shape change; also re-run MCP manifest test.
**Verify:** baseline + new tests green.
**Commit:** `fix: forbid :: in ids, reject dup layer/tween ids, clamp colors, min-3-point polygons (R-3, R-15, R-21)`

### Session 5 — Unified ffmpeg resolver + signal-kill detection + tmp sweep *(R-6, R-7, R-12)*
**Goal:** one shared ffmpeg resolution path for encode, mux, and extraction; killed ffmpeg can never yield "success"; orphan temp dirs are swept.
**Files:** `src/drivers/node/videoExtract.ts:723-741` (the good resolver — extract it), `src/drivers/node/index.ts:221`, `src/drivers/node/audioMux.ts:243`, `src/drivers/node/render.ts` (~:156-170 signal-kill comment), `videoExtract.ts:636` (LRU prune skips `.tmp-*`).
**Steps:**
1. New module e.g. `src/drivers/node/ffmpeg.ts`: prefer `ffmpeg-static`, fall back to PATH, memoize; export `resolveFfmpeg()`.
2. Use it in all three pipelines.
3. On child-process exit by signal (or nonzero code): fail loudly with the stderr tail included in the error; keep the existing `stat()` empty-output check as belt-and-braces.
4. Startup sweep of orphaned `.tmp-*` extraction dirs and `.davidup-tmpvideo-*` files (age-gated, e.g. >1h old, so concurrent renders aren't clobbered).
5. Tests: resolver preference order; signal-kill → rejected promise with stderr tail; sweep removes aged orphans, spares fresh ones.
**Verify:** baseline + the 21 integration tests still pass with real ffmpeg.
**Commit:** `fix: shared ffmpeg resolver, loud signal-kill failure, orphan tmp sweep (R-6, R-7, R-12)`

### Session 6 — "Expansion v2": kenburns zoom + scene paint order *(R-4, R-24)* ⚠ changes existing renders
**Goal:** kenburns actually zooms; scene expansion preserves the author's declaration order. Batched deliberately as ONE versioned pixel-changing release.
**Files:** `src/compose/behaviors.ts:656-664` (emits only `scaleX`; `popIn` shows the correct dual-emit pattern), `src/compose/builtInTemplates.ts:541-555`, `tests/compose/behaviors.test.ts:218-233` (test enshrines the defect), `src/compose/scenes.ts:262,335` (`Object.keys(def.items).sort()` alphabetizes paint order).
**Steps:**
1. kenburns + kenburnsImage emit `scaleX`+`scaleY`; fix the test that asserts the bug.
2. Drop the `.sort()` in scene expansion — children in declaration order (or make z explicit); add a test with an opaque item declared *after* siblings that must paint on top.
3. Bump the behavior/expansion version marker; add a CHANGELOG entry stating renders change and why.
**Verify:** baseline; render `examples/comprehensive.ts` and one scene-using example, eyeball extracted frames (kenburns must scale both axes; scene items in declared order).
**Commit:** `fix!: expansion v2 — kenburns dual-axis zoom, declaration-order scene painting (R-4, R-24)`

### Session 7 — MCP overlap epsilon + snapped behavior boundaries + clean tween ids *(R-25, R-31)*
**Goal:** mathematically-abutting tweens are accepted at the MCP layer; behaviors can't collide with their own segments; expanded tween ids stop embedding FP noise.
**Files:** `src/mcp/store.ts` (`add_tween` / `apply_behavior` overlap paths — no epsilon, unlike the validator's 1µs `OVERLAP_EPS` at `src/schema/validator.ts:41,316-334`), behavior segment emission in `src/compose/behaviors.ts`.
**Repro (from the live drive):** `start=5.2, duration=0.4` → end `5.6000000000000005` → next tween at `5.6` rejected `E_TWEEN_OVERLAP`; `colorCycle` self-collides (`[13.200000000000001, 14.000000000000002]` vs `[14, 14.8]`).
**Steps:**
1. Reuse the validator's epsilon (import the constant — don't duplicate a second magic number) in the MCP endpoint comparison.
2. Snap behavior segment boundaries to exact arithmetic (accumulate as `start + i*step` from originals, or round to a fixed grid) so emitted segments abut exactly.
3. Generate expanded tween ids from rounded/humane starts (e.g. `stat2__label_fadeIn_4.9__opacity`, not `...4.8999999999999995...`).
4. Tests: the two verbatim repros above must succeed; colorCycle applies cleanly at an FP-noisy start.
**Verify:** baseline + repro tests.
**Commit:** `fix: epsilon-tolerant MCP overlap check, exact behavior boundaries, clean tween ids (R-25, R-31)`

### Session 8 — Scene-instance lifetime & removal ownership *(R-26, R-27)* ⚠ changes existing renders
**Goal:** scene instances end when their scene ends; `remove_scene_instance` deletes only what it created.
**Files:** `src/compose/scenes.ts` (expansion), `src/mcp/tools.ts` / `store.ts` (`add_scene_instance`, `remove_scene_instance`).
**Steps:**
1. Default the synthetic group's `enter`/`exit` to `[start, start + sceneDuration)` (or add `clipToScene: true` default — pick one, document it); allow explicit `enter`/`exit` at `add_scene_instance` time.
2. Tag expansion-owned tweens (namespace or ownership marker) so `remove_scene_instance` deletes only those, never separately-authored behavior tweens targeting the instance group; fix the docstring to match.
3. Tests: instance invisible after `start+sceneDuration`; a user tween targeting the instance survives `remove_scene_instance`.
**Trap:** `add_scene_instance` signature change → dual `commands.ts` mirror + manifest sync test + `list_engine_capabilities` if it documents the tool.
**Verify:** baseline; re-render the review's stress scenario shape (statPanel at 4s must be gone by t=12.9).
**Commit:** `fix!: scene instances clip to scene duration; remove_scene_instance owns only expansion tweens (R-26, R-27)`

### Session 9 — Doc truth pass *(R-19)*
**Goal:** no doc claims contradicted by shipped code.
**Steps:**
1. `COMPOSITION_GAP.md:3` — the "$template inside scenes: Not implemented" claim is false (shipped + tested); update or delete the file.
2. README roadmap — audio muxing is shipped (S4); fix the contradiction with the audio tools documented 300 lines earlier.
3. Bump the three version strings (`server.json`, `package.json`, `DEFAULT_VERSION`) from 0.1.0 to 0.2.0.
4. Rename `KNOWN_BUGS.md` → `FIXED_BUGS.md`; create a real `BUGS.md` seeded from review §4 (all open R-findings with status, so later sessions tick them off).
5. `mcp-demo.md`: complete the error-code list (12 of 33 today) or link to a generated source of truth.
**Verify:** manifest sync test green (it checks server.json/README); grep for "0.1.0" leaves only intentional hits.
**Commit:** `docs: truth pass — versions to 0.2.0, kill stale claims, open BUGS.md ledger (R-19)`

---

## Phase 2 — Video is real (S8–S10 from `v0.2-plan.md`; read its session specs first)

### Session 10 — S8: engine video draw case *(R-5)* — the heaviest engine session
**Goal:** video items render. Follow `v0.2-plan.md` S8 spec.
**Files:** `src/engine/render.ts:110-123` (add the `video` case), `src/schema/validator.ts:159-218` (add video case: asset ref must exist), `src/drivers/browser/index.ts:686-699` (pick-buffer case), extraction cache from S7 (`videoExtract.ts` — currently written, never read).
**Steps:** draw via extraction cache → `drawImage` of the pre-extracted PNG frame for time `t`; fit modes; freeze/loop semantics past source duration; validator video case (missing asset = error, not silence); pick-buffer support so the editor can select video items; golden-frame test with a tiny fixture video.
**Verify:** baseline + integration test rendering a comp with a video item → extracted frame visibly contains video pixels (not blank).
**Commit:** `feat: video items render — draw case, validator case, pick buffer (S8, R-5)`

### Session 11 — S9: MCP video tools
**Goal:** `add_video` / `update_video` MCP tools per `v0.2-plan.md` S9.
**Steps:** the two tools + Zod schemas + structured errors; update `list_engine_capabilities` (tweenable paths for video); **update the DUAL mirror `apps/editor/app/types/commands.ts`** — this is the repo's known trap and this session is its highest-risk spot; update manifest (`server.json`, README, mcp-demo) — the sync test will enforce it.
**Verify:** baseline; manifest test green; live smoke: boot MCP server, `register_asset(video)` → `add_video` → `validate` → `render_to_video` → extract a frame and confirm video pixels.
**Commit:** `feat: add_video/update_video MCP tools + capabilities + command mirror (S9)`

### Session 12 — S10: sample compositions + doc sync
**Goal:** three sample compositions exercising video (per `v0.2-plan.md` S10) + docs updated to say video is real.
**Steps:** three examples (e.g. picture-in-picture, video background + text overlay, trimmed clip with freeze); render each in an integration test (duration-exact assertion like the existing examples); README/manual updates; tick R-5 closed in `BUGS.md`.
**Verify:** baseline; all three examples render to MP4 with correct ffprobe duration.
**Commit:** `feat: video sample compositions + doc sync — v0.2 feature-complete (S10)`

---

## Phase 3 — Editor honesty: audio + video UI (U1–U8; each has a full spec in `v0.2-plan.md` — read it, it is the source of truth for these 8 sessions)

> Standing note for all U-sessions: editor tests + typecheck must stay green (they're in CI now); UI mutations must flow through the CommandBus so MCP and human edits stay byte-equal; dual `commands.ts` applies to any new command.

### Session 13 — U1: Library supports audio + video assets
Upload, hash-dedup, type badges, preview affordances per `v0.2-plan.md` U1. **Verify:** upload an mp3 + mp4 in the booted editor; both listed with correct type.

### Session 14 — U2: Inspector AudioTrack panel
AudioTrack CRUD in inspector per U2 spec. **Verify:** add/edit/remove an audio track from UI; `list_audio_tracks` via MCP shows the same state.

### Session 15 — U3: Timeline audio lane
Separate audio lane per U3 spec. **Verify:** track visible, draggable placement, editor tests green.

### Session 16 — U4: Inspector VideoItem panel
Video item properties incl. trim/fit/freeze-loop per U4 spec. Depends on Session 11 tools. **Verify:** edit a video item's fit mode from UI → change visible on stage.

### Session 17 — U5: Timeline video items with trim handles
Trim handles + freeze/loop indicators per U5 spec. **Verify:** trim from UI, rendered output honors it.

### Session 18 — U6: Stage video preview at playhead
Depends on Session 10 (engine draw case). Per U6 spec. **Verify:** scrubbing the playhead shows the correct video frame.

### Session 19 — U7: Outliner shows audio + video
Per U7 spec. **Verify:** outliner lists audio tracks and video items; selection syncs.

### Session 20 — U8: Add flow + UX polish
Per U8 spec (add-video/add-audio entry points, empty states, polish). **Verify:** a stranger-path walkthrough: new project → add video + audio from UI only → render → file plays. Consider `v0.2-plan.md` U9 (waveforms) only if time is trivially available — it's optional.

---

## Phase 4 — Headless path & packaging

### Session 21 — `davidup render` CLI *(R-8)*
**Goal:** `davidup render <project|comp.json> -o out.mp4 [--codec x] [--crf n] [--fps n]` with progress output and correct exit codes.
**Files:** `src/cli/cli.ts:99-158` (command table), reuse the node driver pipeline (which already has backpressure + stderr tails).
**Steps:** arg parsing consistent with existing CLI style; accept a project dir or a raw composition JSON (run precompile passes on it); stream progress (frames/fps) to stderr; exit 0 only on a playable file (reuse the Session-5 signal-kill/stat checks); `--help` text; tests (happy path + invalid JSON + missing asset → nonzero exit).
**Verify:** `bun run src/cli/bin.ts render examples/comprehensive.ts -o /tmp/out.mp4` (or JSON equivalent) → valid MP4; wrong input → nonzero exit + useful stderr.
**Commit:** `feat: davidup render CLI — the headless path (R-8)`

### Session 22 — npx-able packaging *(R-9)*
**Goal:** `npx davidup render …` and `npx davidup edit …` work on a plain-Node machine (no bun).
**Context:** today `bin` points at `.ts` sources with a bun shebang; `edit` resolves `../../apps/editor` and spawns `node ace serve --hmr` — impossible from a global install (`package.json` bin, `cli.ts:28-31`, `edit.ts:249`).
**Steps:** build step emitting `dist/` (tsup/esbuild — pick what's already closest in the repo); node-shebang bin shims; ship the editor as built assets + production server entry (no `--hmr`, no relative `../../apps` path — resolve via the package layout); `files` whitelist in package.json; smoke via `npm pack` + install the tarball into a scratch dir with plain node.
**Verify:** in a clean dir with node only (no bun): `npm i -g ./davidup-*.tgz && davidup render <json> -o out.mp4` works; `davidup edit` boots.
**Commit:** `feat: npx-able packaging — dist build + node bin shims + bundled editor (R-9)`

---

## Phase 5 — The credibility layer

### Session 23 — Determinism harness *(§5 gate 5, R-16)*
**Goal:** determinism is a CI-enforced invariant, not a claim.
**Steps:**
1. Golden frame-hash tests per example (hash frames at ~10%/50%/90%; store hashes in-repo; regenerate script for intentional pixel changes like Sessions 6/8).
2. Add `-fflags +bitexact` to the encode so MP4 containers are byte-reproducible — or, if unacceptable, re-scope the "byte-identical MP4" claim in `src/drivers/node/render.ts` to pixels (review measured a 255-byte container variance, first diff at byte 612).
3. Node↔browser SVG-only pixel-parity snapshot test (headless browser render vs node render of a shapes/text-only comp).
4. Wire all three into CI. Fold in **R-14** here: add the missing tests for enter/exit lifespans (`src/engine/resolver.ts:53-73`) and non-negative clamps (`:158-177`) — they're determinism-adjacent and currently at zero coverage.
**Verify:** CI green; flipping one pixel constant fails the golden test.
**Commit:** `test: determinism harness — golden hashes, bitexact, node↔browser parity, lifespan coverage (R-14, R-16)`

### Session 24 — Editor verification: vue-tsc + Playwright smoke *(§6 item 18)*
**Goal:** the ~5k untypechecked SFC lines get vue-tsc in CI, plus one E2E smoke.
**Steps:** add `vue-tsc --noEmit` to the editor typecheck (expect a fix-up pass on SFC script errors); one Playwright test: boot editor → add shape → add tween via "+ animate" → render draft → assert output file exists; run in CI (install chromium in the workflow). Budget check: review estimates ~a day — if vue-tsc surfaces >20 real errors, split the fixes into a follow-up session.
**Verify:** CI green including the new steps.
**Commit:** `test: vue-tsc in CI + Playwright boot-to-render smoke`

### Session 25 — MCP agent ergonomics batch *(R-17, R-18, R-28, R-29, R-30)*
**Goal:** an agent driving the server can *see*, can't flood itself, and knows where it is.
**Steps:**
1. `render_preview_frame` / thumbnails return MCP **image content blocks** instead of base64-in-JSON (`src/mcp/render.ts`) — the live drive proved agent blindness here masked two P0/P1 engine bugs.
2. Cap `render_thumbnail_strip` `count` (`render.ts:101-127`) with a structured error above the cap.
3. `list_engine_capabilities` gains a server-flavor field (standalone vs editor-hosted) so agents stop learning via `E_FEATURE_UNAVAILABLE` (`tools.ts:2444-2480`).
4. Font cold-start: document in `add_text`'s description that `font` is a registered font-asset id (not a CSS family); make empty `list_fonts` return an actionable hint; optionally ship a small starter font pack.
5. Cross-session leak (R-29): make the standalone server's session-scoping/`reset` behavior explicit in tool descriptions.
**Trap:** tool description/schema changes → manifest sync test + dual `commands.ts` if shapes change.
**Verify:** baseline + manifest test; manual MCP smoke: preview frame arrives as an image block.
**Commit:** `feat: MCP ergonomics — image blocks, count cap, server flavor, font cold-start (R-17, R-18, R-28–R-30)`

### Session 26 — Compose lint: warnings for invisible outcomes *(§6 item 20)*
**Goal:** the validator sees what agents can't. New **warnings** (not errors) for: item permanently opacity-0; item off-canvas for its entire lifespan; font id with no registered asset (currently silently non-deterministic across hosts); scene instance outliving its scene (belt-and-braces after Session 8); video asset ref missing (error since Session 10 — keep as error).
**Files:** `src/schema/validator.ts` warnings channel (already exists — `validate` returns `warnings[]`).
**Steps:** implement each check + a test per check; surface warnings through the MCP `validate` tool and the editor's validation UI if one exists.
**Verify:** baseline; a comp with an opacity-0-forever item validates `valid:true` with 1 warning.
**Commit:** `feat: compose lint — warnings for invisible outcomes (R-30-adjacent, §6.20)`

### Session 27 — Agent eval harness *(§6 item 21 — the north-star metric)*
**Goal:** a scripted benchmark of ~10 authoring briefs, each run by an LLM against the MCP server, scored on validate-clean / render-success / frame-inspection assertions; runnable locally and as CI-nightly.
**Steps:** briefs as fixtures (e.g. "15s product promo: logo + 3 bullets + CTA", "lower-third loop", "kenburns slideshow with music"); a runner that spawns the standalone MCP server, drives it with an agent (Claude API — read the `claude-api` skill before writing API code), renders, extracts frames, and asserts; JSON scorecard output; nightly GitHub Actions workflow with the API key as a secret. Review §2.4 is the prototype — it found 4 bugs in one run.
**Verify:** `bun run eval:agents` produces a scorecard; nightly workflow runs green.
**Commit:** `feat: agent eval harness — authoring-success benchmark (§6.21)`

### Session 28 — P1 residuals sweep *(R-11, R-13, R-20)*
**Goal:** close the remaining P1s not covered above.
**Steps:**
1. **R-11:** audio in-source offset — `atrim` currently always trims from 0 (`audioMux.ts:129`); add a `sourceStart`/offset field (schema + mux + MCP tool + **dual commands.ts** + U2 inspector field) so tracks can start mid-file.
2. **R-13:** `NodeAssetLoader.clear()` must unregister skia `FontLibrary` families (`src/assets/node.ts:46-50`) like the browser loader does.
3. **R-20:** group opacity double-blend — either implement offscreen compositing for groups with opacity<1, or document the multiply-alpha semantics as intentional in the manual and `BUGS.md`. Decide, don't leave it ambiguous.
4. Update `BUGS.md` statuses; anything still open (e.g. R-23 strict-schema debate) gets an explicit "deferred to v1.1" entry.
**Verify:** baseline + new tests (mux with offset sampled at 3 time points, mirroring the existing integration test style).
**Commit:** `fix: audio source offset, font unregistration, group-opacity decision (R-11, R-13, R-20)`

### Session 29 — Gate D8: the launch video 🎬 *(§5 gate 6)*
**Goal:** one real public video, made in davidup, about davidup — the recursion is the demo. This is the v1.0 acceptance test.
**Steps:** author a 20–30s launch video via the MCP surface (agent-authored — eating the dog food from Session 27's harness); music via the audio pipeline; render via `davidup render` CLI from Session 21; commit the composition JSON as an example; final pass over `BUGS.md` (zero open P0/P1) and README; **tag v1.0**.
**Verify:** the six §5 gates, checked one by one: green CI · video real · audio/video visible in editor · headless npx path · determinism harness in CI · public video shipped.
**Commit:** `release: v1.0 — launch video, gates green` + git tag `v1.0.0`

---

## v1.1 — design now, build later (§6 items 22–23; NOT in v1 scope)

### Session 30 (optional, docs-only) — Design specs for Text v2 + stagger/repeat expressions
**Goal:** two design docs, zero code: (a) **Text v2** — multiline, wrapping, `measureText`-backed extents, per-line/per-word stagger reveal (the #1 motion-graphics idiom; single-line text is the hardest current ceiling); (b) **`$repeat` + bounded param expressions** — `{"$repeat": {count, stagger, item}}` and `"${$.start + 0.2}"` arithmetic, already spec'd in `COMPOSITION_PRIMITIVES.md` §6.6; this collapses 30 agent tool calls into 1 and unblocks real user-defined behaviors (today descriptor-only stubs that throw `E_BEHAVIOR_UNKNOWN`, `behaviors.ts:169-175`).
**Verify:** docs reviewed against `COMPOSITION_PRIMITIVES.md`; no schema code touched.

---

## Progress tracker

| # | Session | Findings | Status |
|---|---------|----------|--------|
| 1 | Suite green + editor tests | R-1, R-2 | ☐ |
| 2 | Editor typecheck | R-10 | ☐ |
| 3 | CI pipeline | §6.4 | ☐ |
| 4 | Schema/validator hardening | R-3, R-15, R-21 | ☐ |
| 5 | ffmpeg resolver + tmp sweep | R-6, R-7, R-12 | ☑ |
| 6 | Expansion v2 (kenburns + order) | R-4, R-24 | ☐ |
| 7 | MCP epsilon + tween ids | R-25, R-31 | ☐ |
| 8 | Scene-instance lifetime | R-26, R-27 | ☐ |
| 9 | Doc truth pass | R-19 | ☐ |
| 10 | S8 video draw case | R-5 | ☐ |
| 11 | S9 MCP video tools | — | ☐ |
| 12 | S10 samples + docs | — | ☐ |
| 13–20 | U1–U8 editor audio/video UI | §6.14 | ☐ |
| 21 | render CLI | R-8 | ☐ |
| 22 | npx packaging | R-9 | ☐ |
| 23 | Determinism harness | R-14, R-16 | ☐ |
| 24 | vue-tsc + Playwright | §6.18 | ☐ |
| 25 | MCP ergonomics batch | R-17, R-18, R-28–R-30 | ☐ |
| 26 | Compose lint | §6.20 | ☐ |
| 27 | Agent eval harness | §6.21 | ☐ |
| 28 | P1 residuals | R-11, R-13, R-20 | ☐ |
| 29 | Launch video + v1.0 tag | §5 gate 6 | ☐ |
| 30 | v1.1 design docs (optional) | §6.22–23 | ☐ |
