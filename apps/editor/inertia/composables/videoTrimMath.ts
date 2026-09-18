// Pure math helpers for `useVideoTrimDrag` — U5 (Timeline video trim handles).
//
// Kept separate from the DOM-touching composable so unit tests can import it
// without dragging `window`/`PointerEvent` through tsc — same convention as
// `timelineDragMath.ts` for `useTimelineDrag`.
//
// Unlike a tween's {start, duration} (clamped against the composition
// duration), `trimIn`/`trimOut` are anchored to the *source asset's* time
// axis: `trimIn` can't cross `trimOut` (minus a small epsilon so the visible
// window never collapses to zero), and `trimOut` can't exceed the asset's
// registered duration when it's known.

const MIN_TRIM_WINDOW = 0.05

export function snapTrim(t: number, step: number): number {
  if (step <= 0) return t
  return Math.round(t / step) * step
}

export interface ComputeTrimInArgs {
  originalTrimIn: number
  /** Current (possibly in-flight) trimOut — the upper bound for trimIn. */
  trimOutBound: number
  timeDelta: number
  snapStep: number
  snap: boolean
}

export function computeTrimIn(args: ComputeTrimInArgs): number {
  let v = args.originalTrimIn + args.timeDelta
  if (args.snap && args.snapStep > 0) v = snapTrim(v, args.snapStep)
  const upper = Math.max(0, args.trimOutBound - MIN_TRIM_WINDOW)
  return Math.min(upper, Math.max(0, v))
}

export interface ComputeTrimOutArgs {
  originalTrimOut: number
  /** Current (possibly in-flight) trimIn — the lower bound for trimOut. */
  trimInBound: number
  timeDelta: number
  /** Asset's registered duration in seconds, or null when unknown (no upper clamp). */
  assetDuration: number | null
  snapStep: number
  snap: boolean
}

export function computeTrimOut(args: ComputeTrimOutArgs): number {
  let v = args.originalTrimOut + args.timeDelta
  if (args.snap && args.snapStep > 0) v = snapTrim(v, args.snapStep)
  const upper = args.assetDuration !== null ? args.assetDuration : Number.POSITIVE_INFINITY
  const lower = args.trimInBound + MIN_TRIM_WINDOW
  return Math.min(upper, Math.max(lower, v))
}

