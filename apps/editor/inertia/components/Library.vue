<script setup lang="ts">
// Library panel — step 13 of the editor build plan.
//
// Vue panel with tabs (Templates / Behaviors / Scenes / Assets / Fonts), a
// search box, and a grid of LibraryCards. The catalog is fetched from
// `/api/library`; thumbnails are generated lazily by the cards via
// `/api/library/thumbnail`. The list refreshes via a low-frequency poll so
// disk-side library changes show up in the panel within ~2 seconds without
// a full reload.
//
// The panel renders gracefully when no project is loaded or when the
// project has no library: the catalog list is empty but the tab strip and
// search box are still visible, so the panel is never blank.

import { computed } from 'vue'
import { useLibrary, LIBRARY_TABS, type LibraryTab } from '~/composables/useLibrary'
import LibraryCard from '~/components/LibraryCard.vue'

const lib = useLibrary({ initialTab: 'template' })

const tabLabels: Record<LibraryTab, string> = {
  template: 'Templates',
  behavior: 'Behaviors',
  scene: 'Scenes',
  asset: 'Assets',
  font: 'Fonts',
}

const visibleTabs = computed<LibraryTab[]>(() => LIBRARY_TABS as LibraryTab[])

function setTab(t: LibraryTab) {
  lib.tab.value = t
}

const emptyHint = computed(() => {
  if (!lib.attached.value) {
    return 'No library attached. Add a `library/` directory to your project to populate this panel.'
  }
  if (lib.total.value === 0) {
    return 'Library is empty. Drop a `*.template.json`, `*.behavior.json`, or `*.scene.json` into the project library directory.'
  }
  if (lib.query.value) {
    return `No ${lib.tab.value === 'all' ? 'items' : lib.tab.value + 's'} match "${lib.query.value}".`
  }
  return `No ${lib.tab.value}s in this library yet.`
})
</script>

<template>
  <div class="library-panel" data-panel-name="library">
    <div class="search-row">
      <input
        v-model="lib.query.value"
        class="search-box"
        type="search"
        placeholder="Search library…"
        spellcheck="false"
        autocomplete="off"
        data-testid="library-search"
      />
      <button
        type="button"
        class="refresh-btn"
        :disabled="lib.loading.value"
        title="Refresh catalog"
        data-testid="library-refresh"
        @click="lib.refresh()"
      >
        ⟳
      </button>
    </div>

    <nav class="tabs" role="tablist" aria-label="Library kinds">
      <button
        v-for="t in visibleTabs"
        :key="t"
        type="button"
        role="tab"
        :aria-selected="lib.tab.value === t"
        :data-tab="t"
        :data-active="lib.tab.value === t ? 'true' : 'false'"
        class="tab"
        @click="setTab(t)"
      >
        {{ tabLabels[t] }}
      </button>
    </nav>

    <div v-if="lib.error.value" class="error" role="alert">
      {{ lib.error.value }}
    </div>

    <div
      v-if="lib.items.value.length === 0 && !lib.loading.value && !lib.error.value"
      class="empty"
    >
      <p>{{ emptyHint }}</p>
    </div>

    <div
      v-else
      class="grid"
      :data-loading="lib.loading.value ? 'true' : 'false'"
      data-testid="library-grid"
    >
      <LibraryCard
        v-for="item in lib.items.value"
        :key="`${item.kind}:${item.id}:${item.source}`"
        :item="item"
        :generation="lib.generation.value"
      />
    </div>

    <div v-if="lib.errors.value.length > 0" class="errors">
      <h4>Library errors</h4>
      <ul>
        <li v-for="e in lib.errors.value" :key="e.file">
          <code>{{ e.file }}</code>: {{ e.message }}
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.library-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 8px;
}

.search-row {
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
}

.search-box {
  flex: 1 1 auto;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  padding: 6px 10px;
  color: #e5e5e5;
  font-size: 12px;
  font-family: inherit;
  outline: none;
}

.search-box::placeholder {
  color: #606060;
}

.search-box:focus {
  border-color: rgba(91, 124, 250, 0.55);
}

.refresh-btn {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #c0c0c0;
  border-radius: 4px;
  padding: 0 10px;
  font-size: 16px;
  cursor: pointer;
  line-height: 1;
}

.refresh-btn:hover:not(:disabled) {
  border-color: rgba(91, 124, 250, 0.55);
  color: #e5e5e5;
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: progress;
}

.tabs {
  display: flex;
  gap: 2px;
  flex: 0 0 auto;
  flex-wrap: wrap;
}

.tab {
  background: transparent;
  border: 1px solid transparent;
  color: #909090;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 4px 8px;
  border-radius: 3px;
  cursor: pointer;
  font-family: inherit;
}

.tab:hover {
  color: #e5e5e5;
}

.tab[data-active='true'] {
  color: #e5e5e5;
  background: rgba(91, 124, 250, 0.15);
  border-color: rgba(91, 124, 250, 0.35);
}

.grid {
  flex: 1 1 auto;
  overflow: auto;
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  padding-right: 4px;
  min-height: 0;
}

.grid[data-loading='true'] {
  opacity: 0.8;
}

@media (min-width: 380px) {
  .grid {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  }
}

.empty {
  color: #707070;
  font-size: 12px;
  padding: 12px 4px;
  line-height: 1.5;
}

.error {
  color: #ff6b6b;
  font-size: 12px;
  padding: 6px 8px;
  background: rgba(255, 107, 107, 0.08);
  border: 1px solid rgba(255, 107, 107, 0.3);
  border-radius: 4px;
}

.errors {
  flex: 0 0 auto;
  margin-top: 6px;
  font-size: 11px;
  color: #ffb86b;
  border-top: 1px solid rgba(255, 184, 107, 0.2);
  padding-top: 6px;
}

.errors h4 {
  margin: 0 0 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #ffb86b;
}

.errors ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.errors li {
  margin: 0 0 2px;
  word-break: break-all;
}

.errors code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  background: rgba(255, 184, 107, 0.1);
  padding: 1px 4px;
  border-radius: 2px;
}
</style>
