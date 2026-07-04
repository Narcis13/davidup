<script setup lang="ts">
// TimelineTrack — step 10 originally, extended in step 11 with bar dragging.
//
// One row per composition item: a left-hand label + a track lane that paints
// every tween targeting this item as a positioned bar. Bars are colored by
// {@link TweenSource source heuristic} (template / behavior / scene / plain)
// so the user can read provenance at a glance — see {@link classifyTween}.
//
// Step 11 adds three pointer affordances per bar:
//   - the bar body emits `barPointerDown` with mode `'move'`
//   - the left/right edge handles emit `'resize-left'` / `'resize-right'`
// The parent Timeline owns the drag composable (`useTimelineDrag`) and a
// reactive `dragActive` it pipes back to us. When `dragActive.tweenId` matches
// one of our bars, we render it at the live preview position instead of its
// canonical {start, duration}.
//
// Click semantics: pointerdown/up without movement still fires the bar's
// `@click`, which keeps the legacy "click bar to select target" behaviour. A
// real drag installs a one-shot click suppressor in the composable so the
// trailing click after a release does not bleed into selection.

import { computed } from 'vue'
import type { DragActive, DragMode } from '~/composables/useTimelineDrag'
import type { VideoTrimActive, VideoTrimMode } from '~/composables/useVideoTrimDrag'

export type TweenSource = 'template' | 'behavior' | 'scene' | 'plain'

export interface TimelineTween {
  id: string
  target: string
  property: string
  start: number
  duration: number
  easing?: string
  source: TweenSource
}

// U5 — a video item's own occupied-time span. Distinct from its tweens
// (which animate a *property*, not the item's lifetime): `[start, end)` is
// the item's placement on the composition timeline; `[trimIn, trimOut)` is
// the window of the *source asset* that plays back during the "visible"
// portion of that span. When `end - start` exceeds `trimOut - trimIn`, the
// remainder freezes on the last frame (or loops, when `loop` is true).
export interface VideoSpanInfo {
  start: number
  end: number
  trimIn: number
  trimOut: number
  /** Registered asset duration, or null when the asset has no probed duration. */
  assetDuration: number | null
  loop: boolean
}

export interface TimelineItemRow {
  id: string
  type: string
  tweens: ReadonlyArray<TimelineTween>
  videoSpan: VideoSpanInfo | null
}

export interface BarPointerDownPayload {
  event: PointerEvent
  laneEl: HTMLElement
  tween: TimelineTween
  mode: DragMode
}

export interface VideoSpanPointerDownPayload {
  event: PointerEvent
  laneEl: HTMLElement
  itemId: string
  span: VideoSpanInfo
  mode: DragMode
}

export interface VideoTrimPointerDownPayload {
  event: PointerEvent
  laneEl: HTMLElement
  itemId: string
  span: VideoSpanInfo
  mode: VideoTrimMode
}

const props = defineProps<{
  row: TimelineItemRow
  /** Composition duration in seconds. Used to scale bar positions/widths. */
  duration: number
  /** Currently-selected target id (from useSelection). */
  selectedId: string | null
  /**
   * Pixels-per-second multiplier applied by the parent Timeline. We use it
   * only when the parent decides to overflow horizontally; positions are
   * still emitted as percentages so the same component works in both modes.
   */
  pixelsPerSecond?: number
  /** Live drag preview from `useTimelineDrag.active`, or null. */
  dragActive?: DragActive | null
  /**
   * Step 20.16 — per-track validation marker counts from `useValidation`.
   * `errors > 0` paints a red dot (e.g. tween overlap on this target),
   * `warnings > 0` paints a yellow dot (e.g. truncated tween).
   */
  markerCounts?: { errors: number; warnings: number } | null
  /**
   * Step 14 — library drag overlay state. `libraryHover` is the kind of the
   * drag (behavior/template/scene/asset) when the user is hovering this
   * specific track; `libraryDragActive` is true for any in-flight library
   * drag so we can show a subtle "this is a drop zone" affordance even
   * before the pointer enters our lane.
   */
  libraryHover?: string | null
  libraryDragActive?: boolean
  /** U5 — live outer-span drag preview from Timeline's `videoSpanDrag`. */
  videoSpanDragActive?: DragActive | null
  /** U5 — live trim-handle drag preview from Timeline's `videoTrimDrag`. */
  videoTrimDragActive?: VideoTrimActive | null
}>()

