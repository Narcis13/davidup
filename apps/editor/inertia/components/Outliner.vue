<script setup lang="ts">
// Outliner — UX_GAPS section F.
//
// A floating tree view that mirrors `composition.layers[].items[]` with
// group expansion. Use cases (from UX_GAPS §F):
//  - jump-to-select for items occluded on Stage (the only way to reach a
//    deeply-nested or off-stage item without hand-editing JSON)
//  - foundation for future multi-select and drag-to-reparent
//
// First pass keeps the surface read-only-with-selection: click a row to
// dispatch through `useSelection`, expand/collapse layers and groups,
// filter by id / type / text content. Drag-to-reorder lands in a later
// milestone (UX_GAPS §F notes it as a foundation step). No new mutation
// paths are invented — selection only.

import { computed, ref } from 'vue'
import type { Composition } from '~/composables/useCommandBus'
import { useActiveLayer } from '~/composables/useActiveLayer'
import { useSelection } from '~/composables/useSelection'
import OutlinerNode, { type OutlinerTreeNode } from '~/components/OutlinerNode.vue'

interface RawItem {
  type?: unknown
  kind?: unknown
  items?: unknown
  text?: unknown
  asset?: unknown
  name?: unknown
  start?: unknown
  end?: unknown
  trimIn?: unknown
  trimOut?: unknown
  loop?: unknown
}

const props = defineProps<{
  composition: Composition | null
}>()

const selection = useSelection()
const activeLayer = useActiveLayer()

// §6 — start collapsed by default so the panel doesn't cover the canvas
// on load. Persisted across sessions via localStorage so a user who
// opens it once doesn't have to re-expand every reload.
const COLLAPSED_STORAGE_KEY = 'davidup.outliner.collapsed'
const collapsed = ref(readCollapsedPref(true))
const expandedIds = ref<Set<string>>(new Set())
const filter = ref('')

function readCollapsedPref(fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY)
    if (raw === '0') return false
    if (raw === '1') return true
  } catch {
    /* localStorage may be unavailable in privacy modes */
  }
  return fallback
}

function persistCollapsedPref(value: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, value ? '1' : '0')
  } catch {
    /* ignore */
  }
}

// Layers, top-to-bottom (highest z first) so the tree reads like Photoshop /
// Figma. Matches LayersPanel.vue's row order so the two panels stay
// consistent.
const sortedLayers = computed(() => {
  const layers = props.composition?.layers
  if (!Array.isArray(layers))
    return [] as ReadonlyArray<{ id: string; z: number; items: ReadonlyArray<string> }>
  const out: Array<{ id: string; z: number; items: ReadonlyArray<string> }> = []
  for (const l of layers as ReadonlyArray<Record<string, unknown>>) {
    const id = typeof l.id === 'string' ? l.id : null
    if (!id) continue
    out.push({
      id,
      z: typeof l.z === 'number' ? l.z : 0,
      items: Array.isArray(l.items) ? (l.items as ReadonlyArray<string>) : [],
    })
  }
  out.sort((a, b) => b.z - a.z)
  return out
})

function readItem(itemId: string): RawItem | null {
  const items = props.composition?.items as Record<string, RawItem> | undefined
  if (!items) return null
  return items[itemId] ?? null
}

function itemTypeGlyph(item: RawItem | null): string {
  switch (item?.type) {
    case 'sprite':
      return '◧'
    case 'text':
      return 'T'
    case 'shape':
      return '▭'
    case 'group':
      return '⊞'
    case 'video':
      return '▶'
    case 'scene-instance':
    case 'scene':
      return '◇'
    default:
      return '·'
  }
}

