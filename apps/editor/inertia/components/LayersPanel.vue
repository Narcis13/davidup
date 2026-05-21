<script setup lang="ts">
// LayersPanel — UX_GAPS section B.
//
// A docked floating panel that exposes the composition's layer stack to
// the user. Mirrors the existing add_layer / update_layer / remove_layer /
// move_item_to_layer commands without inventing any new mutation paths.
//
// Capabilities (matching UX_GAPS §B):
//  - See layer list + items per layer
//  - Add a layer (auto-z above the topmost)
//  - Reorder layers up/down (renumbers z via update_layer)
//  - Edit opacity (slider) + blendMode (dropdown) — update_layer
//  - Remove layer (with cascade confirm when non-empty)
//  - Click a layer row → set "active layer" (consumed by ItemToolbar /
//    Stage place mode so primitives land on the row the user selected)
//  - Click an item row → select it (Inspector switches to it)
//
// Rename is out of scope: the engine schema has no rename for layer ids
// (they're the references items use). UX_GAPS §M visibility/lock landed —
// each row shows an eye / lock toggle that dispatches `update_layer` (for
// the row itself) or `update_item` (for each item child). Hidden layers /
// items are skipped by the renderer; locked is a hint the Inspector and
// Stage drag honor.

import { computed, ref } from 'vue'
import { BLEND_MODES } from 'davidup/schema'
import type { Composition, Command } from '~/composables/useCommandBus'
import { useActiveLayer } from '~/composables/useActiveLayer'
import { useSelection } from '~/composables/useSelection'

interface LayerRow {
  id: string
  z: number
  opacity: number
  blendMode: string
  items: ReadonlyArray<string>
  // §M flags: absent in older project JSON ⇒ visible/unlocked. Pulling them
  // into the row shape lets the template render the right glyph without
  // recomputing on every keystroke.
  visible: boolean
  locked: boolean
  // §P friendly name — when set, the row displays it next to the id.
  name: string
}

const props = defineProps<{
  composition: Composition | null
}>()

const emit = defineEmits<{
  (event: 'apply', command: Command): void
}>()

const collapsed = ref(false)
const expandedLayerIds = ref<Set<string>>(new Set())

const activeLayer = useActiveLayer()
const selection = useSelection()

// Layers sorted top-to-bottom (high z first) so the panel reads like
// Photoshop / Figma: row 0 is what the user sees on top of the stage.
const rows = computed<LayerRow[]>(() => {
  const layers = props.composition?.layers
  if (!Array.isArray(layers)) return []
  const out: LayerRow[] = []
  for (const l of layers as ReadonlyArray<Record<string, unknown>>) {
    const id = typeof l.id === 'string' ? l.id : null
    if (!id) continue
    out.push({
      id,
      z: typeof l.z === 'number' ? l.z : 0,
      opacity: typeof l.opacity === 'number' ? l.opacity : 1,
      blendMode: typeof l.blendMode === 'string' ? l.blendMode : 'normal',
      items: Array.isArray(l.items) ? (l.items as ReadonlyArray<string>) : [],
      visible: l.visible !== false,
      locked: l.locked === true,
      name: typeof l.name === 'string' ? l.name : '',
    })
  }
  out.sort((a, b) => b.z - a.z)
  return out
})

// Read the resolved "target" layer (active or topmost fallback) so the
// header can hint to users which layer their next placement lands on.
const targetLayerId = computed<string | null>(() => activeLayer.resolveTarget(props.composition))

// Pick a glyph that hints at what kind of item the user is looking at,
// without dragging in a real icon set. Mirrors the Inspector's item-type
// readout style.
function itemTypeGlyph(itemId: string): string {
  const item = (props.composition?.items as Record<string, { type?: unknown }> | undefined)?.[
    itemId
  ]
  switch (item?.type) {
    case 'sprite':
      return '◧'
    case 'text':
      return 'T'
    case 'shape':
      return '▭'
    case 'group':
      return '⊞'
    case 'scene-instance':
      return '◇'
    default:
      return '·'
  }
}

function nextLayerId(): string {
  // Mirror the store's auto-id rule: "layerN" where N is the smallest
  // positive integer not already taken. We compute it client-side so the
  // generated id is unique even before the server applies the command
  // (avoids collisions when two add-layer clicks land within one round-trip).
  const existing = new Set((props.composition?.layers ?? []).map((l) => (l as { id: string }).id))
  for (let n = 1; n < 10_000; n += 1) {
    const id = `layer${n}`
    if (!existing.has(id)) return id
  }
  return `layer${Date.now()}`
}

