<script setup lang="ts">
// Inspector — step 09 of the editor build plan.
//
// Renders typed inputs for the currently selected item. The schema for the
// item type drives which fields are visible: sprite shows asset/width/height/
// tint, text shows text/font/fontSize/color/align, shape shows kind-specific
// geometry + colours, and every item type shows its 8 transform params.
//
// Each edit dispatches a single `update_item` command via `useCommandBus`.
// The server runs the existing MCP handler (`apply_item_update`) so UI and
// MCP edits stay byte-identical (D4 invariant). The response carries the
// next composition; we replace local state and `useStage` re-attaches at
// the preserved playhead.
//
// Orange "override" dot (polish_plan §20.25): the Inspector compares the
// live item's prop value against the server-supplied `defaults` snapshot —
// the freshly-precompiled composition captured at project load, after all
// $ref / $template / scene / $behavior passes have run but before any
// in-session mutation. For an item that came out of a `$template`
// instance, `defaults` holds the template-expansion value (post param
// substitution); for a `type: "scene"` instance, the scene's authored
// item shape. Editing back to that value clears the dot regardless of how
// the user got there.
//
// The previous heuristic compared against a *client-side* clone of the
// composition taken at session start, which silently reset every page
// reload — making override detection a "what changed in this tab" hint
// rather than "what diverges from the source-of-truth defaults".

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EASING_NAMES } from 'davidup/easings'
import { getTweenable, listTweenable } from 'davidup/schema'
import type { ItemType } from 'davidup/schema'
import { useSelection } from '~/composables/useSelection'
import type { Command, CommandSource, Composition } from '~/composables/useCommandBus'
import { readPath } from '~/composables/useCommandBus'
import type { PickSourceInfo } from '~/composables/useSelection'
import NumberInput from '~/components/inputs/Number.vue'
import StringInput from '~/components/inputs/String.vue'
import ColorInput from '~/components/inputs/Color.vue'
import TimeInput from '~/components/inputs/Time.vue'
import EnumInput from '~/components/inputs/Enum.vue'
import BooleanInput from '~/components/inputs/Boolean.vue'
import PercentInput from '~/components/inputs/Percent.vue'
import RawJsonInput from '~/components/inputs/RawJson.vue'
import AssetPickerInput from '~/components/inputs/AssetPicker.vue'

type ItemLike = {
  type: 'sprite' | 'text' | 'shape' | 'group' | 'video'
  kind?: string
  transform: {
    x: number
    y: number
    scaleX: number
    scaleY: number
    rotation: number
    anchorX: number
    anchorY: number
    opacity: number
  }
  [k: string]: unknown
}

const props = defineProps<{
  composition: Composition | null
  /**
   * Defaults reference for the override-detection dot. Server-provided
   * (rendered into the Inertia payload) and stable across edits within a
   * server session — see editor.vue:`defaults` prop and polish_plan
   * §20.25.
   */
  defaults: Composition | null
  pending?: boolean
  error?: string | null
  /**
   * Current playhead time (seconds). Used as the default `start` value when
   * authoring a new tween via the field-level `+ animate` button so the
   * tween lands where the user is currently scrubbed (UX_GAPS §C).
   */
  playhead?: number
  // Step 20.2 — most recent edit source per item id. When the selected
  // item's last change came from MCP, the header renders an "AI edit"
  // pill (foundation for FR-13). Optional so existing callers that don't
  // yet pass it keep working (the pill just never appears).
  itemLastSource?: ReadonlyMap<string, CommandSource>
  // Step 20.23 — source-map info for the most recent stage pick (only the
  // selected item is meaningful here; `useSelection` clears it when the
  // selection changes to another id). Optional so existing callers keep
  // working — the provenance line just doesn't render when missing.
  lastPickSource?: PickSourceInfo | null
  /**
   * UX_FINDINGS §7 — resolver that returns an item's fully-resolved state
   * at a given time. The Inspector calls this to show the value that
   * matches the painted frame for any tweened property, rather than the
   * authored base value. Optional so the panel still mounts when the
   * stage isn't attached.
   */
  getResolvedItemAt?: (itemId: string, t?: number) => Record<string, unknown> | null
}>()

const emit = defineEmits<{
  (event: 'apply', command: Command): void
  // Step 20.23: provenance line under the item header asks the page to
  // open the SourceDrawer at the picked location (same effect as ⌘J).
  (event: 'reveal-source'): void
}>()

const selection = useSelection()

// All item ids, sorted by layer / position — the "current way to select"
// before stage hit-testing lands in step 16. Group children that are not
// listed in any layer still appear (they live under `composition.items` as
// sub-items).
const itemOptions = computed<Array<{ value: string; label: string }>>(() => {
  const comp = props.composition
  if (!comp) return []
  const items = (comp.items ?? {}) as Record<string, { type: string }>
  const ordered: string[] = []
  const seen = new Set<string>()
  for (const layer of (comp.layers ?? []) as Array<{ id: string; items: string[] }>) {
    for (const itemId of layer.items ?? []) {
      if (!seen.has(itemId) && items[itemId]) {
        ordered.push(itemId)
        seen.add(itemId)
      }
    }
  }
  for (const id of Object.keys(items)) {
    if (!seen.has(id)) ordered.push(id)
  }
  return ordered.map((id) => ({
    value: id,
    label: `${id}  ·  ${items[id]?.type ?? '?'}`,
  }))
})

const selectedItem = computed<ItemLike | null>(() => {
  const comp = props.composition
  const id = selection.selectedItemId.value
  if (!comp || !id) return null
  const item = (comp.items as Record<string, ItemLike>)[id]
  return item ?? null
})

// UX_FINDINGS §7 — fully-resolved state of the selected item at the
// current playhead. Re-runs whenever the playhead, the selected item id,
// or the composition reference changes so values track the painted frame.
// Falls back to the base item when no resolver is wired (e.g. SSR, or
// before the driver attaches).
const resolvedSelectedItem = computed<ItemLike | null>(() => {
  const id = selection.selectedItemId.value
  if (!id) return null
  const resolver = props.getResolvedItemAt
  // Touch playhead + composition so this computed invalidates with them.
  const t = props.playhead ?? 0
  const compRef = props.composition
  if (!resolver || !compRef) return selectedItem.value
  const resolved = resolver(id, t)
  if (!resolved) return selectedItem.value
  return resolved as ItemLike
})

// Set of `${target}::${property}` keys that have at least one tween in the
// composition. Used to flag fields as "animated" in the Inspector without
// scanning the tween list per-field on every render.
const tweenedKeys = computed<ReadonlySet<string>>(() => {
  const tweens = props.composition?.tweens as
    | ReadonlyArray<{ target?: unknown; property?: unknown }>
    | undefined
  const out = new Set<string>()
  if (!Array.isArray(tweens)) return out
  for (const tw of tweens) {
    if (typeof tw?.target !== 'string' || typeof tw?.property !== 'string') continue
    out.add(`${tw.target}::${tw.property}`)
  }
  return out
})

function isFieldAnimated(field: FieldDef): boolean {
  const id = selection.selectedItemId.value
  if (!id) return false
  return tweenedKeys.value.has(`${id}::${field.path}`)
}

// UX_GAPS §Q multi-select — resolve every selected id to its item. Used by the
// Mixed-badge logic + bulk dispatchEdit. Missing ids (deleted between marquee
// and render) are silently dropped so the Inspector never throws on stale state.
const selectedItems = computed<ReadonlyArray<ItemLike>>(() => {
  const comp = props.composition
  const ids = selection.selectedItemIds.value
  if (!comp || ids.length === 0) return []
  const items = comp.items as Record<string, ItemLike>
  const out: ItemLike[] = []
  for (const id of ids) {
    const item = items[id]
    if (item) out.push(item)
  }
  return out
})

const multiCount = computed<number>(() => selectedItems.value.length)
const isMultiSelect = computed<boolean>(() => multiCount.value > 1)

// `null` whenever the selection is empty OR the selected items have mixed
// types. The type-specific section only renders when this is non-null, so
// multi-select across mixed types collapses to the Transform-only editor.
const commonItemType = computed<ItemLike['type'] | null>(() => {
  const items = selectedItems.value
  if (items.length === 0) return null
  const first = items[0]!.type
  for (let i = 1; i < items.length; i++) {
    if (items[i]!.type !== first) return null
  }
  return first
})

const selectedItemLastSource = computed<CommandSource | null>(() => {
  const id = selection.selectedItemId.value
  const map = props.itemLastSource
  if (!id || !map) return null
  return map.get(id) ?? null
})

const showAiEditPill = computed<boolean>(() => selectedItemLastSource.value === 'mcp')

// §M lock: when the selected item carries `locked: true`, every edit input
// (and the field-level "+ animate" buttons that dispatch update_item /
// add_tween from this panel) is disabled, and a banner offers an unlock
// button. The flag is editor-side only — the engine ignores it — so the
// only way it shows up here is through the Layers panel toggle.
const selectedItemLocked = computed<boolean>(() => {
  const item = selectedItem.value as ({ locked?: unknown } | null)
  return item?.locked === true
})

