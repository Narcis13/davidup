<script setup lang="ts">
// Editor page — step 10 adds the Timeline to the three-panel shell.
//
// Step 05 mounted the davidup browser driver against a single full-bleed
// canvas. Step 08 moved that canvas into the `stage` slot of the
// three-panel layout. Step 09 added the Inspector to the `inspector` slot.
// Step 10 now fills the `timeline` slot: tweens become semantic, color-
// coded bars (template / behavior / scene / plain), the ruler shows the
// composition's seconds grid, and the playhead is driven by
// `useStage().playhead` so it tracks the engine's real RAF clock.
//
// Local composition state lives in `useCommandBus` so command results
// can replace it in-place. The original payload is also retained as a
// baseline so the Inspector can render the orange "overridden" dot.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Head } from '@inertiajs/vue3'
import { useStage } from '~/composables/useStage'
import { useCommandBus, type Composition } from '~/composables/useCommandBus'
import { provideSelection } from '~/composables/useSelection'
import { useAssetUpload } from '~/composables/useAssetUpload'
import { LIBRARY_MIME } from '~/composables/useLibraryDrag'
import EditorLayout from '~/layouts/editor.vue'
import Inspector from '~/components/Inspector.vue'
import Library from '~/components/Library.vue'
import SourceDrawer from '~/components/SourceDrawer.vue'
import Stage from '~/components/Stage.vue'
import Timeline from '~/components/Timeline.vue'
import UploadToasts from '~/components/UploadToasts.vue'

interface CompositionSource {
  text: string
  file: string
  mtimeMs: number
}

const props = defineProps<{
  composition: Composition | null
  compositionSource: CompositionSource | null
  project: {
    root: string
    compositionPath: string
    libraryIndexPath: string | null
    assetsDir: string | null
    loadedAt: number
  } | null
  error: { code: string; message: string } | null
}>()

const selection = provideSelection(null)

const bus = useCommandBus({ initial: props.composition })

// Stage.vue owns the canvas element; we forward its inner ref out via
// `defineExpose` so the engine attach loop still binds to it.
const stageRef = ref<{ canvas: HTMLCanvasElement | null } | null>(null)
const canvas = computed<HTMLCanvasElement | null>(() => stageRef.value?.canvas ?? null)

const stage = useStage({ composition: bus.composition, canvas })

// ─── Step 17: reveal-in-source drawer ─────────────────────────────────────
const drawerOpen = ref(false)
const compositionSource = ref<CompositionSource | null>(props.compositionSource)

async function refetchCompositionSource(): Promise<void> {
  if (!props.project) return
  try {
    const res = await fetch('/api/composition-source', { credentials: 'same-origin' })
    if (!res.ok) return
    const json = (await res.json()) as CompositionSource
    compositionSource.value = json
  } catch {
    // Silently ignore — the drawer just shows the last known text.
  }
}

// After any successful command apply the on-disk JSON has changed; pull the
// fresh text so the drawer's line mapping reflects the latest file content.
watch(
  () => bus.composition.value,
  (next, prev) => {
    if (next === prev) return
    if (!drawerOpen.value && !compositionSource.value) return
    void refetchCompositionSource()
  }
)

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '')
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function onKeydown(event: KeyboardEvent): void {
  // ⌘J on macOS, Ctrl+J elsewhere. The shortcut wins over the browser's
  // default (Firefox: open Downloads; Chrome on macOS: no default), so we
  // only intercept when no input is focused — we don't want to swallow J
  // typed into a text field.
  const isToggle = event.key === 'j' && (isMac() ? event.metaKey : event.ctrlKey) && !event.altKey
  if (!isToggle) return
  if (isEditableTarget(event.target)) return
  event.preventDefault()
  drawerOpen.value = !drawerOpen.value
  if (drawerOpen.value) {
    // Re-fetch every time the drawer opens so its line mapping reflects any
    // edits the user made while it was closed.
    void refetchCompositionSource()
  }
}

// ─── Step 18b: window-level file drop ────────────────────────────────────
// Files dropped anywhere on the editor (outside the Library panel, which
// owns its own handler) get routed through the same upload pipeline. We
// always suppress the browser's native file-drop navigation so the page
// doesn't get replaced by the dragged image.
const uploads = useAssetUpload()
const isEditorFileDrag = ref(false)
let editorDragDepth = 0

function isFileDrag(event: DragEvent): boolean {
  const dt = event.dataTransfer
  if (!dt) return false
  const types = Array.from(dt.types ?? [])
  if (types.includes(LIBRARY_MIME)) return false
  return types.includes('Files')
}

function onWindowDragEnter(event: DragEvent): void {
  if (!isFileDrag(event)) return
  event.preventDefault()
  editorDragDepth++
  isEditorFileDrag.value = true
}