function nextLayerZ(): number {
  // Stack the new layer above whatever is currently on top so newly-added
  // primitives default to landing in front. The store would accept any z;
  // we pick a deterministic +1 above the current max to keep z values
  // tidy in the JSON file.
  const layers = props.composition?.layers
  if (!Array.isArray(layers) || layers.length === 0) return 0
  let maxZ = -Infinity
  for (const l of layers as ReadonlyArray<{ z?: unknown }>) {
    if (typeof l.z === 'number' && l.z > maxZ) maxZ = l.z
  }
  if (!Number.isFinite(maxZ)) return 0
  return Math.floor(maxZ) + 1
}

function addLayer(): void {
  const id = nextLayerId()
  const z = nextLayerZ()
  emit('apply', {
    kind: 'add_layer',
    payload: { id, z, opacity: 1 },
    source: 'ui',
  })
  // Promote the freshly-added layer to active so the user's next
  // primitive lands there without an extra click.
  activeLayer.setActiveLayer(id)
}

function removeLayer(row: LayerRow): void {
  const hasItems = row.items.length > 0
  if (hasItems) {
    const ok = typeof window !== 'undefined'
      ? window.confirm(
          `Layer "${row.id}" has ${row.items.length} item(s). Remove the layer and all its items?`,
        )
      : true
    if (!ok) return
  }
  emit('apply', {
    kind: 'remove_layer',
    payload: { id: row.id, cascade: hasItems },
    source: 'ui',
  })
  if (activeLayer.activeLayerId.value === row.id) {
    activeLayer.setActiveLayer(null)
  }
  if (selection.selectedItemId.value && row.items.includes(selection.selectedItemId.value)) {
    selection.setSelection(null)
  }
}

function setOpacity(row: LayerRow, event: Event): void {
  const target = event.target as HTMLInputElement | null
  if (!target) return
  const next = Number(target.value)
  if (!Number.isFinite(next)) return
  if (next === row.opacity) return
  emit('apply', {
    kind: 'update_layer',
    payload: { id: row.id, props: { opacity: next } },
    source: 'ui',
  })
}

// §M visibility / lock toggles. Both are absent-by-default in the schema,
// so we send the *new* truthy value explicitly; the server records it on
// the layer and the renderer skips drawing hidden layers entirely.
function toggleLayerVisible(row: LayerRow): void {
  emit('apply', {
    kind: 'update_layer',
    payload: { id: row.id, props: { visible: !row.visible } },
    source: 'ui',
  })
}

function toggleLayerLocked(row: LayerRow): void {
  emit('apply', {
    kind: 'update_layer',
    payload: { id: row.id, props: { locked: !row.locked } },
    source: 'ui',
  })
}

// Item-level lookup — items live keyed by id on the composition. We avoid
// caching a derived map because the few times per second the user clicks an
// eye/lock the .[id] read is trivially fast.
function getItem(itemId: string): { visible?: boolean; locked?: boolean } | undefined {
  const items = props.composition?.items as Record<string, { visible?: boolean; locked?: boolean }> | undefined
  return items?.[itemId]
}

function isItemVisible(itemId: string): boolean {
  return getItem(itemId)?.visible !== false
}

function isItemLocked(itemId: string): boolean {
  return getItem(itemId)?.locked === true
}

function toggleItemVisible(itemId: string): void {
  const current = isItemVisible(itemId)
  emit('apply', {
    kind: 'update_item',
    payload: { id: itemId, props: { visible: !current } },
    source: 'ui',
  })
}

function toggleItemLocked(itemId: string): void {
  const current = isItemLocked(itemId)
  emit('apply', {
    kind: 'update_item',
    payload: { id: itemId, props: { locked: !current } },
    source: 'ui',
  })
}

function setBlendMode(row: LayerRow, event: Event): void {
  const target = event.target as HTMLSelectElement | null
  if (!target) return
  const next = target.value
  if (!next || next === row.blendMode) return
  emit('apply', {
    kind: 'update_layer',
    payload: { id: row.id, props: { blendMode: next } },
    source: 'ui',
  })
}