const emit = defineEmits<{
  (event: 'selectItem', id: string, tweenId?: string): void
  (event: 'barPointerDown', payload: BarPointerDownPayload): void
  (event: 'libraryDragOver', native: DragEvent): void
  (event: 'libraryDragLeave', native: DragEvent): void
  (event: 'libraryDrop', native: DragEvent): void
  // §20.27 — double-click on a sealed (scene-origin) bar asks the parent to
  // jump SourceDrawer to the scene instance's authored line.
  (event: 'openSceneSource', tween: TimelineTween): void
  // U5 — video span/trim handle drags.
  (event: 'videoSpanPointerDown', payload: VideoSpanPointerDownPayload): void
  (event: 'videoTrimPointerDown', payload: VideoTrimPointerDownPayload): void
}>()

function onLibraryDragOver(event: DragEvent): void {
  emit('libraryDragOver', event)
}
function onLibraryDragLeave(event: DragEvent): void {
  emit('libraryDragLeave', event)
}
function onLibraryDrop(event: DragEvent): void {
  emit('libraryDrop', event)
}

const isSelected = computed(() => props.selectedId === props.row.id)

function effectiveValues(t: TimelineTween): { start: number; duration: number } {
  const a = props.dragActive
  if (a && a.tweenId === t.id) {
    return { start: a.currentStart, duration: a.currentDuration }
  }
  return { start: t.start, duration: t.duration }
}

function barLeftPct(t: TimelineTween): string {
  const d = props.duration
  if (d <= 0) return '0%'
  const { start } = effectiveValues(t)
  return `${(start / d) * 100}%`
}

function barWidthPct(t: TimelineTween): string {
  const d = props.duration
  if (d <= 0) return '0%'
  const { duration } = effectiveValues(t)
  return `${(duration / d) * 100}%`
}

function isDragging(t: TimelineTween): boolean {
  return !!props.dragActive && props.dragActive.tweenId === t.id
}

function onRowClick(): void {
  emit('selectItem', props.row.id)
}

function onBarClick(t: TimelineTween, event: MouseEvent): void {
  event.stopPropagation()
  emit('selectItem', t.target, t.id)
}

function onBarPointerDown(t: TimelineTween, event: PointerEvent, mode: DragMode): void {
  if (event.button !== 0) return
  // §20.27 — sealed scene bars are read-only from the parent composition.
  // Pointerdown is swallowed so the drag composable never engages; the click
  // path still runs and selects the tween for the Inspector.
  if (isSealed(t)) {
    event.stopPropagation()
    return
  }
  const laneEl = (event.currentTarget as HTMLElement).closest('.track-lane') as HTMLElement | null
  if (!laneEl) return
  event.stopPropagation()
  emit('barPointerDown', { event, laneEl, tween: t, mode })
}

// A bar is "sealed" when it originated from inside a scene definition
// (originKind: scene/background → TweenSource: 'scene', gold colour). §8.7
// sealed-instance forbids parent-authored mutation of these tweens.
function isSealed(t: TimelineTween): boolean {
  return t.source === 'scene'
}

function onBarDoubleClick(t: TimelineTween, event: MouseEvent): void {
  if (!isSealed(t)) return
  event.stopPropagation()
  event.preventDefault()
  emit('openSceneSource', t)
}

function barTitle(t: TimelineTween): string {
  const v = effectiveValues(t)
  const end = v.start + v.duration
  const easing = t.easing ? ` · ${t.easing}` : ''
  return `${t.id}\n${t.property} · ${t.source}${easing}\n${v.start.toFixed(2)}s → ${end.toFixed(2)}s (${v.duration.toFixed(2)}s)`
}

function liveBadge(t: TimelineTween): string | null {
  const a = props.dragActive
  if (!a || a.tweenId !== t.id) return null
  const end = a.currentStart + a.currentDuration
  return `${a.currentStart.toFixed(2)}s → ${end.toFixed(2)}s`
}

const markerErrors = computed<number>(() => props.markerCounts?.errors ?? 0)
const markerWarnings = computed<number>(() => props.markerCounts?.warnings ?? 0)
const markerTitle = computed<string>(() => {
  const e = markerErrors.value
  const w = markerWarnings.value
  const parts: string[] = []
  if (e > 0) parts.push(`${e} error${e === 1 ? '' : 's'}`)
  if (w > 0) parts.push(`${w} warning${w === 1 ? '' : 's'}`)
  return parts.join(' · ')
})

