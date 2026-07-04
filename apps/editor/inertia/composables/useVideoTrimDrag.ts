// `useVideoTrimDrag` — pointer-driven drag for a video item's inner trim
// handles (U5). Structurally a slimmed sibling of `useTimelineDrag`: same
// threshold-arm / one-shot-commit / click-suppression shape, but operating
// on `trimIn`/`trimOut` (anchored to the source asset's time axis) instead
// of a tween's {start, duration} (anchored to the composition timeline).
//
// Two handles, one composable: `mode: 'trim-in' | 'trim-out'` picks which
// field moves. `onCommit` fires once per drag with the final snapped value —
// the caller (TimelineTrack.vue) dispatches a single `update_item`.

import { ref, type Ref } from 'vue'
import {
  computeTrimIn,
  computeTrimOut,
  snapTrim as roundTrim,
} from '~/composables/videoTrimMath'

export type VideoTrimMode = 'trim-in' | 'trim-out'

const DEFAULT_SNAP = 0.05
const DRAG_THRESHOLD_PX = 3

export interface VideoTrimActive {
  itemId: string
  mode: VideoTrimMode
  originalValue: number
  currentValue: number
}

export interface BeginVideoTrimArgs {
  event: PointerEvent
  laneElement: HTMLElement
  itemId: string
  mode: VideoTrimMode
  trimIn: number
  trimOut: number
  assetDuration: number | null
}

export interface UseVideoTrimDragOptions {
  /** Composition duration in seconds — used only to size the lane→time conversion. */
  duration: Ref<number>
  snapStep?: Ref<number> | number
  onCommit: (itemId: string, patch: { trimIn?: number; trimOut?: number }) => void
}

export interface UseVideoTrimDragReturn {
  active: Ref<VideoTrimActive | null>
  begin: (args: BeginVideoTrimArgs) => void
  cancel: () => void
}

export function useVideoTrimDrag(opts: UseVideoTrimDragOptions): UseVideoTrimDragReturn {
  const active = ref<VideoTrimActive | null>(null) as Ref<VideoTrimActive | null>

  interface PendingState {
    itemId: string
    mode: VideoTrimMode
    laneEl: HTMLElement
    barEl: HTMLElement
    trimIn: number
    trimOut: number
    assetDuration: number | null
    startX: number
    pointerId: number
  }

  let pending: PendingState | null = null
  let armed = false
  let altPressed = false
  let lastClientX = 0

  function readStep(): number {
    const s = opts.snapStep
    if (s == null) return DEFAULT_SNAP
    if (typeof s === 'number') return s
    return s.value > 0 ? s.value : DEFAULT_SNAP
  }

  function recomputeFromLastX(): void {
    if (!pending || !armed || !active.value) return
    const rect = pending.laneEl.getBoundingClientRect()
    if (rect.width <= 0) return
    const d = opts.duration.value
    const timeDelta = ((lastClientX - pending.startX) / rect.width) * d
    const step = readStep()
    const snap = !altPressed
    let next: number
    if (pending.mode === 'trim-in') {
      next = computeTrimIn({
        originalTrimIn: pending.trimIn,
        trimOutBound: pending.trimOut,
        timeDelta,
        snapStep: step,
        snap,
      })
    } else {
      next = computeTrimOut({
        originalTrimOut: pending.trimOut,
        trimInBound: pending.trimIn,
        timeDelta,
        assetDuration: pending.assetDuration,
        snapStep: step,
        snap,
      })
    }
    active.value = { ...active.value, currentValue: next }
  }

  function begin(args: BeginVideoTrimArgs): void {
    if (args.event.button !== 0) return
    cancel()
    args.event.preventDefault()
    const barEl =
      (args.event.currentTarget as HTMLElement | null) ??
      (args.event.target as HTMLElement | null)
    if (!barEl) return
    pending = {
      itemId: args.itemId,
      mode: args.mode,
      laneEl: args.laneElement,
      barEl,
      trimIn: args.trimIn,
      trimOut: args.trimOut,
      assetDuration: args.assetDuration,
      startX: args.event.clientX,
      pointerId: args.event.pointerId,
    }
    armed = false
    altPressed = args.event.altKey
    lastClientX = args.event.clientX
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
  }

  function arm(): void {
    if (!pending) return
    armed = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const originalValue = pending.mode === 'trim-in' ? pending.trimIn : pending.trimOut
    active.value = {
      itemId: pending.itemId,
      mode: pending.mode,
      originalValue,
      currentValue: originalValue,
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!pending) return
    if (e.pointerId !== pending.pointerId) return
    altPressed = e.altKey
    lastClientX = e.clientX
    const dx = e.clientX - pending.startX
    if (!armed) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return
      arm()
    }
    recomputeFromLastX()
  }

  function onKey(e: KeyboardEvent): void {
    if (!pending) return
    altPressed = e.altKey
    recomputeFromLastX()
  }

  function teardown(): void {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    window.removeEventListener('keydown', onKey)
    window.removeEventListener('keyup', onKey)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    active.value = null
    pending = null
    armed = false
  }

  function suppressNextClick(e: MouseEvent): void {
    e.stopPropagation()
    e.preventDefault()
  }

  function onPointerUp(e: PointerEvent): void {
    if (!pending) return
    if (e.pointerId !== pending.pointerId) return
    if (!armed) {
      teardown()
      return
    }
    const snapshot = active.value
    const itemId = pending.itemId
    const mode = pending.mode
    const barEl = pending.barEl
    barEl.addEventListener('click', suppressNextClick, { capture: true, once: true })
    setTimeout(() => {
      barEl.removeEventListener('click', suppressNextClick, true)
    }, 0)
    teardown()
    if (!snapshot) return
    const rounded = roundTrim(snapshot.currentValue, 0.0001) // stabilize float noise, not a visual snap
    const original = roundTrim(snapshot.originalValue, 0.0001)
    if (rounded === original) return
    if (mode === 'trim-in') opts.onCommit(itemId, { trimIn: rounded })
    else opts.onCommit(itemId, { trimOut: rounded })
  }

  function onPointerCancel(): void {
    teardown()
  }

  function cancel(): void {
    teardown()
  }

  return { active, begin, cancel }
}
