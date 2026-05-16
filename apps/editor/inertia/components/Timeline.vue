<script setup lang="ts">
// Timeline — step 10 of the editor build plan.
//
// Reads `composition.tweens` and groups them per `target` item. One row per
// item (`TimelineTrack`), one bar per tween. A ruler at the top marks each
// second and a vertical playhead synced to `useStage().playhead` slides
// across both ruler and tracks while the stage is playing. Clicking a bar
// pushes the tween's target into the shared selection (consumed by the
// Inspector via `useSelection`).
//
// Source classification (no source-map yet — that's step 15):
//   - behavior  ← tween id contains `_<knownBehaviorName>_`
//                 (behavior expansion emits `${target}_${behavior}_${start}__suffix`)
//   - scene     ← tween target id has an `instanceId__…` prefix where the
//                 instance item exists and is `type:"group"` (scenes wrap
//                 their children in a synthetic group; templates don't).
//   - template  ← tween target id has an `instanceId__…` prefix where the
//                 instance is *not* a group (template expansion spreads
//                 child items directly into the composition).
//   - plain     ← everything else (literal canonical tween, no expansion).
//
// All four classes get their own bar color (PRD FR-05). The heuristic loses
// information when an authored item id happens to contain `__`, but the
// editor's own commands never mint such ids — they only appear as
// expansion output.

import { computed, ref, watch, type Ref } from 'vue'
import type { Command, Composition } from '~/composables/useCommandBus'
import { useSelection } from '~/composables/useSelection'
import { useTimelineDrag } from '~/composables/useTimelineDrag'
import TimelineTrack, {
  type BarPointerDownPayload,
  type TimelineItemRow,
  type TimelineTween,
  type TweenSource,
} from '~/components/TimelineTrack.vue'

const props = defineProps<{
  composition: Composition | null
  /** Current playhead time in seconds. Wire to `useStage().playhead`. */
  playhead: number
  /** Stage status string — controls the playhead indicator label. */
  status?: string | null
  /** Snap step in seconds. Defaults to 0.25. */
  snapStep?: number
}>()

const emit = defineEmits<{
  (event: 'seek', t: number): void
  (event: 'apply', command: Command): void
}>()

const selection = useSelection()

const duration = computed<number>(() => {
  const d = props.composition?.composition?.duration
  return typeof d === 'number' && d > 0 ? d : 0
})

const snapStepRef = computed<number>(() => {
  const s = props.snapStep
  return typeof s === 'number' && s > 0 ? s : 0.25
})

// Step 11 — drag/resize coordinator. `onCommit` only fires once per drag
// (pointerup), so we issue exactly one `update_tween` per gesture. The
// composable also exposes `active` which we forward to TimelineTrack so the
// in-flight bar repaints at the snapped preview position.
const drag = useTimelineDrag({
  duration,
  snapStep: snapStepRef,
  onCommit(tweenId, patch) {
    emit('apply', {
      kind: 'update_tween',
      payload: { id: tweenId, props: patch },
      source: 'ui',
    })
  },
})

function onBarPointerDown(payload: BarPointerDownPayload): void {
  drag.begin({
    event: payload.event,
    laneElement: payload.laneEl,
    tween: payload.tween,
    mode: payload.mode,
  })
}

// Behavior catalogue (kept in sync with src/compose/behaviors.ts). Stored as
// a Set so the per-tween classifier is O(1) per probe.
const BEHAVIOR_NAMES: ReadonlySet<string> = new Set([
  'fadeIn',
  'fadeOut',
  'popIn',
  'popOut',
  'slideIn',
  'slideOut',
  'rotateSpin',
  'kenburns',
  'shake',
  'colorCycle',
  'pulse',
])

function classifyTween(
  tween: { id: string; target: string },
  items: Record<string, { type: string }>,
): TweenSource {
  const id = tween.id ?? ''
  // 1) Behavior: id includes `_<behaviorName>_` (or `__<behavior>_` after scene/
  //    template prefix). The first underscore captures the case where the
  //    target id itself contains no underscores; the lookahead/lookbehind
  //    avoids matching substrings inside a longer property name.
  //    Example: `ball_fadeIn_2.5__t0` or `intro__ball_popIn_0__t1`.
  for (const name of BEHAVIOR_NAMES) {
    if (id.includes(`_${name}_`)) return 'behavior'
  }
  // 2) Template / scene: target id is prefixed with `${instanceId}__`.
  //    Scenes wrap children in a `group` (the synthetic wrapper item);
  //    templates spread items directly into the composition.
  const target = tween.target ?? ''
  const sep = target.indexOf('__')
  if (sep > 0) {
    const prefix = target.slice(0, sep)
    const root = items[prefix]
    if (root && root.type === 'group') return 'scene'
    if (root) return 'template'
    // Prefix doesn't resolve to a known item — fall through to plain.
  }
  return 'plain'
}