// ──────────────── U5: video item outer-span + trim handles ────────────────
//
// A video row (`row.videoSpan` non-null) renders an extra lane above the
// tween lane: one bar spanning the item's own `[start, end)` occupancy, with
// two inner trim handles (trimIn/trimOut, anchored to the source asset's
// time axis — see `videoTrimMath.ts`) and an outer right-edge handle that
// resizes `end` (extending/shrinking the freeze-or-loop tail).

function effectiveSpan(): { start: number; end: number } {
  const span = props.row.videoSpan
  if (!span) return { start: 0, end: 0 }
  const a = props.videoSpanDragActive
  if (a && a.tweenId === props.row.id) {
    return { start: a.currentStart, end: a.currentStart + a.currentDuration }
  }
  return { start: span.start, end: span.end }
}

function effectiveTrim(): { trimIn: number; trimOut: number } {
  const span = props.row.videoSpan
  if (!span) return { trimIn: 0, trimOut: 0 }
  const a = props.videoTrimDragActive
  if (a && a.itemId === props.row.id) {
    if (a.mode === 'trim-in') return { trimIn: a.currentValue, trimOut: span.trimOut }
    return { trimIn: span.trimIn, trimOut: a.currentValue }
  }
  return { trimIn: span.trimIn, trimOut: span.trimOut }
}

function pctOfTimeline(t: number): string {
  const d = props.duration
  if (d <= 0) return '0%'
  return `${Math.min(100, Math.max(0, (t / d) * 100))}%`
}

const videoSpanLeftPct = computed(() => pctOfTimeline(effectiveSpan().start))
const videoSpanWidthPct = computed(() => {
  const d = props.duration
  if (d <= 0) return '0%'
  const { start, end } = effectiveSpan()
  return `${Math.max(0, ((end - start) / d) * 100)}%`
})

// Freeze/loop tail: the portion of [start,end) beyond the visible-trim
// window, as a % of the *bar's own* width (so it renders correctly inside
// the absolutely-positioned bar regardless of zoom).
const videoTailWidthPct = computed<string | null>(() => {
  const { start, end } = effectiveSpan()
  const { trimIn, trimOut } = effectiveTrim()
  const span = Math.max(0.0001, end - start)
  const visible = Math.max(0, trimOut - trimIn)
  const tail = span - visible
  if (tail <= 0.05) return null
  return `${Math.min(100, (tail / span) * 100)}%`
})

const isLoopTail = computed<boolean>(() => props.row.videoSpan?.loop === true)

// Position the trimOut handle at the boundary between the "visible" window
// and the freeze/loop tail (i.e. `100% - tail%`) — the one trim handle whose
// position on the bar is actually meaningful (trimIn has no natural timeline
// position, since it only changes *which* source frames play, not *when*).
const trimOutHandleLeftPct = computed<string>(() => {
  const tail = videoTailWidthPct.value
  if (!tail) return 'calc(100% - 10px)'
  const tailNum = parseFloat(tail)
  if (Number.isNaN(tailNum)) return 'calc(100% - 10px)'
  return `calc(${100 - tailNum}% - 2px)`
})

function onVideoSpanBodyPointerDown(event: PointerEvent, mode: DragMode): void {
  if (event.button !== 0) return
  const span = props.row.videoSpan
  if (!span) return
  const laneEl = (event.currentTarget as HTMLElement).closest('.video-lane') as HTMLElement | null
  if (!laneEl) return
  event.stopPropagation()
  emit('videoSpanPointerDown', { event, laneEl, itemId: props.row.id, span, mode })
}

function onVideoTrimHandlePointerDown(event: PointerEvent, mode: 'trim-in' | 'trim-out'): void {
  if (event.button !== 0) return
  const span = props.row.videoSpan
  if (!span) return
  const laneEl = (event.currentTarget as HTMLElement).closest('.video-lane') as HTMLElement | null
  if (!laneEl) return
  event.stopPropagation()
  emit('videoTrimPointerDown', { event, laneEl, itemId: props.row.id, span, mode })
}

