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
| R-8 | P1 | No `davidup render` CLI — headless render requires MCP or writing JS | **OPEN** | `src/cli/cli.ts` |
| R-9 | P1 | Published `bin` entries point at `.ts` sources with a bun shebang; `npm install -g davidup` on a node-only machine can't work | **OPEN** | `package.json` bin, `src/cli/cli.ts`, `edit.ts` |
| R-10 | P1 | Editor typecheck: 34 errors, no vue-tsc | **CLOSED** — Session 2 (`7e52951`) | `apps/editor` tsconfig |
| R-11 | P1 | Audio tracks can't start mid-file (`atrim` always from 0) — timeline placement only, no in-source offset | **OPEN** | `src/drivers/node/audioMux.ts:129` |
| R-12 | P1 | Orphan `.tmp-*` extraction dirs skipped by LRU prune, never swept | **CLOSED** — Session 5 (`3f84001`) | `src/drivers/node/videoExtract.ts` |
| R-13 | P1 | `NodeAssetLoader.clear()` doesn't unregister skia `FontLibrary` families — font accumulation in long-lived servers | **OPEN** | `src/assets/node.ts:46-50` |
| R-14 | P1 | Enter/exit lifespans and non-negative clamps: zero tests | **OPEN** | `src/engine/resolver.ts:53-73,158-177` |
| R-15 | P1 | Duplicate layer ids and duplicate tween ids passed validation (tween ids are the MCP addressing key) | **CLOSED** — Session 4 (`ee90fea`) | `src/schema/validator.ts` |
| R-16 | P1 | MP4 container bytes non-reproducible (metadata variance); byte-identical claim should be scoped to pixels or fixed with `-fflags +bitexact` | **OPEN** | `src/drivers/node/render.ts` |
| R-17 | P2 | Preview frames as base64-in-JSON, not MCP image content blocks — costly and invisible to vision clients | **OPEN** | `src/mcp/render.ts` |
| R-18 | P2 | `render_thumbnail_strip` has no `count` upper bound — `count:500` floods the tool channel | **OPEN** | `src/mcp/render.ts` |
| R-19 | P2 | Doc drift, systemic: stale "not implemented" claim, README roadmap contradiction, version strings stuck at 0.1.0, `KNOWN_BUGS.md` misnamed, incomplete error-code list | **CLOSED** — Session 9 (this session) | cited per-file in the finding |
| R-20 | P2 | Group opacity multiplies alpha instead of offscreen compositing — overlapping semi-transparent children double-blend | **OPEN** | `src/engine/render.ts:102` |
| R-21 | P2 | Scene/template `color` params accepted any non-empty string (`rgb(999,0,0)` parsed unclamped); polygons with <3 points validated | **CLOSED** — Session 4 (`ee90fea`) | `src/compose/scenes.ts`, `src/color/index.ts` |
| R-22 | P2 | Editor HMR websocket port not derived from `--port`; editor package still named `adonisjs-inertia-starter-kit@0.0.0`; three lockfile ecosystems in one app dir | **OPEN** | `apps/editor` config |
| R-23 | P2 | Composition schema is not `.strict()` — typo'd keys silently stripped, agents never learn they misspelled a property | **OPEN** | `src/schema/zod.ts` |
| R-24 | P0 (live-drive) | Scene expansion silently alphabetized paint order (`Object.keys(def.items).sort()`), discarding declaration order | **CLOSED** — Session 6 (`c3d13f2`) | `src/compose/scenes.ts` |
| R-25 | P1 (live-drive) | MCP-layer tween overlap check had no epsilon — abutting tweens rejected, `colorCycle` could self-collide | **CLOSED** — Session 7 (`4889ed8`) | `src/mcp/store.ts` |
| R-26 | P1 (live-drive) | Scene instances didn't clip to the scene's duration — instance stayed on screen past its scene's end | **CLOSED** — Session 8 (`fc5c7e1`) | `src/compose/scenes.ts` |
| R-27 | P1 (live-drive) | `remove_scene_instance` deleted more than documented (separately-authored behavior tweens targeting the instance) | **CLOSED** — Session 8 (`fc5c7e1`) | `src/mcp/store.ts` / `tools.ts` |
| R-28 | P2 (live-drive) | No server-flavor discovery — `list_engine_capabilities` doesn't say standalone vs. editor-hosted | **OPEN** | `src/mcp/tools.ts` |
| R-29 | P2 (live-drive) | Cross-session state leak — standalone server persists across agent conversations | **OPEN** | standalone server lifecycle |
| R-30 | P2 (live-drive) | Font cold-start wall — `add_text` requires a registered font-asset id, `list_fonts` returns empty, no starter pack | **OPEN** | font registration path |
| R-31 | P2 (live-drive) | Expanded tween ids embedded FP-noisy starts, fragile for later reference/removal | **CLOSED** — Session 7 (`4889ed8`) | `src/compose/behaviors.ts` |

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

**Status:** OPEN.