function onWindowDragOver(event: DragEvent): void {
  if (!isFileDrag(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onWindowDragLeave(event: DragEvent): void {
  if (!isFileDrag(event)) return
  editorDragDepth = Math.max(0, editorDragDepth - 1)
  if (editorDragDepth === 0) isEditorFileDrag.value = false
}

function onWindowDrop(event: DragEvent): void {
  // The drop is always over *something*. We reset state regardless of source
  // so a panel-handled drop still clears the editor-wide overlay.
  editorDragDepth = 0
  isEditorFileDrag.value = false
  if (!isFileDrag(event)) return
  // Always suppress the browser's "load this file" default; without it, a
  // missed drop on the stage opens the image in the tab and nukes the editor.
  event.preventDefault()
  // If a child handler (Library panel) already consumed this drop, it called
  // stopPropagation — so reaching this function means no descendant claimed
  // it and we're free to ingest the files ourselves.
  const files = event.dataTransfer?.files
  if (!files || files.length === 0) return
  uploads.uploadFiles(Array.from(files))
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeydown)
    window.addEventListener('dragenter', onWindowDragEnter)
    window.addEventListener('dragover', onWindowDragOver)
    window.addEventListener('dragleave', onWindowDragLeave)
    window.addEventListener('drop', onWindowDrop)
  }
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', onKeydown)
    window.removeEventListener('dragenter', onWindowDragEnter)
    window.removeEventListener('dragover', onWindowDragOver)
    window.removeEventListener('dragleave', onWindowDragLeave)
    window.removeEventListener('drop', onWindowDrop)
  }
})
</script>

<template>
  <Head title="Editor" />

  <EditorLayout
    :status="bus.composition.value ? stage.status.value : null"
    :status-error="bus.composition.value ? stage.error.value : null"
    :project-root="project?.root ?? null"
  >
    <template #library>
      <Library />
    </template>

    <template #stage>
      <Stage
        v-if="bus.composition.value"
        ref="stageRef"
        :composition="bus.composition.value"
        :playhead="stage.playhead.value"
        :pick-item-at="stage.pickItemAt"
        @apply="bus.apply"
      />
      <div v-else class="empty">
        <h1>davidup editor</h1>
        <p v-if="error">{{ error.message }}</p>
        <p v-else>No project loaded.</p>
        <p class="hint">Boot the editor with <code>davidup edit &lt;project-dir&gt;</code>.</p>
      </div>
    </template>

    <template #inspector>
      <Inspector
        :composition="bus.composition.value"
        :baseline="bus.baseline.value"
        :pending="bus.pending.value"
        :error="bus.error.value"
        @apply="bus.apply"
      />
    </template>

    <template #timeline>
      <Timeline
        :composition="bus.composition.value"
        :playhead="stage.playhead.value"
        :status="bus.composition.value ? stage.status.value : null"
        @seek="(t) => stage.seek(t)"
        @apply="bus.apply"
      />
    </template>
  </EditorLayout>

  <SourceDrawer
    :source="compositionSource"
    :selected-item-id="selection.selectedItemId.value"
    :pick-source-json-pointer="selection.lastPickSource.value?.jsonPointer ?? null"
    :pick-source-file="selection.lastPickSource.value?.file ?? null"
    :open="drawerOpen"
    @close="drawerOpen = false"
  />

  <div
    v-if="isEditorFileDrag"
    class="editor-drop-veil"
    data-testid="editor-drop-veil"
    aria-hidden="true"
  >
    <p>Drop files to add to library</p>
  </div>

  <UploadToasts />
</template>

<style scoped>
.empty {
  text-align: center;
  max-width: 520px;
  padding: 32px;
  color: #e5e5e5;
  font-family: 'Instrument Sans', system-ui, sans-serif;
}

.empty h1 {
  font-size: 28px;
  margin: 0 0 16px;
  letter-spacing: -0.02em;
}

.empty p {
  margin: 8px 0;
  color: #a3a3a3;
}

.empty .hint code {
  background: rgba(255, 255, 255, 0.08);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.95em;
}

.editor-drop-veil {
  position: fixed;
  inset: 0;
  pointer-events: none;
  border: 3px dashed rgba(91, 124, 250, 0.55);
  background: rgba(8, 12, 28, 0.18);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  z-index: 90;
}

.editor-drop-veil p {
  margin: 24px 0 0;
  padding: 8px 14px;
  background: rgba(8, 12, 28, 0.88);
  color: #e5e5e5;
  border-radius: 6px;
  font-size: 13px;
  font-family: 'Instrument Sans', system-ui, sans-serif;
  letter-spacing: 0.02em;
  border: 1px solid rgba(91, 124, 250, 0.5);
}
</style>
