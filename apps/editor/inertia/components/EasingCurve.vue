<script setup lang="ts">
// v1.1 S28 · tween easing curve editor.
//
// Sits under the easing picker in the Inspector's tween panel. Draws the
// selected tween's easing as an SVG curve (sampled through the engine's own
// `getEasing`, so the preview is exactly what renders), with:
//
//   · bezier handles — for `{ bezier }` easings, P1 / P2 are draggable. The
//     curve redraws live from a local draft while dragging; releasing
//     commits one `update_tween { easing: { bezier } }` (one undo step).
//   · a playhead marker — when the playhead is inside the tween's window, a
//     dot rides the curve at the current progress.
//   · scrubbing — pressing / dragging anywhere else on the plot seeks the
//     playhead through the tween's window, so the item on the stage moves
//     along the curve under the pointer.
//
// All geometry and the handle → command mapping live in
// `easingCurveMath.ts` (unit-tested; japa can't load `.vue`).

import { computed, ref } from 'vue'
import { formatEasing, getEasing } from 'davidup/easings'
import type { BezierEasing, Easing } from 'davidup/easings'
import type { Command } from '~/composables/useCommandBus'
import {
  bezierHandleCommand,
  curveYRange,
  dragBezierHandle,
  easingPath,
  fromSvg,
  toSvg,
  tweenProgressAt,
  tweenTimeAt,
  type BezierHandle,
  type CurveBox,
} from '~/composables/easingCurveMath'

const props = defineProps<{
  tween: { id: string; start: number; duration: number; easing?: Easing }
  playhead?: number
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'apply', command: Command): void
  (event: 'seek', t: number): void
}>()

const WIDTH = 240
const HEIGHT = 160
const PAD = 10

const svgRef = ref<SVGSVGElement | null>(null)

// In-flight handle drag. `before` is the committed easing at pointerdown;
// `draft` is what the curve shows until pointerup commits it.
const drag = ref<{
  handle: BezierHandle
  before: BezierEasing
  draft: BezierEasing
  yRange: { yMin: number; yMax: number }
} | null>(null)
const scrubbing = ref(false)

const shown = computed<Easing | undefined>(() => drag.value?.draft ?? props.tween.easing)
const bezier = computed<BezierEasing | null>(() => {
  const e = shown.value
  return typeof e === 'object' && e !== null && 'bezier' in e ? e : null
})

// Frozen for the length of a drag so the plot doesn't rescale under the
// pointer; recomputed from the committed easing otherwise.
const box = computed<CurveBox>(() => {
  const range = drag.value?.yRange ?? curveYRange(props.tween.easing)
  return { width: WIDTH, height: HEIGHT, pad: PAD, ...range }
})

const path = computed(() => easingPath(box.value, shown.value))
const origin = computed(() => toSvg(box.value, 0, 0))
const end = computed(() => toSvg(box.value, 1, 1))
const unitTop = computed(() => toSvg(box.value, 0, 1).y)

const handles = computed(() => {
  const b = bezier.value
  if (!b) return null
  return {
    p1: toSvg(box.value, b.bezier[0], b.bezier[1]),
    p2: toSvg(box.value, b.bezier[2], b.bezier[3]),
  }
})

const marker = computed(() => {
  if (props.playhead === undefined) return null
  const t = tweenProgressAt(props.tween, props.playhead)
  if (t === null) return null
  return toSvg(box.value, t, getEasing(shown.value)(t))
})

const label = computed(() => formatEasing(shown.value ?? 'linear'))

/** Pointer → unit-space point, accounting for the SVG's CSS scaling. */
function pointerToUnit(event: PointerEvent): { t: number; value: number } {
  const svg = svgRef.value
  if (!svg) return { t: 0, value: 0 }
  const rect = svg.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * WIDTH
  const y = ((event.clientY - rect.top) / rect.height) * HEIGHT
  return fromSvg(box.value, x, y)
}

function onHandleDown(handle: BezierHandle, event: PointerEvent): void {
  const b = bezier.value
  if (props.disabled || !b || event.button !== 0) return
  event.stopPropagation()
  ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
  drag.value = { handle, before: b, draft: b, yRange: curveYRange(b) }
}

function onHandleMove(event: PointerEvent): void {
  const d = drag.value
  if (!d) return
  const p = pointerToUnit(event)
  d.draft = dragBezierHandle(d.draft, d.handle, p.t, p.value, d.yRange)
}

function onHandleUp(): void {
  const d = drag.value
  if (!d) return
  drag.value = null
  const command = bezierHandleCommand(props.tween.id, d.before, d.draft)
  if (command) emit('apply', command)
}

function onHandleCancel(): void {
  drag.value = null
}

