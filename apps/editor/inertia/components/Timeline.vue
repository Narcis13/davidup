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
// Source classification (polish_plan §20.26): bars are coloured from the
// `originKind` field of the precompile source map, served by the server in
// the Inertia `sourceMap` prop. The mapping is:
//   - "behavior"             → 'behavior'  (emitted from a $behavior block)
//   - "template"             → 'template'  (emitted from a $template instance)
//   - "scene" / "background" → 'scene'     (scene-instance expansion product)
//   - "literal" / "ref"      → 'plain'     (authored directly or inlined $ref)
//
// Tweens added during the session via commands (`add_tween`, `apply_behavior`)
// are not in the load-time map. For those we fall back to a narrow id-string
// heuristic (only behavior expansion mints `_<behaviorName>_` substrings) and,
// failing that, treat them as plain literals — the dominant case for
// hand-authored single tweens.

import { computed, ref, watch, type Ref } from 'vue'
import type { Command, Composition } from '~/composables/useCommandBus'
import { useSelection } from '~/composables/useSelection'
import { useTimelineDrag } from '~/composables/useTimelineDrag'
import { useVideoTrimDrag } from '~/composables/useVideoTrimDrag'
import { useValidation } from '~/composables/useValidation'
import {
  buildCommandsForNewTrackDrop,
  buildCommandsForTrackDrop,
  useLibraryDrag,
} from '~/composables/useLibraryDrag'
import TimelineTrack, {
  type BarPointerDownPayload,
  type TimelineItemRow,
  type TimelineTween,
  type TweenSource,
  type VideoSpanPointerDownPayload,
  type VideoTrimPointerDownPayload,
} from '~/components/TimelineTrack.vue'
import TimelineAudioTrack, {
  type AudioBarPointerDownPayload,
  type TimelineAudioRow,
} from '~/components/TimelineAudioTrack.vue'

type OriginKind = 'literal' | 'ref' | 'template' | 'behavior' | 'scene' | 'background'

interface SourceLocation {
  file: string
  jsonPointer: string
  originKind: OriginKind
}

interface SourceMap {
  items: Record<string, SourceLocation>
  tweens: Record<string, SourceLocation>
}

const props = defineProps<{
  composition: Composition | null
  /** Current playhead time in seconds. Wire to `useStage().playhead`. */
  playhead: number
  /** Stage status string — controls the playhead indicator label. */
  status?: string | null
  /** Snap step in seconds. Defaults to 0.25. */
  snapStep?: number
  /**
   * Precompile source map (PRD step 15). When present, each bar's colour
   * comes from `tweens[id].originKind`. Tweens added after load fall back
   * to the id-string heuristic below.
   */
  sourceMap?: SourceMap | null
}>()

const emit = defineEmits<{
  (event: 'seek', t: number): void
  (event: 'apply', command: Command): void
  // §20.27 — bubbles up the scene-instance id that owns a sealed bar so the
  // page can route the SourceDrawer to the scene declaration line.
  (event: 'openSceneSource', sceneInstanceId: string): void
  // Mouse-reachable transport: the page wires this to `stage.togglePlay()`
  // so first-time users without the Space-key shortcut can pause.
  (event: 'togglePlay'): void
}>()

const selection = useSelection()
const validation = useValidation()

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

// U3 — audio-lane drag. `useTimelineDrag`'s {start, duration} math applies
// unchanged to an audio track's [start, end) span; only the commit shape
// differs (`update_audio_track` takes `end`, not `duration`).
const audioDrag = useTimelineDrag({
  duration,
  snapStep: snapStepRef,
  onCommit(trackId, patch) {
    const row = audioRows.value.find((r) => r.id === trackId)
    if (!row) return
    const newStart = patch.start ?? row.start
    const newDuration = patch.duration ?? row.end - row.start
    const props_: Record<string, number> = { end: newStart + newDuration }
    if (patch.start !== undefined) props_.start = newStart
    emit('apply', {
      kind: 'update_audio_track',
      payload: { id: trackId, props: props_ },
      source: 'ui',
    })
  },
})

function onAudioBarPointerDown(payload: AudioBarPointerDownPayload): void {
  audioDrag.begin({
    event: payload.event,
    laneElement: payload.laneEl,
    tween: { id: payload.row.id, target: payload.row.id, start: payload.row.start, duration: payload.row.end - payload.row.start },
    mode: payload.mode,
  })
}

