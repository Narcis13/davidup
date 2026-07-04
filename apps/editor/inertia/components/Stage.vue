<script setup lang="ts">
// Stage — step 14 extracted the canvas + drop surface into its own
// component, step 16 adds click-based hit-testing, step 20.18 layers a
// selection-ring overlay on top of the render canvas.
//
// Click flow:
//   1. user clicks somewhere on the canvas
//   2. event clientX/Y → composition pixels via getBoundingClientRect
//   3. pickItemAt(x, y) (current playhead) → { itemId, source? } | null
//   4. setSelectionFromPick(itemId, source) — Inspector switches to it
//
// Selection ring (step 20.18):
//   - A second `<canvas>` is stacked above the render canvas via
//     position: absolute. Both canvases share the same composition-space
//     resolution and CSS scaling, so the ring lines up with rendered pixels
//     without per-frame coordinate plumbing.
//   - Each animation frame we ask the driver for `getItemBoundsAt(id, t)`
//     (returns 4 corners in composition coords) and stroke the polygon.
//     Using the corners — not an axis-aligned rect — means the ring rotates
//     in lock-step with the selected item's transform.
//   - The overlay is purely visual: `pointer-events: none` so clicks fall
//     through to the picker canvas underneath.
//
// The canvas ref is still forwarded back to the page via `defineExpose` so
// `useStage` can keep its existing `Ref<HTMLCanvasElement | null>` contract.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Composition, Command } from '~/composables/useCommandBus'
import {
  buildCommandsForStageDrop,
  useLibraryDrag,
} from '~/composables/useLibraryDrag'
import { useActiveLayer } from '~/composables/useActiveLayer'
import { useItemToolbar, type PlaceTool } from '~/composables/useItemToolbar'
import { useSelection, type PickSourceInfo } from '~/composables/useSelection'
import { useStageDrag } from '~/composables/useStageDrag'
import {
  useStageHandle,
  type HandleKind,
} from '~/composables/useStageHandle'
import type { ItemGeom } from '~/composables/stageHandleMath'

interface PickHit {
  itemId: string
  source?: PickSourceInfo
}

interface ItemBounds {
  corners: ReadonlyArray<readonly [number, number]>
}

const props = defineProps<{
  composition: Composition | null
  /** Current playhead time in seconds — used for the drop's `start` field. */
  playhead: number
  /**
   * Hit-test fn supplied by the parent (the editor page wires
   * `stage.pickItemAt`). Optional so this component still mounts in
   * contexts where the driver isn't attached (SSR, empty project).
   */
  pickItemAt?: (x: number, y: number, t?: number) => PickHit | null
  /**
   * Bounding-box fn for the selection ring. Same optionality as
   * `pickItemAt` — when absent (no driver attached) the ring simply stays
   * hidden.
   */
  getItemBoundsAt?: (itemId: string, t?: number) => ItemBounds | null
  /**
   * Per-frame tick registration. The Stage component subscribes on mount
   * so it can redraw the selection-ring overlay in lock-step with the
   * engine's RAF, then unsubscribes on unmount. Returning the unsubscriber
   * matches `useStage().onTick`'s contract.
   */
  onTick?: (cb: () => void) => () => void
  /**
   * Current stage status. UX_FINDINGS §2 — when the comp is playing, a
   * pointerdown on the canvas calls `pause()` first so the click lands on
   * a stationary frame instead of selecting whatever happened to be under
   * the cursor at the random instant the event fired.
   */
  status?: string | null
  /** Pause the stage. Called on canvas pointerdown while status==='playing'. */
  pause?: () => void
}>()

const emit = defineEmits<{
  (event: 'apply', command: Command): void
}>()

const selection = useSelection()
const itemToolbar = useItemToolbar()
const activeLayer = useActiveLayer()

const canvas = ref<HTMLCanvasElement | null>(null)
const overlay = ref<HTMLCanvasElement | null>(null)
const stageWrap = ref<HTMLDivElement | null>(null)

defineExpose({ canvas })

const canvasWidth = computed(() => props.composition?.composition.width ?? 1280)
const canvasHeight = computed(() => props.composition?.composition.height ?? 720)
const aspect = computed(() => `${canvasWidth.value} / ${canvasHeight.value}`)

const libraryDrag = useLibraryDrag()
const isHover = computed(() => libraryDrag.hover.value === 'stage')

const layerForDropId = computed<string | null>(() =>
  activeLayer.resolveTarget(props.composition),
)

function dropAcceptsThisPayload(): boolean {
  const p = libraryDrag.payload.value
  return !!p && (p.kind === 'template' || p.kind === 'scene' || p.kind === 'asset')
}

function onDragEnter(event: DragEvent): void {
  if (!dropAcceptsThisPayload()) return
  event.preventDefault()
  libraryDrag.setHover('stage', null)
}

function onDragOver(event: DragEvent): void {
  if (!dropAcceptsThisPayload()) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onDragLeave(event: DragEvent): void {
  // dragleave fires on every child boundary crossing; bail unless we're
  // exiting the wrap entirely (relatedTarget outside the element).
  const related = event.relatedTarget
  if (related instanceof Node && stageWrap.value?.contains(related)) return
  libraryDrag.clearHover('stage', null)
}

function dropCoordsToCanvas(event: DragEvent): { x: number; y: number } {
  const canvasEl = canvas.value
  if (!canvasEl) return { x: canvasWidth.value / 2, y: canvasHeight.value / 2 }
  const rect = canvasEl.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    return { x: canvasWidth.value / 2, y: canvasHeight.value / 2 }
  }
  const ratioX = (event.clientX - rect.left) / rect.width
  const ratioY = (event.clientY - rect.top) / rect.height
  return {
    x: Math.round(Math.max(0, Math.min(1, ratioX)) * canvasWidth.value),
    y: Math.round(Math.max(0, Math.min(1, ratioY)) * canvasHeight.value),
  }
}

