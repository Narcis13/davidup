// Pure math for timeline zoom + snapping — v1.1 S27.
//
// DOM-free so the unit tests import it directly (same split as
// `timelineDragMath.ts`). Covers:
//   - zoom: clamping `pxPerSecond`, the ⌘+/− step, fit-to-width, the log-scale
//     slider mapping, and ruler tick spacing that stays legible at any zoom.
//   - snap: frame-boundary snapping (1/fps grid) plus magnetic snapping to
//     other bars' edges within a pixel threshold.
//
// Zoom is stored as `pxPerSecond: number | null`; `null` means "fit" — the
// whole composition fills the visible lane width, whatever that is.

/** Most zoomed-in: 40 px per frame at 60 fps. */
export const MAX_PX_PER_SECOND = 2400
/** Floor for explicit zoom when the fit width is unknown / degenerate. */
export const MIN_PX_PER_SECOND = 1
/** Multiplicative ⌘+ / ⌘− step. */
export const ZOOM_STEP = 1.5
/** Magnetic edge-snap radius, in screen pixels. */
export const EDGE_SNAP_PX = 6

/** Parse a composition fps (number or rational "N/D", v1.1 S7) to a float. */
export function fpsToNumber(fps: unknown): number {
  if (typeof fps === 'number') return Number.isFinite(fps) && fps > 0 ? fps : 0
  if (typeof fps === 'string') {
    const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(fps)
    if (m) {
      const n = Number(m[1])
      const d = Number(m[2])
      return d > 0 && n > 0 ? n / d : 0
    }
    const n = Number(fps)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  return 0
}

/** Pixels per second that fits `duration` into `viewportPx`. 0 when unknown. */
export function fitPxPerSecond(viewportPx: number, duration: number): number {
  if (!(viewportPx > 0) || !(duration > 0)) return 0
  return viewportPx / duration
}

/**
 * Clamp an explicit zoom. Zooming out to (or past) the fit level collapses
 * to `null` ("fit") — there is nothing useful narrower than the whole clip.
 */
export function clampPxPerSecond(pps: number, fitPps: number): number | null {
  if (!Number.isFinite(pps)) return null
  const floor = Math.max(MIN_PX_PER_SECOND, fitPps)
  if (pps <= floor * 1.0001) return null
  return Math.min(MAX_PX_PER_SECOND, pps)
}

/** The px/s actually painted: the explicit zoom, or the fit level. */
export function effectivePxPerSecond(pps: number | null, fitPps: number): number {
  if (pps !== null && pps > 0) return pps
  return fitPps > 0 ? fitPps : MIN_PX_PER_SECOND
}

/** One ⌘+ (dir = 1) or ⌘− (dir = −1) step from the current zoom. */
export function zoomStep(pps: number | null, fitPps: number, dir: 1 | -1): number | null {
  const current = effectivePxPerSecond(pps, fitPps)
  const next = dir > 0 ? current * ZOOM_STEP : current / ZOOM_STEP
  return clampPxPerSecond(next, fitPps)
}

/** Log-scale slider position in [0, 1] for a zoom level. 0 ≡ fit. */
export function zoomToSlider(pps: number | null, fitPps: number): number {
  const lo = Math.log(Math.max(MIN_PX_PER_SECOND, fitPps))
  const hi = Math.log(MAX_PX_PER_SECOND)
  if (hi <= lo) return 0
  const v = Math.log(effectivePxPerSecond(pps, fitPps))
  return Math.min(1, Math.max(0, (v - lo) / (hi - lo)))
}

/** Inverse of {@link zoomToSlider}. */
export function sliderToZoom(pos: number, fitPps: number): number | null {
  const lo = Math.log(Math.max(MIN_PX_PER_SECOND, fitPps))
  const hi = Math.log(MAX_PX_PER_SECOND)
  const p = Math.min(1, Math.max(0, pos))
  return clampPxPerSecond(Math.exp(lo + (hi - lo) * p), fitPps)
}

/**
 * New horizontal scroll offset that keeps the time under `anchorPx` (measured
 * from the lane's left edge in the viewport) fixed across a zoom change.
 */
export function anchoredScrollLeft(args: {
  scrollLeft: number
  anchorPx: number
  oldPps: number
  newPps: number
}): number {
  const { scrollLeft, anchorPx, oldPps, newPps } = args
  if (!(oldPps > 0) || !(newPps > 0)) return scrollLeft
  const t = (scrollLeft + anchorPx) / oldPps
  return Math.max(0, t * newPps - anchorPx)
}

const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

/**
 * Ruler spacing for a zoom level: `major` (labelled) ticks at least
 * `minMajorPx` apart, `minor` ticks subdividing them. Once a single frame is
 * wider than ~8 px, minor ticks drop to frame boundaries.
 */
export function rulerTickSpec(
  pps: number,
  fps: number,
  minMajorPx = 64,
): { major: number; minor: number } {
  const safe = pps > 0 ? pps : 1
  let major = TICK_STEPS[TICK_STEPS.length - 1]
  for (const s of TICK_STEPS) {
    if (s * safe >= minMajorPx) {
      major = s
      break
    }
  }
  const frame = fps > 0 ? 1 / fps : 0
  let minor = major / (major === 0.25 || major === 5 || major === 15 ? 5 : 4)
  if (major === 0.1) minor = major / 2
  if (frame > 0 && frame * safe >= 8 && frame < major) minor = frame
  return { major, minor }
}

/**
 * Build ruler ticks over [0, duration] for a tick spec. Majors and minors are
 * laid out on their own grids and merged — a 0.25 s major is not a multiple of
 * a 1/30 s frame minor, so deriving majors from the minor grid would drop it.
 */
export function buildRulerTicks(
  duration: number,
  spec: { major: number; minor: number },
): Array<{ t: number; major: boolean }> {
  if (!(duration > 0) || !(spec.major > 0) || !(spec.minor > 0)) return []
  // Hard cap so a pathological spec can't hang the tab.
  const CAP = 20000
  const round = (t: number): number => Math.round(t * 1e6) / 1e6
  const majors: number[] = []
  const majorCount = Math.min(Math.floor(duration / spec.major + 1e-6), CAP)
  for (let i = 0; i <= majorCount; i += 1) majors.push(round(i * spec.major))
  const eps = spec.minor * 1e-3
  const out: Array<{ t: number; major: boolean }> = majors.map((t) => ({ t, major: true }))
  const minorCount = Math.min(Math.floor(duration / spec.minor + 1e-6), CAP)
  let m = 0
  for (let i = 0; i <= minorCount; i += 1) {
    const t = round(i * spec.minor)
    while (m < majors.length - 1 && majors[m] < t - eps) m += 1
    const nearMajor =
      Math.abs(majors[m] - t) <= eps || (m > 0 && Math.abs(majors[m - 1] - t) <= eps)
    if (!nearMajor) out.push({ t, major: false })
  }
  out.sort((a, b) => a.t - b.t)
  return out
}

/** Ruler label: "3s", "1.5s", "0:30", "2:00". */
export function formatTickLabel(t: number): string {
  if (t >= 60 && Number.isInteger(t)) {
    const m = Math.floor(t / 60)
    const s = t % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }
  return `${Math.round(t * 100) / 100}s`
}

/** Snap `t` to the nearest frame boundary. `fps ≤ 0` leaves it unchanged. */
export function snapToFrame(t: number, fps: number): number {
  if (!(fps > 0)) return t
  return Math.round(t * fps) / fps
}

/**
 * Nearest edge in `edges` within `threshold` seconds of `t`, or null.
 * Ties resolve to the earlier edge (stable, first wins).
 */
export function nearestEdge(t: number, edges: readonly number[], threshold: number): number | null {
  if (!(threshold > 0)) return null
  let best: number | null = null
  let bestDist = Infinity
  for (const e of edges) {
    const d = Math.abs(e - t)
    if (d <= threshold && d < bestDist) {
      best = e
      bestDist = d
    }
  }
  return best
}

/**
 * Snap targets for a drag: every bar edge on the timeline except the dragged
 * bar's own. Deduped and sorted.
 */
export function collectEdges(
  spans: ReadonlyArray<{ id: string; start: number; end: number }>,
  excludeId: string | null,
): number[] {
  const set = new Set<number>()
  for (const s of spans) {
    if (s.id === excludeId) continue
    if (Number.isFinite(s.start)) set.add(s.start)
    if (Number.isFinite(s.end)) set.add(s.end)
  }
  return [...set].sort((x, y) => x - y)
}