// U5 — video item outer-span drag (move / resize the freeze-or-loop tail's
// end). Reuses the same generic {start, duration} math as tweens/audio; the
// commit maps back to `update_item` with `start`/`end`.
const videoSpanDrag = useTimelineDrag({
  duration,
  snapStep: snapStepRef,
  onCommit(itemId, patch) {
    const row = rows.value.find((r) => r.id === itemId)
    const span = row?.videoSpan
    if (!span) return
    const newStart = patch.start ?? span.start
    const newDuration = patch.duration ?? span.end - span.start
    const props_: Record<string, number> = {}
    if (patch.start !== undefined) props_.start = newStart
    if (patch.duration !== undefined) props_.end = newStart + newDuration
    if (Object.keys(props_).length === 0) return
    emit('apply', {
      kind: 'update_item',
      payload: { id: itemId, props: props_ },
      source: 'ui',
    })
  },
})

function onVideoSpanPointerDown(payload: VideoSpanPointerDownPayload): void {
  videoSpanDrag.begin({
    event: payload.event,
    laneElement: payload.laneEl,
    tween: {
      id: payload.itemId,
      target: payload.itemId,
      start: payload.span.start,
      duration: payload.span.end - payload.span.start,
    },
    mode: payload.mode,
  })
}

// U5 — trim handle drag (trimIn / trimOut). Distinct math from the outer
// span: anchored to the source asset's time axis, not the composition
// timeline. See `useVideoTrimDrag` / `videoTrimMath.ts`.
const videoTrimDrag = useVideoTrimDrag({
  duration,
  snapStep: snapStepRef,
  onCommit(itemId, patch) {
    emit('apply', {
      kind: 'update_item',
      payload: { id: itemId, props: patch },
      source: 'ui',
    })
  },
})

function onVideoTrimPointerDown(payload: VideoTrimPointerDownPayload): void {
  videoTrimDrag.begin({
    event: payload.event,
    laneElement: payload.laneEl,
    itemId: payload.itemId,
    mode: payload.mode,
    trimIn: payload.span.trimIn,
    trimOut: payload.span.trimOut,
    assetDuration: payload.span.assetDuration,
  })
}

// Behavior catalogue (kept in sync with src/compose/behaviors.ts). Stored as
// a Set so the per-tween classifier is O(1) per probe. Used only as a fallback
// for tweens added during the session that have no source-map entry.
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

function originKindToTweenSource(kind: OriginKind): TweenSource {
  switch (kind) {
    case 'behavior':
      return 'behavior'
    case 'template':
      return 'template'
    case 'scene':
    case 'background':
      return 'scene'
    case 'literal':
    case 'ref':
      return 'plain'
  }
}

function classifyTweenFallback(
  tween: { id: string; target: string },
  items: Record<string, { type: string }>,
): TweenSource {
  const id = tween.id ?? ''
  for (const name of BEHAVIOR_NAMES) {
    if (id.includes(`_${name}_`)) return 'behavior'
  }
  const target = tween.target ?? ''
  const sep = target.indexOf('__')
  if (sep > 0) {
    const prefix = target.slice(0, sep)
    const root = items[prefix]
    if (root && root.type === 'group') return 'scene'
    if (root) return 'template'
  }
  return 'plain'
}

function classifyTween(
  tween: { id: string; target: string },
  items: Record<string, { type: string }>,
  sourceMap: SourceMap | null | undefined,
): TweenSource {
  const id = tween.id ?? ''
  const entry = sourceMap?.tweens?.[id]
  if (entry && entry.originKind) {
    return originKindToTweenSource(entry.originKind)
  }
  // Tween was added in-session (apply_behavior / add_tween) and isn't in the
  // load-time source map. Fall back to the id-string heuristic.
  return classifyTweenFallback(tween, items)
}

// U5 — asset id → registered duration (seconds), used to clamp/resolve a
// video item's trim window and its unbounded `end` fallback.
const assetDurationById = computed<ReadonlyMap<string, number>>(() => {
  const out = new Map<string, number>()
  const list = props.composition?.assets
  if (!Array.isArray(list)) return out
  for (const a of list as ReadonlyArray<{ id?: unknown; duration?: unknown }>) {
    if (typeof a?.id === 'string' && typeof a.duration === 'number' && Number.isFinite(a.duration)) {
      out.set(a.id, a.duration)
    }
  }
  return out
})