function onDrop(event: DragEvent): void {
  event.preventDefault()
  const payload = libraryDrag.readDropPayload(event)
  libraryDrag.onDragEnd()
  if (!payload) return
  const layerId = layerForDropId.value
  if (!layerId) return
  const { x, y } = dropCoordsToCanvas(event)
  const start = Math.max(0, props.playhead)
  const commands = buildCommandsForStageDrop(payload, {
    layerId,
    x,
    y,
    start,
  })
  for (const cmd of commands) emit('apply', cmd)
}

function clickCoordsToCanvas(event: MouseEvent): { x: number; y: number } | null {
  const canvasEl = canvas.value
  if (!canvasEl) return null
  const rect = canvasEl.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const ratioX = (event.clientX - rect.left) / rect.width
  const ratioY = (event.clientY - rect.top) / rect.height
  if (ratioX < 0 || ratioX > 1 || ratioY < 0 || ratioY > 1) return null
  return {
    // Floor (not round) so a click at fractional CSS coords still indexes the
    // pixel under the cursor, never one past the right/bottom edge.
    x: Math.floor(ratioX * canvasWidth.value),
    y: Math.floor(ratioY * canvasHeight.value),
  }
}

function buildPlaceCommand(
  tool: PlaceTool,
  layerId: string,
  x: number,
  y: number,
): Command | null {
  switch (tool.kind) {
    case 'shape-rect':
      return {
        kind: 'add_shape',
        payload: {
          layerId,
          kind: 'rect',
          x,
          y,
          width: 240,
          height: 120,
          fillColor: '#5b7cfa',
          cornerRadius: 8,
          anchorX: 0.5,
          anchorY: 0.5,
        },
        source: 'ui',
      }
    case 'shape-circle':
      return {
        kind: 'add_shape',
        payload: {
          layerId,
          kind: 'circle',
          x,
          y,
          width: 160,
          height: 160,
          fillColor: '#5b7cfa',
          anchorX: 0.5,
          anchorY: 0.5,
        },
        source: 'ui',
      }
    case 'text':
      return {
        kind: 'add_text',
        payload: {
          layerId,
          text: tool.text,
          // The toolbar gates the text button on `fontAssets.length > 0`, so
          // there is always at least one font registered. We rely on the
          // composition we read at click time having one too; on the off
          // chance it doesn't, the server validator will surface the issue.
          font: firstFontAssetId() ?? 'default',
          fontSize: 48,
          color: '#ffffff',
          x,
          y,
          anchorX: 0.5,
          anchorY: 0.5,
          align: 'center',
        },
        source: 'ui',
      }
    case 'sprite':
      return {
        kind: 'add_sprite',
        payload: {
          layerId,
          asset: tool.asset,
          x,
          y,
          width: 240,
          height: 240,
          anchorX: 0.5,
          anchorY: 0.5,
        },
        source: 'ui',
      }
  }
}

function firstFontAssetId(): string | null {
  const assets = props.composition?.assets
  if (!Array.isArray(assets)) return null
  for (const a of assets as Array<{ id?: unknown; type?: unknown }>) {
    if (a?.type === 'font' && typeof a.id === 'string') return a.id
  }
  return null
}

function snapshotItemIds(): Set<string> {
  const items = (props.composition as { items?: Record<string, unknown> } | null)?.items
  return new Set(items && typeof items === 'object' ? Object.keys(items) : [])
}

// Emit a place-mode command and promote the freshly-created item to the
// active selection once the bus's response lands. Without this, the
// Inspector keeps showing the previously selected item until the user
// clicks the new one on canvas (UX_FINDINGS §5). The bus is async, and
// Stage doesn't have a direct handle to it — instead we diff
// `props.composition.items` against a pre-emit snapshot and pick up the
// new id from the next composition update. A timeout drops the watcher
// if the apply fails so a later unrelated update can't latch onto it.
function placeAndSelect(command: Command): void {
  const beforeIds = snapshotItemIds()
  let resolved = false
  const stop = watch(
    () => props.composition,
    (next) => {
      if (resolved) return
      const items = (next as { items?: Record<string, unknown> } | null)?.items
      if (!items || typeof items !== 'object') {
        resolved = true
        clearTimeout(timer)
        stop()
        return
      }
      for (const id of Object.keys(items)) {
        if (!beforeIds.has(id)) {
          resolved = true
          clearTimeout(timer)
          stop()
          selection.setSelectionFromPick(id, null)
          return
        }
      }
      // Composition changed but no new item appeared — bail so we don't
      // latch onto an unrelated future addition.
      resolved = true
      clearTimeout(timer)
      stop()
    },
  )
  const timer = setTimeout(() => {
    if (resolved) return
    resolved = true
    stop()
  }, 5000)
  emit('apply', command)
}

