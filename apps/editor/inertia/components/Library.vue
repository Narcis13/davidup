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
import {
  useLibrary,
  LIBRARY_TABS,
  LIBRARY_SCOPES,
  type LibraryItem,
  type LibraryTab,
  type LibraryScopeFilter,
} from '~/composables/useLibrary'
import { useAssetUpload, isUploadableFile } from '~/composables/useAssetUpload'
import { LIBRARY_MIME } from '~/composables/useLibraryDrag'
import LibraryCard from '~/components/LibraryCard.vue'
import SaveDefinitionDialog from '~/components/SaveDefinitionDialog.vue'
import { useToasts } from '~/composables/useToasts'

// Composition is optional so the panel still renders when no project is
// loaded. When present we compute usage counts per asset id (UX_GAPS §J's
// "asset usage panel"): how many sprite/text items in the composition
// currently reference that asset, plus whether the asset is even registered
// in `composition.assets`. The remove button uses these to decide whether
// to call `remove_asset` directly or to confirm with the user first.
type CompositionLike = {
  assets?: ReadonlyArray<{ id?: unknown; type?: unknown }>
  items?: Record<string, { type?: unknown; asset?: unknown; font?: unknown }>
}

const props = defineProps<{
  composition?: CompositionLike | null
}>()

const lib = useLibrary({ initialTab: 'template' })
const uploads = useAssetUpload()
const toasts = useToasts()

const emit = defineEmits<{
  (event: 'apply-template', item: LibraryItem): void
  (event: 'remove-asset', payload: { id: string; cascade: boolean }): void
}>()

function onApply(item: LibraryItem): void {
  emit('apply-template', item)
}

// Promote requests in flight, keyed by `${kind}::${id}`. Each card's
// disabled state is derived from this map so two rapid clicks don't fire
// duplicate POSTs.
const promoting = ref<Set<string>>(new Set())
const promoteKey = (item: LibraryItem) => `${item.kind}::${item.id}`

// ─── Asset usage / removal (UX_GAPS §J) ──────────────────────────────────
//
// `remove_asset` only knows about `composition.assets`; library catalog
// entries are file-tracked separately. So for each library asset card we
// surface (a) whether its id is currently *registered* in the loaded
// composition, and (b) how many sprite/text items still reference it.
//
// A button on the card emits `remove-asset` upward — the page wires that
// to `bus.apply({ kind: 'remove_asset', ... })`. We do the usage check
// *here* (UI side) so the user gets a fast, accurate confirm prompt rather
// than discovering the issue only after the server rejects the call.

interface AssetUsageEntry {
  registered: boolean
  usages: number
  usingItemIds: ReadonlyArray<string>
}

const assetIndex = computed<Map<string, AssetUsageEntry>>(() => {
  const map = new Map<string, AssetUsageEntry>()
  const comp = props.composition
  if (!comp) return map
  // Seed entries for everything actually registered in composition.assets so
  // a registered-but-unused asset still shows up as `registered: true`.
  for (const a of comp.assets ?? []) {
    const id = typeof a?.id === 'string' ? a.id : null
    if (!id) continue
    if (!map.has(id)) {
      map.set(id, { registered: true, usages: 0, usingItemIds: [] })
    } else {
      const cur = map.get(id)!
      map.set(id, { ...cur, registered: true })
    }
  }
  const items = comp.items ?? {}
  for (const [itemId, item] of Object.entries(items)) {
    if (!item || typeof item !== 'object') continue
    const refs: string[] = []
    if (item.type === 'sprite' && typeof item.asset === 'string') refs.push(item.asset)
    if (item.type === 'text' && typeof item.font === 'string') refs.push(item.font)
    for (const ref of refs) {
      const cur = map.get(ref) ?? { registered: false, usages: 0, usingItemIds: [] }
      map.set(ref, {
        registered: cur.registered,
        usages: cur.usages + 1,
        usingItemIds: [...cur.usingItemIds, itemId],
      })
    }
  }
  return map
})

function usageFor(item: LibraryItem): AssetUsageEntry | null {
  if (item.kind !== 'asset' && item.kind !== 'font') return null
  return assetIndex.value.get(item.id) ?? { registered: false, usages: 0, usingItemIds: [] }
}

