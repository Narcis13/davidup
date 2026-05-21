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
// can replace it in-place. A separate server-provided `defaults` payload
// — captured at precompile time, before any in-session edits — is fed to
// the Inspector so the orange "overridden" dot reflects divergence from
// the template/scene-expanded form rather than from a stale session-start
// clone (polish_plan §20.25).

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Head, router } from '@inertiajs/vue3'
import { useStage } from '~/composables/useStage'
import { useCommandBus, type Composition } from '~/composables/useCommandBus'
import { provideSelection } from '~/composables/useSelection'
import { provideValidation } from '~/composables/useValidation'
import { useAssetUpload } from '~/composables/useAssetUpload'
import { useRender } from '~/composables/useRender'
import { useShortcuts } from '~/composables/useShortcuts'
import { useToasts } from '~/composables/useToasts'
import { useGroupActions } from '~/composables/useGroupActions'
import { LIBRARY_MIME } from '~/composables/useLibraryDrag'
import EditorLayout from '~/layouts/editor.vue'
import ApplyTemplateDialog from '~/components/ApplyTemplateDialog.vue'
import CompositionSettingsDialog from '~/components/CompositionSettingsDialog.vue'
import HelpOverlay from '~/components/HelpOverlay.vue'
import OnboardingOverlay from '~/components/OnboardingOverlay.vue'
import RenderDialog from '~/components/RenderDialog.vue'
import Inspector from '~/components/Inspector.vue'
import ItemToolbar from '~/components/ItemToolbar.vue'
import LayersPanel from '~/components/LayersPanel.vue'
import Library from '~/components/Library.vue'
import Outliner from '~/components/Outliner.vue'
import SourceDrawer from '~/components/SourceDrawer.vue'
import Stage from '~/components/Stage.vue'
import StatusBar from '~/components/StatusBar.vue'
import Timeline from '~/components/Timeline.vue'
import Toasts from '~/components/Toasts.vue'
import type { LibraryItem } from '~/composables/useLibrary'

interface CompositionSource {
  text: string
  file: string
  mtimeMs: number
}

interface SourceLocation {
  file: string
  jsonPointer: string
  originKind: 'literal' | 'ref' | 'template' | 'behavior' | 'scene' | 'background'
}

interface SourceMap {
  items: Record<string, SourceLocation>
  tweens: Record<string, SourceLocation>
}