function unlockSelectedItem(): void {
  const id = selection.selectedItemId.value
  if (!id) return
  emit('apply', {
    kind: 'update_item',
    payload: { id, props: { locked: false } },
    source: 'ui',
  })
}

const defaultsItem = computed<ItemLike | null>(() => {
  const base = props.defaults
  const id = selection.selectedItemId.value
  if (!base || !id) return null
  const item = (base.items as Record<string, ItemLike>)[id]
  return item ?? null
})

const compositionDuration = computed<number>(() => {
  const d = props.composition?.composition?.duration
  return typeof d === 'number' && d > 0 ? d : 0
})

// Composition's registered assets — the source of truth for the sprite/font
// pickers. Reads through `as` so the typed Composition's `assets` field stays
// a `ReadonlyArray<{ src?: unknown }>` without forcing AssetPicker to learn
// that wider shape.
type InspectorAsset = {
  id: string
  type?: string
  family?: string
  src?: string
  /** U4 — probed media duration (audio/video assets), seconds. */
  duration?: number
}

const compositionAssets = computed<ReadonlyArray<InspectorAsset>>(() => {
  const list = props.composition?.assets
  if (!Array.isArray(list)) return []
  const out: InspectorAsset[] = []
  for (const a of list as Array<{
    id?: unknown
    type?: unknown
    family?: unknown
    src?: unknown
    duration?: unknown
  }>) {
    if (typeof a?.id !== 'string') continue
    const item: InspectorAsset = { id: a.id }
    if (typeof a.type === 'string') item.type = a.type
    if (typeof a.family === 'string') item.family = a.family
    if (typeof a.src === 'string') item.src = a.src
    if (typeof a.duration === 'number' && Number.isFinite(a.duration)) item.duration = a.duration
    out.push(item)
  }
  return out
})

// UX_GAPS §E — layer list for the "Move to layer" dropdown. Sorted top-to-
// bottom (high z first) so the option order matches LayersPanel / Outliner.
interface LayerOption { id: string; z: number }

const compositionLayers = computed<ReadonlyArray<LayerOption>>(() => {
  const layers = props.composition?.layers
  if (!Array.isArray(layers)) return []
  const out: LayerOption[] = []
  for (const l of layers as ReadonlyArray<Record<string, unknown>>) {
    const id = typeof l.id === 'string' ? l.id : null
    if (!id) continue
    out.push({ id, z: typeof l.z === 'number' ? l.z : 0 })
  }
  out.sort((a, b) => b.z - a.z)
  return out
})

// Which layer directly owns the currently-selected item (layer.items[]
// contains the id). Group children return null — they're not layer-rooted.
const selectedItemLayerId = computed<string | null>(() => {
  const comp = props.composition
  const id = selection.selectedItemId.value
  if (!comp || !id) return null
  const layers = (comp.layers ?? []) as ReadonlyArray<{ id: string; items: ReadonlyArray<string> }>
  for (const layer of layers) {
    if (Array.isArray(layer.items) && layer.items.includes(id)) return layer.id
  }
  return null
})

function onMoveItemToLayer(event: Event): void {
  const target = event.target as HTMLSelectElement
  const targetLayerId = target.value
  const itemId = selection.selectedItemId.value
  if (!itemId || !targetLayerId) return
  if (selectedItemLayerId.value === targetLayerId) return
  emit('apply', {
    kind: 'move_item_to_layer',
    payload: { itemId, targetLayerId },
    source: 'ui',
  })
}

// UX_GAPS §P — friendly item name.
const selectedItemName = computed<string>(() => {
  const item = selectedItem.value as ({ name?: unknown } | null)
  return typeof item?.name === 'string' ? item.name : ''
})

function onNameInput(event: Event): void {
  const target = event.target as HTMLInputElement
  const id = selection.selectedItemId.value
  if (!id) return
  const trimmed = target.value.slice(0, 80)
  emit('apply', {
    kind: 'update_item',
    payload: { id, props: { name: trimmed } },
    source: 'ui',
  })
}

// ──────────────── Field registry ────────────────
//
// The PRD R2 mitigation: a registry of input components keyed by Zod meta-
// type rather than blind reflection. Each entry tells the Inspector how to
// pull the current value out of an item, what input to render, and what
// `update_item` payload key to send back.

// Step 20.22: `boolean`, `percent`, and `json` join the registry; any
// schema kind not listed here falls through to the `RawJson` editor so an
// unknown type can never block editing (PRD R2).
type FieldKind =
  | 'number'
  | 'string'
  | 'color'
  | 'enum'
  | 'time'
  | 'boolean'
  | 'percent'
  | 'json'
  | 'asset'

interface FieldDef {
  key: string
  label: string
  kind: FieldKind
  path: string
  min?: number
  max?: number
  step?: number
  options?: ReadonlyArray<string>
  multiline?: boolean
  placeholder?: string
  /** Used with `kind: 'asset'` to filter the picker by asset type. */
  assetType?: 'image' | 'font' | 'audio' | 'video'
}

const TRANSFORM_FIELDS: ReadonlyArray<FieldDef> = [
  { key: 'x', label: 'x', kind: 'number', path: 'transform.x', step: 1 },
  { key: 'y', label: 'y', kind: 'number', path: 'transform.y', step: 1 },
  { key: 'scaleX', label: 'scaleX', kind: 'number', path: 'transform.scaleX', step: 0.01 },
  { key: 'scaleY', label: 'scaleY', kind: 'number', path: 'transform.scaleY', step: 0.01 },
  {
    key: 'rotation',
    label: 'rotation (rad)',
    kind: 'number',
    path: 'transform.rotation',
    step: 0.05,
  },
  { key: 'anchorX', label: 'anchorX', kind: 'number', path: 'transform.anchorX', step: 0.05 },
  { key: 'anchorY', label: 'anchorY', kind: 'number', path: 'transform.anchorY', step: 0.05 },
  {
    key: 'opacity',
    label: 'opacity',
    kind: 'percent',
    path: 'transform.opacity',
    step: 1,
  },
]

// Lifespan window on the composition timeline. Half-open [enter, exit):
// outside it, the resolver flips `visible = false` so the renderer skips
// the item. Either bound left blank means "open" on that side.
const LIFESPAN_FIELDS: ReadonlyArray<FieldDef> = [
  { key: 'enter', label: 'enter', kind: 'time', path: 'enter', min: 0, step: 0.05 },
  { key: 'exit', label: 'exit', kind: 'time', path: 'exit', min: 0, step: 0.05 },
]

const SPRITE_FIELDS: ReadonlyArray<FieldDef> = [
  { key: 'asset', label: 'asset', kind: 'asset', path: 'asset', assetType: 'image' },
  { key: 'width', label: 'width', kind: 'number', path: 'width', min: 0, step: 1 },
  { key: 'height', label: 'height', kind: 'number', path: 'height', min: 0, step: 1 },
  { key: 'tint', label: 'tint', kind: 'color', path: 'tint' },
]

const TEXT_FIELDS: ReadonlyArray<FieldDef> = [
  { key: 'text', label: 'text', kind: 'string', path: 'text', multiline: true },
  { key: 'font', label: 'font', kind: 'asset', path: 'font', assetType: 'font' },
  { key: 'fontSize', label: 'fontSize', kind: 'number', path: 'fontSize', min: 1, step: 1 },
  { key: 'color', label: 'color', kind: 'color', path: 'color' },
  {
    key: 'align',
    label: 'align',
    kind: 'enum',
    path: 'align',
    options: ['left', 'center', 'right'],
  },
]

const SHAPE_FIELDS: ReadonlyArray<FieldDef> = [
  { key: 'width', label: 'width', kind: 'number', path: 'width', min: 0, step: 1 },
  { key: 'height', label: 'height', kind: 'number', path: 'height', min: 0, step: 1 },
  { key: 'fillColor', label: 'fillColor', kind: 'color', path: 'fillColor' },
  { key: 'strokeColor', label: 'strokeColor', kind: 'color', path: 'strokeColor' },
  {
    key: 'strokeWidth',
    label: 'strokeWidth',
    kind: 'number',
    path: 'strokeWidth',
    min: 0,
    step: 1,
  },
  {
    key: 'cornerRadius',
    label: 'cornerRadius',
    kind: 'number',
    path: 'cornerRadius',
    min: 0,
    step: 1,
  },
]

