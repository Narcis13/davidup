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
  const coords = clickCoordsToCanvas(event)
  if (!coords) return
  const hit = props.pickItemAt(coords.x, coords.y)
  if (!hit) return
  const pos = getItemPosition(hit.itemId)
  // Items without a numeric transform.x/y (e.g. groups whose position is
  // implicit) can't be dragged in phase 1 — let the click flow through and
  // just select them.
  if (!pos) return
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

function onCanvasClick(event: MouseEvent): void {
  if (libraryDrag.isActive.value) return

  // Toolbar place mode takes precedence over hit-testing: a click on the
  // canvas while a primitive tool is active drops the primitive at the
  // cursor position on the topmost layer, then clears the tool. We never
  // route the click through `pickItemAt` in this mode — selecting the
  // freshly-placed item happens implicitly when the bus response echoes
  // the new id, which the toolbar consumer can hook into later.
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
    if (command) emit('apply', command)
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
  if (hit) {
    selection.setSelectionFromPick(hit.itemId, hit.source ?? null)
  } else {
    // Clicking empty stage clears the selection — matches Figma/Sketch.
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

  const id = selection.selectedItemId.value
  if (!id) return
  if (!props.getItemBoundsAt) return

  const bounds = props.getItemBoundsAt(id)
  if (!bounds) return
  const pts = bounds.corners
  if (pts.length < 2) return

  // During an active drag of THIS item, the engine still renders the item
  // at its committed transform — the ghost lives only on the overlay. We
  // offset every corner by the in-progress translation so the ring visibly
  // follows the cursor before pointerup commits the update_item.
  let dx = 0
  let dy = 0
  const dActive = drag.active.value
  if (dActive && dActive.itemId === id) {
    dx = dActive.currentX - dActive.originalX
    dy = dActive.currentY - dActive.originalY
  }

  // Scale the stroke so it appears as ~2 CSS px regardless of how much CSS
  // has shrunk the composition (e.g., 1280-wide comp painted into a
  // 600-wide stage). Falling back to 2 when the CSS rect hasn't laid out
  // yet keeps the first frame's ring visible.
  const rect = overlayEl.getBoundingClientRect()
  const scaleX = rect.width > 0 ? overlayEl.width / rect.width : 1
  const lineWidth = 2 * Math.max(scaleX, 1)

  ctx.save()
  ctx.lineWidth = lineWidth
  ctx.lineJoin = 'round'
  // The brand-blue ring matches the rest of the editor's selection chrome
  // (Inspector header, Library hover) so users don't have to learn a new
  // color for "this is selected."
  ctx.strokeStyle = '#5b7cfa'
  ctx.beginPath()
  ctx.moveTo(pts[0]![0] + dx, pts[0]![1] + dy)
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i]![0] + dx, pts[i]![1] + dy)
  }
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
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

onBeforeUnmount(() => {
  if (unsubscribeTick) {
    unsubscribeTick()
    unsubscribeTick = null
  }
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
