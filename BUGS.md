# Bugs surfaced by the v1 test-resurrection sessions

Non-trivial defects found while greening the suites (v1 plan, Session 1).
Each needs its own fix session — do not band-aid them inside test files.

---

## 1. Unregistering a library behavior that shadows a built-in deletes the built-in

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
