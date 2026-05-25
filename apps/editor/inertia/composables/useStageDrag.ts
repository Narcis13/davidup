// `useStageDrag` — pointer-driven drag-to-move for stage items
// (UX_GAPS §G phase 1).
//
// Pointer-down on the render canvas → if the hit-tested pixel resolves to an
// item, we stage a pending drag without arming visual state. The drag only
// arms once the pointer crosses DRAG_THRESHOLD_PX, which preserves click
// semantics — taps still fall through to Stage.vue's `@click` handler
// (select / clear / place). On arm we:
//
//   1. set the body cursor to `grabbing` + userSelect: none
//   2. notify the caller (so they can promote the dragged item to the
//      current selection, making the ring follow the ghost)
//   3. expose a reactive `active` object that Stage.vue reads each frame
//      to offset the selection-ring overlay
//
// We do NOT push an `update_item` per pointermove — that would round-trip
// through the engine 60×/s and pollute the undo stack. Instead, `onCommit`
// fires exactly once on pointerup with the final snapped position. Visual
// feedback during the drag is local-only (ring follows ghost).
//
// Trailing-click suppression mirrors `useTimelineDrag`: when a drag armed,
// we install a one-shot capture-phase click suppressor on the canvas so
// Stage.vue's `@click` doesn't also clear / re-select the item after the
// drag commits. Scoped to the canvas (not document) so an unrelated click
// elsewhere is never swallowed.

import { ref, type Ref } from 'vue'
import { computeDraggedPosition, roundCoord } from './stageDragMath'

export interface StageDragActive {
  itemId: string
  originalX: number
  originalY: number
  currentX: number
  currentY: number
  snapped: boolean
}

export interface BeginStageDragArgs {
  event: PointerEvent
  /**
   * Element that received `pointerdown` — we attach the trailing-click
   * suppressor here so unrelated clicks elsewhere are never affected.
   */
  hitElement: HTMLElement
  /**
   * Cursor-CSS-px → composition-px scale. Captured at pointerdown because
   * the stage may resize mid-drag (panel resize, window resize) and we want
   * the drag to feel consistent — the user dragged from a specific CSS
   * pixel, not a moving target.
   */
  cssToCompScale: { x: number; y: number }
  itemId: string
  originalX: number
  originalY: number
}

export interface UseStageDragOptions {
  /** Snap step in composition pixels. 0 disables. Defaults to 1px. */
  snapStep?: number
  /** Fires exactly once on pointerup with the final committed position. */
  onCommit: (itemId: string, position: { x: number; y: number }) => void
  /**
   * Fired the moment a drag arms (not on pointerdown — only after the
   * threshold is crossed). Callers use this to promote the dragged item to
   * the current selection so the selection ring follows the ghost.
   */
  onArm?: (itemId: string) => void
}

export interface UseStageDragReturn {
  /** Null until the pointer crosses the drag threshold. */
  active: Ref<StageDragActive | null>
  /** Begin a pending drag from a `pointerdown` on the stage canvas. */
  begin: (args: BeginStageDragArgs) => void
  /** Abort any in-flight drag without committing. */
  cancel: () => void
}

const DRAG_THRESHOLD_PX = 3
const DEFAULT_SNAP = 1

export function useStageDrag(opts: UseStageDragOptions): UseStageDragReturn {
  const active = ref<StageDragActive | null>(null) as Ref<StageDragActive | null>

  interface PendingState {
    itemId: string
    originalX: number
    originalY: number
    startClientX: number
    startClientY: number
    pointerId: number
    hitEl: HTMLElement
    cssToCompScale: { x: number; y: number }
  }

  let pending: PendingState | null = null
  let armed = false
  let altPressed = false
  let lastClientX = 0
  let lastClientY = 0

  function readStep(): number {
    return opts.snapStep ?? DEFAULT_SNAP
  }

  function suppressNextClick(e: MouseEvent): void {
    e.stopPropagation()
    e.preventDefault()
  }

  function arm(): void {
    if (!pending) return
    armed = true
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
    active.value = {
      itemId: pending.itemId,
      originalX: pending.originalX,
      originalY: pending.originalY,
      currentX: pending.originalX,
      currentY: pending.originalY,
      snapped: !altPressed && readStep() > 0,
    }
    opts.onArm?.(pending.itemId)
  }

  function recomputeFromLast(): void {
    if (!pending || !armed || !active.value) return
    const dxCss = lastClientX - pending.startClientX
    const dyCss = lastClientY - pending.startClientY
    const dxComp = dxCss * pending.cssToCompScale.x
    const dyComp = dyCss * pending.cssToCompScale.y
    const step = readStep()
    const next = computeDraggedPosition({
      originalX: pending.originalX,
      originalY: pending.originalY,
      deltaX: dxComp,
      deltaY: dyComp,
      snapStep: step,
      snap: !altPressed,
    })
    active.value = {
      ...active.value,
      currentX: next.x,
      currentY: next.y,
      snapped: !altPressed && step > 0,
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!pending) return
    if (e.pointerId !== pending.pointerId) return
    altPressed = e.altKey
    lastClientX = e.clientX
    lastClientY = e.clientY
    if (!armed) {
      const dx = e.clientX - pending.startClientX
      const dy = e.clientY - pending.startClientY
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
      arm()
    }
    recomputeFromLast()
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
    const originalX = pending.originalX
    const originalY = pending.originalY
    const hitEl = pending.hitEl
    hitEl.addEventListener('click', suppressNextClick, { capture: true, once: true })
    // Safety cleanup: if the trailing click never arrives (rare — pointer
    // released off-canvas, etc.), drop the listener so a future real click
    // isn't accidentally swallowed.
    setTimeout(() => {
      hitEl.removeEventListener('click', suppressNextClick, true)
    }, 0)
    teardown()
    if (!snapshot) return
    const nx = roundCoord(snapshot.currentX)
    const ny = roundCoord(snapshot.currentY)
    if (nx === roundCoord(originalX) && ny === roundCoord(originalY)) return
    opts.onCommit(itemId, { x: nx, y: ny })
  }

  function onPointerCancel(): void {
    teardown()
  }

  function onKey(e: KeyboardEvent): void {
    if (!pending) return
    altPressed = e.altKey
    recomputeFromLast()
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

  function begin(args: BeginStageDragArgs): void {
    if (args.event.button !== 0) return
    cancel()
    pending = {
      itemId: args.itemId,
      originalX: args.originalX,
      originalY: args.originalY,
      startClientX: args.event.clientX,
      startClientY: args.event.clientY,
      pointerId: args.event.pointerId,
      hitEl: args.hitElement,
      cssToCompScale: args.cssToCompScale,
    }
    armed = false
    altPressed = args.event.altKey
    lastClientX = args.event.clientX
    lastClientY = args.event.clientY
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
  }

  function cancel(): void {
    teardown()
  }

  return { active, begin, cancel }
}
