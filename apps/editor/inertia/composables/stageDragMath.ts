// Pure math helpers for `useStageDrag` (UX_GAPS §G phase 1).
//
// Kept in its own file so the unit tests can import it without dragging the
// composable's DOM-only references (`window`, `PointerEvent`, `document`)
// through tsc — same trick `timelineDragMath.ts` uses for timeline drag.

export interface ComputeDraggedPositionArgs {
  /** Item's authored transform.x at drag start. */
  originalX: number
  /** Item's authored transform.y at drag start. */
  originalY: number
  /** Cursor delta along x in composition pixels (CSS-px delta × scaleX). */
  deltaX: number
  /** Cursor delta along y in composition pixels. */
  deltaY: number
  /** Snap step in composition pixels. ≤0 disables snapping. */
  snapStep: number
  /** When false, snapping is bypassed regardless of step (e.g. Alt held). */
  snap: boolean
}

export function snapValue(v: number, step: number): number {
  if (step <= 0) return v
  return Math.round(v / step) * step
}

export function roundCoord(n: number): number {
  // Two decimal places is more than enough for pixel positions and avoids
  // the 0.30000000000000004 noise that creeps in when scaling CSS deltas
  // through composition-px conversion.
  return Math.round(n * 100) / 100
}

export function computeDraggedPosition(
  args: ComputeDraggedPositionArgs
): { x: number; y: number } {
  const { originalX, originalY, deltaX, deltaY, snapStep, snap } = args
  const doSnap = snap && snapStep > 0
  let nx = originalX + deltaX
  let ny = originalY + deltaY
  if (doSnap) {
    nx = snapValue(nx, snapStep)
    ny = snapValue(ny, snapStep)
  }
  return { x: roundCoord(nx), y: roundCoord(ny) }
}
