<script setup lang="ts">
// Three-panel editor shell — step 08 of the editor build plan.
//
// CSS-grid layout matching the v1.0 mockup:
//
//   ┌───────────────────────────────────────────┐
//   │             App-bar (top, 32px)           │
//   ├──────────┬─────────────────────┬──────────┤
//   │ Library  │       Stage         │Inspector │
//   │ (left)   │     (center)        │ (right)  │
//   ├──────────┴─────────────────────┴──────────┤
//   │                Timeline (bottom)          │
//   └───────────────────────────────────────────┘
//
// Sizing comes from `usePanelLayout()`, which hydrates from and persists to
// `~/.davidup/state.json` via `/api/editor-state`. Resize handles are
// pointer-driven; no external dependency.
//
// The shell renders four named slots (`library`, `stage`, `inspector`,
// `timeline`) and ships with placeholder copy in each. Real panel content
// arrives in steps 09 (Inspector), 10 (Timeline), 13 (Library); the stage
// canvas mounts in step 05's existing page using the `stage` slot.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { router } from '@inertiajs/vue3'
import { usePanelLayout, type PanelKey } from '~/composables/usePanelLayout'
import RenderStrip from '~/components/RenderStrip.vue'

const props = defineProps<{
  status?: string | null
  statusError?: string | null
  projectRoot?: string | null
  pending?: boolean
  commandError?: string | null
  undoStackSize?: number
  redoStackSize?: number
}>()

const emit = defineEmits<{
  (event: 'undo'): void
  (event: 'redo'): void
}>()

const canUndo = computed<boolean>(() => (props.undoStackSize ?? 0) > 0)
const canRedo = computed<boolean>(() => (props.redoStackSize ?? 0) > 0)

const isMacPlatform = computed<boolean>(() => {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '')
})

const undoTitle = computed<string>(() => {
  const mod = isMacPlatform.value ? '⌘' : 'Ctrl+'
  return canUndo.value ? `Undo (${mod}Z)` : 'Nothing to undo'
})

const redoTitle = computed<string>(() => {
  const mod = isMacPlatform.value ? '⌘⇧' : 'Ctrl+Shift+'
  return canRedo.value ? `Redo (${mod}Z)` : 'Nothing to redo'
})

function onUndo(): void {
  if (!canUndo.value) return
  emit('undo')
}

function onRedo(): void {
  if (!canRedo.value) return
  emit('redo')
}

const panel = usePanelLayout()

function startDrag(event: PointerEvent, p: PanelKey) {
  panel.beginDrag({ event, panel: p })
}

// ─── Step 20.13: top app-bar with project switcher ────────────────────────
interface RecentProject {
  path: string
  name: string
  lastOpenedAt: number
}

const projectName = computed<string>(() => {
  if (!props.projectRoot) return 'No project'
  const root = props.projectRoot.replace(/[\\/]+$/, '')
  const i = Math.max(root.lastIndexOf('/'), root.lastIndexOf('\\'))
  return i >= 0 ? root.slice(i + 1) : root
})

const saveStatus = computed<{ label: string; tone: 'idle' | 'saving' | 'error' | 'saved' }>(() => {
  if (!props.projectRoot) return { label: '', tone: 'idle' }
  if (props.commandError) return { label: 'Error', tone: 'error' }
  if (props.pending) return { label: 'Saving…', tone: 'saving' }
  return { label: 'Saved', tone: 'saved' }
})

const dropdownOpen = ref(false)
const recents = ref<RecentProject[]>([])
const recentsBusy = ref(false)
const switchingTo = ref<string | null>(null)
const switchError = ref<string | null>(null)
const dropdownRoot = ref<HTMLElement | null>(null)