function videoSpanTitle(): string {
  const span = props.row.videoSpan
  if (!span) return ''
  const { start, end } = effectiveSpan()
  const { trimIn, trimOut } = effectiveTrim()
  const tail = span.loop ? 'loops' : 'freezes'
  return `${props.row.id}\n${start.toFixed(2)}s → ${end.toFixed(2)}s\ntrim ${trimIn.toFixed(2)}s–${trimOut.toFixed(2)}s${videoTailWidthPct.value ? ` · tail ${tail}` : ''}`
}
</script>

<template>
  <div
    class="track"
    :class="{ selected: isSelected, 'track--video': !!row.videoSpan }"
    :data-item-id="row.id"
    :data-library-hover="libraryHover ?? null"
    :data-library-drag-active="libraryDragActive ? 'true' : null"
    @click="onRowClick"
    @dragenter.prevent="onLibraryDragOver"
    @dragover="onLibraryDragOver"
    @dragleave="onLibraryDragLeave"
    @drop="onLibraryDrop"
  >
    <div class="track-label">
      <span
        v-if="markerErrors > 0 || markerWarnings > 0"
        class="track-markers"
        :title="markerTitle"
        :data-testid="`timeline-track-markers-${row.id}`"
      >
        <span
          v-if="markerErrors > 0"
          class="track-marker error"
          :data-count="markerErrors"
          :data-testid="`timeline-track-marker-error-${row.id}`"
          aria-label="Validation errors on this track"
        />
        <span
          v-if="markerWarnings > 0"
          class="track-marker warning"
          :data-count="markerWarnings"
          :data-testid="`timeline-track-marker-warning-${row.id}`"
          aria-label="Validation warnings on this track"
        />
      </span>
      <span class="label-id">{{ row.id }}</span>
      <span class="label-type">{{ row.type }}</span>
    </div>
    <div class="track-lanes">
    <!--
      U5 — video item's own [start,end) span, with inner trim handles and an
      outer end-resize handle. Sits above the tween lane so an animated
      video item (e.g. a tween on x/y) still shows both.
    -->
    <div v-if="row.videoSpan" class="video-lane">
      <div
        class="video-span-bar"
        :style="{ left: videoSpanLeftPct, width: videoSpanWidthPct }"
        :title="videoSpanTitle()"
        :data-testid="`timeline-video-span-${row.id}`"
        @pointerdown="(e) => onVideoSpanBodyPointerDown(e, 'move')"
      >
        <span
          v-if="videoTailWidthPct"
          class="video-tail"
          :class="{ 'video-tail--loop': isLoopTail }"
          :style="{ width: videoTailWidthPct }"
          :data-testid="`timeline-video-tail-${row.id}`"
          aria-hidden="true"
        />
        <span class="video-span-label">{{ row.id }}</span>
        <span
          class="video-trim-handle video-trim-handle--in"
          data-testid="timeline-video-trim-in"
          title="Drag to trim the start of the source clip"
          @pointerdown.stop="(e) => onVideoTrimHandlePointerDown(e, 'trim-in')"
          @click.stop
        />
        <span
          class="video-trim-handle video-trim-handle--out"
          :style="{ left: trimOutHandleLeftPct }"
          data-testid="timeline-video-trim-out"
          title="Drag to trim the end of the visible (non-frozen/non-looped) window"
          @pointerdown.stop="(e) => onVideoTrimHandlePointerDown(e, 'trim-out')"
          @click.stop
        />
        <span
          class="resize-handle resize-right"
          data-testid="timeline-video-span-resize-end"
          title="Drag to extend/shrink the freeze or loop tail"
          @pointerdown.stop="(e) => onVideoSpanBodyPointerDown(e, 'resize-right')"
          @click.stop
        />
      </div>
    </div>
    <div class="track-lane">
      <button
        v-for="tween in row.tweens"
        :key="tween.id"
        type="button"
        class="bar"
        :class="[`bar-${tween.source}`, { dragging: isDragging(tween), sealed: isSealed(tween) }]"
        :style="{ left: barLeftPct(tween), width: barWidthPct(tween) }"
        :title="isSealed(tween) ? `${barTitle(tween)}\n(sealed — double-click to reveal scene source)` : barTitle(tween)"
        :data-tween-id="tween.id"
        :data-tween-source="tween.source"
        :data-sealed="isSealed(tween) ? 'true' : null"
        :data-dragging="isDragging(tween) ? 'true' : null"
        @pointerdown="(e) => onBarPointerDown(tween, e, 'move')"
        @click="(e) => onBarClick(tween, e)"
        @dblclick="(e) => onBarDoubleClick(tween, e)"
      >
        <span
          v-if="!isSealed(tween)"
          class="resize-handle resize-left"
          :data-resize="'left'"
          @pointerdown.stop="(e) => onBarPointerDown(tween, e, 'resize-left')"
          @click.stop
        />
        <svg
          v-if="isSealed(tween)"
          class="bar-lock"
          width="9"
          height="11"
          viewBox="0 0 9 11"
          aria-hidden="true"
          :data-testid="`timeline-bar-lock-${tween.id}`"
        >
          <path
            d="M2 5V3.2C2 1.7 3 0.6 4.5 0.6S7 1.7 7 3.2V5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.1"
            stroke-linecap="round"
          />
          <rect x="0.7" y="5" width="7.6" height="5.5" rx="1.2" fill="currentColor" />
        </svg>
        <span class="bar-label">{{ tween.property }}</span>
        <span
          v-if="!isSealed(tween)"
          class="resize-handle resize-right"
          :data-resize="'right'"
          @pointerdown.stop="(e) => onBarPointerDown(tween, e, 'resize-right')"
          @click.stop
        />
        <span
          v-if="liveBadge(tween)"
          class="drag-badge"
          :data-drag-badge="tween.id"
        >{{ liveBadge(tween) }}</span>
      </button>
    </div>
    </div>
  </div>
