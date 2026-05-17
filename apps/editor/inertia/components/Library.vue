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
//
// Step 18b adds a file-drop zone: dragging files (anything not already a
// library card drag) anywhere on the panel surfaces a hit-zone overlay; on
// drop the files are POSTed to `/api/assets` via `useAssetUpload`. The
// library_index watcher picks the new files up within ~1s and the panel's
// 2-second poll refreshes the catalog so the new card appears.

import { computed, ref } from 'vue'
import { useLibrary, LIBRARY_TABS, type LibraryTab } from '~/composables/useLibrary'
import { useAssetUpload, isUploadableFile } from '~/composables/useAssetUpload'
import { LIBRARY_MIME } from '~/composables/useLibraryDrag'
import LibraryCard from '~/components/LibraryCard.vue'

const lib = useLibrary({ initialTab: 'template' })
const uploads = useAssetUpload()

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

// ─── File-drop upload (step 18b) ──────────────────────────────────────────
const isFileDragHover = ref(false)
let dragDepth = 0

function isFileDrag(event: DragEvent): boolean {
  const dt = event.dataTransfer
  if (!dt) return false
  // Library-card drags carry our internal MIME — those should fall through to
  // the existing drag-to-stage / drag-to-timeline flow, not look like an
  // upload intent.
  const types = Array.from(dt.types ?? [])
  if (types.includes(LIBRARY_MIME)) return false
  return types.includes('Files')
}

function onDragEnter(event: DragEvent): void {
  if (!isFileDrag(event)) return
  event.preventDefault()
  dragDepth++
  isFileDragHover.value = true
}

function onDragOver(event: DragEvent): void {
  if (!isFileDrag(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  isFileDragHover.value = true
}

function onDragLeave(event: DragEvent): void {
  if (!isFileDrag(event)) return
  event.preventDefault()
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) isFileDragHover.value = false
}

function onDrop(event: DragEvent): void {
  if (!isFileDrag(event)) return
  event.preventDefault()
  // Stop the editor-shell window listener from double-handling this drop.
  event.stopPropagation()
  dragDepth = 0
  isFileDragHover.value = false
  const files = event.dataTransfer?.files
  if (!files || files.length === 0) return
  // Reveal the Assets tab when at least one accepted file was dropped so the
  // new card lands somewhere the user can see.
  if (Array.from(files).some(isUploadableFile)) {
    lib.tab.value = 'asset'
  }
  // Hand every file off — unsupported ones get an error toast rather than a
  // silent no-op.
  uploads.uploadFiles(Array.from(files))
}
</script>

<template>
  <div
    class="library-panel"
    data-panel-name="library"
    :data-file-drag="isFileDragHover ? 'true' : null"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
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
          <code>{{ e.file }}</code
          >: {{ e.message }}
        </li>
      </ul>
    </div>

    <div
      v-if="isFileDragHover"
      class="drop-overlay"
      data-testid="library-drop-overlay"
      aria-hidden="true"
    >
      <div class="drop-card">
        <span class="drop-icon">⤓</span>
        <p class="drop-title">Drop to upload</p>
        <p class="drop-sub">Images, video, or audio — added to the Assets library</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.library-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 8px;
}

.drop-overlay {
  position: absolute;
  inset: -8px;
  background: rgba(8, 12, 28, 0.78);
  border: 2px dashed rgba(91, 124, 250, 0.7);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  pointer-events: none;
  backdrop-filter: blur(2px);
}

.drop-card {
  text-align: center;
  color: #e5e5e5;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
}

.drop-icon {
  font-size: 28px;
  line-height: 1;
  color: rgba(91, 124, 250, 1);
}

.drop-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.drop-sub {
  margin: 0;
  font-size: 11px;
  color: #a3a3a3;
  max-width: 220px;
  line-height: 1.4;
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