function onRemoveAsset(item: LibraryItem): void {
  if (item.kind !== 'asset' && item.kind !== 'font') return
  const usage = assetIndex.value.get(item.id)
  if (!usage || !usage.registered) {
    toasts.warning(`Asset "${item.id}" is not registered in this composition.`, {
      dedupeKey: `library:remove-asset:${item.id}:unreg`,
    })
    return
  }
  if (usage.usages > 0) {
    const sample = usage.usingItemIds.slice(0, 3).join(', ')
    const tail = usage.usingItemIds.length > 3 ? `, …(+${usage.usingItemIds.length - 3} more)` : ''
    const ok = window.confirm(
      `"${item.id}" is referenced by ${usage.usages} item${usage.usages === 1 ? '' : 's'} (${sample}${tail}).\n\n` +
        `Removing the asset will fail until those items are deleted or reassigned. Continue anyway?`,
    )
    if (!ok) return
  }
  emit('remove-asset', { id: item.id, cascade: false })
}

// ─── Save-definition dialog (target picker for new templates/scenes/behaviors) ───
const saveDialogOpen = ref(false)
const saveDialogKind = computed<'template' | 'behavior' | 'scene'>(() => {
  const t = lib.tab.value
  if (t === 'template' || t === 'behavior' || t === 'scene') return t
  return 'template'
})
const saveDialogTarget = computed<'project' | 'global'>(() =>
  lib.scope.value === 'global' ? 'global' : 'project',
)

function openSaveDialog() {
  saveDialogOpen.value = true
}

function onDefinitionSaved(payload: {
  kind: string
  id: string
  target: string
  relative: string
}): void {
  toasts.success(
    `Saved ${payload.kind} "${payload.id}" to ${payload.target} library`,
    { dedupeKey: `library:save:${payload.kind}:${payload.id}` },
  )
  // Reveal the matching tab so the new card lands somewhere the user can
  // see it without hunting through filters.
  if (
    payload.kind === 'template' ||
    payload.kind === 'behavior' ||
    payload.kind === 'scene'
  ) {
    lib.tab.value = payload.kind
  }
  void lib.refresh()
}

const tabLabels: Record<LibraryTab, string> = {
  template: 'Templates',
  behavior: 'Behaviors',
  scene: 'Scenes',
  asset: 'Assets',
  font: 'Fonts',
}

const visibleTabs = computed<LibraryTab[]>(() => LIBRARY_TABS as LibraryTab[])

const scopeLabels: Record<LibraryScopeFilter, string> = {
  project: '📁 Project',
  global: '🌐 Global',
  all: 'All',
}

function setTab(t: LibraryTab) {
  lib.tab.value = t
}

function setScope(s: LibraryScopeFilter) {
  lib.scope.value = s
}

/**
 * Where new uploads should land. The scope toggle doubles as the
 * "save to global" switch: when the user is filtering to `Global`,
 * dropped files go to the shared pool; otherwise they land in the
 * current project library. `All` defaults to project.
 */
const uploadTarget = computed<'project' | 'global'>(() =>
  lib.scope.value === 'global' ? 'global' : 'project'
)

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
  uploads.uploadFiles(Array.from(files), { target: uploadTarget.value })
}

// ─── Promote (project → global) ───────────────────────────────────────────
//
// The card emits `promote` for templates/behaviors/scenes that came from a
// standalone JSON file inside the project library. We post to
// `/api/library/promote`, then refresh so the merged catalog reflects the
// move (the file watcher would converge within ~1s anyway, but explicit
// refresh keeps the UI in lockstep with the response).
async function onPromote(item: LibraryItem): Promise<void> {
  const key = promoteKey(item)
  if (promoting.value.has(key)) return
  promoting.value = new Set([...promoting.value, key])
  let res: Response
  try {
    res = await fetch('/api/library/promote', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-inertia': 'false' },
      body: JSON.stringify({ kind: item.kind, id: item.id }),
    })
  } catch (err) {
    promoting.value = removeKey(promoting.value, key)
    toasts.error(`Promote failed: ${(err as Error).message}`, {
      dedupeKey: `library:promote:${key}`,
    })
    return
  }
  promoting.value = removeKey(promoting.value, key)
  const body = (await res.json().catch(() => null)) as
    | { error?: { code?: string; message?: string } }
    | { kind: string; id: string; toRelative: string }
    | null
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error
    const code = err?.code
    if (code === 'E_TARGET_EXISTS') {
      const proceed = window.confirm(
        `Global library already has "${item.id}". Overwrite the existing global copy with the project version?`,
      )
      if (proceed) await retryPromoteForced(item)
      return
    }
    toasts.error(err?.message ?? `Promote failed (HTTP ${res.status})`, {
      dedupeKey: `library:promote:${key}`,
    })
    return
  }
  toasts.success(`Promoted ${item.kind} "${item.id}" to global library`, {
    dedupeKey: `library:promote:${key}:ok`,
  })
  await lib.refresh()
}