// ──────────────── Drag-to-move (UX_GAPS §G phase 1) ────────────────
//
// Pointer-down on the canvas hit-tests for an item; if found, we stage a
// pending drag. The composable arms the drag only after the pointer crosses
// a small threshold so taps still flow through to `onCanvasClick`. On
// commit, we emit a single `update_item` with the new {x, y} — server
// validation and persistence run through the same code path as the
// Inspector's number-field edits (see Inspector.vue's dispatchEdit).
const drag = useStageDrag({
  // 1 composition-pixel snap. Holding Alt during the drag disables it for
  // sub-pixel nudges. Matches the timeline's Alt-bypass behaviour.
  snapStep: 1,
  onCommit(itemId, position) {
    emit('apply', {
      kind: 'update_item',
      payload: { id: itemId, props: { x: position.x, y: position.y } },
      source: 'ui',
    })
  },
  onArm(itemId) {
    // Promote the dragged item to the active selection so the ring follows
    // the ghost. We don't have a source-map entry for a drag-arm (the
    // composable doesn't pick — Stage did, and discarded the source info),
    // so pass null; the Inspector still resolves the rest of its state by
    // id alone.
    if (selection.selectedItemId.value !== itemId) {
      selection.setSelectionFromPick(itemId, null)
    }
  },
})

function getItemPosition(itemId: string): { x: number; y: number } | null {
  const items = (props.composition as { items?: unknown } | null)?.items
  if (!items || typeof items !== 'object') return null
  const it = (items as Record<string, unknown>)[itemId]
  if (!it || typeof it !== 'object') return null
  const t = (it as { transform?: unknown }).transform
  if (!t || typeof t !== 'object') return null
  const tx = (t as { x?: unknown }).x
  const ty = (t as { y?: unknown }).y
  if (typeof tx !== 'number' || typeof ty !== 'number') return null
  return { x: tx, y: ty }
}

// §M lock: items flagged `locked: true` are still selectable from the stage
// (so the user can see they're locked) but their pointer drag and resize/
// rotate handles are no-ops. The Inspector banner is the canonical way out.
function isItemLocked(itemId: string): boolean {
  const items = (props.composition as { items?: unknown } | null)?.items
  if (!items || typeof items !== 'object') return false
  const it = (items as Record<string, unknown>)[itemId]
  if (!it || typeof it !== 'object') return false
  return (it as { locked?: unknown }).locked === true
}

