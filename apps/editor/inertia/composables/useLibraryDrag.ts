// useLibraryDrag — step 14 of the editor build plan.
//
// Owns the HTML5 drag state for "drag a library card → drop on timeline or
// stage". The library panel calls `onDragStart` from `LibraryCard.vue`, the
// Timeline + Stage components register as drop targets, and this module
// translates a successful drop into a Command (`apply_template`,
// `apply_behavior`, or `add_scene_instance`) that the editor page hands off
// to the command bus.
//
// Two coordination signals leave this composable:
//   - `payloadRef` — a reactive snapshot of the in-flight drag (kind, id,
//     name, params). Stage + Timeline use it to paint hit-zone overlays.
//   - the `dataTransfer` MIME `application/x-davidup-library` — the only
//     payload the browser actually preserves across iframes / inert event
//     paths. We always write JSON there as a fallback in case the singleton
//     state was wiped (e.g. a hot reload mid-drag).
//
// "Brand defaults pre-bound" (PRD step 14): when a library item declares
// `params`, we walk the descriptors and pre-fill any required param that
// doesn't have a `default`. For string-typed required params we use the
// item's display name (or its id) as a sensible placeholder so the dropped
// instance renders something the user can read immediately — they can edit
// the title in the Inspector. Optional params with a `default` are passed
// through unchanged; ones without a default are left undefined so the
// engine's own param resolution wins.

import { computed, reactive, readonly, type ComputedRef } from 'vue'
import type { Command } from '~/composables/useCommandBus'
import type { LibraryItem } from '~/composables/useLibrary'

export const LIBRARY_MIME = 'application/x-davidup-library'

export type DropZone = 'track' | 'stage' | 'new-track' | null

export interface LibraryDragPayload {
  kind: LibraryItem['kind']
  id: string
  name: string
  description?: string
  /** Default param bindings pre-resolved from the library descriptor. */
  defaults: Record<string, unknown>
  /** Library item duration in seconds (scenes only). */
  duration?: number
}

interface DragState {
  active: boolean
  payload: LibraryDragPayload | null
  hover: DropZone
  hoverTargetId: string | null
}

// Module-singleton state so `Library` / `Stage` / `Timeline` instances all
// share the same drag snapshot. Vue components import the same composable
// reference; the reactive object survives across `useLibraryDrag()` calls.
const state = reactive<DragState>({
  active: false,
  payload: null,
  hover: null,
  hoverTargetId: null,
})

export function useLibraryDrag() {
  return {
    state: readonly(state) as Readonly<DragState>,
    isActive: computed(() => state.active) as ComputedRef<boolean>,
    payload: computed(() => state.payload) as ComputedRef<LibraryDragPayload | null>,
    hover: computed(() => state.hover) as ComputedRef<DropZone>,
    hoverTargetId: computed(() => state.hoverTargetId) as ComputedRef<string | null>,
    onDragStart,
    onDragEnd,
    setHover,
    clearHover,
    readDropPayload,
    buildCommandsForTrackDrop,
    buildCommandsForStageDrop,
    buildCommandsForNewTrackDrop,
  }
}

// ──────────────── Drag lifecycle ────────────────

function onDragStart(item: LibraryItem, event: DragEvent): void {
  if (!event.dataTransfer) return
  const payload = libraryItemToPayload(item)
  state.active = true
  state.payload = payload
  state.hover = null
  state.hoverTargetId = null
  try {
    event.dataTransfer.setData(LIBRARY_MIME, JSON.stringify(payload))
    // text/plain fallback so dropping into a text input doesn't fall back to
    // pasting the entire JSON blob — but still drops something useful.
    event.dataTransfer.setData('text/plain', `${item.kind}:${item.id}`)
    event.dataTransfer.effectAllowed = 'copy'
  } catch {
    /* dataTransfer is read-only after dragenter on some browsers */
  }
}

function onDragEnd(): void {
  state.active = false
  state.payload = null
  state.hover = null
  state.hoverTargetId = null
}

function setHover(zone: DropZone, targetId: string | null = null): void {
  state.hover = zone
  state.hoverTargetId = targetId
}