</template>

<style scoped>
.track {
  display: grid;
  grid-template-columns: var(--ruler-gutter-width, 160px) 1fr;
  align-items: stretch;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  min-height: 24px;
  cursor: pointer;
}

.track:hover {
  background: rgba(255, 255, 255, 0.025);
}

.track--video {
  min-height: 50px;
}

.track-lanes {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* U5 — video item span lane, sits above the tween lane inside the same row. */
.video-lane {
  position: relative;
  height: 26px;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.06);
  background: repeating-linear-gradient(
    to right,
    transparent 0,
    transparent calc(25% - 1px),
    rgba(255, 255, 255, 0.03) calc(25% - 1px),
    rgba(255, 255, 255, 0.03) 25%
  );
}

.video-span-bar {
  position: absolute;
  top: 3px;
  bottom: 3px;
  min-width: 8px;
  padding: 0 4px;
  border: 1px solid rgba(190, 110, 255, 0.9);
  border-radius: 3px;
  background: rgba(190, 110, 255, 0.4);
  color: #f3e8ff;
  font: 10px/1 'JetBrains Mono', ui-monospace, monospace;
  display: flex;
  align-items: center;
  cursor: grab;
  touch-action: none;
  overflow: hidden;
}

.video-span-bar:active {
  cursor: grabbing;
}

.video-span-label {
  pointer-events: none;
  opacity: 0.9;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
  z-index: 1;
}

/* Freeze tail: hatched pattern. Loop tail: chevron repeat. Both sit at the
 * bar's right edge, representing the portion of [start,end) beyond the
 * visible-trim window. */
.video-tail {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  pointer-events: none;
  background: repeating-linear-gradient(
    45deg,
    rgba(0, 0, 0, 0.35),
    rgba(0, 0, 0, 0.35) 3px,
    transparent 3px,
    transparent 6px
  );
}

.video-tail--loop {
  background-image: repeating-linear-gradient(
    to right,
    transparent 0,
    transparent 4px,
    rgba(0, 0, 0, 0.4) 4px,
    rgba(0, 0, 0, 0.4) 5px,
    transparent 5px,
    transparent 8px
  );
}

.video-trim-handle {
  position: absolute;
  top: 2px;
  bottom: 2px;
  width: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.55);
  cursor: ew-resize;
  z-index: 2;
  touch-action: none;
}

.video-trim-handle--in {
  left: 6px;
}

.video-trim-handle:hover {
  background: rgba(255, 255, 255, 0.9);
}

.track.selected {
  background: rgba(91, 124, 250, 0.12);
}

/* Library drag hit-zone affordances (step 14). */
.track[data-library-drag-active='true'] {
  outline: 1px dashed rgba(91, 124, 250, 0.18);
  outline-offset: -2px;
}

.track[data-library-hover='behavior'] {
  background: rgba(6, 214, 160, 0.18);
  outline: 2px solid rgba(6, 214, 160, 0.75);
  outline-offset: -2px;
}

