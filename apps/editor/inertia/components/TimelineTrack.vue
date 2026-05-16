<script setup lang="ts">
// TimelineTrack — step 10 of the editor build plan.
//
// One row per composition item: a left-hand label + a track lane that paints
// every tween targeting this item as a positioned bar. Bars are colored by
// {@link TweenSource source heuristic} (template / behavior / scene / plain)
// so the user can read provenance at a glance — see {@link classifyTween}.
//
// Click a bar → emits `selectItem` with the tween's target. Until step 15's
// source-map lands, that's the same item the row already represents, but
// emitting the target (not the row's item id) keeps the API correct for
// future behavior-on-group expansions that may target a synthetic child.

import { computed } from 'vue'

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
}>()

const emit = defineEmits<{
  (event: 'selectItem', id: string, tweenId?: string): void
}>()

const isSelected = computed(() => props.selectedId === props.row.id)

function barLeftPct(t: TimelineTween): string {
  const d = props.duration
  if (d <= 0) return '0%'
  return `${(t.start / d) * 100}%`
}

function barWidthPct(t: TimelineTween): string {
  const d = props.duration
  if (d <= 0) return '0%'
  return `${(t.duration / d) * 100}%`
}

function onRowClick(): void {
  emit('selectItem', props.row.id)
}

function onBarClick(t: TimelineTween, event: MouseEvent): void {
  event.stopPropagation()
  emit('selectItem', t.target, t.id)
}

function barTitle(t: TimelineTween): string {
  const end = t.start + t.duration
  const easing = t.easing ? ` · ${t.easing}` : ''
  return `${t.id}\n${t.property} · ${t.source}${easing}\n${t.start.toFixed(2)}s → ${end.toFixed(2)}s (${t.duration.toFixed(2)}s)`
}
</script>

<template>
  <div
    class="track"
    :class="{ selected: isSelected }"
    :data-item-id="row.id"
    @click="onRowClick"
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
        :class="`bar-${tween.source}`"
        :style="{ left: barLeftPct(tween), width: barWidthPct(tween) }"
        :title="barTitle(tween)"
        :data-tween-id="tween.id"
        :data-tween-source="tween.source"
        @click="(e) => onBarClick(tween, e)"
      >
        <span class="bar-label">{{ tween.property }}</span>
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
  cursor: pointer;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
}

.bar:hover {
  filter: brightness(1.15);
  border-color: rgba(255, 255, 255, 0.35);
}

.bar-label {
  pointer-events: none;
  opacity: 0.85;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
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
