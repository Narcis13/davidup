<script setup lang="ts">
// Stage — step 14 extracted the canvas + drop surface into its own
// component, step 16 adds click-based hit-testing.
//
// Click flow:
//   1. user clicks somewhere on the canvas
//   2. event clientX/Y → composition pixels via getBoundingClientRect
//   3. pickItemAt(x, y) (current playhead) → { itemId, source? } | null
//   4. setSelectionFromPick(itemId, source) — Inspector switches to it
//
// The canvas ref is still forwarded back to the page via `defineExpose` so
// `useStage` can keep its existing `Ref<HTMLCanvasElement | null>` contract.

import { computed, ref } from 'vue'
import type { Composition, Command } from '~/composables/useCommandBus'
import {
  buildCommandsForStageDrop,
  useLibraryDrag,
} from '~/composables/useLibraryDrag'
import { useSelection, type PickSourceInfo } from '~/composables/useSelection'

interface PickHit {
  itemId: string
  source?: PickSourceInfo
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
}>()

const emit = defineEmits<{
  (event: 'apply', command: Command): void
}>()

const selection = useSelection()

const canvas = ref<HTMLCanvasElement | null>(null)
const stageWrap = ref<HTMLDivElement | null>(null)

defineExpose({ canvas })

const canvasWidth = computed(() => props.composition?.composition.width ?? 1280)
const canvasHeight = computed(() => props.composition?.composition.height ?? 720)
const aspect = computed(() => `${canvasWidth.value} / ${canvasHeight.value}`)

const libraryDrag = useLibraryDrag()
const isHover = computed(() => libraryDrag.hover.value === 'stage')

const layerForDropId = computed<string | null>(() => {
  const comp = props.composition
  if (!comp || !Array.isArray(comp.layers)) return null
  // Prefer the highest-z layer (rendered on top) so dropped items land in
  // the foreground; layers come ordered low→high in the canonical schema.
  for (let i = comp.layers.length - 1; i >= 0; i -= 1) {
    const l = comp.layers[i] as { id?: unknown } | undefined
    if (l && typeof l.id === 'string') return l.id
  }
  return null
})

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

function onCanvasClick(event: MouseEvent): void {
  if (libraryDrag.isActive.value) return
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
</script>

<template>
  <div
    ref="stageWrap"
    class="stage-wrap"
    :data-library-drag-active="libraryDrag.isActive.value ? 'true' : 'false'"
    :data-library-hover="isHover ? 'true' : 'false'"
    :data-payload-kind="libraryDrag.payload.value?.kind ?? null"
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
      @click="onCanvasClick"
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
