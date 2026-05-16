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

export interface TimelineItemRow {
  id: string
  type: string
  tweens: ReadonlyArray<TimelineTween>
}

export interface BarPointerDownPayload {
  event: PointerEvent
  laneEl: HTMLElement
  tween: TimelineTween
  mode: DragMode
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
   * Step 14 — library drag overlay state. `libraryHover` is the kind of the
   * drag (behavior/template/scene/asset) when the user is hovering this
   * specific track; `libraryDragActive` is true for any in-flight library
   * drag so we can show a subtle "this is a drop zone" affordance even
   * before the pointer enters our lane.
   */
  libraryHover?: string | null
  libraryDragActive?: boolean
}>()

const emit = defineEmits<{
  (event: 'selectItem', id: string, tweenId?: string): void
  (event: 'barPointerDown', payload: BarPointerDownPayload): void
  (event: 'libraryDragOver', native: DragEvent): void
  (event: 'libraryDragLeave', native: DragEvent): void
  (event: 'libraryDrop', native: DragEvent): void
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
  const laneEl = (event.currentTarget as HTMLElement).closest('.track-lane') as HTMLElement | null
  if (!laneEl) return
  event.stopPropagation()
  emit('barPointerDown', { event, laneEl, tween: t, mode })
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
</script>

<template>
  <div
    class="track"
    :class="{ selected: isSelected }"
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
      <span class="label-id">{{ row.id }}</span>
      <span class="label-type">{{ row.type }}</span>
    </div>
    <div class="track-lane">
      <button
        v-for="tween in row.tweens"
        :key="tween.id"
        type="button"
        class="bar"
        :class="[`bar-${tween.source}`, { dragging: isDragging(tween) }]"
        :style="{ left: barLeftPct(tween), width: barWidthPct(tween) }"
        :title="barTitle(tween)"
        :data-tween-id="tween.id"
        :data-tween-source="tween.source"
        :data-dragging="isDragging(tween) ? 'true' : null"
        @pointerdown="(e) => onBarPointerDown(tween, e, 'move')"
        @click="(e) => onBarClick(tween, e)"
      >
        <span
          class="resize-handle resize-left"
          :data-resize="'left'"
          @pointerdown.stop="(e) => onBarPointerDown(tween, e, 'resize-left')"
          @click.stop
        />
        <span class="bar-label">{{ tween.property }}</span>
        <span
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
</template>

<style scoped>
.track {
  display: grid;
  grid-template-columns: 160px 1fr;
  align-items: stretch;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  min-height: 24px;
  cursor: pointer;
}

.track:hover {
  background: rgba(255, 255, 255, 0.025);
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