function clearHover(zone?: DropZone, targetId?: string | null): void {
  if (zone !== undefined && state.hover !== zone) return
  if (targetId !== undefined && state.hoverTargetId !== targetId) return
  state.hover = null
  state.hoverTargetId = null
}

// ──────────────── Drop payload reader ────────────────

export function readDropPayload(event: DragEvent): LibraryDragPayload | null {
  // Prefer module state — it carries the canonical defaults map and is
  // already typed. Fall back to the dataTransfer JSON when something cleared
  // the singleton (HMR mid-drag, programmatic drop tests).
  if (state.payload) return state.payload
  const dt = event.dataTransfer
  if (!dt) return null
  const raw = dt.getData(LIBRARY_MIME)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<LibraryDragPayload>
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.kind !== 'string' || typeof parsed.id !== 'string') return null
    return {
      kind: parsed.kind as LibraryItem['kind'],
      id: parsed.id,
      name: typeof parsed.name === 'string' ? parsed.name : parsed.id,
      description: typeof parsed.description === 'string' ? parsed.description : undefined,
      defaults:
        parsed.defaults && typeof parsed.defaults === 'object'
          ? (parsed.defaults as Record<string, unknown>)
          : {},
      duration: typeof parsed.duration === 'number' ? parsed.duration : undefined,
    }
  } catch {
    return null
  }
}

// ──────────────── Payload synthesis ────────────────

function libraryItemToPayload(item: LibraryItem): LibraryDragPayload {
  const defaults = resolveDefaultParams(item)
  return {
    kind: item.kind,
    id: item.id,
    name: item.name ?? item.id,
    description: item.description,
    defaults,
    duration: typeof item.duration === 'number' ? item.duration : undefined,
  }
}

interface ParamDescriptor {
  name: string
  type?: string
  required?: boolean
  default?: unknown
}

function resolveDefaultParams(item: LibraryItem): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const params = Array.isArray(item.params) ? (item.params as unknown[]) : []
  for (const p of params) {
    const desc = p as ParamDescriptor
    if (!desc || typeof desc.name !== 'string' || desc.name.length === 0) continue
    if (Object.prototype.hasOwnProperty.call(desc, 'default') && desc.default !== undefined) {
      out[desc.name] = desc.default
      continue
    }
    if (desc.required) {
      out[desc.name] = brandPlaceholderFor(desc.type ?? 'string', item)
    }
  }
  return out
}

function brandPlaceholderFor(type: string, item: LibraryItem): unknown {
  switch (type) {
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'color':
      return '#ffffff'
    case 'string':
    default:
      return item.name ?? item.id
  }
}

// ──────────────── Command builders ────────────────
//
// A single drop can require more than one command (e.g. a template + a fade
// behavior to animate it in). For the v1.0 acceptance test ("drop titleCard
// on empty track → valid instance appears, renders") we only need the one
// instance command, but returning an array keeps the call sites uniform and
// leaves room to bind a `fadeIn` follow-up when brand presets land later.

export interface TrackDropContext {
  /** The id of the row the user dropped onto (the target item id). */
  targetItemId: string
  /** The first layer of the composition — used when we have to create a new
   *  item to host a template. */
  defaultLayerId: string
  /** Seconds at which the dropped instance should begin. Pass the playhead. */
  start: number
}

export interface StageDropContext {
  /** Layer to host the new item. Defaults to the topmost layer. */
  layerId: string
  /** Drop coordinates in composition pixels (top-left origin). */
  x: number
  y: number
  /** Seconds at which the dropped instance should begin. */
  start: number
}

export interface NewTrackDropContext {
  layerId: string
  start: number
}