// Resolve the full transform + width/height for an item, with safe defaults
// for fields the engine fills in implicitly. Returns null if the item is
// missing or of a type that can't be resize-/rotate-manipulated (text,
// group — see UX_GAPS §G).
function getResolvableItem(
  itemId: string,
): { type: string; geom: ItemGeom } | null {
  const items = (props.composition as { items?: unknown } | null)?.items
  if (!items || typeof items !== 'object') return null
  const it = (items as Record<string, unknown>)[itemId]
  if (!it || typeof it !== 'object') return null
  const obj = it as {
    type?: unknown
    transform?: Record<string, unknown>
    width?: unknown
    height?: unknown
  }
  const type = typeof obj.type === 'string' ? obj.type : ''
  // U6 — video items are spatially a box exactly like a sprite (the browser
  // driver's corner/anchor math already treats them identically), so they
  // get the same resize/rotate handles.
  if (type !== 'shape' && type !== 'sprite' && type !== 'video') return null
  const t = obj.transform ?? {}
  const num = (v: unknown, d: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : d
  const width = typeof obj.width === 'number' ? obj.width : 0
  const height = typeof obj.height === 'number' ? obj.height : 0
  if (width <= 0 || height <= 0) return null
  return {
    type,
    geom: {
      x: num(t.x, 0),
      y: num(t.y, 0),
      width,
      height,
      scaleX: num(t.scaleX, 1),
      scaleY: num(t.scaleY, 1),
      rotation: num(t.rotation, 0),
      anchorX: num(t.anchorX, 0.5),
      anchorY: num(t.anchorY, 0.5),
    },
  }
}

// ──────────────── Resize + rotation handles (UX_GAPS §G phase 2) ────────────────
//
// HTML divs sit on top of the selection-ring overlay (which is
// pointer-events: none) and own their own pointer events. The handle's
// pointerdown captures the item's geometry snapshot, then useStageHandle
// runs the live drag against window-level listeners — same shape as
// useStageDrag. On commit we emit a single `update_item` carrying the
// changed props (width/height/x/y for resize; rotation for rotate).
const handleDrag = useStageHandle({
  minSize: 1,
  onCommit(itemId, _kind, change) {
    emit('apply', {
      kind: 'update_item',
      payload: { id: itemId, props: change as Record<string, number> },
      source: 'ui',
    })
  },
})

// Compute the 4 world-space corners (TL, TR, BR, BL) of an item's local
// rect under its current geom. Mirrors what the engine's `getItemBoundsAt`
// returns — used as a local fallback during an in-progress resize/rotate so
// the ring + handles can track the cursor before the command is committed.
function computeCornersFromGeom(g: ItemGeom): Array<[number, number]> {
  const c = Math.cos(g.rotation)
  const s = Math.sin(g.rotation)
  const sx = g.scaleX
  const sy = g.scaleY
  const lefts: Array<[number, number]> = [
    [-g.anchorX * g.width, -g.anchorY * g.height],
    [(1 - g.anchorX) * g.width, -g.anchorY * g.height],
    [(1 - g.anchorX) * g.width, (1 - g.anchorY) * g.height],
    [-g.anchorX * g.width, (1 - g.anchorY) * g.height],
  ]
  return lefts.map(([lx, ly]) => {
    const px = lx * sx
    const py = ly * sy
    return [g.x + c * px - s * py, g.y + s * px + c * py] as [number, number]
  })
}

interface HandlePoint {
  x: number
  y: number
}
interface HandlePositions {
  tl: HandlePoint
  t: HandlePoint
  tr: HandlePoint
  r: HandlePoint
  br: HandlePoint
  b: HandlePoint
  bl: HandlePoint
  l: HandlePoint
  rot: HandlePoint
  /** Tangent angle of the top edge, used to align cursor-style hints. */
  topAngleDeg: number
}

// Wrap-relative CSS positions for each handle. Recomputed every tick + on
// reactive deps; null when no item is selected or the canvas hasn't laid
// out yet.
const handlePositions = ref<HandlePositions | null>(null)
const currentCorners = ref<Array<[number, number]> | null>(null)

function pickActiveCornersFor(id: string): Array<[number, number]> | null {
  // 1. Live resize/rotate: derive from in-progress geom (engine still
  //    renders the previous geometry until pointerup commits).
  const h = handleDrag.active.value
  if (h && h.itemId === id) {
    return computeCornersFromGeom(h.current)
  }
  // 2. Otherwise use engine bounds, offset by any in-progress translate.
  if (!props.getItemBoundsAt) return null
  const bounds = props.getItemBoundsAt(id)
  if (!bounds) return null
  let dx = 0
  let dy = 0
  const d = drag.active.value
  if (d && d.itemId === id) {
    dx = d.currentX - d.originalX
    dy = d.currentY - d.originalY
  }
  return bounds.corners.map(([x, y]) => [x + dx, y + dy] as [number, number])
}

// Project composition pixel → wrap-relative CSS pixel using the overlay's
// current synced rect (syncOverlayRect already wrote left/top/width/height
// styles, so they're authoritative for the on-screen mapping).
function recomputeHandlePositions(
  corners: ReadonlyArray<readonly [number, number]> | null,
): HandlePositions | null {
  if (!corners || corners.length < 4) return null
  const overlayEl = overlay.value
  if (!overlayEl) return null
  const ox = parseFloat(overlayEl.style.left || '0')
  const oy = parseFloat(overlayEl.style.top || '0')
  const ow = parseFloat(overlayEl.style.width || '0')
  const oh = parseFloat(overlayEl.style.height || '0')
  if (!ow || !oh) return null
  const sX = ow / canvasWidth.value
  const sY = oh / canvasHeight.value
  const proj = (cx: number, cy: number): HandlePoint => ({
    x: ox + cx * sX,
    y: oy + cy * sY,
  })
  const tl = proj(corners[0]![0], corners[0]![1])
  const tr = proj(corners[1]![0], corners[1]![1])
  const br = proj(corners[2]![0], corners[2]![1])
  const bl = proj(corners[3]![0], corners[3]![1])
  const mid = (a: HandlePoint, b: HandlePoint): HandlePoint => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  })
  const t = mid(tl, tr)
  const r = mid(tr, br)
  const b = mid(br, bl)
  const l = mid(bl, tl)
  // Outward normal on the top edge (rotate tangent by −90° in screen-Y-down
  // convention so the handle sits above the item, never overlapping it).
  const tx = tr.x - tl.x
  const ty = tr.y - tl.y
  const len = Math.hypot(tx, ty) || 1
  const nx = ty / len
  const ny = -tx / len
  const ROT_OFFSET = 28
  const rot = { x: t.x + nx * ROT_OFFSET, y: t.y + ny * ROT_OFFSET }
  return {
    tl,
    t,
    tr,
    r,
    br,
    b,
    bl,
    l,
    rot,
    topAngleDeg: (Math.atan2(ty, tx) * 180) / Math.PI,
  }
}

// Show handles only when a SINGLE item with a resolvable resize geom is
// selected (shape / sprite). Multi-selection (marquee) renders rings
// around each item but no handles — the bulk-transform UX is part of Gap
// Q's multi-select foundation. Text + group fall through to the
// hit-test click flow but expose no handles.
const showHandles = computed<boolean>(() => {
  if (selection.selectedItemIds.value.length !== 1) return false
  const id = selection.selectedItemId.value
  if (!id) return false
  if (isItemLocked(id)) return false
  return getResolvableItem(id) !== null
})

function onHandlePointerDown(event: PointerEvent, kind: HandleKind): void {
  if (event.button !== 0) return
  event.stopPropagation()
  // The handle div itself is the element that should receive the
  // trailing-click suppressor; tossing pointerdown to window-listeners is
  // useStageHandle's job from here.
  const id = selection.selectedItemId.value
  if (!id) return
  const item = getResolvableItem(id)
  if (!item) return
  const canvasEl = canvas.value
  if (!canvasEl) return
  const rect = canvasEl.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  handleDrag.begin({
    event,
    hitElement: event.currentTarget as HTMLElement,
    cssToCompScale: {
      x: canvasWidth.value / rect.width,
      y: canvasHeight.value / rect.height,
    },
    canvasRect: {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    },
    canvasComp: { width: canvasWidth.value, height: canvasHeight.value },
    kind,
    itemId: id,
    geom: item.geom,
  })
}

function cssToCompScaleFromCanvas(): { x: number; y: number } | null {
  const canvasEl = canvas.value
  if (!canvasEl) return null
  const rect = canvasEl.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return {
    x: canvasWidth.value / rect.width,
    y: canvasHeight.value / rect.height,
  }
}

