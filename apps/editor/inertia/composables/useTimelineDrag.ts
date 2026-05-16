// `useTimelineDrag` — pointer-driven drag-to-move + resize for Timeline bars
// (step 11). Three handles per bar:
//   - move           → the bar body, slides start (duration unchanged)
//   - resize-left    → left edge, drags `start` while keeping the right edge
//   - resize-right   → right edge, drags the end while keeping `start`
//
// Values snap to a configurable grid (default 0.25s, PRD §08). Holding `Alt`
// during the drag bypasses snapping for fine-grained edits. We don't push an
// `update_tween` per pointermove — that would round-trip through the engine
// 60×/s. Instead, the composable exposes a reactive `active` object that the
// Timeline reads to paint a transient ghost; `onCommit` only fires once, on
// pointerup, with the final snapped {start, duration} delta.
//
// Click vs. drag disambiguation: pointerdown stages a pending drag but does
// not arm visual state until the pointer moves past DRAG_THRESHOLD_PX. If the
// pointer comes up before the threshold, we leave click semantics alone (the
// bar's `@click` handler still fires and selects the tween). If the drag did
// arm, we install a one-shot capture-phase click suppressor so the trailing
// click doesn't also mutate selection on top of the drag commit.

import { ref, type Ref } from 'vue'
import {
  computeDragValues,
  roundTime,
  type DragMode,
} from '~/composables/timelineDragMath'

export type { DragMode } from '~/composables/timelineDragMath'
export {
  computeDragValues,
  roundTime,
  snapValue,
  type ComputeDragArgs,
} from '~/composables/timelineDragMath'

const DEFAULT_SNAP = 0.25
const DRAG_THRESHOLD_PX = 3

export interface DragActive {
  tweenId: string
  target: string
  mode: DragMode
  originalStart: number
  originalDuration: number
  currentStart: number
  currentDuration: number
  snapped: boolean
}

export interface BeginDragArgs {
  event: PointerEvent
  laneElement: HTMLElement
  tween: { id: string; target: string; start: number; duration: number }
  mode: DragMode
}

export interface UseTimelineDragOptions {
  /** Composition duration in seconds, used to convert pixels → time and clamp. */
  duration: Ref<number>
  /** Snap step in seconds. Pass a Ref to make it user-configurable at runtime. */
  snapStep?: Ref<number> | number
  /** Smallest duration a tween may be shrunk to. Defaults to one snap step. */
  minDuration?: number
  /** Fires once on pointerup with the final, snapped delta. */
  onCommit: (tweenId: string, patch: { start?: number; duration?: number }) => void
}

export interface UseTimelineDragReturn {
  /** Null until the pointer crosses the drag threshold. */
  active: Ref<DragActive | null>
  /** Begin a pending drag from a `pointerdown` on a bar or resize handle. */
  begin: (args: BeginDragArgs) => void
  /** Abort any in-flight drag without committing. */
  cancel: () => void
}

export function useTimelineDrag(opts: UseTimelineDragOptions): UseTimelineDragReturn {
  const active = ref<DragActive | null>(null) as Ref<DragActive | null>

  interface PendingState {
    tween: { id: string; target: string; start: number; duration: number }
    mode: DragMode
    laneEl: HTMLElement
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
    const next = computeDragValues({
      mode: pending.mode,
      originalStart: pending.tween.start,
      originalDuration: pending.tween.duration,
      timeDelta,
      compositionDuration: d,
      snapStep: step,
      minDuration: Math.max(opts.minDuration ?? step, 0.001),
      snap: !altPressed,
    })
    active.value = {
      ...active.value,
      currentStart: next.start,
      currentDuration: next.duration,
      snapped: !altPressed && step > 0,
    }
  }

  function begin(args: BeginDragArgs): void {
    if (args.event.button !== 0) return
    cancel()
    args.event.preventDefault()
    pending = {
      tween: args.tween,
      mode: args.mode,
      laneEl: args.laneElement,
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
    document.body.style.cursor = pending.mode === 'move' ? 'grabbing' : 'col-resize'
    document.body.style.userSelect = 'none'
    active.value = {
      tweenId: pending.tween.id,
      target: pending.tween.target,
      mode: pending.mode,
      originalStart: pending.tween.start,
      originalDuration: pending.tween.duration,
      currentStart: pending.tween.start,
      currentDuration: pending.tween.duration,
      snapped: !altPressed,
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
    const tween = pending.tween
    document.addEventListener('click', suppressNextClick, { capture: true, once: true })
    teardown()
    if (!snapshot) return
    const newStart = roundTime(snapshot.currentStart)
    const newDuration = roundTime(snapshot.currentDuration)
    const startChanged = newStart !== roundTime(tween.start)
    const durationChanged = newDuration !== roundTime(tween.duration)
    if (!startChanged && !durationChanged) return
    const patch: { start?: number; duration?: number } = {}
    if (startChanged) patch.start = newStart
    if (durationChanged) patch.duration = newDuration
    opts.onCommit(tween.id, patch)
  }

  function onPointerCancel(): void {
    teardown()
  }

  function cancel(): void {
    teardown()
  }

  return { active, begin, cancel }
}
