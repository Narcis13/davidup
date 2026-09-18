// Pure math helpers for `useTimelineDrag` — step 11.
//
// Kept in its own file so the unit tests can import this module without
// dragging the composable's DOM-only references (`window`, `PointerEvent`,
// `document`) through tsc. Same trick `panelLayoutShape.ts` uses for the
// panel layout composable. The DOM half lives in `useTimelineDrag.ts`.
//
// v1.1 S27 — snapping is two-tier: an edge of another bar within
// `edgeThreshold` seconds wins (magnetic), otherwise the grid (`snapStep`,
// the frame duration in the editor) applies.

import { nearestEdge } from './timelineZoomMath.js'

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
  /** Other bars' edges (seconds) to magnetise towards (v1.1 S27). */
  edges?: readonly number[]
  /** Edge-snap radius in seconds; ≤0 / absent disables edge snapping. */
  edgeThreshold?: number
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
  const edges = args.edges ?? []
  const threshold = snap ? (args.edgeThreshold ?? 0) : 0
  const grid = (t: number): number => (snap && snapStep > 0 ? snapValue(t, snapStep) : t)
  const snapPoint = (t: number): number => nearestEdge(t, edges, threshold) ?? grid(t)
  if (mode === 'move') {
    let ns = originalStart + timeDelta
    // Either edge of the moving bar may catch another bar's edge; the closer
    // catch wins. No catch → the start snaps to the grid.
    const a = nearestEdge(ns, edges, threshold)
    const b = nearestEdge(ns + originalDuration, edges, threshold)
    const da = a === null ? Infinity : Math.abs(a - ns)
    const db = b === null ? Infinity : Math.abs(b - (ns + originalDuration))
    if (a !== null && da <= db) ns = a
    else if (b !== null) ns = b - originalDuration
    else ns = grid(ns)
    ns = Math.max(0, ns)
    if (compositionDuration > 0) {
      ns = Math.min(ns, Math.max(0, compositionDuration - originalDuration))
    }
    return { start: ns, duration: originalDuration }
  }
  if (mode === 'resize-left') {
    let ns = snapPoint(originalStart + timeDelta)
    ns = Math.max(0, ns)
    const maxStart = originalStart + originalDuration - minDuration
    ns = Math.min(ns, maxStart)
    return { start: ns, duration: originalStart + originalDuration - ns }
  }
  // resize-right
  let ne = snapPoint(originalStart + originalDuration + timeDelta)
  ne = Math.max(originalStart + minDuration, ne)
  if (compositionDuration > 0) ne = Math.min(ne, compositionDuration)
  return { start: originalStart, duration: ne - originalStart }
}