// U4 — VideoItem fields. Spatial (x/y/scale/rotation/anchor/opacity) is
// already covered by TRANSFORM_FIELDS since VideoItemSchema carries the same
// `transform` shape as a sprite. This registry only adds the video-specific
// source/time/display fields: asset (filtered to video), trim window, the
// item's own temporal placement (start/end — distinct from the Lifespan
// enter/exit window every item type has), display fit mode, and loop.
const VIDEO_FIELDS: ReadonlyArray<FieldDef> = [
  { key: 'asset', label: 'asset', kind: 'asset', path: 'asset', assetType: 'video' },
  { key: 'start', label: 'start', kind: 'time', path: 'start', min: 0, step: 0.05 },
  { key: 'end', label: 'end', kind: 'time', path: 'end', min: 0, step: 0.05 },
  { key: 'trimIn', label: 'trimIn', kind: 'time', path: 'trimIn', min: 0, step: 0.05 },
  { key: 'trimOut', label: 'trimOut', kind: 'time', path: 'trimOut', min: 0, step: 0.05 },
  {
    key: 'fit',
    label: 'fit',
    kind: 'enum',
    path: 'fit',
    options: ['cover', 'contain', 'fill', 'none'],
  },
  { key: 'loop', label: 'loop', kind: 'boolean', path: 'loop' },
  { key: 'width', label: 'width', kind: 'number', path: 'width', min: 0, step: 1 },
  { key: 'height', label: 'height', kind: 'number', path: 'height', min: 0, step: 1 },
]

const itemSpecificFields = computed<ReadonlyArray<FieldDef>>(() => {
  // Multi-select across mixed item types: hide the type-specific section
  // entirely. Only Transform — common to every item — keeps rendering.
  const type = commonItemType.value
  if (!type) return []
  switch (type) {
    case 'sprite':
      return SPRITE_FIELDS
    case 'text':
      return TEXT_FIELDS
    case 'shape':
      return SHAPE_FIELDS
    case 'video':
      return VIDEO_FIELDS
    case 'group':
      return []
    default:
      return []
  }
})

// U4 — computed duration breakdown shown next to the video section header:
// "Source: 12.5s · Visible: 8.0s · Freeze: 0.3s" or "… · Loops: 1.6x".
// Resolves the asset's registered duration (from composition.assets) so the
// hint stays accurate even before trimOut has been set explicitly.
const selectedVideoAsset = computed<InspectorAsset | null>(() => {
  const item = selectedItem.value
  if (!item || item.type !== 'video') return null
  const assetId = typeof item.asset === 'string' ? item.asset : null
  if (!assetId) return null
  return compositionAssets.value.find((a) => a.id === assetId) ?? null
})

const selectedVideoAssetDuration = computed<number | null>(() => {
  const d = selectedVideoAsset.value?.duration
  return typeof d === 'number' && Number.isFinite(d) ? d : null
})

const videoDurationSummary = computed<string | null>(() => {
  const item = selectedItem.value
  if (!item || item.type !== 'video' || isMultiSelect.value) return null
  const start = typeof item.start === 'number' ? item.start : 0
  const end = typeof item.end === 'number' ? item.end : null
  const trimIn = typeof item.trimIn === 'number' ? item.trimIn : 0
  const trimOut = typeof item.trimOut === 'number' ? item.trimOut : selectedVideoAssetDuration.value
  const sourceDur = selectedVideoAssetDuration.value
  const parts: string[] = []
  if (sourceDur !== null) parts.push(`Source: ${sourceDur.toFixed(1)}s`)
  if (trimOut !== null) {
    const visible = Math.max(0, trimOut - trimIn)
    parts.push(`Visible: ${visible.toFixed(1)}s`)
    if (end !== null) {
      const span = Math.max(0, end - start)
      const tail = span - visible
      if (tail > 0.05) {
        if (item.loop === true) {
          parts.push(`Loops: ${(span / Math.max(visible, 0.001)).toFixed(1)}x`)
        } else {
          parts.push(`Freeze: ${tail.toFixed(1)}s`)
        }
      }
    }
  }
  return parts.length > 0 ? parts.join(' · ') : null
})

function resetVideoTrim(): void {
  const id = selection.selectedItemId.value
  if (!id) return
  const dur = selectedVideoAssetDuration.value
  emit('apply', {
    kind: 'update_item',
    payload: {
      id,
      props: { trimIn: 0, ...(dur !== null ? { trimOut: dur } : {}) },
    },
    source: 'ui',
  })
}

function valueFor(field: FieldDef): unknown {
  // UX_FINDINGS §7 — for an animated property, return the value that the
  // engine resolves at the current playhead (matches the painted frame),
  // not the authored base value. Single-select only: multi-select still
  // uses the per-item base via readPath(selectedItem.value, ...) so the
  // Mixed badge logic stays consistent (resolving N items × tweens × N
  // playheads is well beyond what the bulk-edit row needs).
  if (!isMultiSelect.value && isFieldAnimated(field) && resolvedSelectedItem.value) {
    return readPath(resolvedSelectedItem.value, field.path)
  }
  return readPath(selectedItem.value, field.path)
}

// Authored base value for an animated field — shown as a tiny "base: X"
// hint next to the input so the user knows what the keyframe-free value
// is. Returns null when the field isn't animated.
function baseValueFor(field: FieldDef): unknown {
  if (!isFieldAnimated(field)) return null
  return readPath(selectedItem.value, field.path)
}

function formatBaseValue(v: unknown): string {
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : v.toFixed(3)
  }
  if (typeof v === 'string') return v
  if (v === undefined || v === null) return '—'
  return JSON.stringify(v)
}

// UX_GAPS §Q — true when multi-select and at least two selected items
// disagree on the field's value. Drives the "Mixed" badge per row and
// suppresses the orange override dot (override-vs-defaults stops being
// meaningful when N items are in scope).
function isMixed(field: FieldDef): boolean {
  const items = selectedItems.value
  if (items.length < 2) return false
  const first = readPath(items[0]!, field.path)
  for (let i = 1; i < items.length; i++) {
    if (!sameValue(first, readPath(items[i]!, field.path))) return true
  }
  return false
}

function isOverridden(field: FieldDef): boolean {
  // Mixed values in multi-select don't have a single defaults to compare
  // against — collapse to "not overridden" so the Mixed badge owns the row.
  if (isMultiSelect.value) return false
  const current = readPath(selectedItem.value, field.path)
  const def = readPath(defaultsItem.value, field.path)
  // Items born in this session (no entry in the defaults snapshot) are
  // fresh — nothing to override against. The post-load add_* commands
  // mutate `composition` but never the captured defaults, so the lookup
  // returns undefined and the dot stays off.
  if (def === undefined) return false
  return !sameValue(current, def)
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 1e-9
  }
  return false
}

// Field kind → input component. Anything not in the map falls through to
// RawJson so the user is never blocked by an unknown type (PRD R2).
const INPUT_FOR_KIND = {
  number: NumberInput,
  string: StringInput,
  color: ColorInput,
  enum: EnumInput,
  time: TimeInput,
  boolean: BooleanInput,
  percent: PercentInput,
  json: RawJsonInput,
  asset: AssetPickerInput,
} as const

function inputFor(field: FieldDef) {
  return (INPUT_FOR_KIND as Record<string, unknown>)[field.kind] ?? RawJsonInput
}

/**
 * Extra props for kind-specific inputs that don't fit the generic
 * label/min/max/step/options surface. Today only the asset picker needs it
 * (composition assets + type filter); we keep this off the `<component>`
 * tag for every input so the others don't see noise in `$attrs`.
 */
function extraPropsFor(field: FieldDef): Record<string, unknown> {
  if (field.kind === 'asset') {
    return {
      assets: compositionAssets.value,
      assetType: field.assetType,
    }
  }
  return {}
}

// ──────────────── Provenance ────────────────
// Step 20.23 — render a tiny "Source: …" line under the section header so
// the user can see where the currently picked item was authored without
// opening the source drawer. Clicking it emits `reveal-source`, which the
// page wires up to the same toggle ⌘J fires.

interface ProvenanceInfo {
  text: string
  originKind: PickSourceInfo['originKind']
}

const provenance = computed<ProvenanceInfo | null>(() => {
  const src = props.lastPickSource ?? null
  if (!src || !selection.selectedItemId.value) return null
  return {
    text: formatProvenance(src),
    originKind: src.originKind,
  }
})

const provenanceTitle = computed<string | null>(() => {
  const src = props.lastPickSource ?? null
  if (!src) return null
  return `${src.file}${src.jsonPointer} (${src.originKind}) — click or press ⌘J to reveal in source`
})

function formatProvenance(src: PickSourceInfo): string {
  const tail = friendlyPointer(src.jsonPointer)
  // `<root>` is the precompiler's placeholder file name for entries authored
  // inline in the loaded composition.json (no `__source` attribution). The
  // file segment doesn't add information in that case, so we collapse to
  // just the pointer path.
  if (!src.file || src.file === '<root>') return tail || 'root'
  const head = fileBasenameNoExt(src.file)
  if (!tail) return head
  return `${head} ⇢ ${tail}`
}

