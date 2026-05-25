<script setup lang="ts">
// OutlinerNode — recursive tree row used by Outliner.vue.
//
// A single item row that may itself contain children (when the item is a
// group). Click the row to select; click the caret to expand/collapse.
//
// The component references itself by name (`OutlinerNode`) for recursion;
// Vue 3 supports this through the SFC filename → component-name mapping.

import { computed } from 'vue'

defineOptions({ name: 'OutlinerNode' })

export interface OutlinerTreeNode {
  id: string
  type: string
  label: string
  detail?: string
  glyph: string
  children: OutlinerTreeNode[]
  hasChildren: boolean
}

const props = defineProps<{
  node: OutlinerTreeNode
  depth: number
  isExpanded: (key: string) => boolean
  isSelected: (id: string) => boolean
  toggle: (key: string) => void
  select: (id: string) => void
  matches: (n: OutlinerTreeNode) => boolean
}>()

const expandKey = computed<string>(() => `item:${props.node.id}`)
const expanded = computed<boolean>(() => props.isExpanded(expandKey.value))
const selected = computed<boolean>(() => props.isSelected(props.node.id))
const visible = computed<boolean>(() => props.matches(props.node))

function onRowClick(): void {
  props.select(props.node.id)
}

function onCaretClick(event: MouseEvent): void {
  // Caret toggles expansion without changing selection — lets users browse
  // a large group without losing the currently-active selection.
  event.stopPropagation()
  if (!props.node.hasChildren) return
  props.toggle(expandKey.value)
}

// Self-reference for recursion. With <script setup> we expose the component
// name via the companion `<script>` block (below) so the compiler can
// resolve `<OutlinerNode>` inside the template — that's the standard Vue 3
// recipe for recursive SFCs.
</script>

<template>
  <li v-if="visible" class="tree-item">
    <button
      type="button"
      class="tree-row tree-row-item"
      :class="{ selected, [`depth-${Math.min(depth, 6)}`]: true }"
      :data-testid="`outliner-item-${node.id}`"
      :title="`Select ${node.id}`"
      @click="onRowClick"
    >
      <span
        class="tree-row-caret"
        :data-outliner-caret="true"
        :aria-expanded="node.hasChildren ? (expanded ? 'true' : 'false') : undefined"
        :aria-disabled="node.hasChildren ? 'false' : 'true'"
        :title="node.hasChildren ? (expanded ? 'Collapse group' : 'Expand group') : ''"
        role="button"
        tabindex="-1"
        @click="onCaretClick"
      >
        <span
          v-if="node.hasChildren"
          class="caret"
          :class="{ open: expanded }"
          aria-hidden="true"
        >▸</span>
        <span v-else class="caret-spacer" aria-hidden="true" />
      </span>
      <span class="tree-glyph" aria-hidden="true">{{ node.glyph }}</span>
      <span class="tree-label">{{ node.id }}</span>
      <span class="tree-meta">
        <span class="tree-type">{{ node.type }}</span>
        <span v-if="node.detail" class="tree-detail"> · {{ node.detail }}</span>
      </span>
    </button>

    <ul v-if="node.hasChildren && expanded" class="tree-children">
      <OutlinerNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :is-expanded="isExpanded"
        :is-selected="isSelected"
        :toggle="toggle"
        :select="select"
        :matches="matches"
      />
    </ul>
  </li>
</template>

<style scoped>
.tree-item {
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

.tree-row.selected {
  background: rgba(91, 124, 250, 0.18);
  border-color: rgba(91, 124, 250, 0.55);
  color: #e7ecff;
}

.tree-row-caret {
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  cursor: pointer;
  border-radius: 3px;
  color: #909090;
}

.tree-row-caret:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #e5e5e5;
}

.tree-row-caret[aria-disabled='true'] {
  cursor: default;
  pointer-events: none;
}

.caret {
  display: inline-flex;
  transition: transform 120ms ease;
  font-size: 10px;
  width: 10px;
  text-align: center;
}

.caret.open {
  transform: rotate(90deg);
}

.caret-spacer {
  display: inline-block;
  width: 10px;
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
  display: inline-flex;
  align-items: center;
  gap: 0;
  flex: 0 0 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 55%;
}

.tree-type {
  text-transform: lowercase;
  color: #909090;
}

.tree-detail {
  color: #707070;
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
</style>
