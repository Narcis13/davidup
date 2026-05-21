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
import { useSelection } from '~/composables/useSelection'
import OutlinerNode, { type OutlinerTreeNode } from '~/components/OutlinerNode.vue'

interface RawItem {
  type?: unknown
  kind?: unknown
  items?: unknown
  text?: unknown
  asset?: unknown
}

const props = defineProps<{
  composition: Composition | null
}>()

const selection = useSelection()

const collapsed = ref(false)
const expandedIds = ref<Set<string>>(new Set())
const filter = ref('')

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
    case 'scene-instance':
    case 'scene':
      return '◇'
    default:
      return '·'
  }
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
  return {
    id: itemId,
    type,
    label: itemId,
    detail: itemDetail(item),
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

function toggleCollapsed(): void {
  collapsed.value = !collapsed.value
}

function clearFilter(): void {
  filter.value = ''
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
            <button
              type="button"
              class="tree-row tree-row-layer"
              :title="`Layer ${layer.layerId} (z=${layer.z}) — click to expand/collapse`"
              :aria-expanded="isExpanded(`layer:${layer.layerId}`) ? 'true' : 'false'"
              :data-testid="`outliner-layer-row-${layer.layerId}`"
              @click="toggleExpanded(`layer:${layer.layerId}`)"
            >
              <span
                class="caret"
                :class="{ open: isExpanded(`layer:${layer.layerId}`) }"
                aria-hidden="true"
              >▸</span>
              <span class="tree-glyph layer-glyph" aria-hidden="true">▤</span>
              <span class="tree-label">{{ layer.layerId }}</span>
              <span class="tree-meta">
                z {{ layer.z }} · {{ layer.nodes.length }} item{{ layer.nodes.length === 1 ? '' : 's' }}
              </span>
            </button>

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
}

.tree-row-layer:hover {
  background: rgba(255, 255, 255, 0.06);
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
</style>