// U3 — one row per `composition.audio[]` entry, sorted by start so bars read
// left-to-right like the item tracks above. `end` always resolves to a
// concrete number here (the schema allows an absent `end` meaning "play to
// the asset's natural duration" — we fall back to the registered asset
// duration, then the composition duration, so the bar is never zero-width).
const audioRows = computed<TimelineAudioRow[]>(() => {
  const comp = props.composition
  const list = (comp as { audio?: unknown } | null)?.audio
  if (!Array.isArray(list)) return []
  const out: TimelineAudioRow[] = []
  for (const t of list as ReadonlyArray<Record<string, unknown>>) {
    if (typeof t?.id !== 'string' || typeof t.asset !== 'string') continue
    const start = typeof t.start === 'number' ? t.start : 0
    const assetDur = assetDurationById.value.get(t.asset) ?? null
    const end =
      typeof t.end === 'number'
        ? t.end
        : start + (assetDur ?? Math.max(0, duration.value - start))
    out.push({
      id: t.id,
      asset: t.asset,
      start,
      end,
      volume: typeof t.volume === 'number' ? t.volume : 1,
      fadeIn: typeof t.fadeIn === 'number' ? t.fadeIn : 0,
      fadeOut: typeof t.fadeOut === 'number' ? t.fadeOut : 0,
    })
  }
  out.sort((a, b) => a.start - b.start)
  return out
})

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
      source: classifyTween(t, items, props.sourceMap),
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
    const type = items[id]?.type ?? 'unknown'
    return {
      id,
      type,
      tweens: list,
      videoSpan: type === 'video' ? buildVideoSpan(id) : null,
    }
  })
})

// U5 — a video item's own occupied-time span, distinct from its tweens.
// `end` falls back to `start + (trimOut - trimIn)` (i.e. no freeze/loop
// tail) when the item omits it (engine leaves `end` unset meaning "play to
// the visible-trim boundary" — see v0.2-plan S5/S9); if trim bounds are also
// unknown, falls back to the full composition duration so the bar is at
// least visible rather than zero-width.
function buildVideoSpan(id: string): TimelineItemRow['videoSpan'] {
  const comp = props.composition
  const raw = (comp?.items as Record<string, Record<string, unknown>> | undefined)?.[id]
  if (!raw) return null
  const start = typeof raw.start === 'number' ? raw.start : 0
  const trimIn = typeof raw.trimIn === 'number' ? raw.trimIn : 0
  const assetId = typeof raw.asset === 'string' ? raw.asset : null
  const assetDuration = assetId ? (assetDurationById.value.get(assetId) ?? null) : null
  const trimOut =
    typeof raw.trimOut === 'number' ? raw.trimOut : (assetDuration ?? duration.value)
  const visible = Math.max(0, trimOut - trimIn)
  const end = typeof raw.end === 'number' ? raw.end : start + (visible > 0 ? visible : duration.value)
  return {
    start,
    end,
    trimIn,
    trimOut,
    assetDuration,
    loop: raw.loop === true,
  }
}

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

// Transport state — derived from the stage status string passed down from the
// page. `isPlaying` chooses between the pause-bars and play-triangle glyph;
// `playLabel` is the short human readout that replaces the old `meta-status`
// readout (so the button visibly shows what the stage is currently doing).
const isPlaying = computed<boolean>(() => props.status === 'playing')
const transportDisabled = computed<boolean>(() => {
  const s = props.status
  // No stage attached yet (no project), still loading, or in error → nothing
  // useful to toggle. Treat 'idle' as disabled because togglePlay is a no-op.
  return !s || s === 'idle' || s === 'loading' || s === 'error'
})
const playLabel = computed<string>(() => {
  switch (props.status) {
    case 'playing':
      return 'Pause'
    case 'paused':
      return 'Play'
    case 'stopped':
      return 'Play'
    case 'ended':
      return 'Replay'
    case 'loading':
      return 'Loading…'
    case 'error':
      return 'Error'
    default:
      return 'Play'
  }
})
const playTitle = computed<string>(() => {
  if (transportDisabled.value) return playLabel.value
  return isPlaying.value ? 'Pause (Space)' : 'Play (Space)'
})

function onToggleTransport(): void {
  if (transportDisabled.value) return
  emit('togglePlay')
}

function onSeekStart(): void {
  if (duration.value <= 0) return
  emit('seek', 0)
}