export function buildCommandsForTrackDrop(
  payload: LibraryDragPayload,
  ctx: TrackDropContext,
): Command[] {
  switch (payload.kind) {
    case 'behavior': {
      // Apply the behavior to the existing track's target item.
      const cmd: Command = {
        kind: 'apply_behavior',
        payload: {
          target: ctx.targetItemId,
          behavior: payload.id,
          start: Math.max(0, ctx.start),
          duration: defaultBehaviorDuration(payload),
          ...(Object.keys(payload.defaults).length > 0
            ? { params: payload.defaults }
            : {}),
        },
        source: 'ui',
      }
      return [cmd]
    }
    case 'template': {
      const start = Math.max(0, ctx.start)
      const instanceId = makeInstanceId(payload.id, start)
      return [
        {
          kind: 'apply_template',
          payload: {
            templateId: payload.id,
            layerId: ctx.defaultLayerId,
            start,
            ...(Object.keys(payload.defaults).length > 0
              ? { params: payload.defaults }
              : {}),
            id: instanceId,
          },
          source: 'ui',
        },
      ]
    }
    case 'scene': {
      const start = Math.max(0, ctx.start)
      return [
        {
          kind: 'add_scene_instance',
          payload: {
            sceneId: payload.id,
            layerId: ctx.defaultLayerId,
            start,
            ...(Object.keys(payload.defaults).length > 0
              ? { params: payload.defaults }
              : {}),
            id: makeInstanceId(payload.id, start),
          },
          source: 'ui',
        },
      ]
    }
    default:
      return []
  }
}

export function buildCommandsForNewTrackDrop(
  payload: LibraryDragPayload,
  ctx: NewTrackDropContext,
): Command[] {
  // Identical semantics to a track drop for now (no existing target needed):
  // templates and scenes always spawn new tracks; behaviors require an
  // existing target so we silently no-op (the drop zone is hidden anyway).
  if (payload.kind === 'behavior') return []
  return buildCommandsForTrackDrop(payload, {
    targetItemId: '',
    defaultLayerId: ctx.layerId,
    start: ctx.start,
  })
}

export function buildCommandsForStageDrop(
  payload: LibraryDragPayload,
  ctx: StageDropContext,
): Command[] {
  switch (payload.kind) {
    case 'asset': {
      // Best-effort sprite placement: register the asset by its library id
      // (if it isn't already on the composition the engine will error and
      // surface it through the bus) and emit an add_sprite at the drop
      // coordinates. We can't compute width/height without IO, so default to
      // the asset's natural fallback (240x240, the engine clamps anyway).
      return [
        {
          kind: 'add_sprite',
          payload: {
            layerId: ctx.layerId,
            asset: payload.id,
            x: ctx.x,
            y: ctx.y,
            width: 240,
            height: 240,
          },
          source: 'ui',
        },
      ]
    }
    case 'template': {
      const start = Math.max(0, ctx.start)
      // Templates have their own internal x/y per item — drop on stage falls
      // back to applying the template (positioned by its own transforms) and
      // lets the user nudge it via the inspector. The PRD lists this as
      // best-effort for v1.0; supporting per-item positional overrides is a
      // v1.1 follow-up.
      return [
        {
          kind: 'apply_template',
          payload: {
            templateId: payload.id,
            layerId: ctx.layerId,
            start,
            ...(Object.keys(payload.defaults).length > 0
              ? { params: payload.defaults }
              : {}),
            id: makeInstanceId(payload.id, start),
          },
          source: 'ui',
        },
      ]
    }
    case 'scene': {
      const start = Math.max(0, ctx.start)
      return [
        {
          kind: 'add_scene_instance',
          payload: {
            sceneId: payload.id,
            layerId: ctx.layerId,
            start,
            transform: { x: ctx.x, y: ctx.y },
            ...(Object.keys(payload.defaults).length > 0
              ? { params: payload.defaults }
              : {}),
            id: makeInstanceId(payload.id, start),
          },
          source: 'ui',
        },
      ]
    }
    default:
      // behaviors/fonts have no stand-alone stage representation
      return []
  }
}

function defaultBehaviorDuration(payload: LibraryDragPayload): number {
  const raw = payload.defaults?.duration
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
  return 0.5
}

function makeInstanceId(id: string, start: number): string {
  // Engine expects valid item ids; commas/dots in the start would collide
  // with id syntax used elsewhere. Round to ms and concatenate.
  const millis = Math.round(start * 1000)
  const suffix = Date.now().toString(36).slice(-4)
  return `${sanitizeId(id)}_${millis}_${suffix}`
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

// Test-only escape hatch so the test suite can drive the singleton between
// cases. Production code should rely on `onDragStart` / `onDragEnd`.
export function __resetLibraryDragForTests(): void {
  state.active = false
  state.payload = null
  state.hover = null
  state.hoverTargetId = null
}
