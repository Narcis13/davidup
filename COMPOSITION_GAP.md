# Composition Gap — Templates Inside Scene Definitions

> **Status:** Not implemented. Tracked here for a future phase.
> **Scope:** Small, well-bounded compiler change in `src/compose/templates.ts`
> with mirroring test additions in `tests/compose/scenes.test.ts`.
> **Companion doc:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) §8 (composability
> layer) and [`COMPOSITION_PRIMITIVES.md`](./COMPOSITION_PRIMITIVES.md) §6 (P3
> templates) / §8 (P4 scenes).

---

## 1. The gap in one sentence

A `$template` block authored inside a **scene definition's** `items` map is
ignored by `expandTemplates` because the pass walks only the root
composition's `items` — not `comp.scenes[*].items`. Every other
composability primitive (`$ref`, `${params.X}`, `$behavior`, nested
`type: "scene"`) already works inside scene definitions.

---

## 2. Why it doesn't work today

### 2.1 The four passes (`src/compose/precompile.ts:73-75`)

```
1. resolveImports        — deep recursive walker; sees everything
2. expandTemplates       — shallow walk over root comp.items[*] ONLY
3. expandSceneInstances  — shallow walk over root comp.items[*] ONLY
4. expandBehaviors       — shallow walk over root comp.tweens[*] ONLY
```

Passes 3 and 4 *don't need* to descend because scene expansion **lifts**
scene-internal tweens to the root before `expandBehaviors` runs (see
`scenes.ts:297-317` and the `rewriteTween` branch on `$behavior` at
`scenes.ts:653`).

But scene-internal **items** stay inside `comp.scenes[*].items` until pass 3
runs. So a `$template` block sitting there is never seen by pass 2.

### 2.2 The exact code site

`src/compose/templates.ts:246`:

```ts
for (const key of Object.keys(itemsRaw as Record<string, unknown>).sort()) {
  const v = (itemsRaw as Record<string, unknown>)[key];
  if (isPlainObject(v) && typeof v.$template === "string") {
    // ... expand ...
  }
}
```

`itemsRaw` here is `comp.items`. There is no companion loop over
`comp.scenes[*].items`.

### 2.3 What currently happens to the gap

If a user writes:

```jsonc
"scenes": {
  "introCard": {
    "items": {
      "lower": { "$template": "lowerThird", "params": { /* ... */ } }
    }
  }
}
```

…the `$template` block passes through `expandTemplates` untouched. Then
`expandSceneInstances` walks `comp.scenes.introCard.items.lower`, finds an
object that is not `isSceneInstance(...)` (it has `$template`, not
`type: "scene"`), so it goes to the `else` branch on `scenes.ts:247-251`
and calls `rewriteItemRefs(substituted, ...)`. The result is an item that
the engine renderer will choke on (no recognized `type`) and the validator
will reject as `E_SCHEMA`.

---

## 3. The fix in concept

Extend `expandTemplates` so it walks scene definitions' `items` maps in
addition to the root composition's `items`. The expansion logic, id
prefixing, tween shifting, and layer rewiring already exist — we're just
applying them in a new place.

### 3.1 Where the new walk goes

```
1. resolveImports
2. expandTemplates
     a. (existing) expand every $template in comp.items[*]
     b. (NEW)      for each scene in comp.scenes:
                     expand every $template in scene.items[*]
                     replace the scene's items/tweens in place
3. expandSceneInstances
4. expandBehaviors
```

Ordering is the same — templates still lower **before** scenes, so by the
time `expandSceneInstances` runs, scene-internal `$template`s are already
materialised as concrete items + tweens.

### 3.2 What changes inside a single scene definition

A template instance authored in a scene contributes:

- **N items** with the local-prefixed ids (e.g., template id `lower` →
  emits items `lower__bar`, `lower__name`, `lower__role`).
- **M tweens** with `target` rewritten to those prefixed ids, with
  `start` already in **scene-local** time (the scene-instance pass will
  shift again into global time).

These go into the scene definition's own `items` map (merged with the
non-template items) and `tweens` array (concatenated), respectively. The
scene's outer expansion later applies its own `${instanceId}__` prefix on
top, producing fully-qualified ids like `intro__lower__bar`. Double
prefixing is fine — the IDs stay unique and stable.

### 3.3 Layer rewiring inside scenes — and why it doesn't apply

The existing root-level `expandTemplates` rewires layers when an instance
lived on a layer. Scene definitions have **no layers** — a scene's items
are all addressed by the synthetic wrapper group. So the scene-internal
template expansion can skip the layer-rewire step entirely.

What replaces it: the scene's wrapper group needs to **list the expanded
template ids** in its children. Concretely, when a scene's `items` map
gains keys like `lower__bar`, `lower__name`, `lower__role` (from a
template instance keyed at `lower`), the wrapper-group construction in
`expandSceneInstance` (`scenes.ts:284-293`) iterates `Object.keys(def.items)`
to populate `groupChildren`. If the template instance key `lower` is
gone from `def.items` after expansion and the expanded ids are in its
place, the wrapper group will pick them up automatically. **Good news:**
we just need to ensure the expanded scene definition's `items` map
contains the new ids and not the old `$template` placeholder.