const rows = computed<TimelineItemRow[]>(() => {
  const comp = props.composition
  if (!comp) return []
  const items = (comp.items ?? {}) as Record<string, { type: string }>
  const tweens = (comp.tweens ?? []) as Array<{
    id: string
    target: string
    property: string
    start: number
    duration: number
    easing?: string
  }>

  // Bucket tweens by target. We iterate tweens once and sort the per-target
  // arrays by `start` so bars stack left-to-right.
  const buckets = new Map<string, TimelineTween[]>()
  for (const t of tweens) {
    if (!t || typeof t.target !== 'string') continue
    const bucket = buckets.get(t.target) ?? []
    bucket.push({
      id: t.id,
      target: t.target,
      property: t.property,
      start: typeof t.start === 'number' ? t.start : 0,
      duration: typeof t.duration === 'number' ? t.duration : 0,
      easing: t.easing,
      source: classifyTween(t, items),
    })
    buckets.set(t.target, bucket)
  }

  // Stable row order: walk layers top→bottom, then any items not in a layer
  // (e.g. group children, scene-internal items) in `Object.keys` order. Items
  // without tweens still get a row so the user can see them in the timeline.
  const ordered: string[] = []
  const seen = new Set<string>()
  const layers = Array.isArray(comp.layers) ? (comp.layers as Array<{ items?: string[] }>) : []
  for (const layer of layers) {
    if (!layer || !Array.isArray(layer.items)) continue
    for (const id of layer.items) {
      if (typeof id !== 'string' || seen.has(id)) continue
      if (!items[id]) continue
      ordered.push(id)
      seen.add(id)
    }
  }
  // Group children come next, in declaration order, so nested items appear
  // beneath their parent group row.
  const groupChildren: string[] = []
  for (const parentId of ordered) {
    const parent = items[parentId] as { type: string; items?: unknown } | undefined
    if (parent?.type !== 'group' || !Array.isArray(parent.items)) continue
    for (const childId of parent.items as unknown[]) {
      if (typeof childId !== 'string' || seen.has(childId)) continue
      if (!items[childId]) continue
      groupChildren.push(childId)
      seen.add(childId)
    }
  }
  for (const id of groupChildren) ordered.push(id)
  // Finally, any item that has tweens but isn't yet listed (defensive — scene
  // expansions usually attach through the wrapper group, but be safe).
  for (const targetId of buckets.keys()) {
    if (!seen.has(targetId) && items[targetId]) {
      ordered.push(targetId)
      seen.add(targetId)
    }
  }

  return ordered.map((id) => {
    const list = (buckets.get(id) ?? []).slice().sort((a, b) => a.start - b.start)
    return {
      id,
      type: items[id]?.type ?? 'unknown',
      tweens: list,
    }
  })
})

const tweenCount = computed<number>(() =>
  rows.value.reduce((acc, r) => acc + r.tweens.length, 0),
)

// Ruler ticks: one major tick per second, minor tick every 0.25s. Snap the
// number of major ticks to ceil(duration) so the rightmost tick is the
// composition's end (the playhead can reach it).
const rulerTicks = computed<Array<{ t: number; major: boolean }>>(() => {
  const d = duration.value
  if (d <= 0) return []
  const ticks: Array<{ t: number; major: boolean }> = []
  // 0 through ceil(d) majors.
  const lastMajor = Math.ceil(d)
  for (let i = 0; i <= lastMajor; i += 1) {
    if (i > d + 1e-9) break
    ticks.push({ t: i, major: true })
    if (i + 0.25 < d) ticks.push({ t: i + 0.25, major: false })
    if (i + 0.5 < d) ticks.push({ t: i + 0.5, major: false })
    if (i + 0.75 < d) ticks.push({ t: i + 0.75, major: false })
  }
  return ticks
})

function pct(t: number): string {
  const d = duration.value
  if (d <= 0) return '0%'
  return `${Math.min(100, Math.max(0, (t / d) * 100))}%`
}

const playheadLeft = computed(() => pct(props.playhead))
const playheadLabel = computed(() => `${props.playhead.toFixed(2)}s`)

function onSelectItem(id: string, _tweenId?: string): void {
  selection.setSelection(id)
}

const rulerEl: Ref<HTMLDivElement | null> = ref(null)

function onRulerClick(event: MouseEvent): void {
  const el = rulerEl.value
  const d = duration.value
  if (!el || d <= 0) return
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0) return
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
  emit('seek', ratio * d)
}

