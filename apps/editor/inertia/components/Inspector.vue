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

type ItemLike = {
  type: 'sprite' | 'text' | 'shape' | 'group'
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

const selectedItemLastSource = computed<CommandSource | null>(() => {
  const id = selection.selectedItemId.value
  const map = props.itemLastSource
  if (!id || !map) return null
  return map.get(id) ?? null
})

const showAiEditPill = computed<boolean>(() => selectedItemLastSource.value === 'mcp')

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

// ──────────────── Field registry ────────────────
//
// The PRD R2 mitigation: a registry of input components keyed by Zod meta-
// type rather than blind reflection. Each entry tells the Inspector how to
// pull the current value out of an item, what input to render, and what
// `update_item` payload key to send back.

// Step 20.22: `boolean`, `percent`, and `json` join the registry; any
// schema kind not listed here falls through to the `RawJson` editor so an
// unknown type can never block editing (PRD R2).
type FieldKind = 'number' | 'string' | 'color' | 'enum' | 'time' | 'boolean' | 'percent' | 'json'

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

const SPRITE_FIELDS: ReadonlyArray<FieldDef> = [
  { key: 'asset', label: 'asset', kind: 'string', path: 'asset' },
  { key: 'width', label: 'width', kind: 'number', path: 'width', min: 0, step: 1 },
  { key: 'height', label: 'height', kind: 'number', path: 'height', min: 0, step: 1 },
  { key: 'tint', label: 'tint', kind: 'color', path: 'tint' },
]

const TEXT_FIELDS: ReadonlyArray<FieldDef> = [
  { key: 'text', label: 'text', kind: 'string', path: 'text', multiline: true },
  { key: 'font', label: 'font', kind: 'string', path: 'font' },
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

const itemSpecificFields = computed<ReadonlyArray<FieldDef>>(() => {
  const item = selectedItem.value
  if (!item) return []
  switch (item.type) {
    case 'sprite':
      return SPRITE_FIELDS
    case 'text':
      return TEXT_FIELDS
    case 'shape':
      return SHAPE_FIELDS
    case 'group':
      return []
    default:
      return []
  }
})

function valueFor(field: FieldDef): unknown {
  return readPath(selectedItem.value, field.path)
}

function isOverridden(field: FieldDef): boolean {
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
} as const

function inputFor(field: FieldDef) {
  return (INPUT_FOR_KIND as Record<string, unknown>)[field.kind] ?? RawJsonInput
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
  const id = selection.selectedItemId.value
  if (!id) return
  // `update_item.props` uses flat keys — both transform overrides and
  // type-specific fields share the same namespace. See applyItemUpdate
  // in src/mcp/store.ts.
  const command: Command = {
    kind: 'update_item',
    payload: { id, props: { [field.key]: raw } },
    source: 'ui',
  }
  emit('apply', command)
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
    </div>

    <div v-if="error" class="error">{{ error }}</div>

    <div v-if="!selectedItem && !selectedTween" class="empty">
      <p>Select an item to edit its parameters.</p>
    </div>

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

    <template v-else>
      <section class="section">
        <header class="section-header">
          <span class="section-title">Transform</span>
          <span class="section-meta-group">
            <span
              v-if="showAiEditPill"
              class="ai-edit-pill"
              data-testid="inspector-ai-edit-pill"
              title="Most recent change to this item came from an MCP / AI tool call"
            >AI edit</span>
            <span class="section-meta">{{ selectedItem.type }}</span>
          </span>
        </header>
        <p
          v-if="provenance"
          class="provenance"
          data-testid="inspector-provenance"
          :title="provenanceTitle ?? undefined"
          @click="onProvenanceClick"
        >
          <span class="provenance-label">Source:</span>
          <span class="provenance-path">{{ provenance.text }}</span>
          <span class="provenance-shortcut" aria-hidden="true">⌘J</span>
        </p>
        <div class="fields">
          <template v-for="field in TRANSFORM_FIELDS" :key="`tx-${field.key}`">
            <div class="field-row" :data-field="field.key">
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
                  @update:model-value="(v: unknown) => dispatchEdit(field, v)"
                />
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

      <section v-if="itemSpecificFields.length > 0" class="section">
        <header class="section-header">
          <span class="section-title">{{ selectedItem.type }}</span>
        </header>
        <div class="fields">
          <template v-for="field in itemSpecificFields" :key="`item-${field.key}`">
            <div class="field-row" :data-field="field.key">
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
                  @update:model-value="(v: unknown) => dispatchEdit(field, v)"
                />
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
</style>