function onCanvasPointerDown(event: PointerEvent): void {
  // Only the primary button initiates a drag — middle/right-click stay free
  // for future pan/context-menu work without colliding with item drag.
  if (event.button !== 0) return
  // Place mode and active library drags both own the next pointer event;
  // staging a drag here would race them.
  if (libraryDrag.isActive.value) return
  if (itemToolbar.activeTool.value) return
  if (!props.pickItemAt) return
  // UX_FINDINGS §2: while the comp is playing the scene under the cursor
  // changes every frame. Park the playhead on the just-rendered frame
  // before hit-testing so the click selects what the user actually sees.
  // The driver's pause() leaves `lastRenderedT` intact, and pickItemAt
  // defaults to that t — so the very next pick lines up with painted pixels.
  if (props.status === 'playing' && props.pause) {
    props.pause()
  }
  const coords = clickCoordsToCanvas(event)
  if (!coords) return
  const hit = props.pickItemAt(coords.x, coords.y)
  if (!hit) {
    // Empty stage — stage a marquee. The marquee only arms after the
    // pointer crosses a small threshold so a plain click still falls through
    // to onCanvasClick (which clears the selection).
    beginMarquee(event, coords)
    return
  }
  const pos = getItemPosition(hit.itemId)
  // Items without a numeric transform.x/y (e.g. groups whose position is
  // implicit) can't be dragged in phase 1 — let the click flow through and
  // just select them.
  if (!pos) return
  // Locked items: the click still selects them, but we don't stage a drag.
  if (isItemLocked(hit.itemId)) return
  const scale = cssToCompScaleFromCanvas()
  if (!scale) return
  const hitEl = (event.currentTarget as HTMLElement | null) ?? canvas.value
  if (!hitEl) return
  drag.begin({
    event,
    hitElement: hitEl,
    cssToCompScale: scale,
    itemId: hit.itemId,
    originalX: pos.x,
    originalY: pos.y,
  })
}

// ──────────────── Marquee multi-select (UX_GAPS §G phase 3) ────────────────
//
// Pointer-down on empty stage stages a marquee. Threshold-armed (3 px) so a
// plain click on empty space still clears the selection via onCanvasClick.
// On commit we iterate composition.items, AABB-test each item's bounds
// against the marquee rect, and call setMultiSelection with the hits in
// reverse layer order (topmost first). Inspector / Timeline still read
// selectedItemId as the "primary" — Gap Q tracks the broader multi-select
// integration; for now the ring renders for every lassoed id and the
// Inspector edits the first one.

interface MarqueeState {
  /** Start point in composition coords. */
  startX: number
  startY: number
  /** Live cursor position in composition coords. */
  curX: number
  curY: number
  /** True only after the pointer crossed the arm threshold. */
  armed: boolean
}

const marquee = ref<MarqueeState | null>(null)
let marqueePointerId: number | null = null
let marqueeStartClient: { x: number; y: number } | null = null

const MARQUEE_THRESHOLD_PX = 3

function beginMarquee(event: PointerEvent, coords: { x: number; y: number }): void {
  cancelMarquee()
  marqueePointerId = event.pointerId
  marqueeStartClient = { x: event.clientX, y: event.clientY }
  marquee.value = {
    startX: coords.x,
    startY: coords.y,
    curX: coords.x,
    curY: coords.y,
    armed: false,
  }
  window.addEventListener('pointermove', onMarqueeMove)
  window.addEventListener('pointerup', onMarqueeUp)
  window.addEventListener('pointercancel', onMarqueeCancel)
}

function onMarqueeMove(event: PointerEvent): void {
  if (marqueePointerId !== event.pointerId) return
  const state = marquee.value
  const start = marqueeStartClient
  if (!state || !start) return
  if (!state.armed) {
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.hypot(dx, dy) < MARQUEE_THRESHOLD_PX) return
    state.armed = true
  }
  const c = clickCoordsToCanvas(event)
  if (!c) return
  state.curX = c.x
  state.curY = c.y
  // Trigger reactivity: ref<MarqueeState> is shallow; replace to bump.
  marquee.value = { ...state }
  drawSelectionRing()
}

function onMarqueeUp(event: PointerEvent): void {
  if (marqueePointerId !== event.pointerId) return
  const state = marquee.value
  cancelMarquee()
  if (!state || !state.armed) return
  const minX = Math.min(state.startX, state.curX)
  const minY = Math.min(state.startY, state.curY)
  const maxX = Math.max(state.startX, state.curX)
  const maxY = Math.max(state.startY, state.curY)
  if (maxX - minX < 1 || maxY - minY < 1) return
  const hits = findItemsInRect(minX, minY, maxX, maxY)
  // Tiny suppressor so onCanvasClick (which runs after pointerup) doesn't
  // immediately clear the selection we just set.
  const canvasEl = canvas.value
  if (canvasEl) {
    const suppress = (e: MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
    }
    canvasEl.addEventListener('click', suppress, { capture: true, once: true })
    setTimeout(() => canvasEl.removeEventListener('click', suppress, true), 0)
  }
  selection.setMultiSelection(hits)
  drawSelectionRing()
}

function onMarqueeCancel(): void {
  cancelMarquee()
  drawSelectionRing()
}

function cancelMarquee(): void {
  window.removeEventListener('pointermove', onMarqueeMove)
  window.removeEventListener('pointerup', onMarqueeUp)
  window.removeEventListener('pointercancel', onMarqueeCancel)
  marquee.value = null
  marqueePointerId = null
  marqueeStartClient = null
}