### 3.4 What `expandTemplate()` already gives us

`src/compose/templates.ts:128-173` (the single-instance expander) is
**reusable as-is**. It takes:

```ts
expandTemplate(
  instanceId: string,
  instance: TemplateInstance,
  options?: ExpandTemplateOptions,
): { items: Record<string, unknown>; tweens: unknown[] }
```

The new scene-walking code calls it the same way the root-level walker
does — no signature change needed.

---

## 4. Implementation plan

### 4.1 Files touched

| File | Change |
|------|--------|
| `src/compose/templates.ts` | New helper `expandTemplatesInScene(scene, userTemplates)`; call it from `expandTemplates` for each scene in `comp.scenes`. |
| `tests/compose/scenes.test.ts` | New describe block covering the four scenarios in §5. |
| `tests/compose/templates.test.ts` | Optional: cross-link test that asserts root + scene template expansion still produce non-colliding ids. |
| `COMPOSITION_PRIMITIVES.md` | §6.5 (new): "Templates inside scene definitions" — short note describing the support, the double-prefix id rule, and the no-layer-rewire bit. |
| `ARCHITECTURE.md` | §8.2 pipeline diagram: add "(2b)" sub-step. §8.5 template section: drop a one-liner stating that templates also work inside scene definitions. |

### 4.2 Function signatures (proposed)

```ts
// New (private to templates.ts)
function expandTemplatesInScene(
  scene: Record<string, unknown>,
  userTemplates: Record<string, TemplateDefinition>,
): Record<string, unknown> {
  // Returns a *new* scene object with $template entries lowered.
  // - Walks scene.items[*]: any { $template } gets expanded.
  // - Expanded item ids are merged into scene.items (replacing the
  //   instance key, just like the root walker does).
  // - Expanded tweens are concatenated onto scene.tweens.
  // - Throws E_DUPLICATE_ID on id collision (existing scene item id
  //   colliding with an expanded id).
  // - Skips scenes that have no $template instances (returns input
  //   unchanged for cheap short-circuit).
}
```

```ts
// Modified entry point
export function expandTemplates(comp: unknown): unknown {
  // ... existing root-level walk ...

  // NEW: walk scene definitions.
  const scenesRaw = (comp as { scenes?: unknown }).scenes;
  if (isPlainObject(scenesRaw)) {
    const newScenes: Record<string, unknown> = {};
    let changed = false;
    for (const id of Object.keys(scenesRaw).sort()) {
      const sceneRaw = scenesRaw[id];
      if (!isPlainObject(sceneRaw)) {
        newScenes[id] = sceneRaw;
        continue;
      }
      const lowered = expandTemplatesInScene(sceneRaw, userTemplates);
      if (lowered !== sceneRaw) changed = true;
      newScenes[id] = lowered;
    }
    if (changed) {
      result.scenes = newScenes;   // attach onto the existing returned object
    }
  }

  return result;
}
```

### 4.3 ID prefixing rule (canonical)

```
template instance key (in scene.items):   "lower"
template local item id:                   "bar"
after expandTemplatesInScene:             "lower__bar"
after expandSceneInstance("intro"):       "intro__lower__bar"
```

Tween targets follow the same double-prefix chain.

### 4.4 Edge cases to handle

| Case | Expected behavior |
|------|-------------------|
| Scene with no `$template` blocks | `expandTemplatesInScene` returns input unchanged — zero allocation. |
| Scene with a `$template` whose id is unknown | Re-use existing `E_TEMPLATE_UNKNOWN` from `expandTemplate`. |
| Template expansion produces an id that collides with a literal scene item | `E_DUPLICATE_ID` with a message that names the scene id, the template instance key, and the colliding id. |
| Template emits `$behavior` tweens (most built-ins do) | Already works — those tweens travel through `rewriteTween`'s `$behavior` branch in scene expansion, then through `expandBehaviors`. |
| Template instance has no `layerId` | Irrelevant inside a scene — scenes have no layers. The current `expandTemplate` only consults `layerId` in root-level layer rewiring; we skip that step inside a scene. |
| Template tween `start` outside `[0, scene.duration]` | Same as today: validator emits `W_TWEEN_TRUNCATED` post-compile. |
| Two scenes both reference the same template instance key | Each scene's expansion is independent; ids end up distinct because the outer `${instanceId}__` prefix differs per scene instance. |

### 4.5 Determinism

- Iterate `Object.keys(comp.scenes).sort()` and `Object.keys(scene.items).sort()`
  (matches the existing patterns in `templates.ts:209,246` and `scenes.ts:213,286`).
- No clocks, no PRNG, no environment reads. Same input → byte-identical output.

---

