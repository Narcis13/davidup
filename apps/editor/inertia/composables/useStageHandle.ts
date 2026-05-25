// `useStageHandle` — pointer-driven resize + rotate for the selected stage
// item (UX_GAPS §G phase 2).
//
// One composable hosts both handle kinds because the lifecycle is identical:
//   1. pointerdown on a handle freezes the item's geometry snapshot
//   2. pointermove updates a reactive `active` object so Stage.vue can
//      redraw the selection ring + handles at the in-progress dimensions
//   3. pointerup commits a single `update_item` with the final result
//
// Like `useStageDrag` we do NOT push an update per pointermove — that would
// stuff the undo stack with 30 entries per gesture. Visual feedback comes
// from the local `active` state; the ring/handles follow it directly.
//
// Trailing-click suppression mirrors `useStageDrag`: the handle that
// received pointerdown gets a one-shot capture-phase click filter so a
// stale click event after pointerup can never reach `onCanvasClick` (which
// would clear the selection by hitting empty stage).

import { ref, type Ref } from 'vue'
import {
  computeResize,
  computeRotation,
  type ItemGeom,
  type ResizeHandleKind,
} from './stageHandleMath'

export type HandleKind = ResizeHandleKind | 'rot'

export interface StageHandleActive {
  kind: HandleKind
  itemId: string
  /** Original geometry captured at pointerdown. */
  original: ItemGeom
  /** Current in-progress result. For 'rot', width/height match original. */
  current: ItemGeom
}

export interface BeginHandleArgs {
  event: PointerEvent
  /** Element that received `pointerdown` (the handle div). */
  hitElement: HTMLElement
  /** Cursor-CSS-px → composition-px scale, captured at drag start. */
  cssToCompScale: { x: number; y: number }
  /** Canvas client rect at drag start (so we can compute world cursor coords). */
  canvasRect: { left: number; top: number; width: number; height: number }
  /** Composition pixel dimensions (so we can map cursor CSS → comp). */
  canvasComp: { width: number; height: number }
  kind: HandleKind
  itemId: string
  geom: ItemGeom
}

export interface UseStageHandleOptions {
  /** Minimum local width/height during resize. Default 1. */
  minSize?: number
  /** Fires once on pointerup with the final geometry diff. */
  onCommit: (
    itemId: string,
    kind: HandleKind,
    change: Partial<ItemGeom>,
  ) => void
}

export interface UseStageHandleReturn {
  active: Ref<StageHandleActive | null>
  begin: (args: BeginHandleArgs) => void
  cancel: () => void
}

const DRAG_THRESHOLD_PX = 2

export function useStageHandle(opts: UseStageHandleOptions): UseStageHandleReturn {
  const active = ref<StageHandleActive | null>(null) as Ref<StageHandleActive | null>
  const minSize = opts.minSize ?? 1

  interface PendingState {
    kind: HandleKind
    itemId: string
    original: ItemGeom
    pointerId: number
    hitEl: HTMLElement
    cssToCompScale: { x: number; y: number }
    canvasRect: { left: number; top: number; width: number; height: number }
    canvasComp: { width: number; height: number }
    /** World coords of cursor at pointerdown. */
    startWorldX: number
    startWorldY: number
    /** Client coords of cursor at pointerdown (CSS px). */
    startClientX: number
    startClientY: number
  }

  let pending: PendingState | null = null
  let armed = false
  let shiftPressed = false
  let lastClientX = 0
  let lastClientY = 0

  function suppressNextClick(e: MouseEvent): void {
    e.stopPropagation()
    e.preventDefault()
  }

  function clientToWorld(
    p: PendingState,
    clientX: number,
    clientY: number,
  ): { x: number; y: number } {
    const rx = (clientX - p.canvasRect.left) / p.canvasRect.width
    const ry = (clientY - p.canvasRect.top) / p.canvasRect.height
    return {
      x: rx * p.canvasComp.width,
      y: ry * p.canvasComp.height,
    }
  }

  function arm(): void {
    if (!pending) return
    armed = true
    document.body.style.cursor =
      pending.kind === 'rot' ? 'crosshair' : 'grabbing'
    document.body.style.userSelect = 'none'
    active.value = {
      kind: pending.kind,
      itemId: pending.itemId,
      original: pending.original,
      current: { ...pending.original },
    }
  }

  function recomputeFromLast(): void {
    if (!pending || !armed || !active.value) return
    const dxCss = lastClientX - pending.startClientX
    const dyCss = lastClientY - pending.startClientY
    const dxWorld = dxCss * pending.cssToCompScale.x
    const dyWorld = dyCss * pending.cssToCompScale.y

    if (pending.kind === 'rot') {
      const cur = clientToWorld(pending, lastClientX, lastClientY)
      const rotation = computeRotation({
        geom: pending.original,
        startCursorX: pending.startWorldX,
        startCursorY: pending.startWorldY,
        cursorX: cur.x,
        cursorY: cur.y,
        snap15: shiftPressed,
      })
      active.value = {
        ...active.value,
        current: { ...pending.original, rotation },
      }
      return
    }

    const r = computeResize({
      handle: pending.kind as ResizeHandleKind,
      geom: pending.original,
      deltaWorldX: dxWorld,
      deltaWorldY: dyWorld,
      preserveAspect: shiftPressed,
      minSize,
    })
    active.value = {
      ...active.value,
      current: {
        ...pending.original,
        width: r.width,
        height: r.height,
        x: r.x,
        y: r.y,
      },
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (!pending) return
    if (e.pointerId !== pending.pointerId) return
    shiftPressed = e.shiftKey
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
    const kind = pending.kind
    const original = pending.original
    const hitEl = pending.hitEl
    hitEl.addEventListener('click', suppressNextClick, { capture: true, once: true })
    setTimeout(() => {
      hitEl.removeEventListener('click', suppressNextClick, true)
    }, 0)
    teardown()
    if (!snapshot) return
    const cur = snapshot.current

    const change: Partial<ItemGeom> = {}
    if (kind === 'rot') {
      if (cur.rotation !== original.rotation) change.rotation = cur.rotation
    } else {
      if (cur.width !== original.width) change.width = cur.width
      if (cur.height !== original.height) change.height = cur.height
      if (cur.x !== original.x) change.x = cur.x
      if (cur.y !== original.y) change.y = cur.y
    }
    if (Object.keys(change).length === 0) return
    opts.onCommit(itemId, kind, change)
  }

  function onPointerCancel(): void {
    teardown()
  }

  function onKey(e: KeyboardEvent): void {
    if (!pending) return
    shiftPressed = e.shiftKey
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

  function begin(args: BeginHandleArgs): void {
    if (args.event.button !== 0) return
    cancel()
    const startWorld = (() => {
      const rx = (args.event.clientX - args.canvasRect.left) / args.canvasRect.width
      const ry = (args.event.clientY - args.canvasRect.top) / args.canvasRect.height
      return {
        x: rx * args.canvasComp.width,
        y: ry * args.canvasComp.height,
      }
    })()
    pending = {
      kind: args.kind,
      itemId: args.itemId,
      original: { ...args.geom },
      pointerId: args.event.pointerId,
      hitEl: args.hitElement,
      cssToCompScale: args.cssToCompScale,
      canvasRect: args.canvasRect,
      canvasComp: args.canvasComp,
      startWorldX: startWorld.x,
      startWorldY: startWorld.y,
      startClientX: args.event.clientX,
      startClientY: args.event.clientY,
    }
    armed = false
    shiftPressed = args.event.shiftKey
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