async function fetchRecents(): Promise<void> {
  recentsBusy.value = true
  try {
    const res = await fetch('/api/projects/recent', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return
    const body = (await res.json()) as { projects?: RecentProject[] }
    recents.value = Array.isArray(body?.projects) ? body.projects : []
  } catch {
    /* leave the prior list in place */
  } finally {
    recentsBusy.value = false
  }
}

async function toggleDropdown(): Promise<void> {
  if (dropdownOpen.value) {
    dropdownOpen.value = false
    return
  }
  dropdownOpen.value = true
  switchError.value = null
  await fetchRecents()
}

function closeDropdown(): void {
  dropdownOpen.value = false
}

async function openRecent(project: RecentProject): Promise<void> {
  if (switchingTo.value) return
  // The currently-open project is already loaded — don't round-trip the server.
  if (props.projectRoot && project.path === props.projectRoot) {
    closeDropdown()
    return
  }
  switchingTo.value = project.path
  switchError.value = null
  try {
    const res = await fetch('/api/project', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-inertia': 'false' },
      body: JSON.stringify({ directory: project.path }),
    })
    if (!res.ok) {
      const text = await res.text()
      let msg = `HTTP ${res.status}`
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } }
        msg = parsed?.error?.message ?? msg
      } catch {
        /* not JSON */
      }
      switchError.value = msg
      return
    }
    // The SSE listener in pages/editor.vue will router.reload() on the
    // `changed` broadcast — but reload here too so the user gets immediate
    // feedback even if the broadcast races.
    closeDropdown()
    router.reload()
  } catch (err) {
    switchError.value = (err as Error).message ?? String(err)
  } finally {
    switchingTo.value = null
  }
}

function openAnother(): void {
  closeDropdown()
  router.visit('/')
}

function onHelp(): void {
  // 20.21 will wire a real overlay. Until then, emit a window event so the
  // future HelpOverlay component can subscribe without a layout-level coupling.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('davidup:toggle-help'))
  }
}

function onCompositionSettings(): void {
  // The dialog itself lives in pages/editor.vue where the command bus is
  // wired up. The layout just signals the request — keeps this shell free
  // of composition-state coupling.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('davidup:toggle-composition-settings'))
  }
}

function onDocClick(event: MouseEvent): void {
  if (!dropdownOpen.value) return
  const root = dropdownRoot.value
  if (root && event.target instanceof Node && root.contains(event.target)) return
  closeDropdown()
}

function onDocKey(event: KeyboardEvent): void {
  if (event.key === 'Escape' && dropdownOpen.value) closeDropdown()
}

function formatRelative(ts: number): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  const mins = Math.round(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('mousedown', onDocClick)
    window.addEventListener('keydown', onDocKey)
  }
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('mousedown', onDocClick)
    window.removeEventListener('keydown', onDocKey)
  }
})

// Close the dropdown if the project switches under us (e.g. via SSE reload).
watch(
  () => props.projectRoot,
  () => closeDropdown()
)
</script>