// Scroll the most-recently-selected row into view so the user can find it
// after clicking an item in the Inspector dropdown.
const trackList: Ref<HTMLDivElement | null> = ref(null)
watch(
  () => selection.selectedItemId.value,
  (id) => {
    if (!id || !trackList.value) return
    const target = trackList.value.querySelector(`[data-item-id="${CSS.escape(id)}"]`)
    if (target && 'scrollIntoView' in target) {
      ;(target as HTMLElement).scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  },
)
</script>

<template>
  <div class="timeline" :data-tween-count="tweenCount">
    <header class="timeline-meta">
      <span class="meta-tween-count">{{ tweenCount }} tween{{ tweenCount === 1 ? '' : 's' }}</span>
      <span class="meta-duration">{{ duration.toFixed(2) }}s</span>
      <span class="meta-playhead">{{ playheadLabel }}</span>
      <span v-if="status" class="meta-status" :data-status="status">{{ status }}</span>
      <span class="legend">
        <span class="legend-item"><span class="swatch swatch-template" />template</span>
        <span class="legend-item"><span class="swatch swatch-behavior" />behavior</span>
        <span class="legend-item"><span class="swatch swatch-scene" />scene</span>
        <span class="legend-item"><span class="swatch swatch-plain" />plain</span>
      </span>
    </header>
    <div class="timeline-body">
      <div class="ruler-row">
        <div class="ruler-gutter">tracks</div>
        <div
          ref="rulerEl"
          class="ruler"
          :title="`Click to seek (0 → ${duration.toFixed(2)}s)`"
          @click="onRulerClick"
        >
          <div
            v-for="tick in rulerTicks"
            :key="tick.t"
            class="tick"
            :class="{ major: tick.major }"
            :style="{ left: pct(tick.t) }"
          >
            <span v-if="tick.major" class="tick-label">{{ tick.t }}s</span>
          </div>
          <div
            class="playhead playhead-head"
            :style="{ left: playheadLeft }"
            :data-time="playheadLabel"
          />
        </div>
      </div>
      <div ref="trackList" class="tracks">
        <TimelineTrack
          v-for="row in rows"
          :key="row.id"
          :row="row"
          :duration="duration"
          :selected-id="selection.selectedItemId.value"
          :drag-active="drag.active.value"
          @select-item="onSelectItem"
          @bar-pointer-down="onBarPointerDown"
        />
        <div
          v-if="duration > 0"
          class="playhead playhead-line"
          :style="{ left: `calc(160px + (100% - 160px) * ${playhead / duration})` }"
        />
        <p v-if="rows.length === 0" class="empty">No items in this composition.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timeline {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  font-family: 'Instrument Sans', system-ui, sans-serif;
  color: #e5e5e5;
}

.timeline-meta {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 6px 12px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #a3a3a3;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  flex: 0 0 auto;
}

.meta-tween-count {
  color: #e5e5e5;
  font-weight: 500;
}

.meta-duration,
.meta-playhead {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-feature-settings: 'tnum';
  text-transform: none;
  letter-spacing: 0;
}

.meta-status[data-status='playing'] {
  color: #06d6a0;
}

.meta-status[data-status='ended'] {
  color: #ffd166;
}

.meta-status[data-status='error'] {
  color: #ff6b6b;
}

.legend {
  margin-left: auto;
  display: inline-flex;
  gap: 12px;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  text-transform: none;
  letter-spacing: 0;
  color: #a3a3a3;
}

.swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
  display: inline-block;
}

.swatch-template {
  background: rgba(255, 107, 53, 0.78);
}
.swatch-behavior {
  background: rgba(6, 214, 160, 0.78);
}
.swatch-scene {
  background: rgba(255, 209, 102, 0.82);
}
.swatch-plain {
  background: rgba(91, 124, 250, 0.55);
}

.timeline-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ruler-row {
  display: grid;
  grid-template-columns: 160px 1fr;
  align-items: stretch;
  flex: 0 0 auto;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
}

.ruler-gutter {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #707070;
  padding: 0 8px;
  display: flex;
  align-items: center;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
}

.ruler {
  position: relative;
  height: 24px;
  cursor: pointer;
}

.tick {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(255, 255, 255, 0.1);
  pointer-events: none;
}

.tick.major {
  background: rgba(255, 255, 255, 0.22);
}

.tick-label {
  position: absolute;
  top: 4px;
  left: 4px;
  font-size: 10px;
  color: #707070;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-feature-settings: 'tnum';
}

.tracks {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.playhead {
  pointer-events: none;
}

.playhead-head {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 1px solid #ff6b35;
  z-index: 2;
}

.playhead-head::before {
  content: '';
  position: absolute;
  top: 0;
  left: -5px;
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 6px solid #ff6b35;
}

.playhead-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 1px solid rgba(255, 107, 53, 0.85);
  z-index: 1;
}

.empty {
  padding: 12px;
  color: #707070;
  font-size: 12px;
}
</style>
