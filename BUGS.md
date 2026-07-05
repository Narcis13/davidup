# Open bugs

Ledger of known defects. Sources:

1. **R-findings** — from `DAVIDUP_V1_REVIEW.md` §4 (the 2026-07-03 multi-agent
   review, branch `v0.2`). Each session in `v1_implementation_plan.md` closes
   specific R-numbers; this table tracks status so later sessions can tick
   remaining ones off without re-reading the whole review.
2. **Other tracked bugs** — defects found outside the R-review (e.g. during
   test-resurrection work) that don't have an R-number.

Fixed defects move to [`FIXED_BUGS.md`](./FIXED_BUGS.md) with a postmortem,
or in the case of R-findings, stay in this table marked `CLOSED` with the
session that fixed them (cheaper than re-writing history, and keeps the
review's finding numbers stable as cross-reference anchors).

---

## 1. R-findings register

| # | Sev | Summary | Status | Location |
|---|-----|---------|--------|----------|
| R-1 | P0 | Test suite red at HEAD: 3 stale tests, shipping tint algorithm had no green coverage | **CLOSED** — Session 1 (`ea51b0e`) | `tests/engine/render.test.ts`, `tests/drivers/browser.test.ts` |
| R-2 | P0 | Editor test suite unrunnable + hangs: extensionless ESM imports crashed Japa's loader | **CLOSED** — Session 1 (`ea51b0e`) | `inertia/composables/useCommandBus.ts`, `useLibrary.ts` |
| R-3 | P0 | `::` in item ids silently kills animation (resolver splits bucket key at first `::`, schema didn't forbid it) | **CLOSED** — Session 4 (`ee90fea`) | `src/engine/resolver.ts`, `src/schema/zod.ts` |
| R-4 | P0 | kenburns/kenburnsImage rendered a horizontal stretch, not a zoom (only emitted `scaleX`) | **CLOSED** — Session 6 (`c3d13f2`) | `src/compose/behaviors.ts`, `builtInTemplates.ts` |
| R-5 | P0 | Video dead-end ships a lie: `register_asset(video)` validates and tweens but renders as nothing, invisible to editor pick buffer | **CLOSED** — Session 10 (`c9c6b99`); render case + node frame provider were already fixed earlier (`93abbf5`, predates this ledger's OPEN status) | `src/schema/validator.ts`, `src/drivers/browser/index.ts` |
| R-6 | P1 | ffmpeg resolution inconsistent across extraction/encode/mux pipelines | **CLOSED** — Session 5 (`3f84001`) | `src/drivers/node/ffmpeg.ts` (new shared resolver) |
| R-7 | P1 | Signal-killed ffmpeg could yield "success" + garbage file | **CLOSED** — Session 5 (`3f84001`) | `src/drivers/node/render.ts` |
| R-8 | P1 | No `davidup render` CLI — headless render requires MCP or writing JS | **CLOSED** — Session 21 (`7940236`); this ledger wasn't updated at the time — caught and corrected during the Session 28 sweep | `src/cli/render.ts`, `src/cli/cli.ts` |
| R-9 | P1 | Published `bin` entries point at `.ts` sources with a bun shebang; `npm install -g davidup` on a node-only machine can't work | **CLOSED** — Session 22 (uncommitted at time of writing — see `git log`): `tsc`-built `dist/`, node-shebang bin shims, dual `bun`/`default` package exports, editor shipped as a prebuilt `editor-dist/` (via `scripts/build-editor.mjs`) with a vendored `davidup` copy, migration + `APP_KEY`/db-path bootstrapping for the packaged editor. Verified via `npm pack` + `npm install` into a clean dir on plain Node (no bun): `davidup new`/`render` produce a real MP4; `davidup edit` boots, serves `/`, `/editor` (SSR-rendered), and `/api/project` with HTTP 200. Also fixed two bugs found only by this end-to-end test: `node ace.js migration:run` never exits its process even after finishing (worked around with a bounded `SIGKILL` timeout in `edit.ts`), and `resources/views/inertia_layout.edge`'s non-standard per-page `@vite()` reference 500'd for any page whose Rollup chunk gets renamed (`editor.vue`, which cycles with `davidup/browser`) — fixed by matching the documented AdonisJS+Inertia layout pattern (app entrypoint only). | `package.json`, `src/cli/{bin,cli,edit}.ts`, `src/mcp/bin.ts`, `scripts/build-editor.mjs`, `scripts/copy-templates.mjs`, `apps/editor/config/database.ts`, `apps/editor/resources/views/inertia_layout.edge` |
| R-10 | P1 | Editor typecheck: 34 errors, no vue-tsc | **CLOSED** — Session 2 (`7e52951`) | `apps/editor` tsconfig |
| R-11 | P1 | Audio tracks can't start mid-file (`atrim` always from 0) — timeline placement only, no in-source offset | **CLOSED** — Session 28: added `trimIn` (in-source seek, independent of timeline `start`/`end`) to `AudioTrackSchema`, `buildAudioFilterComplex`, `add_audio_track`/`update_audio_track`, the editor's dual command schema, and the Inspector's audio-track editor. | `src/schema/zod.ts`, `src/drivers/node/audioMux.ts`, `src/mcp/{tools,store}.ts`, `apps/editor/app/types/commands.ts`, `apps/editor/inertia/components/Inspector.vue` |
| R-12 | P1 | Orphan `.tmp-*` extraction dirs skipped by LRU prune, never swept | **CLOSED** — Session 5 (`3f84001`) | `src/drivers/node/videoExtract.ts` |
| R-13 | P1 | `NodeAssetLoader.clear()` doesn't unregister skia `FontLibrary` families — font accumulation in long-lived servers | **CLOSED** — Session 28: `FontLibrary` only exposes a global `reset()` (no per-family removal), so loaders now share a claim-counted table — `clear()` releases this instance's claims and the native library is actually reset once every claimant anywhere has let go. Also dedupes `(family, path)` registration across instances, which incidentally fixes R-32's pixel non-determinism too. | `src/assets/node.ts` |
| R-14 | P1 | Enter/exit lifespans and non-negative clamps: zero tests | **CLOSED** — Session 23 | `tests/engine/resolver.test.ts` |
| R-15 | P1 | Duplicate layer ids and duplicate tween ids passed validation (tween ids are the MCP addressing key) | **CLOSED** — Session 4 (`ee90fea`) | `src/schema/validator.ts` |
| R-16 | P1 | MP4 container bytes non-reproducible (metadata variance); byte-identical claim should be scoped to pixels or fixed with `-fflags +bitexact` | **CLOSED** — Session 23: `-fflags +bitexact` (+ `-flags:v`/`-flags:a +bitexact`) added to both the stage-1 encode and the audio-mux stage; a reproducibility test renders the same composition twice (silent + muxed-audio paths) and asserts byte-identical output. Scoped to font/image-free compositions — see R-32. | `src/drivers/node/index.ts`, `src/drivers/node/audioMux.ts`, `tests/determinism/bitexact.integration.test.ts` |
| R-17 | P2 | Preview frames as base64-in-JSON, not MCP image content blocks — costly and invisible to vision clients | **CLOSED** — Session 25 (`d993844`); this ledger wasn't updated at the time — caught and corrected during the Session 28 sweep | `src/mcp/render.ts`, `src/mcp/tools.ts`, `src/mcp/server.ts` |
| R-18 | P2 | `render_thumbnail_strip` has no `count` upper bound — `count:500` floods the tool channel | **CLOSED** — Session 25 (`d993844`): `THUMBNAIL_STRIP_MAX_COUNT` (30) rejects anything above it with a hinted `E_INVALID_VALUE`. Ledger correction as above. | `src/mcp/render.ts` |
| R-19 | P2 | Doc drift, systemic: stale "not implemented" claim, README roadmap contradiction, version strings stuck at 0.1.0, `KNOWN_BUGS.md` misnamed, incomplete error-code list | **CLOSED** — Session 9 (this session) | cited per-file in the finding |
| R-20 | P2 | Group opacity multiplies alpha instead of offscreen compositing — overlapping semi-transparent children double-blend | **CLOSED** — Session 28: decided intentional (see the code comment in `render.ts` and the manual). True isolated compositing needs a canvas-sized scratch surface plus transform-matrix capture the minimal `Canvas2DContext` contract doesn't expose; revisit only if a real project hits it. Deferred to v1.1+ if ever. | `src/engine/render.ts`, `vision/davidup-v1.0-manual.md`, `BUGS.md` |
| R-21 | P2 | Scene/template `color` params accepted any non-empty string (`rgb(999,0,0)` parsed unclamped); polygons with <3 points validated | **CLOSED** — Session 4 (`ee90fea`) | `src/compose/scenes.ts`, `src/color/index.ts` |
| R-22 | P2 | Editor HMR websocket port not derived from `--port`; editor package still named `adonisjs-inertia-starter-kit@0.0.0`; three lockfile ecosystems in one app dir | **OPEN** — deferred to v1.1 (cosmetic/dev-ergonomics, no user-facing correctness impact) | `apps/editor` config |
| R-23 | P2 | Composition schema is not `.strict()` — typo'd keys silently stripped, agents never learn they misspelled a property | **OPEN** — deferred to v1.1 (the strict-vs-forward-compatible trade-off needs a real design decision, not a quick fix — see `DAVIDUP_V1_REVIEW.md` §4 for the debate) | `src/schema/zod.ts` |
| R-24 | P0 (live-drive) | Scene expansion silently alphabetized paint order (`Object.keys(def.items).sort()`), discarding declaration order | **CLOSED** — Session 6 (`c3d13f2`) | `src/compose/scenes.ts` |
| R-25 | P1 (live-drive) | MCP-layer tween overlap check had no epsilon — abutting tweens rejected, `colorCycle` could self-collide | **CLOSED** — Session 7 (`4889ed8`) | `src/mcp/store.ts` |
| R-26 | P1 (live-drive) | Scene instances didn't clip to the scene's duration — instance stayed on screen past its scene's end | **CLOSED** — Session 8 (`fc5c7e1`) | `src/compose/scenes.ts` |
| R-27 | P1 (live-drive) | `remove_scene_instance` deleted more than documented (separately-authored behavior tweens targeting the instance) | **CLOSED** — Session 8 (`fc5c7e1`) | `src/mcp/store.ts` / `tools.ts` |
| R-28 | P2 (live-drive) | No server-flavor discovery — `list_engine_capabilities` doesn't say standalone vs. editor-hosted | **CLOSED** — Session 25 (`d993844`): `list_engine_capabilities` now reports `server.flavor` (`"standalone"` \| `"editor"`). Ledger correction as R-17/R-18 above. | `src/mcp/tools.ts` |
| R-29 | P2 (live-drive) | Cross-session state leak — standalone server persists across agent conversations | **OPEN** — partially mitigated Session 25 (`d993844`): `reset`'s tool description now spells out that state persists until it's called, so an agent can at least discover and work around it. The underlying default (state leaks across conversations unless something calls `reset`) is unchanged — deferred to v1.1 for a real per-session lifecycle. | standalone server lifecycle |
| R-30 | P2 (live-drive) | Font cold-start wall — `add_text` requires a registered font-asset id, `list_fonts` returns empty, no starter pack | **OPEN** — partially mitigated Session 25 (`d993844`): an empty `list_fonts` response now carries a `hint` explaining how to register one via `register_asset`. The "no starter pack" half of the finding (a bundled default font so `add_text` works with zero setup) is still unaddressed — deferred to v1.1. | font registration path |
| R-31 | P2 (live-drive) | Expanded tween ids embedded FP-noisy starts, fragile for later reference/removal | **CLOSED** — Session 7 (`4889ed8`) | `src/compose/behaviors.ts` |
| R-32 | P2 (Session 23) | Re-rendering a composition that uses a custom font family already registered in-process re-invokes `skia.FontLibrary.use()` for the same family — observed to make the *pixel* output (not just container metadata) differ between two otherwise-identical renders sharing a process (e.g. a long-lived MCP/editor server, or two test cases in one worker). Discovered while building the Session 23 determinism harness: a font-bearing example rendered twice in the same process produced different-sized MP4s; the same example rendered once per process was stable. Root cause is almost certainly the same one R-13 already tracks (`NodeAssetLoader` never unregisters/dedupes `FontLibrary` families), just a pixel-level symptom instead of a memory-growth one. | **CLOSED** — Session 28, fixed alongside R-13: `NodeAssetLoader` now skips re-registering an already-claimed `(family, path)` pair. A same-process reproducibility test (font-bearing composition rendered twice) now passes in `bitexact.integration.test.ts`. | `src/assets/node.ts`, `tests/assets/node.test.ts`, `tests/determinism/bitexact.integration.test.ts`, `tests/determinism/goldenFrames.integration.test.ts` |

**Still fully open, not yet scheduled:** all ten SaaS S-findings (S1 no auth
… S10 no CSP) from the E/M/D/S-series audit — see `DAVIDUP_V1_REVIEW.md`
§4.2 and §7 for the SaaS phasing plan.

---

## 2. Other tracked bugs

### 2.1 Unregistering a library behavior that shadows a built-in deletes the built-in

**Where:** `src/compose/behaviors.ts` (`unregisterBehavior`) +
`apps/editor/app/services/library_index.ts` (reload diff, ~line 558).

**What happens:** `registerBehavior()` carefully preserves the existing
`expand` function when a library-authored descriptor re-registers a built-in
name (so library JSON can override description/params of e.g. `fadeIn`
without breaking expansion). But `unregisterBehavior()` is a plain
`REGISTRY.delete(name)` — when the library index's reload diff drops a
registration that was *shadowing* a built-in, the built-in is deleted with
it and never restored for the lifetime of the process.

**Repro (production, no tests involved):**
1. Put `fadeIn.behavior.json` (id `fadeIn`) in `~/.davidup/library/behaviors/`.
2. Start the editor — the global preload registers it over the built-in.
3. Remove the file (or otherwise cause a reload where it is no longer a
   winner). The watcher diff calls `unregisterBehavior('fadeIn')`.
4. `apply_behavior fadeIn` now fails with `E_BEHAVIOR_UNKNOWN` until restart.

**How it surfaced:** `library_drop.spec.ts` "dropping a built-in behavior…"
failed with `Unknown behavior "fadeIn"` on any machine whose real
`~/.davidup/library` contains a `fadeIn` behavior (the test suite used to
boot against the developer's actual global pool; `bin/test.ts` now isolates
tests via `DAVIDUP_LIBRARY`, which hides the symptom in CI but the product
bug remains).

**Suggested direction:** either snapshot built-in entries at module load and
have `unregisterBehavior` restore the built-in instead of deleting, or make
the registry two-layered (built-ins + overlay) so removal of an overlay entry
can never touch the base layer. Same audit applies to
`unregisterTemplate` / `unregisterScene` if built-ins exist for those.

**Status:** OPEN — P2, deferred to v1.1 (requires a deliberately shadowed
built-in in `~/.davidup/library` plus a live reload; no impact on normal
authoring or rendering paths).

### 2.2 `davidup edit`'s dev-mode server leaks an orphaned `bin/server.js` per session

**Where:** `src/cli/edit.ts` (`defaultSpawnServer` dev-source branch,
`terminate()`).

**What happens:** in the dev-source path (`apps/editor` has `adonisrc.ts`),
`defaultSpawnServer` spawns `node ace serve --hmr`. That process is itself a
supervisor — @adonisjs/assembler's HMR dev loop forks its own long-lived
`node ... bin/server.js` child to run the actual app, and restarts it on file
changes. `terminate()` sends SIGTERM (then SIGKILL after 3s) to the `ace
serve` PID only; killing that supervisor does not cascade to the
`bin/server.js` grandchild, which is left running indefinitely, still bound
to its port.

**How it surfaced:** discovered while building the Session 24 Playwright
smoke test (`tests/e2e/editorSmoke.integration.test.ts`), which calls the
real `runEdit()` (dev source path) once per test run. Every clean run left
one orphaned `bin/server.js` process behind — confirmed by `ps aux` showing
the count grow by exactly one per invocation even though `handle.close()`
ran without error each time. Harmless for a single CI job (the container
dies with the job), but on a long-lived dev machine repeated `davidup edit`
sessions (or repeated test runs) accumulate zombie servers indefinitely —
same family as R-9's already-fixed `migration:run`-never-exits issue, but
for the dev-mode HMR path instead of the packaged path.

**Suggested direction:** spawn with `detached: true` and kill the process
*group* (`process.kill(-child.pid, signal)`) instead of just the child PID —
same fix shape already applied to the packaged path's migration timeout.
Needs care: `stdio: "inherit"` plus `detached: true` changes how the child's
own signal handling and terminal attachment behave, so verify `Ctrl+C` on
the CLI itself still tears the whole tree down cleanly.

**Status:** OPEN — P2, deferred to v1.1 (dev-source `davidup edit` only; the
packaged/npx path is unaffected, and CI containers reap the orphan with the
job).