function fileBasenameNoExt(file: string): string {
  const slash = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
  const base = slash >= 0 ? file.slice(slash + 1) : file
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

function friendlyPointer(pointer: string): string {
  if (!pointer || pointer === '/') return ''
  const raw = pointer.startsWith('/') ? pointer.slice(1) : pointer
  const tokens = raw.split('/').map(decodePtrToken)
  // RFC-6901 leaves us with a slash-separated path: turn it into the more
  // editor-friendly `parent::child` (objects) / `parent[2]` (arrays).
  let out = ''
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]
    if (/^\d+$/.test(t)) {
      out += `[${t}]`
      continue
    }
    // Composed ids carry the scene/template instance + child via `__`.
    // Render them with the same separator so users can spot which scene a
    // picked sub-item came from.
    const composed = t.includes('__') ? t.replace(/__/g, '::') : t
    out += out === '' ? composed : `::${composed}`
  }
  return out
}

function decodePtrToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~')
}

function onProvenanceClick(): void {
  emit('reveal-source')
}

function dispatchEdit(field: FieldDef, raw: unknown): void {
  // `update_item.props` uses flat keys — both transform overrides and
  // type-specific fields share the same namespace. See applyItemUpdate
  // in src/mcp/store.ts.
  //
  // Multi-select bulk edit (UX_GAPS §Q): fire one `update_item` per
  // selected id. The command bus serialises through the server one at a
  // time; per-item failures show up as individual toasts so the user can
  // tell which targets accepted the change. The Mixed badge then either
  // clears (everyone now agrees) or stays on if some items rejected.
  const ids = selection.selectedItemIds.value
  const targets =
    ids.length > 0
      ? ids
      : selection.selectedItemId.value
        ? [selection.selectedItemId.value]
        : []
  if (targets.length === 0) return
  for (const id of targets) {
    emit('apply', {
      kind: 'update_item',
      payload: { id, props: { [field.key]: raw } },
      source: 'ui',
    } as Command)
  }
}

// ──────────────── Add-tween authoring (UX_GAPS §C) ────────────────
//
// Each tweenable field renders a tiny `+` button next to the input. Clicking
// it opens an inline popover with `from / to / start / duration / easing`
// controls (seeded from the field's current value and the editor playhead).
// On confirm we dispatch a single `add_tween` command — the same shape the
// MCP add_tween tool produces, keeping UI ↔ MCP equivalence intact.

interface AddTweenPopoverState {
  field: FieldDef
  from: number | string
  to: number | string
  start: number
  duration: number
  easing: string
}

const addTweenPopover = ref<AddTweenPopoverState | null>(null)

function isFieldTweenable(field: FieldDef): boolean {
  // Tween authoring is single-target by construction (`add_tween` carries
  // one `target` id). Hide the `+ animate` button while multiple items
  // are selected so the user doesn't think a click would animate them all.
  if (isMultiSelect.value) return false
  const item = selectedItem.value
  if (!item) return false
  return getTweenable(item.type as ItemType, field.path) !== undefined
}

function tweenValueKindForField(field: FieldDef): 'number' | 'color' | 'unknown' {
  const item = selectedItem.value
  if (!item) return 'unknown'
  const desc = getTweenable(item.type as ItemType, field.path)
  return desc ? desc.kind : 'unknown'
}

function inputForKind(kind: 'number' | 'color' | 'unknown') {
  switch (kind) {
    case 'number':
      return NumberInput
    case 'color':
      return ColorInput
    default:
      return RawJsonInput
  }
}

function snapStart(t: number, duration: number): number {
  // Clamp `start` so `start + duration` stays within the composition. We
  // intentionally keep it simple — the server validator owns the final
  // word; this just makes the seed feel sensible.
  if (!Number.isFinite(t) || t < 0) return 0
  const dur = compositionDuration.value
  if (dur <= 0) return Math.max(0, t)
  const max = Math.max(0, dur - duration)
  return Math.min(max, Math.max(0, t))
}

function openAddTweenPopover(field: FieldDef): void {
  const item = selectedItem.value
  if (!item) return
  const desc = getTweenable(item.type as ItemType, field.path)
  if (!desc) return
  const current = readPath(item, field.path)
  // Sensible defaults: from = current value, to = current value (user nudges
  // it), start = current playhead clipped into the composition, duration =
  // min(1s, remaining time). Falls back to neutral colours/0 when the field
  // hasn't been assigned yet.
  const fallback: number | string = desc.kind === 'color' ? '#ffffff' : 0
  const seed: number | string =
    desc.kind === 'color'
      ? typeof current === 'string'
        ? current
        : fallback
      : typeof current === 'number'
        ? current
        : 0
  const compDur = compositionDuration.value > 0 ? compositionDuration.value : 1
  const duration = Math.min(1, Math.max(0.1, compDur))
  const start = snapStart(props.playhead ?? 0, duration)
  addTweenPopover.value = {
    field,
    from: seed,
    to: seed,
    start,
    duration,
    easing: 'linear',
  }
}

function closeAddTweenPopover(): void {
  addTweenPopover.value = null
}

function updateAddTweenField<K extends keyof AddTweenPopoverState>(
  key: K,
  value: AddTweenPopoverState[K],
): void {
  const cur = addTweenPopover.value
  if (!cur) return
  addTweenPopover.value = { ...cur, [key]: value }
}

function confirmAddTween(): void {
  const state = addTweenPopover.value
  const id = selection.selectedItemId.value
  if (!state || !id) return
  const payload: Record<string, unknown> = {
    target: id,
    property: state.field.path,
    from: state.from,
    to: state.to,
    start: Math.max(0, state.start),
    duration: Math.max(0.05, state.duration),
    easing: state.easing,
  }
  const command: Command = {
    kind: 'add_tween',
    payload,
    source: 'ui',
  }
  emit('apply', command)
  addTweenPopover.value = null
}

function isAddTweenPopoverFor(field: FieldDef): boolean {
  const cur = addTweenPopover.value
  return !!cur && cur.field.key === field.key && cur.field.path === field.path
}

// Close any open popover when the user changes selection so we don't issue
// an add_tween for a stale target.
watch(
  () => selection.selectedItemId.value,
  () => {
    addTweenPopover.value = null
  },
)
watch(
  () => selection.selectedTweenId.value,
  (tid) => {
    if (tid) addTweenPopover.value = null
  },
)

// Esc dismisses the add-tween popover. We register at the window level so
// the user can back out without focusing the popover first — same UX as
// ItemToolbar's Esc handling.
function onAddTweenKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (!addTweenPopover.value) return
  event.preventDefault()
  closeAddTweenPopover()
}

onMounted(() => {
  if (typeof window !== 'undefined') window.addEventListener('keydown', onAddTweenKeydown)
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onAddTweenKeydown)
})

// ──────────────── Remove-tween (UX_GAPS §C) ──────────────────────
// Dispatch helper for the "Delete tween" button shown in tween mode. The
// page's deleteSelection (Backspace) also calls remove_tween via the same
// path when a tween is selected — both flow through the bus.

function deleteSelectedTween(): void {
  // Read via the function reference defined further down (closure resolution
  // happens at call time, so we can refer to `selectedTween` here even
  // though the `const` lives below for narrative grouping).
  const tw = selectedTween.value
  if (!tw) return
  // Mirror editor.vue:deleteSelection's invariant — drop the tween selection
  // before dispatching so the Inspector immediately falls back to item mode
  // (it would do so anyway when the response arrives, but this avoids a
  // momentary "tween not found" render between command and response).
  selection.setTweenSelection(null)
  emit('apply', {
    kind: 'remove_tween',
    payload: { id: tw.id },
    source: 'ui',
  })
}

// ──────────────── Tween editor (step 20.24) ────────────────
//
// When the Timeline emits a bar click, `useSelection.setTweenSelection`
// records the tween id alongside the item selection. The Inspector then
// swaps its item editor for a minimal 6-field tween panel:
//   property · from · to · start · duration · easing
// Edits dispatch a single `update_tween` per change (no diffing — the
// server's `applyTweenUpdate` accepts partial `props`). A full curve
// editor is deferred to v1.1 per polish_plan §R-P1.

type TweenLike = {
  id: string
  target: string
  property: string
  from: unknown
  to: unknown
  start: number
  duration: number
  easing?: string
}

const selectedTween = computed<TweenLike | null>(() => {
  const comp = props.composition
  const tid = selection.selectedTweenId.value
  if (!comp || !tid) return null
  const list = (comp.tweens ?? []) as ReadonlyArray<TweenLike>
  for (const t of list) {
    if (t && t.id === tid) return t
  }
  return null
})

// Item the selected tween targets — used to derive which properties are
// tweenable (for the property dropdown) and the value kind for from/to.
const tweenTargetItem = computed<ItemLike | null>(() => {
  const tw = selectedTween.value
  const comp = props.composition
  if (!tw || !comp) return null
  const items = (comp.items as Record<string, ItemLike>) ?? {}
  return items[tw.target] ?? null
})