// Reorder via z-renumbering. The schema lets z be any number, so a
// simple "swap z with neighbour" call would work — but neighbouring z
// values may not be adjacent integers (templates often skip values).
// Instead we re-issue update_layer for every layer with its new index-
// based z; the bus serialises them and the file ends up tidy. The
// "topmost" semantic (last entry in layers[] wins) matches the
// composition's render order, which sorts by z ascending.
function moveLayer(row: LayerRow, direction: 'up' | 'down'): void {
  const ordered = [...rows.value] // already sorted top→bottom
  const idx = ordered.findIndex((r) => r.id === row.id)
  if (idx < 0) return
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1
  if (targetIdx < 0 || targetIdx >= ordered.length) return
  const swapped = ordered.slice()
  const tmp = swapped[idx]!
  swapped[idx] = swapped[targetIdx]!
  swapped[targetIdx] = tmp

  // Top of the panel = highest z. We assign new z values starting from
  // (length - 1) at index 0 and decreasing. Then dispatch one update per
  // layer whose z actually changed — minimises the undo entries the user
  // has to step through to revert.
  const total = swapped.length
  for (let i = 0; i < swapped.length; i += 1) {
    const r = swapped[i]!
    const newZ = total - 1 - i
    if (r.z === newZ) continue
    emit('apply', {
      kind: 'update_layer',
      payload: { id: r.id, props: { z: newZ } },
      source: 'ui',
    })
  }
}

function selectLayer(row: LayerRow): void {
  activeLayer.setActiveLayer(row.id)
}

function selectItem(itemId: string): void {
  selection.setSelection(itemId)
}

function toggleExpanded(layerId: string): void {
  const next = new Set(expandedLayerIds.value)
  if (next.has(layerId)) next.delete(layerId)
  else next.add(layerId)
  expandedLayerIds.value = next
}

function isExpanded(layerId: string): boolean {
  return expandedLayerIds.value.has(layerId)
}

function isActive(layerId: string): boolean {
  return activeLayer.activeLayerId.value === layerId
}

function isItemSelected(itemId: string): boolean {
  return selection.selectedItemId.value === itemId
}

function toggleCollapsed(): void {
  collapsed.value = !collapsed.value
}

// UX_GAPS §P — inline rename. Double-click the row label opens an input;
// Enter commits an `update_layer` with `name`, Esc cancels. Empty input
// clears the name (falls back to the raw id).
const renamingLayerId = ref<string | null>(null)
const renameDraft = ref<string>('')

function beginRenameLayer(row: LayerRow): void {
  renamingLayerId.value = row.id
  renameDraft.value = row.name
}

function cancelRenameLayer(): void {
  renamingLayerId.value = null
  renameDraft.value = ''
}

function commitRenameLayer(row: LayerRow): void {
  const id = renamingLayerId.value
  if (!id || id !== row.id) {
    cancelRenameLayer()
    return
  }
  const next = renameDraft.value.trim().slice(0, 80)
  if (next === (row.name ?? '')) {
    cancelRenameLayer()
    return
  }
  emit('apply', {
    kind: 'update_layer',
    payload: { id: row.id, props: { name: next } },
    source: 'ui',
  })
  cancelRenameLayer()
}
</script>

