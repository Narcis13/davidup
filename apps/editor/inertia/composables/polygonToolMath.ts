// Pure math for the stage polygon tool (v1.1 S26). Kept free of Vue / DOM so
// `tests/unit/polygon_tool.spec.ts` can lock the `add_shape` payload down.
//
// The engine draws polygon `points` in the item's local space (origin =
// transform x/y, shifted by anchor × width/height), so the tool:
//   - takes the clicked vertices in composition pixels,
//   - drops consecutive near-duplicates (a double-click to close lands two
//     clicks on the same spot before the dblclick fires),
//   - sizes the item to the vertices' bounding box (so the selection ring,
//     hit-test and anchor pivot all line up) with anchor 0.5 / 0.5,
//   - and rebases the points onto that box's top-left.

export type Point = readonly [number, number]

/** Vertices closer than this (composition px) to the previous one are dropped. */
export const POLYGON_DEDUPE_PX = 2

/** Minimum distinct vertices for a closable polygon. */
export const POLYGON_MIN_POINTS = 3

export function dedupePolygonPoints(points: ReadonlyArray<Point>): Point[] {
  const out: Point[] = []
  for (const p of points) {
    const prev = out[out.length - 1]
    if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) < POLYGON_DEDUPE_PX) continue
    out.push(p)
  }
  // The closing edge is implicit — a last vertex sitting on the first adds
  // nothing but a zero-length edge.
  if (out.length > 1) {
    const first = out[0]!
    const last = out[out.length - 1]!
    if (Math.hypot(last[0] - first[0], last[1] - first[1]) < POLYGON_DEDUPE_PX) out.pop()
  }
  return out
}

export function canClosePolygon(points: ReadonlyArray<Point>): boolean {
  return dedupePolygonPoints(points).length >= POLYGON_MIN_POINTS
}

/**
 * `add_shape kind:polygon` payload for the clicked vertices, or null when
 * fewer than three distinct vertices remain after de-duplication.
 */
export function buildPolygonShapePayload(
  layerId: string,
  points: ReadonlyArray<Point>,
): Record<string, unknown> | null {
  const pts = dedupePolygonPoints(points)
  if (pts.length < POLYGON_MIN_POINTS) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of pts) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  const width = maxX - minX
  const height = maxY - minY
  return {
    layerId,
    kind: 'polygon',
    x: minX + width / 2,
    y: minY + height / 2,
    width,
    height,
    points: pts.map(([x, y]) => [x - minX, y - minY]),
    fillColor: '#5b7cfa',
    anchorX: 0.5,
    anchorY: 0.5,
  }
}