const tweenPropertyOptions = computed<ReadonlyArray<string>>(() => {
  const tw = selectedTween.value
  const item = tweenTargetItem.value
  if (!item) return tw ? [tw.property] : []
  const known = listTweenable(item.type as ItemType).map((d) => d.path)
  // If the current property isn't in the tweenable table (legacy or future
  // schema), keep it visible in the dropdown so the user can see what's
  // there before switching it out.
  if (tw && !known.includes(tw.property)) return [tw.property, ...known]
  return known
})

// Resolve the from/to value kind so the inputs render correctly. Without a
// known item or property descriptor we fall back to the raw-JSON editor,
// matching the R2 mitigation from the item editor.
const tweenValueKind = computed<'number' | 'color' | 'unknown'>(() => {
  const tw = selectedTween.value
  const item = tweenTargetItem.value
  if (!tw || !item) return 'unknown'
  const desc = getTweenable(item.type as ItemType, tw.property)
  return desc ? desc.kind : 'unknown'
})

function inputForTweenValue() {
  switch (tweenValueKind.value) {
    case 'number':
      return NumberInput
    case 'color':
      return ColorInput
    default:
      return RawJsonInput
  }
}

function dispatchTweenEdit(key: string, raw: unknown): void {
  const tw = selectedTween.value
  if (!tw) return
  // `update_tween.props` uses flat keys (id, target, property, from, to,
  // start, duration, easing). The server validates partial patches —
  // see applyTweenUpdate in src/mcp/store.ts. Each edit is a single round-
  // trip; for drag-driven changes the Timeline already batches via
  // useTimelineDrag.
  const command: Command = {
    kind: 'update_tween',
    payload: { id: tw.id, props: { [key]: raw } },
    source: 'ui',
  }
  emit('apply', command)
}

function clearTweenSelection(): void {
  // Returning the Inspector to item-editor mode without losing the
  // underlying item selection (so the Stage selection ring stays put).
  selection.setTweenSelection(null)
}

function onSelectionChange(event: Event): void {
  const target = event.target as HTMLSelectElement
  selection.setSelection(target.value || null)
}

// ──────────────── U2: Audio track editor ────────────────
//
// Audio tracks aren't items — they live in `composition.audio[]`, addressed
// through `selection.selectedAudioTrackId` (mutually exclusive with the
// item/tween editor modes above). Mirrors the tween editor's shape: a small
// fixed field set, one `update_audio_track` per edit.

type AudioTrackLike = {
  id: string
  asset: string
  start: number
  end?: number
  volume?: number
  fadeIn?: number
  fadeOut?: number
}

const selectedAudioTrack = computed<AudioTrackLike | null>(() => {
  const comp = props.composition
  const id = selection.selectedAudioTrackId.value
  if (!comp || !id) return null
  const list = (comp as { audio?: unknown }).audio
  if (!Array.isArray(list)) return null
  for (const t of list as ReadonlyArray<AudioTrackLike>) {
    if (t && t.id === id) return t
  }
  return null
})

const audioTrackAssetDuration = computed<number | null>(() => {
  const track = selectedAudioTrack.value
  if (!track) return null
  const asset = compositionAssets.value.find((a) => a.id === track.asset)
  return asset?.duration ?? null
})

// Half-open [start, end) validity check mirroring the S1 schema invariant —
// purely advisory here (the server is the source of truth); flags when the
// track's end runs past the composition so the user gets an inline nudge
// before dispatching an edit the validator would otherwise flag as a
// warning post-hoc.
const audioTrackExceedsComposition = computed<boolean>(() => {
  const track = selectedAudioTrack.value
  if (!track || typeof track.end !== 'number') return false
  return compositionDuration.value > 0 && track.end > compositionDuration.value
})

type AudioTrackEditableKey = 'asset' | 'start' | 'end' | 'volume' | 'fadeIn' | 'fadeOut'

function dispatchAudioTrackEdit(key: AudioTrackEditableKey, value: unknown): void {
  const track = selectedAudioTrack.value
  if (!track) return
  emit('apply', {
    kind: 'update_audio_track',
    payload: { id: track.id, props: { [key]: value } },
    source: 'ui',
  })
}

// Mute toggle (U2 spec): volume → 0, remembered per-track so a second click
// restores the pre-mute value rather than snapping to a fixed default.
const preMuteVolume = ref<Map<string, number>>(new Map())

const isAudioTrackMuted = computed<boolean>(() => {
  const track = selectedAudioTrack.value
  if (!track) return false
  return (typeof track.volume === 'number' ? track.volume : 1) <= 0
})

function toggleMuteAudioTrack(): void {
  const track = selectedAudioTrack.value
  if (!track) return
  const current = typeof track.volume === 'number' ? track.volume : 1
  if (current > 0) {
    preMuteVolume.value.set(track.id, current)
    dispatchAudioTrackEdit('volume', 0)
  } else {
    const restore = preMuteVolume.value.get(track.id) ?? 1
    dispatchAudioTrackEdit('volume', restore > 0 ? restore : 1)
  }
}

function deleteSelectedAudioTrack(): void {
  const track = selectedAudioTrack.value
  if (!track) return
  selection.setAudioTrackSelection(null)
  emit('apply', { kind: 'remove_audio_track', payload: { id: track.id }, source: 'ui' })
}
</script>