<template>
  <div
    class="editor-shell"
    :data-dragging="panel.isDragging.value ? 'true' : 'false'"
    :style="{
      gridTemplateColumns: panel.gridTemplateColumns.value,
      // `panel.gridTemplateRows` describes the resizable rows below the
      // app-bar (stage | handle | timeline). Prepend the fixed 32px app-bar
      // row and append the 24px status-bar row so the inline style matches
      // `grid-template-areas` in CSS.
      gridTemplateRows: `32px ${panel.gridTemplateRows.value} 24px`,
    }"
  >
    <header class="app-bar" data-testid="app-bar">
      <div class="app-bar-left">
        <div ref="dropdownRoot" class="project-switcher">
          <button
            type="button"
            class="project-switcher-btn"
            data-testid="project-switcher-btn"
            :aria-expanded="dropdownOpen ? 'true' : 'false'"
            aria-haspopup="menu"
            :title="projectRoot ?? ''"
            @click="toggleDropdown"
          >
            <span class="project-brand" aria-hidden="true">davidup</span>
            <span class="project-divider" aria-hidden="true">/</span>
            <span class="project-name">{{ projectName }}</span>
            <svg
              class="chevron"
              :class="{ open: dropdownOpen }"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          <div
            v-if="dropdownOpen"
            class="project-menu"
            role="menu"
            data-testid="project-menu"
          >
            <div class="project-menu-head">
              <span>Recent projects</span>
              <span v-if="recentsBusy" class="project-menu-spinner" aria-hidden="true">…</span>
            </div>
            <ul v-if="recents.length > 0" class="project-menu-list">
              <li
                v-for="(p, idx) in recents"
                :key="p.path"
                class="project-menu-item"
                :class="{ active: projectRoot === p.path, busy: switchingTo === p.path }"
                role="menuitem"
                tabindex="0"
                :data-testid="`project-menu-item-${idx}`"
                @click="openRecent(p)"
                @keydown.enter.prevent="openRecent(p)"
                @keydown.space.prevent="openRecent(p)"
              >
                <span class="project-menu-name">{{ p.name }}</span>
                <span class="project-menu-meta">
                  <span class="project-menu-time">{{ formatRelative(p.lastOpenedAt) }}</span>
                  <span v-if="projectRoot === p.path" class="project-menu-active-dot" aria-label="current">●</span>
                </span>
                <span class="project-menu-path">{{ p.path }}</span>
              </li>
            </ul>
            <p v-else-if="!recentsBusy" class="project-menu-empty">No recent projects.</p>

            <p v-if="switchError" class="project-menu-error" role="alert">{{ switchError }}</p>

            <button
              type="button"
              class="project-menu-other"
              data-testid="project-menu-open-another"
              @click="openAnother"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
              </svg>
              Open another…
            </button>
          </div>
        </div>
      </div>

      <div class="app-bar-center" data-testid="app-bar-save-status">
        <div class="history-group" data-testid="history-group">
          <button
            type="button"
            class="history-btn"
            data-testid="undo-btn"
            :title="undoTitle"
            :aria-label="undoTitle"
            :disabled="!canUndo"
            @click="onUndo"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 7v6h6" />
              <path d="M21 17a8 8 0 0 0-8-8H3" />
            </svg>
          </button>
          <button
            type="button"
            class="history-btn"
            data-testid="redo-btn"
            :title="redoTitle"
            :aria-label="redoTitle"
            :disabled="!canRedo"
            @click="onRedo"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21 7v6h-6" />
              <path d="M3 17a8 8 0 0 1 8-8h10" />
            </svg>
          </button>
        </div>
        <span v-if="saveStatus.label" class="save-status" :data-tone="saveStatus.tone">
          <span class="save-status-dot" aria-hidden="true" />
          {{ saveStatus.label }}
        </span>
      </div>

      <div class="app-bar-right">
        <div class="app-bar-render">
          <RenderStrip />
        </div>
        <button
          type="button"
          class="comp-settings-btn"
          title="Composition settings (width, height, fps, duration, background)"
          aria-label="Composition settings"
          data-testid="composition-settings-btn"
          :disabled="!projectRoot"
          @click="onCompositionSettings"
        >
          <span class="comp-settings-gear" aria-hidden="true">⚙</span>
          <span class="comp-settings-label">Composition</span>
        </button>
        <button
          type="button"
          class="help-btn"
          title="Help (shortcuts, drag-and-drop, MCP cheat-sheet)"
          aria-label="Help"
          data-testid="help-btn"
          @click="onHelp"
        >
          ?
        </button>
      </div>
    </header>

    <aside class="panel panel-library" data-panel="library">
      <header class="panel-header">Library</header>
      <div class="panel-body">
        <slot name="library">
          <p class="placeholder">Library panel — templates, behaviors, scenes, assets.</p>
        </slot>
      </div>
    </aside>

    <div
      class="resize-handle resize-handle-vertical"
      data-handle="left"
      title="Drag to resize the Library panel"
      @pointerdown="(e) => startDrag(e, 'leftWidth')"
    />

    <main class="panel panel-stage" data-panel="stage">
      <div class="stage-canvas-wrap">
        <slot name="stage">
          <p class="placeholder">Stage</p>
        </slot>
      </div>
      <div v-if="status" class="stage-status" :data-status="status">
        <span>{{ status }}</span>
        <span v-if="statusError"> · {{ statusError }}</span>
        <span v-if="projectRoot" class="stage-status-project">· {{ projectRoot }}</span>
      </div>
    </main>

    <div
      class="resize-handle resize-handle-vertical"
      data-handle="right"
      title="Drag to resize the Inspector panel"
      @pointerdown="(e) => startDrag(e, 'rightWidth')"
    />

    <aside class="panel panel-inspector" data-panel="inspector">
      <header class="panel-header">Inspector</header>
      <div class="panel-body">
        <slot name="inspector">
          <p class="placeholder">Inspector panel — typed parameters for the selected item.</p>
        </slot>
      </div>
    </aside>

    <div
      class="resize-handle resize-handle-horizontal"
      data-handle="bottom"
      title="Drag to resize the Timeline panel"
      @pointerdown="(e) => startDrag(e, 'bottomHeight')"
    />

    <section class="panel panel-timeline" data-panel="timeline">
      <header class="panel-header">Timeline</header>
      <div class="panel-body">
        <slot name="timeline">
          <p class="placeholder">Timeline panel — tween bars, ruler, playhead.</p>
        </slot>
      </div>
    </section>

    <div class="panel-statusbar" data-panel="statusbar">
      <slot name="statusbar" />
    </div>
  </div>
