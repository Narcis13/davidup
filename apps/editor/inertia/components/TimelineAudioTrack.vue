<script setup lang="ts">
// TimelineAudioTrack — U3 (Timeline audio lane).
//
// One row per `composition.audio[]` entry. Unlike TimelineTrack's per-item
// tween bars (many bars per row, one per tween), an audio track is a single
// bar spanning `[start, end)` — the track itself, not something targeting
// it. Body-drag moves `start` (duration preserved); the right-edge handle
// resizes `end`. There is no left-resize handle — U3 doesn't call for one,
// audio tracks don't have a source-trim concept the way video items do.
//
// Mute (volume === 0) renders a striped/grey fill; fadeIn/fadeOut render as
// gradient ramps at the bar's edges sized proportionally to the bar's
// duration. Right-click opens a small context menu (Mute/Delete/Reset
// volume) — see `useContextMenu`.

import { computed } from 'vue'
import type { DragActive, DragMode } from '~/composables/useTimelineDrag'

export interface TimelineAudioRow {
  id: string
  asset: string
  start: number
  end: number
  volume: number
  fadeIn: number
  fadeOut: number
}

export interface AudioBarPointerDownPayload {
  event: PointerEvent
  laneEl: HTMLElement
  row: TimelineAudioRow
  mode: DragMode
}

const props = defineProps<{
  row: TimelineAudioRow
  duration: number
  selected: boolean
  dragActive?: DragActive | null
}>()

const emit = defineEmits<{
  (event: 'select', id: string): void
  (event: 'barPointerDown', payload: AudioBarPointerDownPayload): void
  (event: 'contextmenu', payload: { id: string; x: number; y: number }): void
}>()

function effective(): { start: number; end: number } {
  const a = props.dragActive
  if (a && a.tweenId === props.row.id) {
    return { start: a.currentStart, end: a.currentStart + a.currentDuration }
  }
  return { start: props.row.start, end: props.row.end }
}

function pct(t: number): string {
  const d = props.duration
  if (d <= 0) return '0%'
  return `${Math.min(100, Math.max(0, (t / d) * 100))}%`
}

const barLeftPct = computed(() => pct(effective().start))
const barWidthPct = computed(() => {
  const d = props.duration
  if (d <= 0) return '0%'
  const { start, end } = effective()
  return `${Math.max(0, ((end - start) / d) * 100)}%`
})

const isMuted = computed(() => props.row.volume <= 0)
const isDragging = computed(() => !!props.dragActive && props.dragActive.tweenId === props.row.id)

// Fade ramps as a % of the bar's own width (not the full timeline) so they
// scale correctly regardless of zoom.
const fadeInPct = computed(() => {
  const { start, end } = effective()
  const span = Math.max(0.0001, end - start)
  return `${Math.min(100, (props.row.fadeIn / span) * 100)}%`
})
const fadeOutPct = computed(() => {
  const { start, end } = effective()
  const span = Math.max(0.0001, end - start)
  return `${Math.min(100, (props.row.fadeOut / span) * 100)}%`
})

function onRowClick(): void {
  emit('select', props.row.id)
}

function onBarPointerDown(event: PointerEvent, mode: DragMode): void {
  if (event.button !== 0) return
  const laneEl = (event.currentTarget as HTMLElement).closest('.audio-track-lane') as HTMLElement | null
  if (!laneEl) return
  event.stopPropagation()
  emit('barPointerDown', { event, laneEl, row: props.row, mode })
}

function onContextMenu(event: MouseEvent): void {
  event.preventDefault()
  event.stopPropagation()
  emit('contextmenu', { id: props.row.id, x: event.clientX, y: event.clientY })
}

function barTitle(): string {
  const { start, end } = effective()
  const muteNote = isMuted.value ? ' · muted' : ` · vol ${Math.round(props.row.volume * 100)}%`
  return `${props.row.id}\n${props.row.asset}\n${start.toFixed(2)}s → ${end.toFixed(2)}s${muteNote}`
}
</script>