<template>
  <div class="inspector">
    <div class="selection-row">
      <label class="selection-label">
        <span class="selection-label-text">Item</span>
        <select
          class="selection-select"
          :value="selection.selectedItemId.value ?? ''"
          @change="onSelectionChange"
        >
          <option value="">— select item —</option>
          <option v-for="opt in itemOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </label>
      <!-- UX_GAPS §Q — when N>1 items are selected (marquee or shift-click),
           the dropdown still shows the "primary" id; this chip surfaces the
           extra count so the user knows their edit will fan out to N items. -->
      <p
        v-if="isMultiSelect"
        class="multi-chip"
        data-testid="inspector-multi-chip"
      >
        <span class="multi-chip-count">{{ multiCount }}</span>
        <span class="multi-chip-label">items selected · bulk edit</span>
      </p>
    </div>

    <div v-if="error" class="error">{{ error }}</div>

    <div v-if="!selectedItem && !selectedTween && !selectedAudioTrack" class="empty">
      <p>Select an item to edit its parameters.</p>
    </div>

    <section
      v-else-if="selectedAudioTrack"
      class="section"
      data-testid="inspector-audio-track-editor"
    >
      <header class="section-header">
        <span class="section-title">Audio track</span>
        <span class="section-meta-group">
          <span class="section-meta">{{ selectedAudioTrack.id }}</span>
          <button
            type="button"
            class="tween-delete"
            data-testid="inspector-audio-track-delete"
            title="Remove this audio track"
            :disabled="pending"
            @click="deleteSelectedAudioTrack"
          >Delete track</button>
        </span>
      </header>
      <p
        v-if="audioTrackExceedsComposition"
        class="multi-note"
        data-testid="inspector-audio-track-overflow-warning"
      >
        This track's <code>end</code> runs past the composition duration ({{ compositionDuration.toFixed(2) }}s).
      </p>
      <div class="fields">
        <AssetPickerInput
          :model-value="selectedAudioTrack.asset"
          label="asset"
          asset-type="audio"
          :assets="compositionAssets"
          :disabled="pending"
          @update:model-value="(v: string) => dispatchAudioTrackEdit('asset', v)"
        />
        <TimeInput
          :model-value="selectedAudioTrack.start"
          label="start"
          :max="compositionDuration"
          :disabled="pending"
          @update:model-value="(v: number) => dispatchAudioTrackEdit('start', v)"
        />
        <TimeInput
          :model-value="selectedAudioTrack.end ?? (audioTrackAssetDuration ?? 0) + selectedAudioTrack.start"
          label="end"
          :disabled="pending"
          @update:model-value="(v: number) => dispatchAudioTrackEdit('end', v)"
        />
        <PercentInput
          :model-value="selectedAudioTrack.volume ?? 1"
          label="volume"
          :max="2"
          :disabled="pending"
          @update:model-value="(v: number) => dispatchAudioTrackEdit('volume', v)"
        />
        <TimeInput
          :model-value="selectedAudioTrack.fadeIn ?? 0"
          label="fadeIn"
          :disabled="pending"
          @update:model-value="(v: number) => dispatchAudioTrackEdit('fadeIn', v)"
        />
        <TimeInput
          :model-value="selectedAudioTrack.fadeOut ?? 0"
          label="fadeOut"
          :disabled="pending"
          @update:model-value="(v: number) => dispatchAudioTrackEdit('fadeOut', v)"
        />
        <button
          type="button"
          class="animate-btn"
          :class="{ active: isAudioTrackMuted }"
          data-testid="inspector-audio-track-mute"
          :disabled="pending"
          :title="isAudioTrackMuted ? 'Unmute (restore previous volume)' : 'Mute (volume → 0, restorable)'"
          @click="toggleMuteAudioTrack"
        >{{ isAudioTrackMuted ? 'Unmute' : 'Mute' }}</button>
      </div>
    </section>

    <section v-else-if="selectedTween" class="section" data-testid="inspector-tween-editor">
      <header class="section-header">
        <span class="section-title">Tween</span>
        <span class="section-meta-group">
          <span class="section-meta">{{ selectedTween.id }}</span>
          <button
            type="button"
            class="tween-back"
            data-testid="inspector-tween-back"
            title="Return to item editor (keeps item selected)"
            @click="clearTweenSelection"
          >Edit item</button>
          <button
            type="button"
            class="tween-delete"
            data-testid="inspector-tween-delete"
            title="Delete this tween (Backspace also works while a tween is selected)"
            :disabled="pending"
            @click="deleteSelectedTween"
          >Delete tween</button>
        </span>
      </header>
      <div class="fields">
        <EnumInput
          :model-value="selectedTween.property"
          label="property"
          :options="tweenPropertyOptions"
          :disabled="pending"
          @update:model-value="(v: string) => dispatchTweenEdit('property', v)"
        />
        <component
          :is="inputForTweenValue()"
          :model-value="selectedTween.from"
          label="from"
          :disabled="pending"
          @update:model-value="(v: unknown) => dispatchTweenEdit('from', v)"
        />
        <component
          :is="inputForTweenValue()"
          :model-value="selectedTween.to"
          label="to"
          :disabled="pending"
          @update:model-value="(v: unknown) => dispatchTweenEdit('to', v)"
        />
        <TimeInput
          :model-value="selectedTween.start"
          label="start"
          :max="compositionDuration"
          :disabled="pending"
          @update:model-value="(v: number) => dispatchTweenEdit('start', v)"
        />
        <TimeInput
          :model-value="selectedTween.duration"
          label="duration"
          :max="compositionDuration"
          :disabled="pending"
          @update:model-value="(v: number) => dispatchTweenEdit('duration', v)"
        />
        <EnumInput
          :model-value="selectedTween.easing ?? 'linear'"
          label="easing"
          :options="EASING_NAMES"
          :disabled="pending"
          @update:model-value="(v: string) => dispatchTweenEdit('easing', v)"
        />
      </div>
    </section>

    <!--
      This branch is only reachable once the empty/audio-track/tween branches
      above have all failed, which — given the empty-state check at the top
      covers "none of the three are set" — means `selectedItem` must be set.
      That's true by construction, but a plain `v-else` doesn't let vue-tsc
      narrow `selectedItem` from `ItemLike | null` to `ItemLike` inside this
      block (it only narrows on the condition actually written), so every
      `selectedItem.foo` access below was a possibly-null type error. Spelling
      the (equivalent) condition out as `v-else-if="selectedItem"` fixes the
      narrowing with no behavior change.
    -->
    <template v-else-if="selectedItem">
      <div
        v-if="selectedItemLocked && !isMultiSelect"
        class="locked-banner"
        data-testid="inspector-locked-banner"
        role="status"
      >
        <span class="locked-icon" aria-hidden="true">🔒</span>
        <span class="locked-text">
          This item is locked. Edits are disabled while the lock is on.
        </span>
        <button
          type="button"
          class="locked-unlock"
          data-testid="inspector-unlock"
          @click="unlockSelectedItem"
        >
          Unlock
        </button>
      </div>
      <fieldset
        class="locked-fieldset"
        :class="{ locked: selectedItemLocked && !isMultiSelect }"
        :disabled="selectedItemLocked && !isMultiSelect"
      >
      <section v-if="!isMultiSelect" class="section" data-testid="inspector-name-section">
        <label class="item-name-row">
          <span class="item-name-label">Name</span>
          <input
            type="text"
            class="item-name-input"
            data-testid="inspector-item-name"
            maxlength="80"
            spellcheck="false"
            :value="selectedItemName"
            :placeholder="`Optional — id is ${selection.selectedItemId.value}`"
            :disabled="pending || selectedItemLocked"
            @change="onNameInput"
          />
        </label>
      </section>

      <section class="section">
        <header class="section-header">
          <span class="section-title">Transform</span>
          <span class="section-meta-group">
            <span
              v-if="showAiEditPill && !isMultiSelect"
              class="ai-edit-pill"
              data-testid="inspector-ai-edit-pill"
              title="Most recent change to this item came from an MCP / AI tool call"
            >AI edit</span>
            <span class="section-meta">
              {{ isMultiSelect ? `${multiCount} selected` : selectedItem.type }}
            </span>
          </span>
        </header>
        <p
          v-if="provenance && !isMultiSelect"
          class="provenance"
          data-testid="inspector-provenance"
          :title="provenanceTitle ?? undefined"
          @click="onProvenanceClick"
        >
          <span class="provenance-label">Source:</span>
          <span class="provenance-path">{{ provenance.text }}</span>
          <span class="provenance-shortcut" aria-hidden="true">⌘J</span>
        </p>
        <p
          v-if="isMultiSelect && !commonItemType"
          class="multi-note"
          data-testid="inspector-multi-mixed-types"
        >
          Mixed types selected — only Transform fields are editable in bulk.
        </p>
        <div class="fields">
          <template v-for="field in TRANSFORM_FIELDS" :key="`tx-${field.key}`">
            <div
              class="field-row"
              :class="{ mixed: isMixed(field), animated: isFieldAnimated(field) && !isMultiSelect }"
              :data-field="field.key"
              :data-mixed="isMixed(field) ? 'true' : 'false'"
              :data-animated="isFieldAnimated(field) ? 'true' : 'false'"
            >
              <div class="field-row-input">
                <component
                  :is="inputFor(field)"
                  :model-value="valueFor(field)"
                  :label="field.label"
                  :min="field.min"
                  :max="field.kind === 'time' ? compositionDuration : field.max"
                  :step="field.step"
                  :options="field.options ?? []"
                  :placeholder="field.placeholder"
                  :multiline="field.multiline"
                  :overridden="isOverridden(field)"
                  :disabled="pending"
                  v-bind="extraPropsFor(field)"
                  @update:model-value="(v: unknown) => dispatchEdit(field, v)"
                />
                <span
                  v-if="isMixed(field)"
                  class="mixed-badge"
                  :data-testid="`inspector-mixed-${field.key}`"
                  title="Selected items have different values. Editing will set them all to the same value."
                >Mixed</span>
                <span
                  v-else-if="isFieldAnimated(field) && !isMultiSelect"
                  class="animated-badge"
                  :data-testid="`inspector-animated-${field.key}`"
                  :title="`Animated · ${field.label} resolves to ${formatBaseValue(valueFor(field))} at this playhead. Editing changes the base (authored) value — base is ${formatBaseValue(baseValueFor(field))} — which a tween will override at this time.`"
                >Animated</span>
              </div>
              <button
                v-if="isFieldTweenable(field)"
                type="button"
                class="animate-btn"
                :class="{ active: isAddTweenPopoverFor(field) }"
                :disabled="pending"
                :data-testid="`inspector-animate-${field.key}`"
                :title="`Animate ${field.label} — add a tween for this property`"
                @click="isAddTweenPopoverFor(field) ? closeAddTweenPopover() : openAddTweenPopover(field)"
              >+ animate</button>
              <div
                v-if="isAddTweenPopoverFor(field) && addTweenPopover"
                class="animate-popover"
                data-testid="inspector-animate-popover"
              >
                <div class="animate-popover-title">
                  Animate <code>{{ field.path }}</code>
                </div>
                <component
                  :is="inputForKind(tweenValueKindForField(field))"
                  :model-value="addTweenPopover.from"
                  label="from"
                  :disabled="pending"
                  @update:model-value="(v: unknown) => updateAddTweenField('from', v as number | string)"
                />
                <component
                  :is="inputForKind(tweenValueKindForField(field))"
                  :model-value="addTweenPopover.to"
                  label="to"
                  :disabled="pending"
                  @update:model-value="(v: unknown) => updateAddTweenField('to', v as number | string)"
                />
                <TimeInput
                  :model-value="addTweenPopover.start"
                  label="start"
                  :max="compositionDuration"
                  :disabled="pending"
                  @update:model-value="(v: number) => updateAddTweenField('start', v)"
                />
                <TimeInput
                  :model-value="addTweenPopover.duration"
                  label="duration"
                  :max="compositionDuration"
                  :disabled="pending"
                  @update:model-value="(v: number) => updateAddTweenField('duration', v)"
                />
                <EnumInput
                  :model-value="addTweenPopover.easing"
                  label="easing"
                  :options="EASING_NAMES"
                  :disabled="pending"
                  @update:model-value="(v: string) => updateAddTweenField('easing', v)"
                />
                <div class="animate-popover-actions">
                  <button
                    type="button"
                    class="animate-popover-btn ghost"
                    @click="closeAddTweenPopover"
                  >Cancel</button>
                  <button
                    type="button"
                    class="animate-popover-btn primary"
                    :disabled="pending"
                    data-testid="inspector-animate-confirm"
                    @click="confirmAddTween"
                  >Add tween</button>
                </div>
              </div>
            </div>
          </template>
        </div>
      </section>

      <section class="section" data-testid="inspector-lifespan-section">
        <header class="section-header">
          <span class="section-title">Lifespan</span>
          <span class="section-meta">[enter, exit)</span>
        </header>
        <div class="fields">
          <template v-for="field in LIFESPAN_FIELDS" :key="`ls-${field.key}`">
            <div
              class="field-row"
              :class="{ mixed: isMixed(field), animated: isFieldAnimated(field) && !isMultiSelect }"
              :data-field="field.key"
              :data-mixed="isMixed(field) ? 'true' : 'false'"
              :data-animated="isFieldAnimated(field) ? 'true' : 'false'"
            >
              <div class="field-row-input">
                <component
                  :is="inputFor(field)"
                  :model-value="valueFor(field)"
                  :label="field.label"
                  :min="field.min"
                  :max="compositionDuration"
                  :step="field.step"
                  :placeholder="field.key === 'enter' ? '0' : `${compositionDuration}`"
                  :overridden="isOverridden(field)"
                  :disabled="pending"
                  @update:model-value="(v: unknown) => dispatchEdit(field, v)"
                />
                <span
                  v-if="isMixed(field)"
                  class="mixed-badge"
                  :data-testid="`inspector-mixed-${field.key}`"
                  title="Selected items have different values."
                >Mixed</span>
                <span
                  v-else-if="isFieldAnimated(field) && !isMultiSelect"
                  class="animated-badge"
                  :data-testid="`inspector-animated-${field.key}`"
                  :title="`Animated · ${field.label} resolves to ${formatBaseValue(valueFor(field))} at this playhead.`"
                >Animated</span>
              </div>
            </div>
          </template>
        </div>
      </section>

      <section
        v-if="!isMultiSelect && selectedItemLayerId !== null && compositionLayers.length > 0"
        class="section"
        data-testid="inspector-layer-section"
      >
        <header class="section-header">
          <span class="section-title">Layer</span>
          <span class="section-meta">{{ selectedItemLayerId }}</span>
        </header>
        <label class="layer-move">
          <span class="layer-move-label">Move to</span>
          <select
            class="layer-move-select"
            data-testid="inspector-move-layer"
            :value="selectedItemLayerId ?? ''"
            :disabled="pending"
            @change="onMoveItemToLayer"
          >
            <option
              v-for="layer in compositionLayers"
              :key="layer.id"
              :value="layer.id"
            >
              {{ layer.id }} · z {{ layer.z }}
            </option>
          </select>
        </label>
      </section>

      <section v-if="itemSpecificFields.length > 0" class="section">
        <header class="section-header">
          <span class="section-title">{{ commonItemType ?? selectedItem.type }}</span>
          <span v-if="isMultiSelect" class="section-meta">
            {{ multiCount }} selected
          </span>
        </header>
        <template v-if="commonItemType === 'video' && !isMultiSelect">
          <p
            v-if="videoDurationSummary"
            class="video-duration-summary"
            data-testid="inspector-video-duration-summary"
          >{{ videoDurationSummary }}</p>
          <img
            v-if="selectedItem.asset"
            class="video-preview-thumb"
            data-testid="inspector-video-preview"
            :src="`/api/library/thumbnail?kind=asset&id=${encodeURIComponent(String(selectedItem.asset))}`"
            alt="Video preview"
          />
          <button
            type="button"
            class="animate-btn"
            data-testid="inspector-video-reset-trim"
            title="Reset trim — trimIn=0, trimOut=asset duration"
            :disabled="pending"
            @click="resetVideoTrim"
          >Reset trim</button>
        </template>
        <div class="fields">
          <template v-for="field in itemSpecificFields" :key="`item-${field.key}`">
            <div
              class="field-row"
              :class="{ mixed: isMixed(field), animated: isFieldAnimated(field) && !isMultiSelect }"
              :data-field="field.key"
              :data-mixed="isMixed(field) ? 'true' : 'false'"
              :data-animated="isFieldAnimated(field) ? 'true' : 'false'"
            >
              <div class="field-row-input">
                <component
                  :is="inputFor(field)"
                  :model-value="valueFor(field)"
                  :label="field.label"
                  :min="field.min"
                  :max="field.kind === 'time' ? compositionDuration : field.max"
                  :step="field.step"
                  :options="field.options ?? []"
                  :placeholder="field.placeholder"
                  :multiline="field.multiline"
                  :overridden="isOverridden(field)"
                  :disabled="pending"
                  v-bind="extraPropsFor(field)"
                  @update:model-value="(v: unknown) => dispatchEdit(field, v)"
                />
                <span
                  v-if="isMixed(field)"
                  class="mixed-badge"
                  :data-testid="`inspector-mixed-${field.key}`"
                  title="Selected items have different values. Editing will set them all to the same value."
                >Mixed</span>
                <span
                  v-else-if="isFieldAnimated(field) && !isMultiSelect"
                  class="animated-badge"
                  :data-testid="`inspector-animated-${field.key}`"
                  :title="`Animated · ${field.label} resolves to ${formatBaseValue(valueFor(field))} at this playhead. Editing changes the base — a tween will override at this time.`"
                >Animated</span>
              </div>
              <button
                v-if="isFieldTweenable(field)"
                type="button"
                class="animate-btn"
                :class="{ active: isAddTweenPopoverFor(field) }"
                :disabled="pending"
                :data-testid="`inspector-animate-${field.key}`"
                :title="`Animate ${field.label} — add a tween for this property`"
                @click="isAddTweenPopoverFor(field) ? closeAddTweenPopover() : openAddTweenPopover(field)"
              >+ animate</button>
              <div
                v-if="isAddTweenPopoverFor(field) && addTweenPopover"
                class="animate-popover"
                data-testid="inspector-animate-popover"
              >
                <div class="animate-popover-title">
                  Animate <code>{{ field.path }}</code>
                </div>
                <component
                  :is="inputForKind(tweenValueKindForField(field))"
                  :model-value="addTweenPopover.from"
                  label="from"
                  :disabled="pending"
                  @update:model-value="(v: unknown) => updateAddTweenField('from', v as number | string)"
                />
                <component
                  :is="inputForKind(tweenValueKindForField(field))"
                  :model-value="addTweenPopover.to"
                  label="to"
                  :disabled="pending"
                  @update:model-value="(v: unknown) => updateAddTweenField('to', v as number | string)"
                />
                <TimeInput
                  :model-value="addTweenPopover.start"
                  label="start"
                  :max="compositionDuration"
                  :disabled="pending"
                  @update:model-value="(v: number) => updateAddTweenField('start', v)"
                />
                <TimeInput
                  :model-value="addTweenPopover.duration"
                  label="duration"
                  :max="compositionDuration"
                  :disabled="pending"
                  @update:model-value="(v: number) => updateAddTweenField('duration', v)"
                />
                <EnumInput
                  :model-value="addTweenPopover.easing"
                  label="easing"
                  :options="EASING_NAMES"
                  :disabled="pending"
                  @update:model-value="(v: string) => updateAddTweenField('easing', v)"
                />
                <div class="animate-popover-actions">
                  <button
                    type="button"
                    class="animate-popover-btn ghost"
                    @click="closeAddTweenPopover"
                  >Cancel</button>
                  <button
                    type="button"
                    class="animate-popover-btn primary"
                    :disabled="pending"
                    data-testid="inspector-animate-confirm"
                    @click="confirmAddTween"
                  >Add tween</button>
                </div>
              </div>
            </div>
          </template>
        </div>
      </section>
      </fieldset>
    </template>
  </div>