// AABB intersection in composition coords. Iterates `composition.layers`
// from top-of-stack (last layer renders on top — first in the .layers array
// is back, last is front) so the returned list orders topmost-first.
function findItemsInRect(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): string[] {
  const comp = props.composition as
    | {
        layers?: ReadonlyArray<{ items?: ReadonlyArray<string> }>
        items?: Record<string, unknown>
      }
    | null
  if (!comp || !props.getItemBoundsAt) return []
  const layers = comp.layers ?? []
  const items = comp.items ?? {}
  const hits: string[] = []
  // Layers render back-to-front by index, so reverse-iterate for topmost first.
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    const ids = layer?.items ?? []
    for (let j = ids.length - 1; j >= 0; j--) {
      const id = ids[j]
      if (!id || !(id in items)) continue
      const bounds = props.getItemBoundsAt(id)
      if (!bounds) continue
      let bMinX = Infinity
      let bMinY = Infinity
      let bMaxX = -Infinity
      let bMaxY = -Infinity
      for (const [cx, cy] of bounds.corners) {
        if (cx < bMinX) bMinX = cx
        if (cy < bMinY) bMinY = cy
        if (cx > bMaxX) bMaxX = cx
        if (cy > bMaxY) bMaxY = cy
      }
      if (bMinX > maxX || bMaxX < minX || bMinY > maxY || bMaxY < minY) continue
      hits.push(id)
    }
  }
  return hits
}

function onCanvasClick(event: MouseEvent): void {
  if (libraryDrag.isActive.value) return

  // UX_FINDINGS §2 belt-and-suspenders: pointerdown normally pauses first,
  // but synthetic clicks (without a paired pointerdown) can still arrive
  // while playing. Pause is idempotent.
  if (props.status === 'playing' && props.pause) {
    props.pause()
  }

  // Toolbar place mode takes precedence over hit-testing: a click on the
  // canvas while a primitive tool is active drops the primitive at the
  // cursor position on the topmost layer, then clears the tool. We never
  // route the click through `pickItemAt` in this mode — `placeAndSelect`
  // diffs the composition once the bus response lands and promotes the
  // new id to the active selection (UX_FINDINGS §5).
  const tool = itemToolbar.activeTool.value
  if (tool) {
    const layerId = layerForDropId.value
    const coords = clickCoordsToCanvas(event)
    if (!layerId || !coords) {
      itemToolbar.clearTool()
      return
    }
    const command = buildPlaceCommand(tool, layerId, coords.x, coords.y)
    itemToolbar.clearTool()
    if (command) placeAndSelect(command)
    return
  }

  if (!props.pickItemAt) return
  const coords = clickCoordsToCanvas(event)
  if (!coords) return
  // Don't pass `props.playhead` — the editor's tracked playhead can drift
  // from the engine's actual frame time (tab throttling parks RAF; the
  // engine's self-termination past duration also leaves `playhead` ref
  // stale). The driver, when not given an explicit t, computes the same
  // clock value it just used to render — so picks always match pixels.
  const hit = props.pickItemAt(coords.x, coords.y)
  // Shift / Cmd-click extends the multi-selection — required for UX_GAPS §L
  // Group when the user wants to pick specific items rather than marquee
  // everything in a rectangle. Clicking the same id again toggles it off.
  const additive = event.shiftKey || event.metaKey || event.ctrlKey
  if (hit) {
    if (additive) {
      const current = selection.selectedItemIds.value
      const exists = current.includes(hit.itemId)
      const next = exists
        ? current.filter((id) => id !== hit.itemId)
        : [hit.itemId, ...current]
      selection.setMultiSelection(next)
    } else {
      selection.setSelectionFromPick(hit.itemId, hit.source ?? null)
    }
  } else if (!additive) {
    // Clicking empty stage clears the selection — matches Figma/Sketch.
    // Additive empty clicks preserve the existing multi-selection.
    selection.setSelectionFromPick(null)
  }
}

// ──────────────── Selection ring (step 20.18) ────────────────

function clearOverlay(): void {
  const overlayEl = overlay.value
  if (!overlayEl) return
  const ctx = overlayEl.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, overlayEl.width, overlayEl.height)
}

// Mirror the stage canvas's on-screen rect onto the overlay so the two
// stack pixel-for-pixel. The wrap is the overlay's offsetParent (it owns
// `position: relative`), so we subtract the wrap's client origin from the
// canvas's viewport rect to get wrap-relative coords.
function syncOverlayRect(): void {
  const overlayEl = overlay.value
  const canvasEl = canvas.value
  const wrapEl = stageWrap.value
  if (!overlayEl || !canvasEl || !wrapEl) return
  const c = canvasEl.getBoundingClientRect()
  const w = wrapEl.getBoundingClientRect()
  if (c.width <= 0 || c.height <= 0) return
  overlayEl.style.left = `${c.left - w.left}px`
  overlayEl.style.top = `${c.top - w.top}px`
  overlayEl.style.width = `${c.width}px`
  overlayEl.style.height = `${c.height}px`
}

