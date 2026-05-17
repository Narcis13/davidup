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
// Orange "override" dot: the Inspector keeps a snapshot of the composition
// at session start (`baseline`) and renders the dot whenever the live
// item's prop value differs from its baseline value. Once step 15 lands
// (source-map emission) this baseline will be replaced with the template /
// scene default value the item was authored against.

import { computed } from 'vue'
import { useSelection } from '~/composables/useSelection'
import type { Command, CommandSource, Composition } from '~/composables/useCommandBus'
import { readPath } from '~/composables/useCommandBus'
import NumberInput from '~/components/inputs/Number.vue'
import StringInput from '~/components/inputs/String.vue'
import ColorInput from '~/components/inputs/Color.vue'
import TimeInput from '~/components/inputs/Time.vue'
import EnumInput from '~/components/inputs/Enum.vue'

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
  baseline: Composition | null
  pending?: boolean
  error?: string | null
  // Step 20.2 — most recent edit source per item id. When the selected
  // item's last change came from MCP, the header renders an "AI edit"
  // pill (foundation for FR-13). Optional so existing callers that don't
  // yet pass it keep working (the pill just never appears).
  itemLastSource?: ReadonlyMap<string, CommandSource>
}>()

const emit = defineEmits<{
  (event: 'apply', command: Command): void
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

const baselineItem = computed<ItemLike | null>(() => {
  const base = props.baseline
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

type FieldKind = 'number' | 'string' | 'color' | 'enum' | 'time'

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
    kind: 'number',
    path: 'transform.opacity',
    min: 0,
    max: 1,
    step: 0.01,
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
  const base = readPath(baselineItem.value, field.path)
  // Treat both undefined as not-overridden; surface any other inequality.
  if (current === undefined && base === undefined) return false
  return !sameValue(current, base)
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 1e-9
  }
  return false
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

    <div v-if="!selectedItem" class="empty">
      <p>Select an item to edit its parameters.</p>
    </div>

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
        <div class="fields">
          <template v-for="field in TRANSFORM_FIELDS" :key="`tx-${field.key}`">
            <NumberInput
              :model-value="valueFor(field) as number | undefined"
              :label="field.label"
              :min="field.min"
              :max="field.max"
              :step="field.step"
              :overridden="isOverridden(field)"
              :disabled="pending"
              @update:model-value="(v) => dispatchEdit(field, v)"
            />
          </template>
        </div>
      </section>

      <section v-if="itemSpecificFields.length > 0" class="section">
        <header class="section-header">
          <span class="section-title">{{ selectedItem.type }}</span>
        </header>
        <div class="fields">
          <template v-for="field in itemSpecificFields" :key="`item-${field.key}`">
            <NumberInput
              v-if="field.kind === 'number'"
              :model-value="valueFor(field) as number | undefined"
              :label="field.label"
              :min="field.min"
              :max="field.max"
              :step="field.step"
              :overridden="isOverridden(field)"
              :disabled="pending"
              @update:model-value="(v) => dispatchEdit(field, v)"
            />
            <TimeInput
              v-else-if="field.kind === 'time'"
              :model-value="valueFor(field) as number | undefined"
              :label="field.label"
              :max="compositionDuration"
              :step="field.step"
              :overridden="isOverridden(field)"
              :disabled="pending"
              @update:model-value="(v) => dispatchEdit(field, v)"
            />
            <ColorInput
              v-else-if="field.kind === 'color'"
              :model-value="valueFor(field) as string | undefined"
              :label="field.label"
              :overridden="isOverridden(field)"
              :disabled="pending"
              @update:model-value="(v) => dispatchEdit(field, v)"
            />
            <EnumInput
              v-else-if="field.kind === 'enum'"
              :model-value="valueFor(field) as string | undefined"
              :label="field.label"
              :options="field.options ?? []"
              :overridden="isOverridden(field)"
              :disabled="pending"
              @update:model-value="(v) => dispatchEdit(field, v)"
            />
            <StringInput
              v-else
              :model-value="valueFor(field) as string | undefined"
              :label="field.label"
              :placeholder="field.placeholder"
              :multiline="field.multiline"
              :overridden="isOverridden(field)"
              :disabled="pending"
              @update:model-value="(v) => dispatchEdit(field, v)"
            />
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

.fields {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
</style>