</template>

<style scoped>
.inspector {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 24px;
}

.selection-row {
  position: sticky;
  top: -12px;
  margin: -12px -12px 0;
  padding: 12px;
  background: #111;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  z-index: 1;
}

.selection-label {
  display: grid;
  grid-template-columns: 60px 1fr;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.selection-label-text {
  color: #a3a3a3;
}

.selection-select {
  background: #161616;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e5e5e5;
  font: inherit;
  padding: 4px 6px;
  border-radius: 4px;
  width: 100%;
}

.selection-select:focus {
  outline: 1px solid #5b7cfa;
  outline-offset: 1px;
}

.error {
  font-size: 12px;
  color: #ff6b6b;
  background: rgba(255, 107, 107, 0.08);
  border: 1px solid rgba(255, 107, 107, 0.25);
  padding: 6px 8px;
  border-radius: 4px;
}

.empty {
  color: #707070;
  font-size: 13px;
}

/* §M locked-state UI. The banner is the visible signpost; the fieldset
 * dims and disables the form below it. `disabled` on a fieldset natively
 * disables every nested form control, so we don't have to thread an extra
 * disabled prop into every input. */
.locked-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 198, 107, 0.12);
  border: 1px solid rgba(255, 198, 107, 0.45);
  color: #ffe2a8;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 12px;
}
.locked-icon {
  font-size: 14px;
  flex: 0 0 auto;
}
.locked-text {
  flex: 1 1 auto;
  min-width: 0;
}
.locked-unlock {
  appearance: none;
  background: rgba(255, 198, 107, 0.18);
  border: 1px solid rgba(255, 198, 107, 0.55);
  color: #ffe2a8;
  font: inherit;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
}
.locked-unlock:hover {
  background: rgba(255, 198, 107, 0.32);
}
.locked-fieldset {
  appearance: none;
  border: none;
  padding: 0;
  margin: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.locked-fieldset.locked {
  opacity: 0.55;
  filter: saturate(0.7);
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  padding-bottom: 4px;
}

.section-title {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #a3a3a3;
}

.section-meta {
  font-size: 11px;
  color: #707070;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.section-meta-group {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.ai-edit-pill {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #d4c4ff;
  background: rgba(140, 110, 255, 0.16);
  border: 1px solid rgba(140, 110, 255, 0.42);
  padding: 2px 6px;
  border-radius: 999px;
  font-family: 'Instrument Sans', system-ui, sans-serif;
  line-height: 1;
}

.tween-back {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #d4d4d4;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 2px 8px;
  border-radius: 4px;
  font-family: 'Instrument Sans', system-ui, sans-serif;
  line-height: 1;
  cursor: pointer;
}

.tween-back:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
}

