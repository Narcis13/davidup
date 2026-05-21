# Editor UX Findings — 2026-05-21

Findings from an end-to-end authoring + render session against `apps/editor`.
Flow exercised: scaffold `ux-test-video` from `basic` template → extend to 12s →
add a circle → add 4 tweens (rotation, scaleX, scaleY, fillColor) → render to MP4.
Render produced a valid 12.00s @ 60fps 1280×720 h264 file in ~5s.

Numbering matches the order the issues were hit during the session, not severity.

---

## 1. `BLEND_MODES` not exported on first load (blocks editor)

**Symptom.** Navigating to `/editor` for the first time after a clean dev start
throws in the browser console and the editor doesn't mount:

```
SyntaxError: The requested module '/node_modules/.vite/deps/davidup_schema.js?v=e052d8ba'
does not provide an export named 'BLEND_MODES'
    at LayersPanel.vue:2
```

The page renders blank until a hard reload (`Cmd+Shift+R`). After the hard
reload everything works.

**Root cause.** Vite pre-bundle cache (`apps/editor/node_modules/.vite/deps/davidup_schema.js`)
served a stale module reference. The export _is_ present in the cached file
(line 4416 of the cached bundle), but the importing chunk holds a binding from
an earlier build that didn't have it.

**Affected files.**
- `apps/editor/inertia/components/LayersPanel.vue:26` — `import { BLEND_MODES } from 'davidup/schema'`
- `src/schema/zod.ts:38` — `export const BLEND_MODES = ...`
- `src/schema/index.ts:6` — re-exports `BLEND_MODES`

**Impact.** High — a first-time user lands on a blank screen after creating a
project. Looks like the create-project flow silently failed.

**Suggested fix.** Either bump a cache-busting key when `davidup/schema`
changes, add `optimizeDeps.force` for the davidup workspace packages, or
exclude `davidup` from `optimizeDeps` so it's served from source. Investigate
why the second-build cache didn't see the new export.

---

## 2. FPS input rejects whole-number values

**Symptom.** Opening Composition settings, the FPS field shows `60`. Clicking
Apply fires browser HTML5 validation:

> Please enter a valid value. The two nearest valid values are 59.0001 and 60.0001.

The dialog refuses to close until FPS is set to `60.0001` (or similar). Workaround
during the session was removing `min` via DevTools.

**Root cause.** Input has misaligned validation attributes:

```
min="0.0001"   step="1"
```

Valid values are therefore `0.0001, 1.0001, 2.0001, ..., 60.0001`. The default
value `60` is outside the valid set.

**Affected file.** `apps/editor/inertia/components/CompositionSettingsDialog.vue`
(FPS input).

**Suggested fix.** Set `min="1"` (or `min="24"`) with `step="1"`. Allow integer
FPS; if fractional FPS is intentional for NTSC, set `step="0.001"` and a sensible
`min`.

---

## 3. Numeric fields render locale-formatted (`0,5` instead of `0.5`)

**Symptom.** Inspector shows `anchorX = 0,5` and `anchorY = 0,5` for the badge
(default 0.5 anchors). Looks like a typo or a comma-separated list to anyone
not on a comma-decimal locale.

**Root cause.** Likely `toLocaleString()` or `Intl.NumberFormat` applied to
display values without forcing `en-US`.

**Affected file.** `apps/editor/inertia/components/Inspector.vue` (number
display path).

**Suggested fix.** Use raw `String(value)` or `.toLocaleString('en-US')` for
inputs whose underlying schema is dot-decimal. Editing accepts dot, so input
parsing is fine — only display is wrong.

---

## 4. New circles default to `anchorX=0, anchorY=0`

**Symptom.** Placing a circle via the Circle tool creates an item with
`anchorX=0, anchorY=0`. Rotation and scale therefore pivot around the
top-left corner, which feels broken. Rectangles correctly default to
`0.5, 0.5`.

**Affected code.** Item-creation path for the circle primitive (likely in
`apps/editor/app/services/...` or the Stage drop handler in
`apps/editor/inertia/components/Stage.vue`).

**Suggested fix.** Mirror the rectangle default: anchor `(0.5, 0.5)` for
circles too. This matches user expectation that the visible center is the
pivot.

---

## 5. Newly-placed item is not auto-selected

**Symptom.** Click Circle tool → click stage → circle appears, but the
Inspector still shows the previously selected item (`badge`). The user has to
manually click the new circle on canvas before being able to edit it.

**Affected file.** `apps/editor/inertia/components/Stage.vue` — the drop /
place-mode completion path.

**Suggested fix.** After creating the item from place-mode, set selection to
the new item's id before exiting place-mode. Standard editor convention.

---

## 6. No non-drag affordance to add fonts / behaviors / scenes from library

**Symptom.** The Library panel lists global fonts (Inter, Bebas Neue, etc.)
and behaviors (pulse, fadeIn, etc.). Single-click highlights, double-click
does nothing, right-click does nothing. Only HTML5 drag-and-drop onto the
canvas works.

This cascades: the Text tool is disabled with the helpful tooltip
"Add a font asset to the composition before placing text" — but there is no
discoverable click path to register a font, so a user without prior drag-drop
knowledge is stuck.

**Affected file.** `apps/editor/inertia/components/LibraryCard.vue`.
Templates already have an `Apply` button (`canApply = item.kind === 'template'`).
Other kinds emit no `apply` event.

**Suggested fix.** Add an explicit "Add to project" / "+" button on font,
behavior, and scene cards. Keep drag-drop as the power-user path. At minimum,
add a hint string on the disabled Text tooltip pointing the user at the
Library → Fonts tab + the drag gesture.

---

## 7. Library cards are visually flat — no previews

**Symptom.** Fonts render as a list of text rows ("Anton", "Bebas Neue", ...)
with no glyph preview. Behaviors render similarly but at least have a one-line
inline description ("Scale out then back in. Set peakScale to the bulge size.").
Templates and scenes also lack thumbnails in the list view.

**Impact.** Picking a font or scene by name only is slow and error-prone, and
defeats the purpose of a visual library.

**Affected files.**
- `apps/editor/inertia/components/LibraryCard.vue`
- `apps/editor/inertia/components/Library.vue`
- `apps/editor/app/controllers/library_controller.ts` (`/api/library/thumbnail`
  already exists per `start/routes.ts`)

**Suggested fix.** Render the existing thumbnail endpoint for kinds that have
one. For fonts, render the family name in the font itself (a 20–24px
"AaBbCc 123" sample) so users see what they're picking.

---

## Out of scope but noted

- Outliner is a floating panel that overlaps the canvas by default. It collapses
  cleanly but consider docking it by default to a side panel.
- After render, the "Play" button on a History entry opens QuickTime externally
  rather than offering an in-app preview. The `/project-renders/:filename` route
  serves the MP4 fine — a small in-app `<video>` preview would close the loop
  without leaving the editor.
- The session did not exercise: Text tool, Sprite tool, Group/Ungroup, Scenes,
  Behaviors (couldn't drag-drop via the MCP), the SourceDrawer (⌘J), or
  undo/redo. Worth a second pass.