## 5. Test plan

All in `tests/compose/scenes.test.ts` (or a new `templates-in-scenes.test.ts`
if it gets large).

### 5.1 Happy path

A scene definition uses a built-in template (e.g., `lowerThird`) in its
`items` map. Assert after `precompile`:

- The scene's `$template` placeholder is gone.
- The composition contains the expected expanded items with the
  `${instanceId}__${templateKey}__${localId}` triple-segment ids.
- The composition contains the expected tweens with shifted `start`
  values (template-local → scene-local → global).
- Validator reports `valid: true`.

### 5.2 Template params + scene params combine cleanly

The scene declares its own params (e.g., `accent: color`). The scene
authoring passes `accent` through to the template's `color` param via
`"${params.accent}"`. Assert that:

- The substitution chain resolves at the scene-expansion step
  (`expandSceneInstance` runs `substitute` on every item, including the
  ones that came from template expansion, so the placeholder is filled
  with the scene-instance's `params.accent`).

> Open design question to decide during implementation: does
> `expandTemplatesInScene` substitute `${params.X}` immediately (binding
> to nothing yet) or leave placeholders for the scene expansion to
> resolve? The latter is the only correct option — the template
> expansion happens *before* a scene instance exists, so there are no
> scene params yet. Plan: emit placeholders untouched; let
> `expandSceneInstance`'s existing `substitute(...)` call handle them.
> This means `expandTemplate` (the per-instance expander) needs to know
> not to fail on unresolved `${params.X}` in this code path. It already
> doesn't — `substitute` is run by the caller, not by `expandTemplate`
> itself. Confirm via reading `templates.ts:128-173`.

### 5.3 Template emits `$behavior` tweens

Use a built-in like `titleCard` that emits `$behavior` blocks. Assert
that after `precompile`:

- No `$behavior` markers remain anywhere.
- The behavior-emitted tweens have ids of the form
  `${derivedParentId}__${suffix}` where `derivedParentId` already encodes
  the scene-prefixed target.

### 5.4 Error cases

- Unknown template inside scene → `E_TEMPLATE_UNKNOWN`.
- Template emits an id that collides with a literal scene item id →
  `E_DUPLICATE_ID` with the scene id surfaced in the message.
- Scene contains both `$template` and nested `type: "scene"` — assert
  both lower correctly and the resulting ids don't collide.

### 5.5 Regression

Existing `tests/compose/scenes.test.ts` and `tests/compose/templates.test.ts`
must continue to pass unchanged. The new walk is **additive** to the
existing root-level walker; canonical-v0.1 input and scene-instance-only
input both follow the existing short-circuit path.

---

## 6. Documentation updates

### 6.1 `COMPOSITION_PRIMITIVES.md`

Add a short subsection under §6 (Templates):

> **6.5 Templates inside scene definitions.** The same `$template`
> primitive may appear in a scene definition's `items` map. The
> precompile pipeline lowers scene-internal templates **before** lowering
> the scene instance itself. The expanded ids carry both prefixes:
> `${sceneInstanceId}__${templateInstanceKey}__${templateLocalId}`.
> All other rules (param substitution, behavior expansion, sealed
> instances) are unchanged.

### 6.2 `ARCHITECTURE.md`

In §8.2 pipeline diagram, annotate pass 2:

```
2. expandTemplates     — lowers $template instances at the root AND
                         inside every scene definition
```

In §8.5, append one line:

> Templates also expand inside scene definitions (see §8.6 for the
> double-prefix id rule).

---

## 7. Out of scope (explicitly)

- **Templates emitting scene instances.** A `$template` whose `items`
  contain `type: "scene"` is plausible but not in this gap. Would
  require either running the template pass twice or extending the
  scene pass to recurse over template outputs. Defer.
- **`$ref` to a `$template` block alone.** Already works today —
  `$ref` is the universal inliner. No change needed.
- **`$template` inside scene **tweens**.** Templates emit items + tweens
  as a unit; placing a `$template` directly in a `tweens[]` slot is
  not in the spec.
- **Cross-scene template id deduplication.** Each scene instance
  produces its own prefixed ids; collisions are impossible by
  construction. No registry-side dedup is needed.

---

## 8. Estimated size

- ~50 lines added in `templates.ts` (new helper + entry wiring).
- ~150 lines added across two test files (4 scenarios × 2-3 assertions).
- ~10 lines of doc changes.
- No engine changes. No schema changes. No MCP tool changes.
- **One-phase work item.** Single PR.

---

## 9. Acceptance criteria

1. `bun run typecheck` green.
2. `bun run test` green (existing + new tests).
3. A new example in `examples/` (or an additional scene file in
   `examples/four-scenes-60s/scenes/`) uses a `$template` inside a scene
   definition and renders end-to-end through `render.ts`.
4. `COMPOSITION_PRIMITIVES.md` §6.5 added.
5. `ARCHITECTURE.md` §8.2 / §8.5 updated.