.tween-back:focus-visible {
  outline: 1px solid #5b7cfa;
  outline-offset: 1px;
}

.tween-delete {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #ffb4b4;
  background: rgba(255, 90, 90, 0.08);
  border: 1px solid rgba(255, 90, 90, 0.35);
  padding: 2px 8px;
  border-radius: 4px;
  font-family: 'Instrument Sans', system-ui, sans-serif;
  line-height: 1;
  cursor: pointer;
}

.tween-delete:hover:not(:disabled) {
  background: rgba(255, 90, 90, 0.18);
  border-color: rgba(255, 90, 90, 0.6);
  color: #ffffff;
}

.tween-delete:focus-visible {
  outline: 1px solid #ff6b6b;
  outline-offset: 1px;
}

.tween-delete:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.field-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 6px;
}

.field-row-input {
  min-width: 0;
  position: relative;
}

/* UX_GAPS §Q — Mixed indicator. The badge sits at the right edge of the
 * field-row input column so it overlaps the input without pushing layout.
 * `.field-row.mixed` mutes the input's value so the user reads it as "this
 * is one of N values" rather than the canonical value. */
.field-row.mixed .field-row-input :deep(input),
.field-row.mixed .field-row-input :deep(select),
.field-row.mixed .field-row-input :deep(textarea) {
  color: rgba(229, 229, 229, 0.55);
  border-color: rgba(255, 198, 107, 0.45);
}

.mixed-badge {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #1a1a1a;
  background: #ffc66b;
  padding: 2px 6px;
  border-radius: 999px;
  font-family: 'Instrument Sans', system-ui, sans-serif;
  font-weight: 600;
  line-height: 1;
  pointer-events: none;
  z-index: 1;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}

/* UX_FINDINGS §7 — Animated indicator. Tinted brand-blue (matches the
 * Timeline's tween colour) so it reads distinctly from the orange Mixed /
 * override badges. `pointer-events: auto` lets the title attribute fire
 * on hover so the user can read the longer explanation. */
.animated-badge {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #e7ecff;
  background: rgba(91, 124, 250, 0.28);
  padding: 2px 6px;
  border-radius: 999px;
  font-family: 'Instrument Sans', system-ui, sans-serif;
  font-weight: 600;
  line-height: 1;
  pointer-events: auto;
  cursor: help;
  z-index: 1;
  border: 1px solid rgba(91, 124, 250, 0.55);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35);
}

/* Subtly tint the input border when animated so the field reads as
 * driven-by-tween even when the badge text is partially covered by the
 * value. Soft enough not to fight the orange overridden state. */
.field-row.animated .field-row-input :deep(input),
.field-row.animated .field-row-input :deep(select),
.field-row.animated .field-row-input :deep(textarea) {
  border-color: rgba(91, 124, 250, 0.45);
}

.multi-chip {
  margin: 8px 0 0;
  padding: 4px 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(91, 124, 250, 0.14);
  border: 1px solid rgba(91, 124, 250, 0.45);
  border-radius: 999px;
  color: #aab7ff;
  font-size: 11px;
  font-family: 'Instrument Sans', system-ui, sans-serif;
}

.multi-chip-count {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-weight: 600;
  background: rgba(91, 124, 250, 0.35);
  color: #ffffff;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  min-width: 16px;
  text-align: center;
}

.multi-chip-label {
  letter-spacing: 0.04em;
}

.multi-note {
  margin: 0 0 4px;
  padding: 6px 8px;
  font-size: 11px;
  color: #ffe2a8;
  background: rgba(255, 198, 107, 0.08);
  border: 1px solid rgba(255, 198, 107, 0.32);
  border-radius: 4px;
}

.animate-btn {
  flex: 0 0 auto;
  appearance: none;
  background: rgba(91, 124, 250, 0.08);
  border: 1px solid rgba(91, 124, 250, 0.32);
  color: #aab7ff;
  font: inherit;
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: lowercase;
  padding: 2px 8px;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 100ms ease, border-color 100ms ease, color 100ms ease;
}

.animate-btn:hover:not(:disabled) {
  background: rgba(91, 124, 250, 0.18);
  border-color: rgba(91, 124, 250, 0.6);
  color: #ffffff;
}

.animate-btn.active {
  background: rgba(91, 124, 250, 0.32);
  border-color: rgba(91, 124, 250, 0.8);
  color: #ffffff;
}

.animate-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.animate-popover {
  grid-column: 1 / -1;
  margin: 4px 0 6px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: rgba(91, 124, 250, 0.06);
  border: 1px solid rgba(91, 124, 250, 0.32);
  border-radius: 6px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
}

.animate-popover-title {
  font-size: 11px;
  color: #aab7ff;
  letter-spacing: 0.04em;
  margin-bottom: 2px;
}

.animate-popover-title code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: #d4d4d4;
}

.animate-popover-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 4px;
}

.animate-popover-btn {
  appearance: none;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #d4d4d4;
  font: inherit;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 5px;
  cursor: pointer;
}

.animate-popover-btn.ghost:hover {
  background: rgba(255, 255, 255, 0.06);
}

.animate-popover-btn.primary {
  background: rgba(91, 124, 250, 0.22);
  border-color: rgba(91, 124, 250, 0.6);
  color: #ffffff;
}

.animate-popover-btn.primary:hover:not(:disabled) {
  background: rgba(91, 124, 250, 0.36);
}

.animate-popover-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.fields {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.provenance {
  margin: 0;
  padding: 4px 6px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #a3a3a3;
  background: rgba(91, 124, 250, 0.06);
  border: 1px solid rgba(91, 124, 250, 0.18);
  border-radius: 4px;
  cursor: pointer;
  align-self: flex-start;
  max-width: 100%;
  user-select: none;
}

.provenance:hover {
  background: rgba(91, 124, 250, 0.14);
  border-color: rgba(91, 124, 250, 0.42);
  color: #d4d4d4;
}

.provenance-label {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #707070;
  flex: 0 0 auto;
}

.provenance-path {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  color: #aab7ff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.provenance-shortcut {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  color: #707070;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 1px 4px;
  border-radius: 3px;
  flex: 0 0 auto;
}

.layer-move {
  display: grid;
  grid-template-columns: 120px 1fr;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.layer-move-label {
  color: #a3a3a3;
}

.layer-move-select {
  background: #161616;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e5e5e5;
  font: inherit;
  padding: 4px 6px;
  border-radius: 4px;
  min-width: 0;
}

.layer-move-select:focus {
  outline: 1px solid #5b7cfa;
  outline-offset: 1px;
}

.layer-move-select:disabled {
  opacity: 0.45;
}

.item-name-row {
  display: grid;
  grid-template-columns: 60px 1fr;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.item-name-label {
  color: #a3a3a3;
}

.item-name-input {
  background: #161616;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e5e5e5;
  font: inherit;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  padding: 4px 6px;
  border-radius: 4px;
  min-width: 0;
}

.item-name-input::placeholder {
  color: #5a5a5a;
}

.item-name-input:focus {
  outline: 1px solid #5b7cfa;
  outline-offset: 1px;
}

.item-name-input:disabled {
  opacity: 0.45;
}

.video-duration-summary {
  margin: 0;
  font-size: 11px;
  color: #a3a3a3;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.video-preview-thumb {
  display: block;
  width: 100%;
  max-width: 200px;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #050505;
}
</style>