const props = defineProps<{
  composition: Composition | null
  /**
   * Server-captured snapshot of the freshly-precompiled composition. Stays
   * stable across edits in this session — the Inspector reads it as the
   * template/scene default for its override-detection dot (§20.25).
   */
  defaults: Composition | null
  /**
   * Authorship trail emitted by the precompile pipeline (PRD step 15). The
   * Timeline reads `tweens[id].originKind` to colour bars by their true
   * origin instead of the id-string heuristic — polish_plan §20.26.
   */
  sourceMap: SourceMap | null
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
const validation = provideValidation(props.composition)

const bus = useCommandBus({ initial: props.composition, validation })

// Stage.vue owns the canvas element; we forward its inner ref out via
// `defineExpose` so the engine attach loop still binds to it.
const stageRef = ref<{ canvas: HTMLCanvasElement | null } | null>(null)
const canvas = computed<HTMLCanvasElement | null>(() => stageRef.value?.canvas ?? null)

const stage = useStage({ composition: bus.composition, canvas })

// Toast queue and render handle are module-singletons so it's safe to grab
// them this early — the rest of the editor reuses the same instances. We
// pull them up here so the shortcut registry just below can reference them
// without forward-declaring lazily.
const toasts = useToasts()
const render = useRender()

// ─── Step 17: reveal-in-source drawer ─────────────────────────────────────
const drawerOpen = ref(false)
const compositionSource = ref<CompositionSource | null>(props.compositionSource)

// ─── Step 20.15: status-bar reveal-issue override ────────────────────────
// When the StatusBar's expanded issues panel surfaces a validation issue
// click, we feed an explicit pointer + file to SourceDrawer so it scrolls
// to that line regardless of the current selection. Cleared when the
// selection changes (so the drawer goes back to following selection) or
// when the drawer closes.
const manualSourcePointer = ref<{ jsonPointer: string; file: string } | null>(null)

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

function onDrawerClose(): void {
  drawerOpen.value = false
  manualSourcePointer.value = null
}

function onRevealIssue(payload: { jsonPointer: string | null; path: string | undefined }): void {
  // Open the drawer at the issue's source location. Without a resolvable
  // pointer we still open the drawer at whatever the current selection
  // resolves to — better than swallowing the click silently.
  if (compositionSource.value && payload.jsonPointer) {
    manualSourcePointer.value = {
      jsonPointer: payload.jsonPointer,
      file: compositionSource.value.file,
    }
  } else {
    manualSourcePointer.value = null
  }
  // UX_GAPS §R — also deep-link the selection so the Inspector swings to
  // the offending item / tween, not just the source drawer line. The path
  // shape is the validator's "dotted" form: items.<id>... / tweens.<id>...
  // / layers.<id>... — we only set selection for items and tweens (layers
  // aren't selectable today).
  if (payload.path) {
    const parts = payload.path.split('.')
    const head = parts[0]
    const targetId = typeof parts[1] === 'string' ? parts[1] : null
    if (head === 'items' && targetId) {
      selection.setSelection(targetId)
    } else if (head === 'tweens' && targetId) {
      // Pick the tween bar so the Inspector flips into tween mode and the
      // Timeline highlights the offending tween.
      const tweens = (bus.composition.value?.tweens ?? []) as ReadonlyArray<{ id: string; target: string }>
      const tw = tweens.find((t) => t.id === targetId)
      if (tw) selection.setTweenSelection(targetId, tw.target)
    }
  }
  drawerOpen.value = true
  void refetchCompositionSource()
}

// Selection changes invalidate the manual override — the user is now
// driving with the inspector / stage, so let those resume control of the
// drawer highlight.
watch(
  () => selection.selectedItemId.value,
  () => {
    manualSourcePointer.value = null
  }
)

// ─── Step 20.20: shortcut handlers (FR-16) ───────────────────────────────
// All keymap routing lives in `useShortcuts`. We just supply the verbs.

function toggleSourceDrawer(): void {
  drawerOpen.value = !drawerOpen.value
  if (drawerOpen.value) {
    // Re-fetch every time the drawer opens so its line mapping reflects any
    // edits the user made while it was closed.
    void refetchCompositionSource()
  }
}

// Step 20.23: Inspector's provenance line acts like ⌘J — but since the
// user clicked an explicit "reveal" affordance, we always end up with the
// drawer open (no toggle) so the click never *closes* the drawer
// unexpectedly.
// §20.27 — Timeline emits this when the user double-clicks a sealed (scene-
// origin) bar. We look up the scene instance's authored location from the
// precompile sourceMap and route the SourceDrawer there. Falls back to a
// best-effort `/items/<id>` pointer in composition.json when the sourceMap
// is unavailable (e.g. very early load) so the affordance still works.
function onOpenSceneSource(sceneInstanceId: string): void {
  const entry = props.sourceMap?.items?.[sceneInstanceId] ?? null
  const file = entry?.file ?? compositionSource.value?.file ?? null
  const pointer = entry?.jsonPointer ?? `/items/${encodePointerToken(sceneInstanceId)}`
  if (file) {
    manualSourcePointer.value = { jsonPointer: pointer, file }
  } else {
    manualSourcePointer.value = null
  }
  if (!drawerOpen.value) {
    drawerOpen.value = true
  }
  void refetchCompositionSource()
}

// UX_GAPS §S — onboarding's "Drop files" CTA flashes the file-drop veil so
// the user can see the dedicated zone before going looking for it.
let flashTimer: ReturnType<typeof setTimeout> | null = null
function flashDropZone(): void {
  isEditorFileDrag.value = true
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    isEditorFileDrag.value = false
    flashTimer = null
  }, 1600)
}