// §20.27 — strip the scene-internal suffix so we land on the wrapper-group
// instance id. Tweens authored directly against the wrapper (target == scene
// instance id) have no `__`, in which case the target IS the instance id.
function sceneInstanceIdForTween(tween: TimelineTween): string {
  const target = tween.target ?? ''
  const sep = target.indexOf('__')
  return sep > 0 ? target.slice(0, sep) : target
}

function onOpenSceneSource(tween: TimelineTween): void {
  const sceneId = sceneInstanceIdForTween(tween)
  if (!sceneId) return
  emit('openSceneSource', sceneId)
}

// U3 — audio track selection + context menu (Mute / Delete / Reset volume).
function onSelectAudioTrack(id: string): void {
  selection.setAudioTrackSelection(id)
}

interface AudioContextMenuState {
  id: string
  x: number
  y: number
}
const audioContextMenu = ref<AudioContextMenuState | null>(null)

function onAudioContextMenu(payload: { id: string; x: number; y: number }): void {
  audioContextMenu.value = payload
}

function closeAudioContextMenu(): void {
  audioContextMenu.value = null
}

function contextMenuTrack(): TimelineAudioRow | null {
  const id = audioContextMenu.value?.id
  if (!id) return null
  return audioRows.value.find((r) => r.id === id) ?? null
}

function contextMenuMute(): void {
  const track = contextMenuTrack()
  closeAudioContextMenu()
  if (!track) return
  emit('apply', {
    kind: 'update_audio_track',
    payload: { id: track.id, props: { volume: track.volume > 0 ? 0 : 1 } },
    source: 'ui',
  })
}

function contextMenuResetVolume(): void {
  const track = contextMenuTrack()
  closeAudioContextMenu()
  if (!track) return
  emit('apply', {
    kind: 'update_audio_track',
    payload: { id: track.id, props: { volume: 1 } },
    source: 'ui',
  })
}

function contextMenuDelete(): void {
  const track = contextMenuTrack()
  closeAudioContextMenu()
  if (!track) return
  if (selection.selectedAudioTrackId.value === track.id) {
    selection.setAudioTrackSelection(null)
  }
  emit('apply', { kind: 'remove_audio_track', payload: { id: track.id }, source: 'ui' })
}

// U3 — dropping an audio asset directly into the audio lane creates a track
// at the drop's horizontal time position (not the playhead) — matches the
// per-row/new-track item drops, which use the mouse position on Stage but
// the playhead on Timeline; the audio lane is explicitly time-positional so
// it uses the drop's x-coordinate instead.
const audioLaneEl: Ref<HTMLDivElement | null> = ref(null)

function audioLaneAcceptsDrop(): boolean {
  const p = libraryDrag.payload.value
  return !!p && p.kind === 'asset' && p.mediaType === 'audio'
}

function onAudioLaneDragOver(event: DragEvent): void {
  if (!audioLaneAcceptsDrop()) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  libraryDrag.setHover('new-track', null)
}

function onAudioLaneDragLeave(): void {
  libraryDrag.clearHover('new-track', null)
}

function timeAtClientX(clientX: number): number {
  const el = audioLaneEl.value
  const d = duration.value
  if (!el || d <= 0) return Math.max(0, props.playhead)
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0) return Math.max(0, props.playhead)
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  return roundToSnap(ratio * d)
}

function onAudioLaneDrop(event: DragEvent): void {
  event.preventDefault()
  const payload = libraryDrag.readDropPayload(event)
  libraryDrag.onDragEnd()
  if (!payload || payload.kind !== 'asset' || payload.mediaType !== 'audio') return
  const start = timeAtClientX(event.clientX)
  emit('apply', {
    kind: 'add_audio_track',
    payload: { asset: payload.id, start: Math.max(0, start) },
    source: 'ui',
  })
}

