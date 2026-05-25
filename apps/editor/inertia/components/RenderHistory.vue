<script setup lang="ts">
// RenderHistory — polish_plan §20.28.
//
// Collapsible list of past renders inside the RenderStrip. Reads the
// server's `<project>/renders/` directory via GET /api/renders/files so
// entries persist across editor sessions (the in-memory `useRender.history`
// only covers the current page load). Each row exposes:
//
//   • Filename + relative size + relative mtime
//   • A direct video link (opens in a new tab)
//   • "Reveal in Finder" → POST /api/renders/shell { action: 'reveal' }
//   • "Play in QuickTime" → POST /api/renders/shell { action: 'play' }
//
// Shell actions are macOS-only (the server short-circuits on other
// platforms); the buttons stay visible but the toast will surface the
// platform error if invoked from non-darwin.

import { computed, onMounted, ref, watch } from 'vue'
import { useRender } from '~/composables/useRender'
import { useToasts } from '~/composables/useToasts'

interface RenderFile {
  filename: string
  relativePath: string
  sizeBytes: number
  modifiedAt: number
}

const render = useRender()
const toasts = useToasts()

const expanded = ref<boolean>(false)
const files = ref<RenderFile[]>([])
const isLoading = ref<boolean>(false)
const loadError = ref<string | null>(null)

// UX_GAPS §O — bulk-delete + rename.
const selected = ref<Set<string>>(new Set())
const renameTarget = ref<string | null>(null)
const renameInput = ref<string>('')

async function refresh(): Promise<void> {
  isLoading.value = true
  loadError.value = null
  try {
    const res = await fetch('/api/renders/files', { credentials: 'same-origin' })
    if (!res.ok) {
      let detail: string | null = null
      try {
        const body = (await res.json()) as { error?: { message?: string } }
        detail = body.error?.message ?? null
      } catch {
        // ignore
      }
      loadError.value = detail ?? `Failed to list renders (${res.status})`
      files.value = []
      return
    }
    const body = (await res.json()) as { files: RenderFile[] }
    files.value = body.files ?? []
  } catch (err) {
    loadError.value = (err as Error).message || 'Network error'
    files.value = []
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  void refresh()
})

// Refresh the list whenever a render finishes so a brand-new file shows up.
watch(
  () => render.current.value?.status,
  (status, prev) => {
    if (status === 'done' && prev !== 'done') {
      void refresh()
    }
  }
)

function toggle(): void {
  expanded.value = !expanded.value
  if (expanded.value) void refresh()
}

const count = computed<number>(() => files.value.length)
const buttonLabel = computed<string>(() =>
  count.value > 0 ? `History · ${count.value}` : 'History'
)

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 0) return 'just now'
  const s = Math.round(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ms).toLocaleDateString()
}

function isSelected(name: string): boolean {
  return selected.value.has(name)
}

function toggleSelected(name: string): void {
  const next = new Set(selected.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  selected.value = next
}

function clearSelection(): void {
  selected.value = new Set()
}

const selectedCount = computed<number>(() => selected.value.size)

async function deleteSelected(): Promise<void> {
  const names = Array.from(selected.value)
  if (names.length === 0) return
  const ok =
    typeof window === 'undefined' ||
    window.confirm(
      `Delete ${names.length} render${names.length === 1 ? '' : 's'}? This removes the .mp4 file${names.length === 1 ? '' : 's'} from disk.`,
    )
  if (!ok) return
  try {
    const res = await fetch('/api/renders/delete', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filenames: names }),
    })
    if (!res.ok) {
      let detail = `Delete failed (${res.status})`
      try {
        const body = (await res.json()) as { error?: { message?: string } }
        detail = body.error?.message ?? detail
      } catch {
        /* ignore */
      }
      toasts.error('Delete failed', { message: detail })
      return
    }
    const body = (await res.json()) as { deleted: string[]; skipped: Array<{ filename: string; reason: string }> }
    clearSelection()
    await refresh()
    if (body.skipped.length > 0) {
      toasts.error(`Some renders weren't deleted (${body.skipped.length})`, {
        message: body.skipped.map((s) => `${s.filename}: ${s.reason}`).join('\n'),
      })
    } else {
      toasts.success(`Deleted ${body.deleted.length} render${body.deleted.length === 1 ? '' : 's'}`)
    }
  } catch (err) {
    toasts.error('Delete failed', { message: (err as Error).message || 'Network error' })
  }
}

function beginRename(name: string): void {
  renameTarget.value = name
  // Strip .mp4 so the user only edits the meaningful basename.
  renameInput.value = name.replace(/\.mp4$/i, '')
}