// RFC-6901 token escape — matches the encoder used by the precompile source
// map. Inlined here so we don't have to pull the compose module into the
// browser bundle just for two character substitutions.
function encodePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1')
}

function onRevealSourceFromInspector(): void {
  // Clear any manual override so the drawer follows the active selection,
  // not a previously-revealed validation issue.
  manualSourcePointer.value = null
  if (!drawerOpen.value) {
    drawerOpen.value = true
    void refetchCompositionSource()
  }
}

function deleteSelection(): void {
  // UX_GAPS §C: when a Timeline bar is selected, Backspace deletes the
  // tween — not the item the bar targets. Without this branch the user has
  // no keyboard path to remove a tween, and accidentally taps Backspace
  // expecting to scrub the animation away but lose the whole sprite.
  const tweenId = selection.selectedTweenId.value
  if (tweenId) {
    selection.setTweenSelection(null)
    void bus.apply({ kind: 'remove_tween', payload: { id: tweenId } })
    return
  }
  const id = selection.selectedItemId.value
  if (!id) return
  // Pre-emptively clear the selection so the Inspector doesn't try to render
  // an item that's about to vanish from the composition; if the command
  // fails the user can re-select. `bus.apply` surfaces the failure as a toast.
  selection.setSelection(null)
  void bus.apply({ kind: 'remove_item', payload: { id } })
}

function fitTimeline(): void {
  // The timeline already auto-fits the panel width (no zoom state yet), so
  // "fit" collapses to the canonical reset action: seek the playhead back to
  // the start. Cheap, observable, and on-message with what ⌘0 means in most
  // media tools ("reset view").
  stage.seek(0)
}

// ─── UX_GAPS §N: render configuration dialog ─────────────────────────────
const renderDialogOpen = ref(false)

function openRenderDialog(): void {
  // ⌘R / RenderStrip button / app-bar render button all route through here
  // so the user always confronts the config dialog before kickoff.
  if (!bus.composition.value) return
  if (render.isBusy.value) {
    toasts.error('A render is already running.', {
      dedupeKey: 'render:start-error',
    })
    return
  }
  renderDialogOpen.value = true
}

function closeRenderDialog(): void {
  renderDialogOpen.value = false
}

function onRenderConfirm(payload: {
  filename?: string
  renderOptions: { codec: string; crf: number; preset: string; pixFmt: string }
}): void {
  renderDialogOpen.value = false
  void render
    .startRender({
      ...(payload.filename ? { filename: payload.filename } : {}),
      renderOptions: payload.renderOptions as never,
    })
    .then((result) => {
      if (!result.ok && result.error) {
        toasts.error(result.error.message, {
          message: result.error.code,
          dedupeKey: 'render:start-error',
        })
      }
    })
}

function startRender(): void {
  openRenderDialog()
}

function forceFlush(): void {
  // Every command already round-trips through the server, so there's no
  // pending in-memory state to commit. ⌘S is still load-bearing as the
  // user's "are we saved?" acknowledgement — emit a confirmation toast so
  // the chord has a visible effect.
  const project = props.project
  const detail = project?.compositionPath
    ? `Composition synced to ${project.compositionPath}`
    : 'All edits are already on disk.'
  toasts.success('Saved', {
    message: detail,
    dedupeKey: 'editor:saved',
  })
}

// ─── Step 20.21: help overlay (?) ────────────────────────────────────────
const helpOpen = ref(false)

function toggleHelp(): void {
  helpOpen.value = !helpOpen.value
}

function closeHelp(): void {
  helpOpen.value = false
}

function onHelpToggleEvent(): void {
  toggleHelp()
}

// ─── Apply-with-params dialog (UX_GAPS §I) ───────────────────────────────
// Clicking the "Apply…" button on a parameterized library template opens
// this dialog so the user can override param values per insertion. The
// drag-and-drop path continues to apply silently with brand defaults; this
// is the deliberate, click-driven entry point.
interface ApplyTemplateState {
  item: LibraryItem
  layerId: string
  start: number
  defaults: Record<string, unknown>
}
const applyTemplateState = ref<ApplyTemplateState | null>(null)
const applyTemplateOpen = computed(() => applyTemplateState.value !== null)

