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