async function retryPromoteForced(item: LibraryItem): Promise<void> {
  const key = promoteKey(item)
  promoting.value = new Set([...promoting.value, key])
  let res: Response
  try {
    res = await fetch('/api/library/promote', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-inertia': 'false' },
      body: JSON.stringify({ kind: item.kind, id: item.id, force: true }),
    })
  } catch (err) {
    promoting.value = removeKey(promoting.value, key)
    toasts.error(`Promote failed: ${(err as Error).message}`, {
      dedupeKey: `library:promote:${key}`,
    })
    return
  }
  promoting.value = removeKey(promoting.value, key)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string }
    } | null
    toasts.error(body?.error?.message ?? `Promote failed (HTTP ${res.status})`, {
      dedupeKey: `library:promote:${key}`,
    })
    return
  }
  toasts.success(`Promoted ${item.kind} "${item.id}" to global library (overwrote)`, {
    dedupeKey: `library:promote:${key}:ok`,
  })
  await lib.refresh()
}

function removeKey(set: Set<string>, key: string): Set<string> {
  const next = new Set(set)
  next.delete(key)
  return next
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
      <button
        type="button"
        class="new-def-btn"
        title="Save a new template, behavior, or scene"
        data-testid="library-new-definition"
        @click="openSaveDialog"
      >
        + New
      </button>
    </div>

    <nav
      class="scope-tabs"
      role="tablist"
      aria-label="Library scope"
      data-testid="library-scope-tabs"
    >
      <button
        v-for="s in LIBRARY_SCOPES"
        :key="s"
        type="button"
        role="tab"
        :aria-selected="lib.scope.value === s"
        :data-scope="s"
        :data-active="lib.scope.value === s ? 'true' : 'false'"
        class="scope-pill"
        @click="setScope(s)"
      >
        {{ scopeLabels[s] }}
      </button>
      <span class="scope-spacer" />
      <span
        v-if="uploadTarget === 'global'"
        class="scope-hint"
        data-testid="library-upload-hint"
        :title="`Drops upload to ~/.davidup/library`"
      >
        ⤓ to 🌐 global
      </span>
    </nav>

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
        :key="`${item.kind}:${item.id}:${item.scope}:${item.source}`"
        :item="item"
        :generation="lib.generation.value"
        :promote-busy="promoting.has(`${item.kind}::${item.id}`)"
        :asset-usage="usageFor(item)"
        @promote="onPromote"
        @apply="onApply"
        @remove="onRemoveAsset"
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

    <SaveDefinitionDialog
      :open="saveDialogOpen"
      :kind="saveDialogKind"
      :initial-target="saveDialogTarget"
      @close="saveDialogOpen = false"
      @saved="onDefinitionSaved"
    />
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

.new-def-btn {
  flex: 0 0 auto;
  height: 28px;
  background: rgba(91, 124, 250, 0.16);
  border: 1px solid rgba(91, 124, 250, 0.4);
  color: #c9d4ff;
  border-radius: 4px;
  padding: 0 10px;
  font-size: 12px;
  letter-spacing: 0.02em;
  cursor: pointer;
  line-height: 1;
  white-space: nowrap;
}

.new-def-btn:hover {
  background: rgba(91, 124, 250, 0.26);
  border-color: rgba(91, 124, 250, 0.65);
  color: #e5e5e5;
}

.scope-tabs {
  display: flex;
  gap: 4px;
  flex: 0 0 auto;
  align-items: center;
  padding: 2px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 999px;
}

.scope-pill {
  background: transparent;
  border: 1px solid transparent;
  color: #909090;
  font-size: 11px;
  letter-spacing: 0.02em;
  padding: 3px 10px;
  border-radius: 999px;
  cursor: pointer;
  font-family: inherit;
  line-height: 1.4;
}

.scope-pill:hover {
  color: #e5e5e5;
}

.scope-pill[data-active='true'] {
  color: #e5e5e5;
  background: rgba(91, 124, 250, 0.18);
  border-color: rgba(91, 124, 250, 0.4);
}

.scope-spacer {
  flex: 1 1 auto;
}

.scope-hint {
  font-size: 10px;
  color: #ffb86b;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  padding-right: 8px;
  letter-spacing: 0.04em;
  white-space: nowrap;
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