</template>

<style scoped>
.editor-shell {
  position: fixed;
  inset: 0;
  display: grid;
  background: #0a0a0a;
  color: #e5e5e5;
  font-family: 'Instrument Sans', system-ui, sans-serif;
  /* Rows: [app-bar 32px] | [stage row] | [handle] | [timeline] | [status 24px] */
  grid-template-areas:
    'appbar appbar appbar appbar appbar'
    'library handle-left stage handle-right inspector'
    'handle-bottom handle-bottom handle-bottom handle-bottom handle-bottom'
    'timeline timeline timeline timeline timeline'
    'statusbar statusbar statusbar statusbar statusbar';
  grid-template-columns: 280px 6px 1fr 6px 320px;
  grid-template-rows: 32px 1fr 6px 220px 24px;
  overflow: hidden;
}

.editor-shell[data-dragging='true'] {
  cursor: grabbing;
}

.app-bar {
  grid-area: appbar;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 0 10px;
  height: 32px;
  background: #0d0d0d;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  font-size: 12px;
  z-index: 30;
  position: relative;
}

.app-bar-left {
  display: flex;
  align-items: center;
  min-width: 0;
}

.app-bar-center {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.history-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 2px;
}

.history-btn {
  appearance: none;
  background: transparent;
  border: none;
  color: #d4d4d4;
  width: 24px;
  height: 22px;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 120ms ease, color 120ms ease;
  padding: 0;
}

.history-btn:hover:not(:disabled) {
  background: rgba(91, 124, 250, 0.16);
  color: #e7ecff;
}

.history-btn:disabled {
  color: #555;
  cursor: default;
}

.app-bar-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
}

.app-bar-render {
  display: flex;
  align-items: center;
  min-width: 0;
  max-width: 100%;
}

.project-switcher {
  position: relative;
  display: inline-flex;
}

.project-switcher-btn {
  appearance: none;
  background: transparent;
  border: 1px solid transparent;
  color: #e5e5e5;
  font: inherit;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
  max-width: 360px;
  min-width: 0;
}

.project-switcher-btn:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.08);
}

.project-switcher-btn[aria-expanded='true'] {
  background: rgba(91, 124, 250, 0.12);
  border-color: rgba(91, 124, 250, 0.4);
}

.project-brand {
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #5b7cfa;
  font-weight: 600;
  flex: 0 0 auto;
}

.project-divider {
  color: #5a5a5a;
  flex: 0 0 auto;
}

.project-name {
  font-weight: 500;
  color: #f0f0f0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
}

.chevron {
  color: #909090;
  transition: transform 140ms ease;
  flex: 0 0 auto;
}

.chevron.open {
  transform: rotate(180deg);
}

.project-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 320px;
  max-width: 480px;
  background: #131313;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  padding: 6px 6px 8px;
  z-index: 40;
}

.project-menu-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #909090;
  padding: 6px 10px 4px;
}

.project-menu-spinner {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  color: #707070;
}

.project-menu-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  max-height: 320px;
  overflow-y: auto;
}

.project-menu-item {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 0 8px;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 120ms ease;
}

.project-menu-item:hover,
.project-menu-item:focus-visible {
  background: rgba(91, 124, 250, 0.1);
  outline: none;
}

.project-menu-item.active {
  background: rgba(91, 124, 250, 0.16);
}

.project-menu-item.busy {
  opacity: 0.6;
  cursor: progress;
}

.project-menu-name {
  font-size: 13px;
  color: #f0f0f0;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  grid-column: 1;
  grid-row: 1;
}

.project-menu-meta {
  font-size: 11px;
  color: #909090;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  grid-column: 2;
  grid-row: 1;
}

.project-menu-time {
  font-feature-settings: 'tnum';
}

.project-menu-active-dot {
  color: #5b7cfa;
  font-size: 8px;
  line-height: 1;
}

.project-menu-path {
  font-size: 10.5px;
  color: #707070;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  grid-column: 1 / span 2;
  grid-row: 2;
}

