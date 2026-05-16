// Pure math helpers for `useTimelineDrag` — step 11.
//
// Kept in its own file so the unit tests can import this module without
// dragging the composable's DOM-only references (`window`, `PointerEvent`,
// `document`) through tsc. Same trick `panelLayoutShape.ts` uses for the
// panel layout composable. The DOM half lives in `useTimelineDrag.ts`.

export type DragMode = 'move' | 'resize-left' | 'resize-right'

export interface ComputeDragArgs {
  mode: DragMode
  originalStart: number
  originalDuration: number
  /** Time-delta in seconds from `(clientX - startX) / laneWidth * duration`. */
  timeDelta: number
  /** Composition duration in seconds; ≤0 disables the right-edge clamp. */
  compositionDuration: number
  /** Snap step in seconds. Pass 0 to disable. */
  snapStep: number
  /** Smallest duration the tween may shrink to. */
  minDuration: number
  /** Disable snap without changing the step (e.g. Alt held). */
  snap: boolean
}

export function snapValue(t: number, step: number): number {
  if (step <= 0) return t
  return Math.round(t / step) * step
}

export function roundTime(n: number): number {
  return Math.round(n * 10000) / 10000
}

export function computeDragValues(args: ComputeDragArgs): { start: number; duration: number } {
  const {
    mode,
    originalStart,
    originalDuration,
    timeDelta,
    compositionDuration,
    snapStep,
    minDuration,
    snap,
  } = args
  const doSnap = snap && snapStep > 0
  if (mode === 'move') {
    let ns = originalStart + timeDelta
    if (doSnap) ns = snapValue(ns, snapStep)
    ns = Math.max(0, ns)
    if (compositionDuration > 0) {
      ns = Math.min(ns, Math.max(0, compositionDuration - originalDuration))
    }
    return { start: ns, duration: originalDuration }
  }
  if (mode === 'resize-left') {
    let ns = originalStart + timeDelta
    if (doSnap) ns = snapValue(ns, snapStep)
    ns = Math.max(0, ns)
    const maxStart = originalStart + originalDuration - minDuration
    ns = Math.min(ns, maxStart)
    return { start: ns, duration: originalStart + originalDuration - ns }
  }
  // resize-right
  let ne = originalStart + originalDuration + timeDelta
  if (doSnap) ne = snapValue(ne, snapStep)
  ne = Math.max(originalStart + minDuration, ne)
  if (compositionDuration > 0) ne = Math.min(ne, compositionDuration)
  return { start: originalStart, duration: ne - originalStart }
}