function cancelRename(): void {
  renameTarget.value = null
  renameInput.value = ''
}

async function commitRename(): Promise<void> {
  const from = renameTarget.value
  const next = renameInput.value.trim()
  if (!from) return
  if (!next || next === from || next === from.replace(/\.mp4$/i, '')) {
    cancelRename()
    return
  }
  try {
    const res = await fetch('/api/renders/rename', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: from, newFilename: next }),
    })
    if (!res.ok) {
      let detail = `Rename failed (${res.status})`
      try {
        const body = (await res.json()) as { error?: { message?: string } }
        detail = body.error?.message ?? detail
      } catch {
        /* ignore */
      }
      toasts.error('Rename failed', { message: detail })
      return
    }
    const body = (await res.json()) as { filename: string }
    cancelRename()
    await refresh()
    toasts.success(`Renamed to ${body.filename}`)
  } catch (err) {
    toasts.error('Rename failed', { message: (err as Error).message || 'Network error' })
  }
}

async function doShell(filename: string, action: 'reveal' | 'play'): Promise<void> {
  try {
    const res = await fetch('/api/renders/shell', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, action }),
    })
    if (!res.ok) {
      let msg = `Request failed (${res.status})`
      try {
        const body = (await res.json()) as { error?: { message?: string } }
        msg = body.error?.message ?? msg
      } catch {
        // ignore
      }
      toasts.error(action === 'reveal' ? 'Reveal failed' : 'Play failed', { message: msg })
    }
  } catch (err) {
    toasts.error(action === 'reveal' ? 'Reveal failed' : 'Play failed', {
      message: (err as Error).message || 'Network error',
    })
  }
}
</script>

<template>
  <div class="render-history" data-testid="render-history">
    <button
      type="button"
      class="history-toggle"
      :aria-expanded="expanded"
      :data-expanded="expanded"
      data-testid="render-history-toggle"
      :title="expanded ? 'Hide past renders' : 'Show past renders'"
      @click="toggle"
    >
      <span class="caret" aria-hidden="true">{{ expanded ? '▾' : '▸' }}</span>
      <span class="history-label">{{ buttonLabel }}</span>
    </button>

    <div
      v-if="expanded"
      class="history-panel"
      role="region"
      aria-label="Past renders"
      data-testid="render-history-panel"
    >
      <div v-if="isLoading && files.length === 0" class="history-empty">Loading…</div>
      <div v-else-if="loadError" class="history-error" data-testid="render-history-error">
        {{ loadError }}
      </div>
      <div v-else-if="files.length === 0" class="history-empty" data-testid="render-history-empty">
        No renders yet.
      </div>
      <div
        v-if="selectedCount > 0"
        class="bulk-bar"
        data-testid="render-history-bulk"
      >
        <span class="bulk-label">
          {{ selectedCount }} selected
        </span>
        <button
          type="button"
          class="row-btn"
          data-testid="render-history-bulk-clear"
          @click="clearSelection"
        >Clear</button>
        <button
          type="button"
          class="row-btn row-btn-delete"
          data-testid="render-history-bulk-delete"
          @click="deleteSelected"
        >Delete</button>
      </div>
      <ul v-if="files.length > 0" class="history-list" data-testid="render-history-list">
        <li
          v-for="file in files"
          :key="file.filename"
          class="history-row"
          :class="{ selected: isSelected(file.filename), 'is-renaming': renameTarget === file.filename }"
          :data-testid="`render-history-row-${file.filename}`"
        >
          <input
            type="checkbox"
            class="row-check"
            :checked="isSelected(file.filename)"
            :data-testid="`render-history-check-${file.filename}`"
            :aria-label="`Select ${file.filename}`"
            @change="toggleSelected(file.filename)"
          />
          <div class="row-main">
            <template v-if="renameTarget === file.filename">
              <input
                v-model="renameInput"
                type="text"
                spellcheck="false"
                class="row-rename-input"
                :data-testid="`render-history-rename-input-${file.filename}`"
                @keydown.enter.prevent="commitRename"
                @keydown.esc.prevent="cancelRename"
              />
              <span class="row-meta">
                {{ formatSize(file.sizeBytes) }} · {{ formatRelative(file.modifiedAt) }}
              </span>
            </template>
            <template v-else>
              <a
                :href="`/project-renders/${file.filename}`"
                target="_blank"
                rel="noopener"
                class="row-name"
                :title="file.relativePath"
                data-testid="render-history-link"
              >
                {{ file.filename }}
              </a>
              <span class="row-meta">
                {{ formatSize(file.sizeBytes) }} · {{ formatRelative(file.modifiedAt) }}
              </span>
            </template>
          </div>
          <div class="row-actions">
            <template v-if="renameTarget === file.filename">
              <button
                type="button"
                class="row-btn"
                :data-testid="`render-history-rename-cancel-${file.filename}`"
                @click="cancelRename"
              >Cancel</button>
              <button
                type="button"
                class="row-btn row-btn-play"
                :data-testid="`render-history-rename-save-${file.filename}`"
                @click="commitRename"
              >Save</button>
            </template>
            <template v-else>
              <button
                type="button"
                class="row-btn"
                :data-testid="`render-history-rename-${file.filename}`"
                title="Rename"
                @click="beginRename(file.filename)"
              >Rename</button>
              <button
                type="button"
                class="row-btn"
                data-testid="render-history-reveal"
                title="Reveal in Finder"
                @click="doShell(file.filename, 'reveal')"
              >Reveal</button>
              <button
                type="button"
                class="row-btn row-btn-play"
                data-testid="render-history-play"
                title="Play in QuickTime"
                @click="doShell(file.filename, 'play')"
              >Play</button>
            </template>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.render-history {
  position: relative;
  flex: 0 0 auto;
  font-family: 'Instrument Sans', system-ui, sans-serif;
}