.project-menu-empty {
  color: #707070;
  font-size: 12px;
  padding: 8px 10px 4px;
  margin: 0;
}

.project-menu-error {
  color: #ff6b6b;
  font-size: 11px;
  padding: 4px 10px;
  margin: 4px 0 0;
}

.project-menu-other {
  margin-top: 6px;
  width: 100%;
  appearance: none;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #c8d2ff;
  font: inherit;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  transition: background 120ms ease, border-color 120ms ease;
}

.project-menu-other:hover {
  background: rgba(91, 124, 250, 0.12);
  border-color: rgba(91, 124, 250, 0.45);
}

.save-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #909090;
  font-feature-settings: 'tnum';
  letter-spacing: 0.02em;
}

.save-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  display: inline-block;
}

.save-status[data-tone='saving'] {
  color: #f4c66e;
}
.save-status[data-tone='saving'] .save-status-dot {
  animation: save-pulse 1.1s ease-in-out infinite;
}

.save-status[data-tone='saved'] {
  color: #7fcb9a;
}

.save-status[data-tone='error'] {
  color: #ff8a8a;
}

@keyframes save-pulse {
  0%, 100% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
}

.help-btn {
  appearance: none;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #c8d2ff;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font: inherit;
  font-weight: 600;
  font-size: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
  flex: 0 0 auto;
}

.help-btn:hover {
  background: rgba(91, 124, 250, 0.15);
  border-color: rgba(91, 124, 250, 0.5);
  color: #e7ecff;
}

.comp-settings-btn {
  appearance: none;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #d4d4d4;
  height: 22px;
  border-radius: 6px;
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
  flex: 0 0 auto;
}

.comp-settings-btn:hover:not(:disabled) {
  background: rgba(91, 124, 250, 0.15);
  border-color: rgba(91, 124, 250, 0.5);
  color: #e7ecff;
}

.comp-settings-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.comp-settings-gear {
  font-size: 13px;
  line-height: 1;
}

.comp-settings-label {
  font-size: 11.5px;
  letter-spacing: 0.02em;
}

.panel {
  background: #111;
  border: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.panel-library {
  grid-area: library;
}
.panel-stage {
  grid-area: stage;
  background: #0a0a0a;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
}

.stage-canvas-wrap {
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  position: relative;
}
.panel-inspector {
  grid-area: inspector;
}
.panel-timeline {
  grid-area: timeline;
}
.panel-statusbar {
  grid-area: statusbar;
  display: flex;
  min-width: 0;
  min-height: 0;
  position: relative;
}
.panel-statusbar > * {
  flex: 1 1 auto;
  min-width: 0;
}

.panel-header {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #a3a3a3;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  flex: 0 0 auto;
}

.panel-body {
  flex: 1 1 auto;
  overflow: auto;
  padding: 12px;
}

.placeholder {
  color: #707070;
  font-size: 13px;
  margin: 0;
}

.resize-handle {
  background: transparent;
  position: relative;
  z-index: 2;
}

.resize-handle::after {
  content: '';
  position: absolute;
  background: rgba(255, 255, 255, 0.04);
  transition: background 120ms ease;
}

.resize-handle:hover::after,
.editor-shell[data-dragging='true'] .resize-handle::after {
  background: rgba(91, 124, 250, 0.45);
}

.resize-handle-vertical {
  cursor: col-resize;
}

.resize-handle-vertical[data-handle='left'] {
  grid-area: handle-left;
}

.resize-handle-vertical[data-handle='right'] {
  grid-area: handle-right;
}

.resize-handle-vertical::after {
  inset: 0 2px;
}

.resize-handle-horizontal {
  grid-area: handle-bottom;
  cursor: row-resize;
}

.resize-handle-horizontal::after {
  inset: 2px 0;
}

.stage-status {
  position: absolute;
  bottom: 12px;
  left: 12px;
  font-size: 12px;
  color: #a3a3a3;
  background: rgba(0, 0, 0, 0.55);
  padding: 4px 8px;
  border-radius: 4px;
  pointer-events: none;
  font-feature-settings: 'tnum';
}

.stage-status[data-status='error'] {
  color: #ff6b6b;
}

.stage-status-project {
  margin-left: 8px;
  opacity: 0.7;
}
</style>