function seekTo(event: PointerEvent): void {
  emit('seek', tweenTimeAt(props.tween, pointerToUnit(event).t))
}

function onPlotDown(event: PointerEvent): void {
  if (event.button !== 0) return
  ;(event.currentTarget as Element).setPointerCapture(event.pointerId)
  scrubbing.value = true
  seekTo(event)
}

function onPlotMove(event: PointerEvent): void {
  if (scrubbing.value) seekTo(event)
}

function onPlotUp(): void {
  scrubbing.value = false
}
</script>

<template>
  <div class="easing-curve" :class="{ disabled }" data-testid="easing-curve">
    <svg
      ref="svgRef"
      class="plot"
      :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
      preserveAspectRatio="none"
      role="img"
      :aria-label="`Easing curve ${label}`"
    >
      <!-- Scrub surface: press / drag to move the playhead through the tween. -->
      <rect
        class="scrub"
        :class="{ active: scrubbing }"
        x="0"
        y="0"
        :width="WIDTH"
        :height="HEIGHT"
        data-testid="easing-curve-scrub"
        @pointerdown="onPlotDown"
        @pointermove="onPlotMove"
        @pointerup="onPlotUp"
        @pointercancel="onPlotUp"
      />
      <!-- The unit square: t ∈ [0, 1] × value ∈ [0, 1]. -->
      <rect
        class="unit"
        :x="origin.x"
        :y="unitTop"
        :width="end.x - origin.x"
        :height="origin.y - unitTop"
      />
      <line class="diagonal" :x1="origin.x" :y1="origin.y" :x2="end.x" :y2="end.y" />
      <path class="curve" :d="path" data-testid="easing-curve-path" />

      <template v-if="marker">
        <line class="marker-guide" :x1="marker.x" :y1="0" :x2="marker.x" :y2="HEIGHT" />
        <circle class="marker" :cx="marker.x" :cy="marker.y" r="3.5" data-testid="easing-curve-marker" />
      </template>

      <template v-if="handles">
        <line class="arm" :x1="origin.x" :y1="origin.y" :x2="handles.p1.x" :y2="handles.p1.y" />
        <line class="arm" :x1="end.x" :y1="end.y" :x2="handles.p2.x" :y2="handles.p2.y" />
        <circle
          v-for="h in (['p1', 'p2'] as const)"
          :key="h"
          class="handle"
          :class="{ dragging: drag?.handle === h }"
          :cx="handles[h].x"
          :cy="handles[h].y"
          r="5"
          :data-testid="`easing-curve-${h}`"
          @pointerdown="(e: PointerEvent) => onHandleDown(h, e)"
          @pointermove="onHandleMove"
          @pointerup="onHandleUp"
          @pointercancel="onHandleCancel"
        />
      </template>
    </svg>
    <div class="caption">
      <span class="value" data-testid="easing-curve-label">{{ label }}</span>
      <span class="hint">{{ handles ? 'drag handles · drag plot to scrub' : 'drag to scrub' }}</span>
    </div>
  </div>
</template>

<style scoped>
.easing-curve {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-left: 128px;
  min-width: 0;
}

.plot {
  width: 100%;
  max-width: 320px;
  aspect-ratio: 3 / 2;
  background: #111;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  touch-action: none;
  user-select: none;
}

.scrub {
  fill: transparent;
  cursor: ew-resize;
}

.unit {
  fill: rgba(255, 255, 255, 0.02);
  stroke: rgba(255, 255, 255, 0.12);
  stroke-width: 1;
  pointer-events: none;
}

.diagonal {
  stroke: rgba(255, 255, 255, 0.1);
  stroke-dasharray: 3 3;
  pointer-events: none;
}

.curve {
  fill: none;
  stroke: #5b7cfa;
  stroke-width: 2;
  stroke-linejoin: round;
  pointer-events: none;
}

.marker-guide {
  stroke: rgba(255, 138, 61, 0.35);
  stroke-width: 1;
  pointer-events: none;
}

.marker {
  fill: #ff8a3d;
  pointer-events: none;
}

.arm {
  stroke: rgba(229, 229, 229, 0.45);
  stroke-width: 1;
  pointer-events: none;
}

.handle {
  fill: #161616;
  stroke: #e5e5e5;
  stroke-width: 1.5;
  cursor: grab;
}

.handle:hover,
.handle.dragging {
  fill: #5b7cfa;
}

.handle.dragging {
  cursor: grabbing;
}

.caption {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  max-width: 320px;
  font-size: 11px;
  color: #707070;
}

.value {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  color: #a3a3a3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hint {
  flex: 0 0 auto;
}

.easing-curve.disabled .handle {
  pointer-events: none;
  opacity: 0.45;
}
</style>