function onSelectItem(id: string, tweenId?: string): void {
  // Step 20.24 — bar clicks emit a tween id; route them through
  // setTweenSelection so the Inspector switches to its tween editor. Row
  // clicks (no tween id) drop tween selection so the Inspector goes back
  // to the item editor.
  if (typeof tweenId === 'string' && tweenId.length > 0) {
    selection.setTweenSelection(tweenId, id)
  } else {
    selection.setSelection(id)
  }
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

// Library drag-and-drop (step 14). Two zones:
//   - per-row: dropping a behavior card lands `apply_behavior` against that
//     row's target item. Dropping a template/scene on a row is treated as a
//     new-track drop (we don't merge a template into an existing item).
//   - new-track gutter at the bottom of the tracks list: drops a template
//     or scene as a fresh instance on the first layer.
const libraryDrag = useLibraryDrag()
const tracksHostEl: Ref<HTMLDivElement | null> = ref(null)
const layerForDropId = computed<string | null>(() => {
  const comp = props.composition
  if (!comp || !Array.isArray(comp.layers)) return null
  const first = comp.layers.find((l: { id?: unknown }) => typeof l?.id === 'string')
  return first ? ((first as { id: string }).id ?? null) : null
})
const dragHoverActive = computed(() => libraryDrag.isActive.value)

function tweenAcceptsDrop(): boolean {
  const p = libraryDrag.payload.value
  return !!p && (p.kind === 'behavior' || p.kind === 'template' || p.kind === 'scene')
}

function onTrackDragOver(event: DragEvent, targetItemId: string): void {
  if (!tweenAcceptsDrop()) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  const p = libraryDrag.payload.value
  // Behaviors require an existing target; templates/scenes fall through to
  // the new-track zone but still highlight the row for feedback.
  if (p?.kind === 'behavior') {
    libraryDrag.setHover('track', targetItemId)
  } else {
    libraryDrag.setHover('new-track', null)
  }
}

function onTrackDragLeave(_event: DragEvent, targetItemId: string): void {
  libraryDrag.clearHover('track', targetItemId)
}

function onTrackDrop(event: DragEvent, targetItemId: string): void {
  event.preventDefault()
  const payload = libraryDrag.readDropPayload(event)
  libraryDrag.onDragEnd()
  if (!payload) return
  const layerId = layerForDropId.value
  if (!layerId) return
  const start = roundToSnap(Math.max(0, props.playhead))
  let commands: Command[] = []
  if (payload.kind === 'behavior') {
    commands = buildCommandsForTrackDrop(payload, {
      targetItemId,
      defaultLayerId: layerId,
      start,
    })
  } else {
    // template/scene dropped over a row → spawn a new track instead.
    commands = buildCommandsForNewTrackDrop(payload, { layerId, start })
  }
  for (const cmd of commands) emit('apply', cmd)
}

function onNewTrackDragOver(event: DragEvent): void {
  const p = libraryDrag.payload.value
  if (!p || (p.kind !== 'template' && p.kind !== 'scene')) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  libraryDrag.setHover('new-track', null)
}

function onNewTrackDragLeave(): void {
  libraryDrag.clearHover('new-track', null)
}

function onNewTrackDrop(event: DragEvent): void {
  event.preventDefault()
  const payload = libraryDrag.readDropPayload(event)
  libraryDrag.onDragEnd()
  if (!payload) return
  const layerId = layerForDropId.value
  if (!layerId) return
  const start = roundToSnap(Math.max(0, props.playhead))
  const commands = buildCommandsForNewTrackDrop(payload, { layerId, start })
  for (const cmd of commands) emit('apply', cmd)
}

function roundToSnap(t: number): number {
  const step = snapStepRef.value
  if (!step || step <= 0) return t
  return Math.round(t / step) * step
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
      <div class="transport" role="group" aria-label="Playback transport">
        <button
          type="button"
          class="transport-btn transport-to-start"
          data-testid="transport-to-start"
          title="Jump to start"
          aria-label="Jump to start"
          :disabled="duration <= 0"
          @click="onSeekStart"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <rect x="4" y="5" width="2.5" height="14" rx="0.6" />
            <path d="M21 5.6v12.8c0 .9-1 1.5-1.8 1.0L8.6 12.9a1.1 1.1 0 0 1 0-1.8L19.2 4.6c.8-.5 1.8.1 1.8 1z" />
          </svg>
        </button>
        <button
          type="button"
          class="transport-btn transport-play"
          data-testid="transport-toggle-play"
          :data-status="status ?? 'idle'"
          :data-playing="isPlaying ? 'true' : 'false'"
          :title="playTitle"
          :aria-label="playTitle"
          :aria-pressed="isPlaying ? 'true' : 'false'"
          :disabled="transportDisabled"
          @click="onToggleTransport"
        >
          <svg
            v-if="isPlaying"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <rect x="6" y="5" width="4" height="14" rx="0.8" />
            <rect x="14" y="5" width="4" height="14" rx="0.8" />
          </svg>
          <svg
            v-else
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M7 4.8v14.4c0 .9 1 1.5 1.8 1L20.4 13a1.2 1.2 0 0 0 0-2L8.8 3.8c-.8-.5-1.8.1-1.8 1z" />
          </svg>
          <span class="transport-label">{{ playLabel }}</span>
        </button>
      </div>
      <span class="meta-tween-count">{{ tweenCount }} tween{{ tweenCount === 1 ? '' : 's' }}</span>
      <span class="meta-duration">{{ duration.toFixed(2) }}s</span>
      <span class="meta-playhead">{{ playheadLabel }}</span>
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
      <div ref="trackList" class="tracks" data-testid="timeline-tracks">
        <TimelineTrack
          v-for="row in rows"
          :key="row.id"
          :row="row"
          :duration="duration"
          :selected-id="selection.selectedItemId.value"
          :drag-active="drag.active.value"
          :video-span-drag-active="videoSpanDrag.active.value"
          :video-trim-drag-active="videoTrimDrag.active.value"
          :marker-counts="validation.markersByTarget.value.get(row.id) ?? null"
          :library-hover="
            libraryDrag.hover.value === 'track' &&
            libraryDrag.hoverTargetId.value === row.id
              ? libraryDrag.payload.value?.kind ?? null
              : null
          "
          :library-drag-active="dragHoverActive"
          @select-item="onSelectItem"
          @bar-pointer-down="onBarPointerDown"
          @open-scene-source="onOpenSceneSource"
          @video-span-pointer-down="onVideoSpanPointerDown"
          @video-trim-pointer-down="onVideoTrimPointerDown"
          @library-drag-over="(e) => onTrackDragOver(e, row.id)"
          @library-drag-leave="(e) => onTrackDragLeave(e, row.id)"
          @library-drop="(e) => onTrackDrop(e, row.id)"
        />
        <div
          v-if="duration > 0"
          class="playhead playhead-line"
          :style="{
            left: `calc(var(--ruler-gutter-width) + (100% - var(--ruler-gutter-width)) * ${playhead / duration})`,
          }"
        />
        <div
          v-if="libraryDrag.isActive.value"
          class="new-track-drop"
          :data-active="libraryDrag.hover.value === 'new-track' ? 'true' : 'false'"
          :data-payload-kind="libraryDrag.payload.value?.kind ?? null"
          data-testid="timeline-new-track-drop"
          @dragenter.prevent="onNewTrackDragOver"
          @dragover="onNewTrackDragOver"
          @dragleave="onNewTrackDragLeave"
          @drop="onNewTrackDrop"
        >
          <span class="new-track-label">
            Drop {{ libraryDrag.payload.value?.kind ?? 'item' }} to add a new track
          </span>
        </div>
        <p v-if="rows.length === 0" class="empty">No items in this composition.</p>
      </div>

      <!-- U3 — Audio lane. Visually separated from the item tracks above by
           a distinct header + top border; reads `composition.audio[]`
           directly (never routed through the item/layer walk). -->
      <div class="audio-section">
        <div class="audio-section-header">
          <span class="audio-section-title">Audio</span>
          <span class="audio-section-count">{{ audioRows.length }}</span>
        </div>
        <div
          ref="audioLaneEl"
          class="audio-lane"
          data-testid="timeline-audio-lane"
          :data-drop-active="audioLaneAcceptsDrop() && libraryDrag.hover.value === 'new-track' ? 'true' : 'false'"
          @dragenter.prevent="onAudioLaneDragOver"
          @dragover="onAudioLaneDragOver"
          @dragleave="onAudioLaneDragLeave"
          @drop="onAudioLaneDrop"
        >
          <TimelineAudioTrack
            v-for="row in audioRows"
            :key="row.id"
            :row="row"
            :duration="duration"
            :selected="selection.selectedAudioTrackId.value === row.id"
            :drag-active="audioDrag.active.value"
            @select="onSelectAudioTrack"
            @bar-pointer-down="onAudioBarPointerDown"
            @contextmenu="onAudioContextMenu"
          />
          <p
            v-if="audioRows.length === 0"
            class="audio-empty"
            data-testid="timeline-audio-empty"
          >
            Drag an audio asset here from the Library, or click <strong>+ Add Audio Track…</strong> in the toolbar.
          </p>
        </div>
      </div>
    </div>

    <!-- U3 — audio track context menu (Mute / Delete / Reset volume). -->
    <div
      v-if="audioContextMenu"
      class="context-menu-backdrop"
      data-testid="timeline-audio-context-backdrop"
      @click="closeAudioContextMenu"
      @contextmenu.prevent="closeAudioContextMenu"
    >
      <div
        class="context-menu"
        :style="{ left: `${audioContextMenu.x}px`, top: `${audioContextMenu.y}px` }"
        data-testid="timeline-audio-context-menu"
        @click.stop
      >
        <button type="button" @click="contextMenuMute">
          {{ (contextMenuTrack()?.volume ?? 1) > 0 ? 'Mute' : 'Unmute' }}
        </button>
        <button type="button" @click="contextMenuResetVolume">Reset volume</button>
        <button type="button" class="danger" @click="contextMenuDelete">Delete</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timeline {
  --ruler-gutter-width: 160px;
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

.transport {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 2px;
}

.transport-btn {
  appearance: none;
  background: transparent;
  border: none;
  color: #d4d4d4;
  height: 22px;
  border-radius: 4px;
  font: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  transition: background 120ms ease, color 120ms ease;
}

.transport-btn:hover:not(:disabled) {
  background: rgba(91, 124, 250, 0.16);
  color: #e7ecff;
}

.transport-btn:focus-visible {
  outline: 1px solid rgba(91, 124, 250, 0.75);
  outline-offset: 1px;
}

.transport-btn:disabled {
  color: #555;
  cursor: default;
}

.transport-to-start {
  width: 24px;
  padding: 0;
}

.transport-play {
  gap: 5px;
  min-width: 70px;
  justify-content: flex-start;
  padding: 0 8px 0 6px;
}

.transport-label {
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-feature-settings: 'tnum';
  color: inherit;
}

.transport-play[data-playing='true']:not(:disabled) {
  color: #06d6a0;
}

.transport-play[data-status='ended']:not(:disabled) {
  color: #ffd166;
}

.transport-play[data-status='error'] {
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
  grid-template-columns: var(--ruler-gutter-width) 1fr;
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

.new-track-drop {
  position: relative;
  margin: 6px 8px 10px;
  border: 1px dashed rgba(91, 124, 250, 0.45);
  border-radius: 6px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(91, 124, 250, 0.7);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  background: rgba(91, 124, 250, 0.04);
  pointer-events: auto;
  transition: background 100ms ease, border-color 100ms ease, color 100ms ease;
}

.new-track-drop[data-active='true'] {
  background: rgba(91, 124, 250, 0.18);
  border-color: rgba(91, 124, 250, 0.95);
  color: #e5e5e5;
}

.new-track-drop[data-payload-kind='behavior'] {
  display: none;
}

.new-track-label {
  pointer-events: none;
}

.audio-section {
  flex: 0 0 auto;
  border-top: 2px solid rgba(6, 214, 160, 0.25);
  background: rgba(6, 214, 160, 0.02);
}

.audio-section-header {
  display: grid;
  grid-template-columns: var(--ruler-gutter-width) 1fr;
  align-items: center;
  padding: 4px 8px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #6bd0b0;
  background: rgba(6, 214, 160, 0.06);
  border-bottom: 1px solid rgba(6, 214, 160, 0.15);
}

.audio-section-count {
  font-feature-settings: 'tnum';
  color: #6bd0b0;
  opacity: 0.7;
}

.audio-lane {
  position: relative;
  max-height: 160px;
  overflow-y: auto;
}

.audio-lane[data-drop-active='true'] {
  background: rgba(6, 214, 160, 0.1);
  outline: 2px dashed rgba(6, 214, 160, 0.55);
  outline-offset: -2px;
}

.audio-empty {
  padding: 12px;
  color: #707070;
  font-size: 11.5px;
}

.audio-empty strong {
  color: #9fdec8;
  font-weight: 500;
}

.context-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 300;
}

.context-menu {
  position: fixed;
  min-width: 140px;
  background: #131313;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.context-menu button {
  appearance: none;
  background: transparent;
  border: none;
  color: #d4d4d4;
  font: inherit;
  font-size: 12px;
  text-align: left;
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
}

.context-menu button:hover {
  background: rgba(255, 255, 255, 0.08);
}

.context-menu button.danger {
  color: #ff8b8b;
}

.context-menu button.danger:hover {
  background: rgba(255, 107, 107, 0.14);
}
</style>