<template>
  <div
    class="audio-track"
    :class="{ selected }"
    :data-audio-track-id="row.id"
    @click="onRowClick"
  >
    <div class="audio-track-label">
      <span class="audio-glyph" aria-hidden="true">♪</span>
      <span class="label-id">{{ row.id }}</span>
      <span v-if="isMuted" class="mute-chip">muted</span>
    </div>
    <div class="audio-track-lane">
      <button
        type="button"
        class="audio-bar"
        :class="{ dragging: isDragging, muted: isMuted }"
        :style="{ left: barLeftPct, width: barWidthPct }"
        :title="barTitle()"
        :data-testid="`timeline-audio-bar-${row.id}`"
        :data-dragging="isDragging ? 'true' : null"
        @pointerdown="(e) => onBarPointerDown(e, 'move')"
        @contextmenu="onContextMenu"
      >
        <span class="fade-ramp fade-in" :style="{ width: fadeInPct }" aria-hidden="true" />
        <span class="audio-bar-label">{{ row.asset }}</span>
        <span class="fade-ramp fade-out" :style="{ width: fadeOutPct }" aria-hidden="true" />
        <span
          class="resize-handle resize-right"
          data-testid="timeline-audio-resize-right"
          @pointerdown.stop="(e) => onBarPointerDown(e, 'resize-right')"
          @click.stop
        />
      </button>
    </div>
  </div>
</template>

<style scoped>
.audio-track {
  display: grid;
  grid-template-columns: var(--ruler-gutter-width, 160px) 1fr;
  align-items: stretch;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  min-height: 24px;
  cursor: pointer;
}

.audio-track:hover {
  background: rgba(255, 255, 255, 0.025);
}

.audio-track.selected {
  background: rgba(6, 214, 160, 0.1);
}

.audio-track-label {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  font-size: 12px;
  color: #e5e5e5;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  min-width: 0;
}

.audio-glyph {
  color: #6bd0b0;
  flex: 0 0 auto;
}

.label-id {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1 1 auto;
  min-width: 0;
}

.mute-chip {
  flex: 0 0 auto;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #a3a3a3;
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 5px;
  border-radius: 999px;
}

.audio-track-lane {
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

.audio-bar {
  position: absolute;
  top: 3px;
  bottom: 3px;
  min-width: 2px;
  padding: 0 4px;
  border: 1px solid rgba(6, 214, 160, 0.95);
  border-radius: 3px;
  background: rgba(6, 214, 160, 0.55);
  color: #052017;
  font: 10px/1 'JetBrains Mono', ui-monospace, monospace;
  text-align: left;
  cursor: grab;
  overflow: hidden;
  white-space: nowrap;
  display: flex;
  align-items: center;
  touch-action: none;
}

.audio-bar:hover {
  filter: brightness(1.15);
}

.audio-bar.dragging {
  cursor: grabbing;
  filter: brightness(1.2);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18), 0 4px 14px rgba(0, 0, 0, 0.5);
  z-index: 3;
}

.audio-bar.muted {
  background: repeating-linear-gradient(
    45deg,
    rgba(120, 120, 120, 0.45),
    rgba(120, 120, 120, 0.45) 4px,
    rgba(90, 90, 90, 0.45) 4px,
    rgba(90, 90, 90, 0.45) 8px
  );
  border-color: rgba(180, 180, 180, 0.6);
  color: #d4d4d4;
}

.audio-bar-label {
  pointer-events: none;
  opacity: 0.9;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
  z-index: 1;
}

.fade-ramp {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 0;
}

.fade-ramp.fade-in {
  left: 0;
  background: linear-gradient(to right, rgba(0, 0, 0, 0.45), transparent);
}

.fade-ramp.fade-out {
  right: 0;
  background: linear-gradient(to left, rgba(0, 0, 0, 0.45), transparent);
}

.resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  background: rgba(0, 0, 0, 0.18);
  z-index: 2;
}

.resize-handle.resize-right {
  right: 0;
  border-top-right-radius: 3px;
  border-bottom-right-radius: 3px;
}

.audio-bar:hover .resize-handle {
  background: rgba(255, 255, 255, 0.35);
}
</style>
