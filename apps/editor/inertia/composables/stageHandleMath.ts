// Pure math helpers for `useStageHandle` (UX_GAPS §G phase 2).
//
// Two operations, both deterministic given the item's transform + cursor
// delta:
//   • computeResize — corner / edge handle drag → new {width, height, x, y}
//     such that the opposite anchor of the bounding rect stays fixed in
//     world coords.
//   • computeRotation — top-edge rotation handle drag → new rotation around
//     the item's pivot in radians.
//
// Kept DOM-free so the unit tests can import without dragging window /
// PointerEvent through tsc — mirrors `stageDragMath.ts`.

export type ResizeHandleKind = 'tl' | 't' | 'tr' | 'r' | 'br' | 'b' | 'bl' | 'l'

export interface ItemGeom {
  /** Pivot x (transform.x) in composition pixels. */
  x: number
  /** Pivot y (transform.y). */
  y: number
  /** Item's local width (pre-scale). */
  width: number
  /** Item's local height (pre-scale). */
  height: number
  scaleX: number
  scaleY: number
  /** Rotation in radians. */
  rotation: number
  /** 0..1; default 0.5. */
  anchorX: number
  /** 0..1; default 0.5. */
  anchorY: number
}

export interface ResizeArgs {
  handle: ResizeHandleKind
  geom: ItemGeom
  /** Cursor delta from drag start in WORLD (composition) coords. */
  deltaWorldX: number
  deltaWorldY: number
  /** Lock aspect ratio while resizing (Shift held). Ignored for edge handles. */
  preserveAspect: boolean
  /** Minimum local width/height. */
  minSize: number
}

export interface ResizeResult {
  width: number
  height: number
  x: number
  y: number
}

/** rx ∈ {0, 0.5, 1} based on handle's horizontal position. */
function rxFor(h: ResizeHandleKind): number {
  if (h === 'tl' || h === 'l' || h === 'bl') return 0
  if (h === 't' || h === 'b') return 0.5
  return 1
}
/** ry ∈ {0, 0.5, 1} based on handle's vertical position. */
function ryFor(h: ResizeHandleKind): number {
  if (h === 'tl' || h === 't' || h === 'tr') return 0
  if (h === 'l' || h === 'r') return 0.5
  return 1
}

function rotate(x: number, y: number, theta: number): { x: number; y: number } {
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  return { x: c * x - s * y, y: s * x + c * y }
}

export function computeResize(args: ResizeArgs): ResizeResult {
  const { handle, geom, deltaWorldX, deltaWorldY, preserveAspect, minSize } = args
  const rx = rxFor(handle)
  const ry = ryFor(handle)

  // Cursor delta in the item's local (unrotated) frame.
  const local = rotate(deltaWorldX, deltaWorldY, -geom.rotation)

  // Effective (post-scale) starting dimensions. We resize the effective
  // dimensions then divide by scale to land back on local width/height,
  // which is what update_item.props.width/height stores.
  const Wsx = Math.abs(geom.scaleX) < 1e-6 ? 1 : geom.scaleX
  const Wsy = Math.abs(geom.scaleY) < 1e-6 ? 1 : geom.scaleY
  const Weff = geom.width * Wsx
  const Heff = geom.height * Wsy

  // Δ effective dimension per handle:
  //   rx=1 (right)  → ΔW = +local.x
  //   rx=0 (left)   → ΔW = −local.x
  //   rx=0.5 (mid)  → ΔW = 0
  const sx = rx === 0.5 ? 0 : 2 * rx - 1
  const sy = ry === 0.5 ? 0 : 2 * ry - 1

  let newWeff = Weff + sx * local.x
  let newHeff = Heff + sy * local.y

  // Aspect-lock (Shift). Only meaningful for corner handles (sx≠0 && sy≠0).
  // Use the larger relative delta to drive both — feels natural in Figma /
  // Sketch where the cursor's farther-displaced axis wins.
  if (preserveAspect && sx !== 0 && sy !== 0 && Weff > 0 && Heff > 0) {
    const ratioW = newWeff / Weff
    const ratioH = newHeff / Heff
    const r = Math.abs(ratioW - 1) > Math.abs(ratioH - 1) ? ratioW : ratioH
    newWeff = Weff * r
    newHeff = Heff * r
  }

  // Clamp to minSize in LOCAL terms so the dispatched width/height never go
  // sub-pixel and trigger schema validation NON_NEG edges.
  const minWeff = minSize * Math.abs(Wsx)
  const minHeff = minSize * Math.abs(Wsy)
  if (newWeff < minWeff) newWeff = minWeff
  if (newHeff < minHeff) newHeff = minHeff

  const newW = newWeff / Wsx
  const newH = newHeff / Wsy

  // Keep the opposite reference point world-fixed. In LOCAL coords:
  //   old_opp = ((1-rx-anchorX)*Weff, (1-ry-anchorY)*Heff)
  //   new_opp = ((1-rx-anchorX)*newWeff, (1-ry-anchorY)*newHeff)
  //   item_xy_new = item_xy + R(theta) * (old_opp - new_opp)
  const ax = 1 - rx - geom.anchorX
  const ay = 1 - ry - geom.anchorY
  const oldOppX = ax * Weff
  const oldOppY = ay * Heff
  const newOppX = ax * newWeff
  const newOppY = ay * newHeff
  const worldDelta = rotate(oldOppX - newOppX, oldOppY - newOppY, geom.rotation)

  return {
    width: roundDim(newW),
    height: roundDim(newH),
    x: roundCoord(geom.x + worldDelta.x),
    y: roundCoord(geom.y + worldDelta.y),
  }
}

export interface RotateArgs {
  geom: ItemGeom
  /**
   * Cursor position in WORLD coords at drag start. The rotation handle
   * sits above the item's top edge; the initial angle from item center to
   * this point is the reference we measure deltas against.
   */
  startCursorX: number
  startCursorY: number
  /** Cursor position now. */
  cursorX: number
  cursorY: number
  /** Snap to 15° increments (Shift held). */
  snap15: boolean
}

/** Returns new rotation (radians). */
export function computeRotation(args: RotateArgs): number {
  const cx = args.geom.x
  const cy = args.geom.y
  const a0 = Math.atan2(args.startCursorY - cy, args.startCursorX - cx)
  const a1 = Math.atan2(args.cursorY - cy, args.cursorX - cx)
  let rot = args.geom.rotation + (a1 - a0)
  if (args.snap15) {
    const step = (Math.PI / 180) * 15
    rot = Math.round(rot / step) * step
  }
  // Normalise to (-PI, PI] for stable serialisation.
  while (rot > Math.PI) rot -= 2 * Math.PI
  while (rot <= -Math.PI) rot += 2 * Math.PI
  return roundAngle(rot)
}

export function roundCoord(n: number): number {
  return Math.round(n * 100) / 100
}

export function roundDim(n: number): number {
  return Math.round(n * 100) / 100
}

export function roundAngle(n: number): number {
  // 5 decimals ≈ 0.0006° — well below visual perception, keeps undo diffs
  // tight.
  return Math.round(n * 100000) / 100000
}