.track[data-library-hover='template'] {
  background: rgba(255, 107, 53, 0.18);
  outline: 2px solid rgba(255, 107, 53, 0.7);
  outline-offset: -2px;
}

.track[data-library-hover='scene'] {
  background: rgba(255, 209, 102, 0.2);
  outline: 2px solid rgba(255, 209, 102, 0.8);
  outline-offset: -2px;
}

.track-label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  font-size: 12px;
  color: #e5e5e5;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  min-width: 0;
}

.label-id {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1 1 auto;
  min-width: 0;
}

.label-type {
  flex: 0 0 auto;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #707070;
}

.track-markers {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
  margin-right: 2px;
}

.track-marker {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55);
}

.track-marker.error {
  background: #ff6b6b;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.55),
    0 0 6px rgba(255, 107, 107, 0.65);
}

.track-marker.warning {
  background: #f4c66e;
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.55),
    0 0 5px rgba(244, 198, 110, 0.55);
}

.track-lane {
  position: relative;
  height: 24px;
  background: repeating-linear-gradient(
    to right,
    transparent 0,
    transparent calc(25% - 1px),
    rgba(255, 255, 255, 0.04) calc(25% - 1px),
    rgba(255, 255, 255, 0.04) 25%
  );
}

.bar {
  position: absolute;
  top: 3px;
  bottom: 3px;
  min-width: 2px;
  padding: 0 4px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: rgba(91, 124, 250, 0.6);
  color: rgba(255, 255, 255, 0.9);
  font: 10px/1 'JetBrains Mono', ui-monospace, monospace;
  text-align: left;
  cursor: grab;
  overflow: visible;
  white-space: nowrap;
  display: flex;
  align-items: center;
  touch-action: none;
}

.bar:hover {
  filter: brightness(1.15);
  border-color: rgba(255, 255, 255, 0.35);
}

.bar.dragging {
  cursor: grabbing;
  filter: brightness(1.2);
  border-color: rgba(255, 255, 255, 0.7);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18), 0 4px 14px rgba(0, 0, 0, 0.5);
  z-index: 3;
}

.bar-label {
  pointer-events: none;
  opacity: 0.85;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
}

.resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  background: rgba(0, 0, 0, 0.18);
  z-index: 1;
}

.resize-handle.resize-left {
  left: 0;
  border-top-left-radius: 3px;
  border-bottom-left-radius: 3px;
}

.resize-handle.resize-right {
  right: 0;
  border-top-right-radius: 3px;
  border-bottom-right-radius: 3px;
}

.bar:hover .resize-handle,
.bar.dragging .resize-handle {
  background: rgba(255, 255, 255, 0.35);
}

.drag-badge {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  background: rgba(20, 20, 20, 0.95);
  color: #e5e5e5;
  padding: 3px 6px;
  border-radius: 3px;
  font: 10px/1 'JetBrains Mono', ui-monospace, monospace;
  white-space: nowrap;
  pointer-events: none;
  border: 1px solid rgba(255, 255, 255, 0.18);
  z-index: 4;
}

/* §20.27 — sealed scene bars: lock affordance + cursor signal. The resize
   handles are not rendered at all when sealed, so the only cursor users see
   over the bar body is `not-allowed`. Double-click reveals the scene source. */
.bar.sealed {
  cursor: not-allowed;
}

.bar.sealed:hover {
  /* Suppress the brighten-on-hover that normally telegraphs "draggable". */
  filter: none;
  border-color: rgba(255, 209, 102, 1);
}

.bar-lock {
  flex: 0 0 auto;
  margin-right: 4px;
  color: #221608;
  opacity: 0.85;
  pointer-events: none;
}

.bar.sealed:hover .bar-lock {
  opacity: 1;
}

/* PRD FR-05: bars are templates (orange), behaviors (green), scenes (gold). */
.bar-template {
  background: rgba(255, 107, 53, 0.78);
  border-color: rgba(255, 107, 53, 0.95);
  color: #1a0d05;
}

.bar-behavior {
  background: rgba(6, 214, 160, 0.78);
  border-color: rgba(6, 214, 160, 0.95);
  color: #052017;
}

.bar-scene {
  background: rgba(255, 209, 102, 0.82);
  border-color: rgba(255, 209, 102, 1);
  color: #221608;
}

.bar-plain {
  background: rgba(91, 124, 250, 0.55);
  border-color: rgba(91, 124, 250, 0.85);
  color: #0a1130;
}
</style>
