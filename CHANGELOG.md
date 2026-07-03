# Changelog

Entries that change existing render output are marked **⚠ pixel-changing**
and cite the behavior/expansion version marker that moved
(`BEHAVIOR_EXPANSION_VERSION` in `src/compose/behaviors.ts`,
`SCENE_EXPANSION_VERSION` in `src/compose/scenes.ts`).

## Unreleased

### ⚠ Expansion v2 — kenburns dual-axis zoom, declaration-order scene painting (R-4, R-24)

- **`kenburns` / `kenburnsImage` now zoom on both axes.** The `kenburns`
  behavior previously emitted a tween for `transform.scaleX` only, leaving
  `transform.scaleY` frozen at its initial value — every "Ken Burns" zoom
  rendered as a horizontal stretch, not a zoom. It now emits matching
  `scaleX` and `scaleY` tweens (the same dual-emit pattern already used by
  `popIn`/`popOut`). Any composition relying on `kenburns` or the
  `kenburnsImage` template will render differently — closer to the intended
  effect. `BEHAVIOR_EXPANSION_VERSION` bumped `1 → 2`.

- **Scene expansion no longer alphabetizes paint order.** `expandSceneInstance`
  built the synthetic group's child list via `Object.keys(def.items).sort()`,
  silently discarding the scene author's declaration order and substituting
  alphabetical order instead. An opaque item declared *after* its siblings
  (so it should paint on top) could end up painted *behind* them if its id
  happened to sort earlier — this was live-caught in a scene where a `panel`
  rect (alphabetically before `bar`/`label`) hid both of those items.
  Scene-local items now paint in declaration order. `SCENE_EXPANSION_VERSION`
  bumped `1 → 2`.

  Compositions that (knowingly or not) depended on the old alphabetized
  paint order — including any that were reordered/renamed as a workaround —
  should be re-rendered and checked.

### ⚠ Expansion v3 — scene instances clip to their own duration (R-26, R-27)

- **Scene instances now default to disappearing when their scene ends.** The
  synthetic group `add_scene_instance` / `type: "scene"` expansion produces
  previously carried no `enter`/`exit`, so once its tweens finished playing
  the instance held its last frame for the rest of the composition — a 4s
  scene instance placed at t=0 stayed visible even at t=30. The wrapper group
  now defaults `enter`/`exit` to `[start, start + effectiveDuration)`
  (`effectiveDuration` follows the instance's time-mapping mode: scene
  duration for identity/timeScale, `toTime - fromTime` for clip, `scene.duration
  * count` for loop). Pass explicit `enter`/`exit` on the instance to opt back
  into a custom or unbounded window. `SCENE_EXPANSION_VERSION` bumped `2 → 3`.

  Compositions that relied on a scene instance's last frame holding past its
  own duration should be re-rendered and checked; add explicit `enter`/`exit`
  to restore the old behavior for a specific instance if needed.

- **`remove_scene_instance` no longer deletes tweens it didn't add.** Removing
  an instance's wrapper group previously cascaded through the store's normal
  "drop tweens targeting a removed item" rule, so a separately-authored tween
  targeting the instance's synthetic group (the only target parent tweens may
  use, per §8.7) was silently deleted alongside the expansion's own tweens.
  `remove_scene_instance` now removes exactly the item/tween/asset ids its
  own `add_scene_instance` (or the most recent `update_scene_instance`) call
  produced; tweens authored separately against the same target survive.