function resolveDefaultsForApply(item: LibraryItem): Record<string, unknown> {
  // Mirrors the brand-defaults logic in `useLibraryDrag.resolveDefaultParams`
  // so the dialog opens with the same starting values the drag path would
  // have used silently. Required params with no `default` get a string
  // placeholder so the user sees something they can edit.
  const out: Record<string, unknown> = {}
  const params = Array.isArray(item.params) ? (item.params as unknown[]) : []
  for (const raw of params) {
    const p = raw as { name?: string; type?: string; required?: boolean; default?: unknown }
    if (!p || typeof p.name !== 'string' || p.name.length === 0) continue
    if (Object.prototype.hasOwnProperty.call(p, 'default') && p.default !== undefined) {
      out[p.name] = p.default
      continue
    }
    if (p.required) {
      switch (p.type) {
        case 'number':
          out[p.name] = 0
          break
        case 'boolean':
          out[p.name] = false
          break
        case 'color':
          out[p.name] = '#ffffff'
          break
        default:
          out[p.name] = item.name ?? item.id
      }
    }
  }
  return out
}

function pickHostLayerId(): string | null {
  const comp = bus.composition.value
  if (!comp || !Array.isArray(comp.layers) || comp.layers.length === 0) return null
  const first = comp.layers[0]
  return typeof first?.id === 'string' ? first.id : null
}

function onLibraryApply(item: LibraryItem): void {
  if (item.kind !== 'template') return
  const layerId = pickHostLayerId()
  if (!layerId) {
    toasts.error('No layers available to host the template.', {
      dedupeKey: 'apply-template:no-layer',
    })
    return
  }
  const start = Math.max(0, stage.playhead.value ?? 0)
  const defaults = resolveDefaultsForApply(item)
  const params = Array.isArray(item.params) ? item.params : []
  if (params.length === 0) {
    // Non-parameterized templates skip the dialog entirely.
    dispatchApplyTemplate(item, layerId, start, defaults)
    return
  }
  applyTemplateState.value = { item, layerId, start, defaults }
}

function closeApplyTemplate(): void {
  applyTemplateState.value = null
}