function drawSelectionRing(): void {
  syncOverlayRect()
  const overlayEl = overlay.value
  if (!overlayEl) return
  const ctx = overlayEl.getContext('2d')
  if (!ctx) return

  // Always clear before deciding to paint — handles the case where the
  // selection was cleared between frames.
  ctx.clearRect(0, 0, overlayEl.width, overlayEl.height)

  // Scale the stroke so it appears as ~2 CSS px regardless of how much CSS
  // has shrunk the composition (e.g., 1280-wide comp painted into a
  // 600-wide stage). Falling back to 2 when the CSS rect hasn't laid out
  // yet keeps the first frame's ring visible.
  const rect = overlayEl.getBoundingClientRect()
  const scaleX = rect.width > 0 ? overlayEl.width / rect.width : 1
  const lineWidth = 2 * Math.max(scaleX, 1)

  const ids = selection.selectedItemIds.value
  const primaryId = selection.selectedItemId.value

  // For each selected id, draw a ring. Handles + currentCorners only track
  // the primary (first / single) selection so the Inspector + handle drag
  // both have a single source of truth.
  ctx.save()
  ctx.lineWidth = lineWidth
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#5b7cfa'

  let primaryCorners: Array<[number, number]> | null = null
  for (const id of ids) {
    const pts = pickActiveCornersFor(id)
    if (!pts || pts.length < 2) continue
    if (id === primaryId) primaryCorners = pts
    ctx.beginPath()
    ctx.moveTo(pts[0]![0], pts[0]![1])
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i]![0], pts[i]![1])
    }
    ctx.closePath()
    ctx.stroke()
  }
  ctx.restore()

  currentCorners.value = primaryCorners
  handlePositions.value =
    ids.length === 1 ? recomputeHandlePositions(primaryCorners) : null

  // Marquee rectangle. Dashed, semi-transparent fill — Figma-style.
  const m = marquee.value
  if (m && m.armed) {
    const x0 = Math.min(m.startX, m.curX)
    const y0 = Math.min(m.startY, m.curY)
    const w = Math.abs(m.curX - m.startX)
    const h = Math.abs(m.curY - m.startY)
    if (w > 0 && h > 0) {
      ctx.save()
      ctx.fillStyle = 'rgba(91, 124, 250, 0.12)'
      ctx.fillRect(x0, y0, w, h)
      ctx.lineWidth = lineWidth * 0.75
      ctx.setLineDash([6 * scaleX, 4 * scaleX])
      ctx.strokeStyle = '#5b7cfa'
      ctx.strokeRect(x0, y0, w, h)
      ctx.restore()
    }
  }
}

let unsubscribeTick: (() => void) | null = null

onMounted(() => {
  // First-paint draw, in case there's already a selection (e.g. SSR hydrate).
  drawSelectionRing()
  if (props.onTick) {
    unsubscribeTick = props.onTick(drawSelectionRing)
  }
})

// Composition swaps change the overlay's internal width/height; redraw so the
// ring lands in the new coordinate space instead of leaving a stale stroke.
watch(
  () => [canvasWidth.value, canvasHeight.value],
  () => {
    // The reactive width/height bind to the <canvas> attrs which auto-clear
    // on resize, so we don't need to call clearOverlay() ourselves.
    drawSelectionRing()
  },
)

// Selection changes shouldn't have to wait a RAF to render — paint immediately
// on the next microtask so the ring appears the same tick the user clicks.
watch(
  () => selection.selectedItemId.value,
  () => {
    drawSelectionRing()
  },
)

// Ghost-follows-cursor: redraw on every drag-state mutation so the ring
// tracks the pointer between RAF ticks. (RAF still drives the base loop,
// this just removes any visible lag on fast cursor sweeps.)
watch(
  () => drag.active.value,
  () => {
    drawSelectionRing()
  },
  { deep: true }
)

// Same eager redraw for resize / rotate — the engine renders the item's
// committed geom until pointerup, so the ring + handles have to track the
// in-progress state on their own.
watch(
  () => handleDrag.active.value,
  () => {
    drawSelectionRing()
  },
  { deep: true }
)

// Selection-set changes (single → multi via marquee, multi → single via
// click): redraw so stale rings clear and new rings paint immediately.
watch(
  () => selection.selectedItemIds.value,
  () => {
    drawSelectionRing()
  },
  { deep: true }
)

onBeforeUnmount(() => {
  if (unsubscribeTick) {
    unsubscribeTick()
    unsubscribeTick = null
  }
  cancelMarquee()
  clearOverlay()
})
</script>