<template>
  <div
    class="layers-panel"
    data-testid="layers-panel"
    :data-collapsed="collapsed ? 'true' : 'false'"
  >
    <header class="layers-header">
      <button
        type="button"
        class="layers-toggle"
        :title="collapsed ? 'Expand layers panel' : 'Collapse layers panel'"
        :aria-label="collapsed ? 'Expand layers panel' : 'Collapse layers panel'"
        data-testid="layers-panel-toggle"
        @click="toggleCollapsed"
      >
        <span class="caret" :class="{ open: !collapsed }" aria-hidden="true">▾</span>
        <span class="layers-title">Layers</span>
        <span class="layers-count" aria-hidden="true">{{ rows.length }}</span>
      </button>
      <button
        v-if="!collapsed"
        type="button"
        class="layers-add"
        title="Add a new layer above the topmost"
        aria-label="Add layer"
        data-testid="layers-panel-add"
        @click="addLayer"
      >
        +
      </button>
    </header>

    <div v-if="!collapsed" class="layers-body">
      <p v-if="rows.length === 0" class="layers-empty">
        No layers. Click <span class="kbd">+</span> to add one.
      </p>
      <ul v-else class="layers-list">
        <li
          v-for="(row, idx) in rows"
          :key="row.id"
          class="layers-row"
          :class="{ active: isActive(row.id) }"
          :data-testid="`layers-row-${row.id}`"
        >
          <div class="row-head">
            <button
              type="button"
              class="row-expand"
              :title="isExpanded(row.id) ? 'Collapse items' : 'Show items'"
              :aria-expanded="isExpanded(row.id) ? 'true' : 'false'"
              :data-testid="`layers-row-${row.id}-expand`"
              @click.stop="toggleExpanded(row.id)"
            >
              <span class="caret" :class="{ open: isExpanded(row.id) }" aria-hidden="true">▸</span>
            </button>
            <button
              v-if="renamingLayerId !== row.id"
              type="button"
              class="row-label"
              :title="`Set ${row.id} as the active layer (z=${row.z}). Double-click to rename.`"
              :data-testid="`layers-row-${row.id}-select`"
              @click="selectLayer(row)"
              @dblclick.stop="beginRenameLayer(row)"
            >
              <span class="row-id">{{ row.name || row.id }}</span>
              <span v-if="row.name" class="row-subid" :title="`Layer id: ${row.id}`">{{ row.id }}</span>
              <span class="row-meta">
                z {{ row.z }}
                <span v-if="row.items.length > 0" class="row-item-count">
                  · {{ row.items.length }} item{{ row.items.length === 1 ? '' : 's' }}
                </span>
                <span v-if="targetLayerId === row.id" class="row-target-pill" title="Newly placed items land here">target</span>
              </span>
            </button>
            <input
              v-else
              v-model="renameDraft"
              type="text"
              spellcheck="false"
              maxlength="80"
              class="row-rename-input"
              :placeholder="`Friendly name — empty resets to ${row.id}`"
              :data-testid="`layers-row-${row.id}-rename-input`"
              @keydown.enter.prevent="commitRenameLayer(row)"
              @keydown.esc.prevent="cancelRenameLayer"
              @blur="commitRenameLayer(row)"
            />
            <div class="row-actions">
              <button
                type="button"
                class="row-btn flag"
                :class="{ off: !row.visible }"
                :title="row.visible ? 'Hide layer (renderer skips it)' : 'Show layer'"
                :aria-label="row.visible ? 'Hide layer' : 'Show layer'"
                :aria-pressed="!row.visible"
                :data-testid="`layers-row-${row.id}-visible`"
                @click.stop="toggleLayerVisible(row)"
              >
                {{ row.visible ? '👁' : '⊘' }}
              </button>
              <button
                type="button"
                class="row-btn flag"
                :class="{ on: row.locked }"
                :title="row.locked ? 'Unlock layer (allow edits)' : 'Lock layer (prevent edits)'"
                :aria-label="row.locked ? 'Unlock layer' : 'Lock layer'"
                :aria-pressed="row.locked"
                :data-testid="`layers-row-${row.id}-locked`"
                @click.stop="toggleLayerLocked(row)"
              >
                {{ row.locked ? '🔒' : '🔓' }}
              </button>
              <button
                type="button"
                class="row-btn"
                :disabled="idx === 0"
                title="Move layer up (higher z)"
                aria-label="Move layer up"
                :data-testid="`layers-row-${row.id}-up`"
                @click.stop="moveLayer(row, 'up')"
              >
                ▲
              </button>
              <button
                type="button"
                class="row-btn"
                :disabled="idx === rows.length - 1"
                title="Move layer down (lower z)"
                aria-label="Move layer down"
                :data-testid="`layers-row-${row.id}-down`"
                @click.stop="moveLayer(row, 'down')"
              >
                ▼
              </button>
              <button
                type="button"
                class="row-btn danger"
                title="Remove layer"
                aria-label="Remove layer"
                :data-testid="`layers-row-${row.id}-remove`"
                @click.stop="removeLayer(row)"
              >
                ×
              </button>
            </div>
          </div>

          <div class="row-controls">
            <label class="control opacity">
              <span class="control-label">Opacity</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                :value="row.opacity"
                :data-testid="`layers-row-${row.id}-opacity`"
                @input="setOpacity(row, $event)"
              />
              <span class="opacity-readout">{{ Math.round(row.opacity * 100) }}%</span>
            </label>
            <label class="control blend">
              <span class="control-label">Blend</span>
              <select
                :value="row.blendMode"
                :data-testid="`layers-row-${row.id}-blend`"
                @change="setBlendMode(row, $event)"
              >
                <option v-for="mode in BLEND_MODES" :key="mode" :value="mode">{{ mode }}</option>
              </select>
            </label>
          </div>

          <ul v-if="isExpanded(row.id) && row.items.length > 0" class="row-items">
            <li
              v-for="itemId in row.items"
              :key="itemId"
              class="row-item"
              :class="{ selected: isItemSelected(itemId), hidden: !isItemVisible(itemId) }"
            >
              <button
                type="button"
                class="row-item-btn"
                :title="`Select ${itemId}`"
                :data-testid="`layers-item-${itemId}`"
                @click="selectItem(itemId)"
              >
                <span class="row-item-glyph" aria-hidden="true">{{ itemTypeGlyph(itemId) }}</span>
                <span class="row-item-id">{{ itemId }}</span>
              </button>
              <div class="row-item-actions">
                <button
                  type="button"
                  class="row-btn flag"
                  :class="{ off: !isItemVisible(itemId) }"
                  :title="isItemVisible(itemId) ? 'Hide item' : 'Show item'"
                  :aria-label="isItemVisible(itemId) ? 'Hide item' : 'Show item'"
                  :aria-pressed="!isItemVisible(itemId)"
                  :data-testid="`layers-item-${itemId}-visible`"
                  @click.stop="toggleItemVisible(itemId)"
                >
                  {{ isItemVisible(itemId) ? '👁' : '⊘' }}
                </button>
                <button
                  type="button"
                  class="row-btn flag"
                  :class="{ on: isItemLocked(itemId) }"
                  :title="isItemLocked(itemId) ? 'Unlock item' : 'Lock item'"
                  :aria-label="isItemLocked(itemId) ? 'Unlock item' : 'Lock item'"
                  :aria-pressed="isItemLocked(itemId)"
                  :data-testid="`layers-item-${itemId}-locked`"
                  @click.stop="toggleItemLocked(itemId)"
                >
                  {{ isItemLocked(itemId) ? '🔒' : '🔓' }}
                </button>
              </div>
            </li>
          </ul>
          <p v-else-if="isExpanded(row.id)" class="row-items-empty">No items.</p>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.layers-panel {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 248px;
  max-height: calc(100% - 24px);
  z-index: 20;
  display: flex;
  flex-direction: column;
  background: rgba(13, 13, 13, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  font-family: 'Instrument Sans', system-ui, sans-serif;
  color: #e5e5e5;
  pointer-events: auto;
  overflow: hidden;
}

.layers-panel[data-collapsed='true'] {
  max-height: none;
}

.layers-header {
  display: flex;
  align-items: stretch;
  gap: 4px;
  padding: 4px 4px 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.layers-toggle {
  appearance: none;
  background: transparent;
  border: none;
  color: #d4d4d4;
  font: inherit;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  padding: 4px 8px;
  cursor: pointer;
  text-align: left;
  border-radius: 4px;
  min-width: 0;
}

.layers-toggle:hover {
  background: rgba(255, 255, 255, 0.05);
}

.caret {
  display: inline-flex;
  transition: transform 120ms ease;
  color: #909090;
  font-size: 10px;
  width: 10px;
  text-align: center;
}

.caret.open {
  transform: rotate(90deg);
}

.layers-header .caret.open {
  transform: rotate(0deg);
}

.layers-title {
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #a3a3a3;
  flex: 1 1 auto;
  min-width: 0;
}

.layers-count {
  font-size: 11px;
  color: #6f6f6f;
  font-feature-settings: 'tnum';
  background: rgba(255, 255, 255, 0.04);
  padding: 1px 6px;
  border-radius: 10px;
}

.layers-add {
  appearance: none;
  background: rgba(91, 124, 250, 0.2);
  border: 1px solid rgba(91, 124, 250, 0.55);
  color: #ffffff;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}

.layers-add:hover {
  background: rgba(91, 124, 250, 0.35);
}

.layers-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 6px;
}

.layers-empty {
  margin: 8px;
  font-size: 12px;
  color: #707070;
}

.kbd {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}

.layers-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.layers-row {
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  padding: 4px;
  background: rgba(255, 255, 255, 0.01);
  transition: border-color 120ms ease, background 120ms ease;
}

.layers-row.active {
  border-color: rgba(91, 124, 250, 0.6);
  background: rgba(91, 124, 250, 0.08);
}

.row-head {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.row-expand {
  appearance: none;
  background: transparent;
  border: none;
  color: #909090;
  padding: 2px 4px;
  border-radius: 3px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}

.row-expand:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #e5e5e5;
}

.row-label {
  appearance: none;
  background: transparent;
  border: none;
  color: #e5e5e5;
  font: inherit;
  font-size: 12px;
  flex: 1 1 auto;
  text-align: left;
  padding: 3px 4px;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.row-label:hover {
  background: rgba(255, 255, 255, 0.04);
}

.row-id {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  color: #f0f0f0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-subid {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  color: #707070;
  background: rgba(255, 255, 255, 0.04);
  padding: 1px 5px;
  border-radius: 3px;
  margin-left: 4px;
}

.row-rename-input {
  flex: 1 1 auto;
  background: #161616;
  border: 1px solid rgba(91, 124, 250, 0.55);
  color: #f0f0f0;
  font: inherit;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  padding: 3px 6px;
  border-radius: 4px;
  min-width: 0;
}

.row-rename-input:focus {
  outline: none;
  border-color: rgba(91, 124, 250, 0.85);
  box-shadow: 0 0 0 1px rgba(91, 124, 250, 0.4);
}

.row-meta {
  font-size: 10.5px;
  color: #909090;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-feature-settings: 'tnum';
}

.row-item-count {
  color: #808080;
}

.row-target-pill {
  background: rgba(91, 124, 250, 0.25);
  color: #c8d2ff;
  font-size: 9.5px;
  padding: 1px 5px;
  border-radius: 8px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: 1px solid rgba(91, 124, 250, 0.55);
}

.row-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}

.row-btn {
  appearance: none;
  background: transparent;
  border: 1px solid transparent;
  color: #c0c0c0;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.row-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.1);
  color: #f0f0f0;
}

.row-btn:disabled {
  color: #4f4f4f;
  cursor: default;
}

.row-btn.danger:hover:not(:disabled) {
  background: rgba(255, 90, 90, 0.18);
  border-color: rgba(255, 90, 90, 0.5);
  color: #ffcccc;
}

/* §M flag buttons. .off / .on tint signal the "active" (non-default)
 * states (hidden / locked) so the row reads at a glance. */
.row-btn.flag {
  font-size: 11px;
}
.row-btn.flag.off {
  color: #ff8a8a;
  background: rgba(255, 90, 90, 0.08);
}
.row-btn.flag.on {
  color: #ffc66b;
  background: rgba(255, 198, 107, 0.1);
}

.row-controls {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 4px 0 22px;
}

.control {
  display: grid;
  grid-template-columns: 50px 1fr auto;
  align-items: center;
  gap: 6px;
}

.control-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #909090;
}

.opacity input[type='range'] {
  width: 100%;
  accent-color: #5b7cfa;
}

.opacity-readout {
  font-size: 10.5px;
  color: #c0c0c0;
  font-feature-settings: 'tnum';
  min-width: 32px;
  text-align: right;
}

.blend select {
  grid-column: 2 / span 2;
  appearance: none;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #f0f0f0;
  font: inherit;
  font-size: 11px;
  padding: 3px 6px;
  border-radius: 4px;
  cursor: pointer;
}

.blend select:focus {
  outline: none;
  border-color: rgba(91, 124, 250, 0.65);
}

.row-items {
  list-style: none;
  margin: 6px 0 2px;
  padding: 0 0 0 22px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  border-top: 1px dashed rgba(255, 255, 255, 0.05);
  padding-top: 4px;
}

.row-items-empty {
  margin: 6px 0 2px 22px;
  padding-top: 4px;
  border-top: 1px dashed rgba(255, 255, 255, 0.05);
  font-size: 10.5px;
  color: #707070;
}

.row-item {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 2px;
}

.row-item.hidden .row-item-btn {
  opacity: 0.55;
}

.row-item-actions {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  flex: 0 0 auto;
}

.row-item-btn {
  appearance: none;
  background: transparent;
  border: 1px solid transparent;
  color: #c0c0c0;
  font: inherit;
  font-size: 11.5px;
  flex: 1 1 auto;
  min-width: 0;
  text-align: left;
  padding: 3px 6px;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.row-item-btn:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.08);
  color: #f0f0f0;
}

.row-item.selected .row-item-btn {
  background: rgba(91, 124, 250, 0.18);
  border-color: rgba(91, 124, 250, 0.55);
  color: #e7ecff;
}

.row-item-glyph {
  display: inline-flex;
  width: 14px;
  height: 14px;
  align-items: center;
  justify-content: center;
  color: #5b7cfa;
  font-size: 11px;
}

.row-item-id {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