.history-toggle {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: #d4d4d4;
  padding: 5px 9px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
  font-family: inherit;
}

.history-toggle:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
  color: #f0f0f0;
}

.history-toggle[data-expanded='true'] {
  background: rgba(91, 220, 130, 0.1);
  border-color: rgba(91, 220, 130, 0.3);
  color: #d8efd8;
}

.caret {
  font-size: 9px;
  color: #a0a0a0;
}

.history-toggle[data-expanded='true'] .caret {
  color: #8bd6a5;
}

.history-label {
  font-feature-settings: 'tnum';
}

.history-panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 50;
  width: 360px;
  max-height: 360px;
  overflow-y: auto;
  background: rgba(18, 18, 18, 0.97);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.5);
  padding: 6px;
  backdrop-filter: blur(10px);
}

.history-empty,
.history-error {
  font-size: 11px;
  color: #909090;
  padding: 12px;
  text-align: center;
}

.history-error {
  color: #ff8b8b;
}

.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.history-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.02);
}

.history-row:hover {
  background: rgba(255, 255, 255, 0.06);
}

.row-main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.row-name {
  color: #e0e0e0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-name:hover {
  color: #c8f3d2;
  text-decoration: underline;
  text-decoration-color: rgba(91, 220, 130, 0.5);
  text-underline-offset: 2px;
}

.row-meta {
  font-size: 10px;
  color: #909090;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-feature-settings: 'tnum';
}

.row-actions {
  display: flex;
  gap: 4px;
  flex: 0 0 auto;
}

.row-btn {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.05);
  color: #d4d4d4;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition: background 100ms ease, border-color 100ms ease, color 100ms ease;
}

.row-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.25);
  color: #f0f0f0;
}

.row-btn-play:hover {
  background: rgba(91, 220, 130, 0.15);
  border-color: rgba(91, 220, 130, 0.5);
  color: #c8f3d2;
}

.row-btn-delete {
  border-color: rgba(255, 107, 107, 0.35);
  color: #ffb4b4;
}

.row-btn-delete:hover {
  background: rgba(255, 107, 107, 0.2);
  border-color: rgba(255, 107, 107, 0.7);
  color: #ffffff;
}

.bulk-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  margin-bottom: 4px;
  background: rgba(91, 124, 250, 0.08);
  border: 1px solid rgba(91, 124, 250, 0.4);
  border-radius: 5px;
}

.bulk-label {
  flex: 1 1 auto;
  font-size: 11px;
  color: #aab7ff;
  font-feature-settings: 'tnum';
}

.row-check {
  flex: 0 0 auto;
  cursor: pointer;
  accent-color: #5b7cfa;
  margin: 0;
}

.history-row.selected {
  background: rgba(91, 124, 250, 0.12);
  outline: 1px solid rgba(91, 124, 250, 0.42);
}

.history-row.is-renaming {
  background: rgba(91, 124, 250, 0.08);
}

.row-rename-input {
  background: #161616;
  border: 1px solid rgba(91, 124, 250, 0.55);
  color: #e5e5e5;
  font: inherit;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  padding: 3px 6px;
  border-radius: 3px;
  width: 100%;
}

.row-rename-input:focus {
  outline: none;
  border-color: rgba(91, 124, 250, 0.85);
  box-shadow: 0 0 0 1px rgba(91, 124, 250, 0.4);
}
</style>
