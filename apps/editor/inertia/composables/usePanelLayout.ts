// `usePanelLayout` — drives the three-panel editor shell.
//
// Step 08 of the editor build plan. Pairs with `inertia/layouts/editor.vue`
// to provide:
//   - reactive sizes for the Library (left), Inspector (right), Timeline
//     (bottom) panels
//   - drag handlers for the three resize gutters between them
//   - hydration from `GET /api/editor-state` and a debounced
//     `PUT /api/editor-state` when sizes change, so layout survives reloads
//     via `~/.davidup/state.json`
//
// The composable is layout-only — it doesn't know about the canvas inside
// the center cell, the timeline contents, or the inspector. Those panels
// land in later steps and consume `gridTemplateColumns` / `gridTemplateRows`
// (or the raw size refs) for their own internal layout.

import {
  computed,
  getCurrentInstance,
  onBeforeUnmount,
  onMounted,
  ref,
  type Ref,
} from 'vue'
import {
  clampPanel,
  DEFAULT_PANEL_LAYOUT,
  HANDLE_SIZE,
  makeGridColumns,
  makeGridRows,
  normalizeLayout,
  PANEL_LIMITS,
  type PanelKey,
  type PanelLayout,
  type PanelLimits,
} from './panelLayoutShape.js'

export {
  DEFAULT_PANEL_LAYOUT,
  HANDLE_SIZE,
  PANEL_LIMITS,
  type PanelKey,
  type PanelLayout,
  type PanelLimits,
}

export interface UsePanelLayoutOptions {
  /** Override the persistence endpoint (tests). */
  endpoint?: string
  /** Skip hydrating from the server (tests / SSR). */
  skipFetch?: boolean
  /** Initial layout; defaults to {@link DEFAULT_PANEL_LAYOUT}. */
  initial?: Partial<PanelLayout>
  /** Debounce window for persistence writes. Default 250ms. */
  saveDebounceMs?: number
}

export interface DragInit {
  /** Pointer event that starts the drag. */
  event: PointerEvent
  /** Which size to mutate. */
  panel: PanelKey
}

export interface UsePanelLayoutReturn {
  layout: Ref<PanelLayout>
  /** CSS-grid column template for the three-column shell. */
  gridTemplateColumns: Ref<string>
  /** CSS-grid row template for the stage / timeline split. */
  gridTemplateRows: Ref<string>
  /** Clamp + apply a single panel size. Persists asynchronously. */
  setPanel: (panel: PanelKey, size: number) => void
  /** Replace the whole layout. Persists asynchronously. */
  setLayout: (next: Partial<PanelLayout>) => void
  /** Begin a pointer drag on a resize handle. Wire into `@pointerdown`. */
  beginDrag: (init: DragInit) => void
  /** True while a drag is in progress (used to disable transitions). */
  isDragging: Ref<boolean>
  /** True after the initial server hydration has completed. */
  hydrated: Ref<boolean>
  /** Force a flush of any pending debounced save. */
  flush: () => Promise<void>
  limits: PanelLimits
}

export function usePanelLayout(opts: UsePanelLayoutOptions = {}): UsePanelLayoutReturn {
  const endpoint = opts.endpoint ?? '/api/editor-state'
  const debounceMs = opts.saveDebounceMs ?? 250

  const layout = ref<PanelLayout>(normalizeLayout(opts.initial))
  const isDragging = ref(false)
  const hydrated = ref(false)

  // Five-track / three-track grid; the resize gutters live as real tracks
  // (see panelLayoutShape.ts) so `grid-template-areas` in editor.vue stays
  // in sync with the reactive sizes.
  const gridTemplateColumns = computed(() => makeGridColumns(layout.value))
  const gridTemplateRows = computed(() => makeGridRows(layout.value))

  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let savePending: Promise<void> | null = null

  async function persistNow(): Promise<void> {
    if (typeof fetch === 'undefined') return
    const snapshot = { ...layout.value }
    try {
      await fetch(endpoint, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ panelLayout: snapshot }),
      })
    } catch {
      // Persistence failures are non-fatal — the user keeps the new layout
      // for this session even if it doesn't outlive a reload.
    }
  }

  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      savePending = persistNow().finally(() => {
        savePending = null
      })
    }, debounceMs)
  }

  function setPanel(panel: PanelKey, size: number): void {
    const next = clampPanel(size, panel)
    if (layout.value[panel] === next) return
    layout.value = { ...layout.value, [panel]: next }
    scheduleSave()
  }

  function setLayout(next: Partial<PanelLayout>): void {
    const merged = normalizeLayout({ ...layout.value, ...next })
    if (
      merged.leftWidth === layout.value.leftWidth &&
      merged.rightWidth === layout.value.rightWidth &&
      merged.bottomHeight === layout.value.bottomHeight
    ) {
      return
    }
    layout.value = merged
    scheduleSave()
  }

  function beginDrag({ event, panel }: DragInit): void {
    if (typeof window === 'undefined') return
    event.preventDefault()
    isDragging.value = true
    const startX = event.clientX
    const startY = event.clientY
    const startSize = layout.value[panel]
    // Left handle moves the boundary right => panel grows positive.
    // Right handle moves the boundary left  => panel grows negative delta.
    // Bottom handle moves boundary up       => panel grows negative delta.
    const sign: 1 | -1 = panel === 'leftWidth' ? 1 : -1
    const axis: 'x' | 'y' = panel === 'bottomHeight' ? 'y' : 'x'

    const onMove = (e: PointerEvent) => {
      const delta = axis === 'x' ? e.clientX - startX : e.clientY - startY
      const next = startSize + sign * delta
      setPanel(panel, next)
    }
    const onUp = () => {
      isDragging.value = false
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      // Restore selection / cursor.
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
      // One last debounced save kicks off automatically via setPanel during drag.
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }

  async function flush(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
      savePending = persistNow().finally(() => {
        savePending = null
      })
    }
    if (savePending) await savePending
  }

  async function hydrate(): Promise<void> {
    if (opts.skipFetch || typeof fetch === 'undefined') {
      hydrated.value = true
      return
    }
    try {
      const res = await fetch(endpoint, { method: 'GET' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { panelLayout?: Partial<PanelLayout> }
      if (body && typeof body === 'object' && body.panelLayout) {
        layout.value = normalizeLayout({ ...layout.value, ...body.panelLayout })
      }
    } catch {
      // Fall back to defaults already in `layout`.
    } finally {
      hydrated.value = true
    }
  }

  // Lifecycle hooks only register when called inside a component setup —
  // tests that exercise the composable in an effect scope shouldn't trigger
  // Vue's "no active instance" warning.
  if (getCurrentInstance()) {
    onMounted(() => {
      void hydrate()
    })
    onBeforeUnmount(() => {
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
        void persistNow()
      }
    })
  }

  return {
    layout,
    gridTemplateColumns,
    gridTemplateRows,
    setPanel,
    setLayout,
    beginDrag,
    isDragging,
    hydrated,
    flush,
    limits: PANEL_LIMITS,
  }
}