function makeTemplateInstanceId(templateId: string, start: number): string {
  const millis = Math.round(start * 1000)
  const suffix = Date.now().toString(36).slice(-4)
  const sanitized = templateId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${sanitized}_${millis}_${suffix}`
}

function dispatchApplyTemplate(
  item: LibraryItem,
  layerId: string,
  start: number,
  params: Record<string, unknown>,
): void {
  const id = makeTemplateInstanceId(item.id, start)
  void bus.apply({
    kind: 'apply_template',
    payload: {
      templateId: item.id,
      layerId,
      start,
      ...(Object.keys(params).length > 0 ? { params } : {}),
      id,
    },
    source: 'ui',
  })
}

function onApplyTemplateConfirm(payload: { params: Record<string, unknown> }): void {
  const state = applyTemplateState.value
  if (!state) return
  dispatchApplyTemplate(state.item, state.layerId, state.start, payload.params)
  applyTemplateState.value = null
}

// ─── UX_GAPS §J: remove asset from composition.assets ────────────────────
//
// The Library panel has already run the usage check (and shown the confirm
// dialog when needed) — by the time we get here the user has acknowledged
// any risk. We forward the call straight to the same command bus the
// Inspector uses; the server's `remove_asset` handler will still reject
// with E_ASSET_IN_USE if items reference it, and StatusBar surfaces that.
function onLibraryRemoveAsset(payload: { id: string; cascade: boolean }): void {
  void bus.apply({
    kind: 'remove_asset',
    payload: { id: payload.id },
    source: 'ui',
  })
}

// ─── UX_GAPS §D: composition settings dialog ─────────────────────────────
const compositionSettingsOpen = ref(false)

function closeCompositionSettings(): void {
  compositionSettingsOpen.value = false
}

function onCompositionSettingsToggleEvent(): void {
  if (!bus.composition.value) return
  compositionSettingsOpen.value = !compositionSettingsOpen.value
}

// ─── UX_GAPS §L: group / ungroup ─────────────────────────────────────────
const groupActions = useGroupActions({
  getComposition: () => bus.composition.value,
  selection,
  apply: bus.apply,
})

useShortcuts({
  togglePlay: () => stage.togglePlay(),
  deleteSelection,
  fitTimeline,
  toggleSourceDrawer,
  render: startRender,
  forceFlush,
  toggleHelp,
  undo: () => bus.undo(),
  redo: () => bus.redo(),
  group: () => groupActions.group(),
  ungroup: () => groupActions.ungroup(),
})

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

// ─── Step 20.11: project-switch live refetch ─────────────────────────────
// The editor subscribes to /api/projects/events so a project switch (from
// another tab, the CLI, or — once 20.12 lands — the in-app project picker)
// reloads the page with the new composition prop. `router.reload()` keeps
// scroll position and other ephemeral UI state; only Inertia-provided props
// are refetched.
let projectEventSource: EventSource | null = null

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('dragenter', onWindowDragEnter)
    window.addEventListener('dragover', onWindowDragOver)
    window.addEventListener('dragleave', onWindowDragLeave)
    window.addEventListener('drop', onWindowDrop)
    // The app-bar's `?` button dispatches this event so we don't need a
    // layout↔page prop coupling just for the help overlay.
    window.addEventListener('davidup:toggle-help', onHelpToggleEvent)
    // App-bar's ⚙ button signals via the same window-event pattern so the
    // layout doesn't need to know about the command bus.
    window.addEventListener(
      'davidup:toggle-composition-settings',
      onCompositionSettingsToggleEvent,
    )
    // RenderStrip / external triggers dispatch this so every kickoff path
    // surfaces the configuration dialog before starting the worker.
    window.addEventListener('davidup:open-render-dialog', openRenderDialog)
    // OnboardingOverlay → flash the file-drop zone so the user sees where
    // dropping files goes (UX_GAPS §S).
    window.addEventListener('davidup:flash-drop-zone', flashDropZone)

    if (typeof EventSource !== 'undefined') {
      projectEventSource = new EventSource('/api/projects/events')
      projectEventSource.addEventListener('changed', (ev) => {
        const data = (ev as MessageEvent).data
        let projectName: string | null = null
        if (typeof data === 'string' && data.length > 0) {
          try {
            const parsed = JSON.parse(data) as { root?: string }
            if (typeof parsed?.root === 'string') {
              const dir = parsed.root.replace(/[\\/]+$/, '')
              const i = Math.max(dir.lastIndexOf('/'), dir.lastIndexOf('\\'))
              projectName = i >= 0 ? dir.slice(i + 1) : dir
            }
          } catch {
            /* not JSON */
          }
        }
        toasts.info('Project switched', {
          message: projectName ? `Loaded ${projectName}` : 'Reloading composition…',
          dedupeKey: 'project:switched',
        })
        router.reload()
      })
    }
  }
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('dragenter', onWindowDragEnter)
    window.removeEventListener('dragover', onWindowDragOver)
    window.removeEventListener('dragleave', onWindowDragLeave)
    window.removeEventListener('drop', onWindowDrop)
    window.removeEventListener('davidup:toggle-help', onHelpToggleEvent)
    window.removeEventListener(
      'davidup:toggle-composition-settings',
      onCompositionSettingsToggleEvent,
    )
    window.removeEventListener('davidup:open-render-dialog', openRenderDialog)
    window.removeEventListener('davidup:flash-drop-zone', flashDropZone)
    if (flashTimer) {
      clearTimeout(flashTimer)
      flashTimer = null
    }
  }
  if (projectEventSource) {
    projectEventSource.close()
    projectEventSource = null
  }
})
</script>

<template>
  <Head title="Editor" />

  <EditorLayout
    :status="bus.composition.value ? stage.status.value : null"
    :status-error="bus.composition.value ? stage.error.value : null"
    :project-root="project?.root ?? null"
    :pending="bus.pending.value"
    :command-error="bus.error.value"
    :undo-stack-size="bus.undoStackSize.value"
    :redo-stack-size="bus.redoStackSize.value"
    @undo="bus.undo"
    @redo="bus.redo"
  >
    <template #library>
      <Library
        :composition="bus.composition.value"
        @apply-template="onLibraryApply"
        @remove-asset="onLibraryRemoveAsset"
      />
    </template>

    <template #stage>
      <ItemToolbar
        v-if="bus.composition.value"
        :composition="bus.composition.value"
        :can-group="groupActions.canGroup.value"
        :can-ungroup="groupActions.canUngroup.value"
        @group="groupActions.group"
        @ungroup="groupActions.ungroup"
      />
      <LayersPanel
        v-if="bus.composition.value"
        :composition="bus.composition.value"
        @apply="bus.apply"
      />
      <Outliner
        v-if="bus.composition.value"
        :composition="bus.composition.value"
      />
      <Stage
        v-if="bus.composition.value"
        ref="stageRef"
        :composition="bus.composition.value"
        :playhead="stage.playhead.value"
        :pick-item-at="stage.pickItemAt"
        :get-item-bounds-at="stage.getItemBoundsAt"
        :on-tick="stage.onTick"
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
        :defaults="props.defaults"
        :pending="bus.pending.value"
        :error="bus.error.value"
        :playhead="stage.playhead.value"
        :item-last-source="bus.itemLastSource.value"
        :last-pick-source="selection.lastPickSource.value"
        @apply="bus.apply"
        @reveal-source="onRevealSourceFromInspector"
      />
    </template>

    <template #timeline>
      <Timeline
        :composition="bus.composition.value"
        :playhead="stage.playhead.value"
        :status="bus.composition.value ? stage.status.value : null"
        :source-map="props.sourceMap"
        @seek="(t) => stage.seek(t)"
        @apply="bus.apply"
        @open-scene-source="onOpenSceneSource"
      />
    </template>

    <template #statusbar>
      <StatusBar
        :composition="bus.composition.value"
        :playhead="stage.playhead.value"
        :selected-item-id="selection.selectedItemId.value"
        :stage-status="bus.composition.value ? stage.status.value : null"
        :stage-error="bus.composition.value ? stage.error.value : null"
        @reveal-issue="onRevealIssue"
      />
    </template>
  </EditorLayout>

  <SourceDrawer
    :source="compositionSource"
    :selected-item-id="selection.selectedItemId.value"
    :pick-source-json-pointer="manualSourcePointer?.jsonPointer ?? selection.lastPickSource.value?.jsonPointer ?? null"
    :pick-source-file="manualSourcePointer?.file ?? selection.lastPickSource.value?.file ?? null"
    :open="drawerOpen"
    @close="onDrawerClose"
  />

  <div
    v-if="isEditorFileDrag"
    class="editor-drop-veil"
    data-testid="editor-drop-veil"
    aria-hidden="true"
  >
    <p>Drop files to add to library</p>
  </div>

  <HelpOverlay :open="helpOpen" @close="closeHelp" />

  <CompositionSettingsDialog
    :open="compositionSettingsOpen"
    :composition="bus.composition.value"
    @close="closeCompositionSettings"
    @apply="bus.apply"
  />

  <ApplyTemplateDialog
    :open="applyTemplateOpen"
    :item="applyTemplateState?.item ?? null"
    :initial-values="applyTemplateState?.defaults"
    :layer-id="applyTemplateState?.layerId ?? null"
    :start="applyTemplateState?.start"
    @close="closeApplyTemplate"
    @apply="onApplyTemplateConfirm"
  />

  <RenderDialog
    :open="renderDialogOpen"
    :composition="bus.composition.value"
    :busy="render.isBusy.value"
    @close="closeRenderDialog"
    @confirm="onRenderConfirm"
  />

  <OnboardingOverlay v-if="bus.composition.value" />

  <Toasts />
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