function formatRange(start: number, end: number | undefined): string {
  const fmt = (t: number) => {
    const m = Math.floor(t / 60)
    const s = Math.round(t % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }
  return end !== undefined ? `${fmt(start)}-${fmt(end)}` : `${fmt(start)}…`
}

function itemDetail(item: RawItem | null): string | undefined {
  if (!item) return undefined
  // Surface the most useful one-word hint per item type so users can pick
  // the right node out of a long list without clicking to inspect.
  switch (item.type) {
    case 'shape':
      return typeof item.kind === 'string' ? item.kind : undefined
    case 'text':
      if (typeof item.text === 'string' && item.text.length > 0) {
        return item.text.length > 24 ? `${item.text.slice(0, 23)}…` : item.text
      }
      return undefined
    case 'sprite':
      return typeof item.asset === 'string' ? item.asset : undefined
    case 'video': {
      // U7 — "▶ 0:00-0:12" range + loop/freeze badge, matching the spec's
      // outliner row hint.
      const start = typeof item.start === 'number' ? item.start : 0
      const end = typeof item.end === 'number' ? item.end : undefined
      const range = formatRange(start, end)
      const tail = item.loop === true ? ' · loop' : ''
      return `▶ ${range}${tail}`
    }
    case 'group':
      if (Array.isArray(item.items))
        return `${(item.items as ReadonlyArray<unknown>).length} items`
      return undefined
    case 'scene-instance':
    case 'scene':
      return 'scene'
    default:
      return undefined
  }
}

function buildNode(itemId: string, ancestorIds: ReadonlySet<string>): OutlinerTreeNode | null {
  // Recurse-safe: a group's items[] could in principle cycle (engine catches
  // it at validate, but we defensively avoid infinite loops in the UI).
  if (ancestorIds.has(itemId)) return null
  const item = readItem(itemId)
  const type = typeof item?.type === 'string' ? item.type : 'unknown'
  const children: OutlinerTreeNode[] = []
  if (item && item.type === 'group' && Array.isArray(item.items)) {
    const next = new Set(ancestorIds)
    next.add(itemId)
    for (const childId of item.items as ReadonlyArray<unknown>) {
      if (typeof childId !== 'string') continue
      const node = buildNode(childId, next)
      if (node) children.push(node)
    }
  }
  // §P — if the item carries a friendly `name`, surface it as the label and
  // demote the raw id to a detail hint. Keeps filtering predictable (the
  // filter still searches `id`, `type`, and `detail` — which now includes id).
  const friendlyName = typeof item?.name === 'string' && item.name.length > 0 ? item.name : null
  const detail = itemDetail(item)
  return {
    id: itemId,
    type,
    label: friendlyName ?? itemId,
    detail: friendlyName
      ? detail
        ? `${itemId} · ${detail}`
        : itemId
      : detail,
    glyph: itemTypeGlyph(item),
    children,
    hasChildren: children.length > 0,
  }
}

const tree = computed<Array<{ layerId: string; z: number; nodes: OutlinerTreeNode[] }>>(() => {
  return sortedLayers.value.map((layer) => {
    const nodes: OutlinerTreeNode[] = []
    for (const itemId of layer.items) {
      const node = buildNode(itemId, new Set())
      if (node) nodes.push(node)
    }
    return { layerId: layer.id, z: layer.z, nodes }
  })
})

// Filter pass: walk the tree and force-expand any ancestor of a hit so the
// user sees the path to the result. We collect the keys to auto-expand
// (rather than mutating `expandedIds`) so clearing the filter restores the
// user's manual expand/collapse state.
const autoExpanded = computed<ReadonlySet<string>>(() => {
  const q = filter.value.trim().toLowerCase()
  if (q.length === 0) return new Set<string>()
  const out = new Set<string>()
  const visit = (node: OutlinerTreeNode, ancestors: string[]): boolean => {
    const selfHit =
      node.id.toLowerCase().includes(q) ||
      node.type.toLowerCase().includes(q) ||
      (node.detail ?? '').toLowerCase().includes(q)
    let anyChildHit = false
    for (const child of node.children) {
      if (visit(child, [...ancestors, `item:${node.id}`])) anyChildHit = true
    }
    if (selfHit || anyChildHit) {
      for (const a of ancestors) out.add(a)
      if (anyChildHit) out.add(`item:${node.id}`)
      return true
    }
    return false
  }
  for (const layer of tree.value) {
    const layerKey = `layer:${layer.layerId}`
    let anyLayerHit = false
    for (const n of layer.nodes) {
      if (visit(n, [layerKey])) anyLayerHit = true
    }
    if (anyLayerHit) out.add(layerKey)
  }
  return out
})

function nodeMatchesFilter(node: OutlinerTreeNode): boolean {
  const q = filter.value.trim().toLowerCase()
  if (q.length === 0) return true
  if (
    node.id.toLowerCase().includes(q) ||
    node.type.toLowerCase().includes(q) ||
    (node.detail ?? '').toLowerCase().includes(q)
  )
    return true
  for (const c of node.children) if (nodeMatchesFilter(c)) return true
  return false
}

function layerMatchesFilter(layerId: string, nodes: OutlinerTreeNode[]): boolean {
  const q = filter.value.trim().toLowerCase()
  if (q.length === 0) return true
  if (layerId.toLowerCase().includes(q)) return true
  for (const n of nodes) if (nodeMatchesFilter(n)) return true
  return false
}

function isExpanded(key: string): boolean {
  if (autoExpanded.value.has(key)) return true
  return expandedIds.value.has(key)
}

function toggleExpanded(key: string): void {
  const next = new Set(expandedIds.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedIds.value = next
}

function selectItem(itemId: string): void {
  selection.setSelection(itemId)
}

function isItemSelected(itemId: string): boolean {
  return selection.selectedItemId.value === itemId
}

// §8 — clicking a layer row body promotes it to the active layer (newly
// placed primitives land there) AND expands it so the user immediately
// sees the children. The caret stays a pure expand toggle (no active-layer
// change) so the user can browse the tree without disturbing placement.
function selectLayer(layerId: string): void {
  activeLayer.setActiveLayer(layerId)
  if (!expandedIds.value.has(`layer:${layerId}`)) {
    toggleExpanded(`layer:${layerId}`)
  }
}

function isLayerActive(layerId: string): boolean {
  return activeLayer.activeLayerId.value === layerId
}

function toggleCollapsed(): void {
  collapsed.value = !collapsed.value
  persistCollapsedPref(collapsed.value)
}

function clearFilter(): void {
  filter.value = ''
}

// ─── U7: Audio Tracks section ────────────────────────────────────────────
//
// Audio tracks aren't layer-rooted items, so they don't fit the recursive
// tree above — a dedicated top-level section below it (mirroring how
// Premiere/After Effects separate audio from the visual layer stack).
interface AudioTrackNode {
  id: string
  asset: string
  start: number
  end?: number
  duration: number
  muted: boolean
}

function audioTrackDuration(t: Record<string, unknown>, assetDur: number | null): number {
  const start = typeof t.start === 'number' ? t.start : 0
  const end = typeof t.end === 'number' ? t.end : start + (assetDur ?? 0)
  return Math.max(0, end - start)
}

const audioTrackNodes = computed<AudioTrackNode[]>(() => {
  const comp = props.composition
  const list = (comp as { audio?: unknown } | null)?.audio
  if (!Array.isArray(list)) return []
  const assets = Array.isArray(comp?.assets) ? (comp!.assets as ReadonlyArray<Record<string, unknown>>) : []
  const assetDurById = new Map<string, number>()
  for (const a of assets) {
    if (typeof a.id === 'string' && typeof a.duration === 'number') assetDurById.set(a.id, a.duration)
  }
  const out: AudioTrackNode[] = []
  for (const t of list as ReadonlyArray<Record<string, unknown>>) {
    if (typeof t.id !== 'string' || typeof t.asset !== 'string') continue
    const assetDur = assetDurById.get(t.asset) ?? null
    out.push({
      id: t.id,
      asset: t.asset,
      start: typeof t.start === 'number' ? t.start : 0,
      end: typeof t.end === 'number' ? t.end : undefined,
      duration: audioTrackDuration(t, assetDur),
      muted: typeof t.volume === 'number' && t.volume <= 0,
    })
  }
  return out
})

function formatAudioDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function selectAudioTrack(id: string): void {
  selection.setAudioTrackSelection(id)
}

function isAudioTrackSelected(id: string): boolean {
  return selection.selectedAudioTrackId.value === id
}

const totalItemCount = computed<number>(() => {
  let count = 0
  const visit = (n: OutlinerTreeNode) => {
    count += 1
    for (const c of n.children) visit(c)
  }
  for (const layer of tree.value) for (const n of layer.nodes) visit(n)
  return count
})

const visibleMatchCount = computed<number>(() => {
  if (filter.value.trim().length === 0) return totalItemCount.value
  let count = 0
  const q = filter.value.trim().toLowerCase()
  const visit = (n: OutlinerTreeNode) => {
    const selfHit =
      n.id.toLowerCase().includes(q) ||
      n.type.toLowerCase().includes(q) ||
      (n.detail ?? '').toLowerCase().includes(q)
    if (selfHit) count += 1
    for (const c of n.children) visit(c)
  }
  for (const layer of tree.value) for (const n of layer.nodes) visit(n)
  return count
})
</script>

<template>
  <div
    class="outliner"
    data-testid="outliner"
    :data-collapsed="collapsed ? 'true' : 'false'"
  >
    <header class="outliner-header">
      <button
        type="button"
        class="outliner-toggle"
        :title="collapsed ? 'Expand outliner' : 'Collapse outliner'"
        :aria-label="collapsed ? 'Expand outliner' : 'Collapse outliner'"
        data-testid="outliner-toggle"
        @click="toggleCollapsed"
      >
        <span class="caret" :class="{ open: !collapsed }" aria-hidden="true">▾</span>
        <span class="outliner-title">Outliner</span>
        <span class="outliner-count" aria-hidden="true">{{ totalItemCount }}</span>
      </button>
    </header>

    <div v-if="!collapsed" class="outliner-body">
      <div class="outliner-filter">
        <input
          v-model="filter"
          type="search"
          placeholder="Filter items…"
          aria-label="Filter outliner"
          data-testid="outliner-filter"
          spellcheck="false"
          autocomplete="off"
        />
        <button
          v-if="filter.length > 0"
          type="button"
          class="outliner-filter-clear"
          title="Clear filter"
          aria-label="Clear filter"
          data-testid="outliner-filter-clear"
          @click="clearFilter"
        >
          ×
        </button>
      </div>

      <p v-if="tree.length === 0" class="outliner-empty">
        No layers in this composition.
      </p>
      <p
        v-else-if="filter.length > 0 && visibleMatchCount === 0"
        class="outliner-empty"
        data-testid="outliner-no-matches"
      >
        No matches for "{{ filter }}".
      </p>

      <ul v-else class="tree">
        <template v-for="layer in tree" :key="layer.layerId">
          <li
            v-if="layerMatchesFilter(layer.layerId, layer.nodes)"
            class="tree-layer"
            :data-testid="`outliner-layer-${layer.layerId}`"
          >
            <!--
              §8 — split disclosure caret from the row body. The caret
              toggles expansion only (so the user can browse without
              changing the active layer); the body sets the layer active
              AND expands it. Modelled as two stacked buttons so each
              gets its own focus + a11y semantics.
            -->
            <div
              class="tree-row tree-row-layer"
              :class="{ active: isLayerActive(layer.layerId) }"
              :data-testid="`outliner-layer-row-${layer.layerId}`"
            >
              <button
                type="button"
                class="tree-row-caret"
                :title="isExpanded(`layer:${layer.layerId}`) ? 'Collapse layer' : 'Expand layer'"
                :aria-label="isExpanded(`layer:${layer.layerId}`) ? 'Collapse layer' : 'Expand layer'"
                :aria-expanded="isExpanded(`layer:${layer.layerId}`) ? 'true' : 'false'"
                :data-testid="`outliner-layer-caret-${layer.layerId}`"
                @click.stop="toggleExpanded(`layer:${layer.layerId}`)"
              >
                <span
                  class="caret"
                  :class="{ open: isExpanded(`layer:${layer.layerId}`) }"
                  aria-hidden="true"
                >▸</span>
              </button>
              <button
                type="button"
                class="tree-row-body"
                :title="`Select layer ${layer.layerId} (z=${layer.z}) — newly placed items will land here`"
                :data-testid="`outliner-layer-select-${layer.layerId}`"
                @click="selectLayer(layer.layerId)"
              >
                <span class="tree-glyph layer-glyph" aria-hidden="true">▤</span>
                <span class="tree-label">{{ layer.layerId }}</span>
                <span class="tree-meta">
                  z {{ layer.z }} · {{ layer.nodes.length }} item{{ layer.nodes.length === 1 ? '' : 's' }}
                  <span v-if="isLayerActive(layer.layerId)" class="active-pill" title="Active layer — primitives land here">active</span>
                </span>
              </button>
            </div>

            <ul
              v-if="isExpanded(`layer:${layer.layerId}`) && layer.nodes.length > 0"
              class="tree-children"
            >
              <OutlinerNode
                v-for="node in layer.nodes"
                :key="node.id"
                :node="node"
                :depth="1"
                :is-expanded="isExpanded"
                :is-selected="isItemSelected"
                :toggle="toggleExpanded"
                :select="selectItem"
                :matches="nodeMatchesFilter"
              />
            </ul>
            <p
              v-else-if="isExpanded(`layer:${layer.layerId}`) && layer.nodes.length === 0"
              class="tree-empty"
            >
              empty layer
            </p>
          </li>
        </template>
      </ul>

      <!-- U7 — Audio Tracks: dedicated section, separate from the layer/item
           tree (audio isn't layer-rooted). -->
      <div v-if="audioTrackNodes.length > 0" class="audio-tracks-section">
        <div class="audio-tracks-header">Audio Tracks</div>
        <ul class="tree">
          <li
            v-for="node in audioTrackNodes"
            :key="node.id"
            class="tree-item"
          >
            <button
              type="button"
              class="tree-row tree-row-item"
              :class="{ selected: isAudioTrackSelected(node.id) }"
              :data-testid="`outliner-audio-track-${node.id}`"
              :title="`Select ${node.id}`"
              @click="selectAudioTrack(node.id)"
            >
              <span class="caret-spacer" aria-hidden="true" />
              <span class="tree-glyph audio-glyph" aria-hidden="true">♪</span>
              <span class="tree-label">{{ node.id }}</span>
              <span class="tree-meta">
                <span class="tree-type">{{ formatAudioDuration(node.duration) }}</span>
                <span v-if="node.muted" class="tree-detail"> · muted</span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.outliner {
  position: absolute;
  left: 12px;
  bottom: 12px;
  width: 280px;
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

.outliner[data-collapsed='true'] {
  max-height: none;
}

.outliner-header {
  display: flex;
  align-items: stretch;
  gap: 4px;
  padding: 4px 4px 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.outliner-toggle {
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

.outliner-toggle:hover {
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

.outliner-header .caret.open {
  transform: rotate(0deg);
}

.outliner-title {
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #a3a3a3;
  flex: 1 1 auto;
  min-width: 0;
}

.outliner-count {
  font-size: 11px;
  color: #6f6f6f;
  font-feature-settings: 'tnum';
  background: rgba(255, 255, 255, 0.04);
  padding: 1px 6px;
  border-radius: 10px;
}

.outliner-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 6px;
}

.outliner-filter {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 2px 6px;
}

.outliner-filter input {
  flex: 1 1 auto;
  appearance: none;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #f0f0f0;
  font: inherit;
  font-size: 11.5px;
  padding: 4px 8px;
  border-radius: 4px;
  min-width: 0;
}

.outliner-filter input:focus {
  outline: none;
  border-color: rgba(91, 124, 250, 0.65);
}

.outliner-filter-clear {
  appearance: none;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #c0c0c0;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  cursor: pointer;
  flex: 0 0 auto;
  font-size: 12px;
  line-height: 1;
}

.outliner-filter-clear:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #f0f0f0;
}

.outliner-empty {
  margin: 6px 8px;
  font-size: 11.5px;
  color: #707070;
}

.tree {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.tree-layer {
  list-style: none;
  margin: 0;
}

.tree-row {
  appearance: none;
  background: transparent;
  border: 1px solid transparent;
  color: #d4d4d4;
  font: inherit;
  font-size: 11.5px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 3px 6px;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  min-width: 0;
}

.tree-row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.tree-row-layer {
  background: rgba(255, 255, 255, 0.02);
  display: flex;
  align-items: stretch;
  gap: 0;
  padding: 0;
}

.tree-row-layer:hover {
  background: rgba(255, 255, 255, 0.06);
}

.tree-row-layer.active {
  background: rgba(91, 124, 250, 0.12);
  border-color: rgba(91, 124, 250, 0.55);
}

.tree-row-layer .tree-row-caret {
  appearance: none;
  background: transparent;
  border: none;
  color: #909090;
  width: 22px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-top-left-radius: 4px;
  border-bottom-left-radius: 4px;
}

.tree-row-layer .tree-row-caret:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #e5e5e5;
}

.tree-row-layer .tree-row-body {
  appearance: none;
  background: transparent;
  border: none;
  color: #d4d4d4;
  font: inherit;
  font-size: 11.5px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  padding: 3px 6px;
  cursor: pointer;
  text-align: left;
  min-width: 0;
  border-top-right-radius: 4px;
  border-bottom-right-radius: 4px;
}

.tree-row-layer .tree-row-body:hover {
  background: rgba(255, 255, 255, 0.06);
}

.active-pill {
  background: rgba(91, 124, 250, 0.25);
  color: #c8d2ff;
  font-size: 9.5px;
  padding: 1px 5px;
  border-radius: 8px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border: 1px solid rgba(91, 124, 250, 0.55);
  margin-left: 6px;
  font-feature-settings: normal;
}

.tree-glyph {
  display: inline-flex;
  width: 14px;
  height: 14px;
  align-items: center;
  justify-content: center;
  color: #5b7cfa;
  font-size: 11px;
  flex: 0 0 auto;
}

.layer-glyph {
  color: #8c97a8;
}

.tree-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px;
  color: #f0f0f0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1 1 auto;
  min-width: 0;
}

.tree-meta {
  font-size: 10px;
  color: #808080;
  font-feature-settings: 'tnum';
  flex: 0 0 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 55%;
}

.tree-children {
  list-style: none;
  margin: 0 0 0 8px;
  padding: 0 0 0 14px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  border-left: 1px dashed rgba(255, 255, 255, 0.06);
}

.tree-empty {
  margin: 4px 0 4px 22px;
  padding: 2px 0;
  font-size: 10.5px;
  color: #707070;
  font-style: italic;
}

/* U7 — Audio Tracks section + the row styling it needs that OutlinerNode's
 * scoped styles (correctly) don't leak into this component. */
.audio-tracks-section {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.audio-tracks-header {
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #6bd0b0;
  padding: 2px 6px 4px;
}

.tree-item {
  list-style: none;
  margin: 0;
}

.tree-row.selected {
  background: rgba(6, 214, 160, 0.14);
  border-color: rgba(6, 214, 160, 0.5);
  color: #e7fff5;
}

.caret-spacer {
  display: inline-block;
  width: 10px;
}

.audio-glyph {
  color: #6bd0b0;
}

.tree-type {
  color: #909090;
  font-feature-settings: 'tnum';
}

.tree-detail {
  color: #707070;
}
</style>