<template>
  <div
    ref="stageWrap"
    class="stage-wrap"
    :data-library-drag-active="libraryDrag.isActive.value ? 'true' : 'false'"
    :data-library-hover="isHover ? 'true' : 'false'"
    :data-payload-kind="libraryDrag.payload.value?.kind ?? null"
    :data-place-mode="itemToolbar.isActive.value ? 'true' : 'false'"
    data-testid="stage-wrap"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <canvas
      ref="canvas"
      class="stage-canvas"
      data-testid="stage-canvas"
      :width="canvasWidth"
      :height="canvasHeight"
      :style="{ aspectRatio: aspect }"
      @pointerdown="onCanvasPointerDown"
      @click="onCanvasClick"
    />
    <!--
      Selection-ring overlay (step 20.18). Position is synced to the
      render canvas's bounding rect on every animation frame via
      `syncOverlayRect()` — that lets it sit exactly on top without
      fighting the wrap's flex/centering layout. The render-canvas's CSS
      sizing rules already determined its on-screen rectangle; we just
      copy that rectangle here.
    -->
    <canvas
      ref="overlay"
      class="stage-overlay"
      data-testid="stage-overlay"
      :width="canvasWidth"
      :height="canvasHeight"
      aria-hidden="true"
    />
    <!--
      Resize + rotation handles (UX_GAPS §G phase 2). Rendered as
      absolutely-positioned HTML so they own pointer events (the overlay
      canvas above is `pointer-events: none`). Positions are written by
      `recomputeHandlePositions()` every tick + on reactive deps so they
      track the selection ring in lock-step. Only shape / sprite items
      expose handles — text / group fall through to the click hit-test.
    -->
    <template v-if="showHandles && handlePositions">
      <div
        v-for="kind in (['tl','t','tr','r','br','b','bl','l'] as const)"
        :key="kind"
        class="stage-handle"
        :class="['stage-handle--' + kind]"
        :data-handle="kind"
        :data-testid="'stage-handle-' + kind"
        :style="{
          left: handlePositions[kind].x + 'px',
          top: handlePositions[kind].y + 'px',
        }"
        @pointerdown="(e: PointerEvent) => onHandlePointerDown(e, kind)"
      />
      <div
        class="stage-handle stage-handle--rot"
        data-handle="rot"
        data-testid="stage-handle-rot"
        :style="{
          left: handlePositions.rot.x + 'px',
          top: handlePositions.rot.y + 'px',
        }"
        @pointerdown="(e: PointerEvent) => onHandlePointerDown(e, 'rot')"
      />
      <div
        class="stage-handle-tether"
        :style="{
          left: handlePositions.t.x + 'px',
          top: handlePositions.t.y + 'px',
          width: '2px',
          height: '28px',
          transform: 'translate(-50%, -100%) rotate(' + (handlePositions.topAngleDeg + 90) + 'deg)',
          transformOrigin: '50% 100%',
        }"
        aria-hidden="true"
      />
    </template>
    <div
      v-if="libraryDrag.isActive.value && dropAcceptsThisPayload()"
      class="drop-overlay"
      :data-active="isHover ? 'true' : 'false'"
      aria-hidden="true"
    >
      <span class="drop-label">
        Drop {{ libraryDrag.payload.value?.kind }} on stage
        <span v-if="libraryDrag.payload.value?.name" class="drop-name"
          >· {{ libraryDrag.payload.value.name }}</span
        >
      </span>
    </div>
  </div>
</template>

<style scoped>
.stage-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
}

.stage-canvas {
  display: block;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  background: #000;
  image-rendering: auto;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
  /* Crosshair signals the canvas is clickable for hit-testing (step 16). */
  cursor: crosshair;
}

/* Place mode (UX_GAPS section A) — emphasise the canvas is in "drop"
 * mode by ringing it in brand blue so the user can tell their next click
 * will add a primitive, not select one. */
.stage-wrap[data-place-mode='true'] .stage-canvas {
  box-shadow: 0 0 0 2px rgba(91, 124, 250, 0.7);
  cursor: copy;
}

/* Selection-ring overlay (step 20.18). Positioned absolutely against
 * .stage-wrap; its top/left/width/height are written by syncOverlayRect()
 * so it always covers the render canvas exactly. pointer-events: none
 * keeps clicks routed to the picker canvas below.
 */
.stage-overlay {
  position: absolute;
  display: block;
  pointer-events: none;
}

/* Resize + rotation handles (UX_GAPS §G phase 2). Eight 10×10 squares
 * positioned at the corners + edge midpoints of the selection ring, plus
 * a circle 28 px above the top edge for rotation. `inline-style`
 * left/top come from recomputeHandlePositions(); the transform centers
 * the handle on the projected point so they sit *on* the ring, not below
 * it. Cursors are static (CSS doesn't easily rotate cursors with the
 * item) — the canonical resize cursor for each pair is good enough.
 */
.stage-handle {
  position: absolute;
  width: 11px;
  height: 11px;
  background: #ffffff;
  border: 1.5px solid #5b7cfa;
  box-sizing: border-box;
  border-radius: 2px;
  transform: translate(-50%, -50%);
  pointer-events: auto;
  touch-action: none;
  z-index: 2;
}
.stage-handle--tl,
.stage-handle--br {
  cursor: nwse-resize;
}
.stage-handle--tr,
.stage-handle--bl {
  cursor: nesw-resize;
}
.stage-handle--t,
.stage-handle--b {
  cursor: ns-resize;
}
.stage-handle--l,
.stage-handle--r {
  cursor: ew-resize;
}
.stage-handle--rot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #5b7cfa;
  border-color: #ffffff;
  cursor: crosshair;
}

/* A thin line connecting the top-edge midpoint to the rotation handle, so
 * the floating handle reads as anchored to the item even when the item is
 * rotated. */
.stage-handle-tether {
  position: absolute;
  background: #5b7cfa;
  opacity: 0.6;
  pointer-events: none;
  z-index: 1;
}

.drop-overlay {
  position: absolute;
  inset: 16px;
  border: 2px dashed rgba(91, 124, 250, 0.55);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  background: rgba(91, 124, 250, 0.04);
  color: rgba(91, 124, 250, 0.85);
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  transition: background 100ms ease, border-color 100ms ease;
}

.drop-overlay[data-active='true'] {
  background: rgba(91, 124, 250, 0.18);
  border-color: rgba(91, 124, 250, 0.95);
  color: #ffffff;
}

.drop-label {
  background: rgba(0, 0, 0, 0.45);
  padding: 8px 14px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
}

.drop-name {
  margin-left: 6px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  text-transform: none;
  letter-spacing: 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.92);
}
</style>
