// `useGroupActions` — Group / Ungroup commands (UX_GAPS §L).
//
// Group: takes the current multi-selection, dispatches `add_group` with the
// selected item ids as children. The engine's `addGroup` detaches the
// children from their layer.items so they render exactly once — under the
// new group's transform — instead of double-painting.
//
// Ungroup: UI-side flatten for a single selected group. For every child:
//   1. compose the group's transform into the child's local transform
//      (so the child keeps its on-screen position), via `update_item`
//   2. promote the child back onto the group's layer, via `move_item_to_layer`
// Then remove the now-empty group via `remove_item`.
//
// Why UI-side rather than a new `ungroup` engine verb (per UX_GAPS notes):
// the alternative listed in the doc — "N update_item + 1 remove_item" plus
// `move_item_to_layer` to re-parent the children — uses only existing
// commands, so the MCP surface stays unchanged. Transform composition is
// approximate when the group has *non-uniform* scale combined with a
// rotation (TRS can't capture the resulting shear); we surface a toast in
// that case rather than silently corrupting positions.

import { computed, type ComputedRef } from 'vue'
import type { Composition, Command } from './useCommandBus'
import type { SelectionApi } from './useSelection'
import { useToasts } from './useToasts'

type ApplyFn = (command: Command) => Promise<void> | void

interface Transform {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
  anchorX: number
  anchorY: number
  opacity: number
}

interface ItemLike {
  type?: string
  transform?: Partial<Transform>
  items?: ReadonlyArray<string>
}

const DEFAULT_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  anchorX: 0,
  anchorY: 0,
  opacity: 1,
}

function readItem(composition: Composition | null, id: string): ItemLike | null {
  const items = (composition as { items?: Record<string, ItemLike> } | null)?.items
  if (!items || typeof items !== 'object') return null
  const it = items[id]
  return it && typeof it === 'object' ? it : null
}

function readTransform(item: ItemLike | null): Transform {
  const t = (item?.transform ?? {}) as Partial<Transform>
  const num = (v: unknown, d: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : d
  return {
    x: num(t.x, DEFAULT_TRANSFORM.x),
    y: num(t.y, DEFAULT_TRANSFORM.y),
    scaleX: num(t.scaleX, DEFAULT_TRANSFORM.scaleX),
    scaleY: num(t.scaleY, DEFAULT_TRANSFORM.scaleY),
    rotation: num(t.rotation, DEFAULT_TRANSFORM.rotation),
    anchorX: num(t.anchorX, DEFAULT_TRANSFORM.anchorX),
    anchorY: num(t.anchorY, DEFAULT_TRANSFORM.anchorY),
    opacity: num(t.opacity, DEFAULT_TRANSFORM.opacity),
  }
}

/**
 * Find the id of the layer that directly contains `itemId` at the layer.items
 * level. Returns null if the item is a group child (not a layer-root item).
 */
function findItemLayer(composition: Composition | null, itemId: string): string | null {
  const layers = (composition as { layers?: ReadonlyArray<{ id?: unknown; items?: ReadonlyArray<unknown> }> } | null)?.layers
  if (!Array.isArray(layers)) return null
  for (const layer of layers) {
    const lid = typeof layer?.id === 'string' ? layer.id : null
    const items = Array.isArray(layer?.items) ? layer.items : []
    if (!lid) continue
    if (items.includes(itemId)) return lid
  }
  return null
}

interface GroupActionsOptions {
  /** Reactive composition source. */
  getComposition: () => Composition | null
  /** Selection store — read selectedItemIds / selectedItemId, write setSelection. */
  selection: SelectionApi
  /** Command dispatcher (typically `bus.apply`). */
  apply: ApplyFn
}

export interface GroupActionsApi {
  /** True when the current selection (≥2 items on the same layer) is groupable. */
  canGroup: ComputedRef<boolean>
  /** True when a single group item is selected and can be flattened. */
  canUngroup: ComputedRef<boolean>
  /** Wrap the current selection in a new group via `add_group`. */
  group: () => Promise<void>
  /** Flatten the selected group via N update_item + N move_item_to_layer + remove_item. */
  ungroup: () => Promise<void>
}

export function useGroupActions(options: GroupActionsOptions): GroupActionsApi {
  const toasts = useToasts()

  const canGroup = computed<boolean>(() => {
    const comp = options.getComposition()
    if (!comp) return false
    const ids = options.selection.selectedItemIds.value
    if (ids.length < 2) return false
    let firstLayer: string | null = null
    for (const id of ids) {
      const lid = findItemLayer(comp, id)
      if (lid === null) return false
      if (firstLayer === null) firstLayer = lid
      else if (firstLayer !== lid) return false
    }
    return firstLayer !== null
  })

  const canUngroup = computed<boolean>(() => {
    const comp = options.getComposition()
    if (!comp) return false
    const ids = options.selection.selectedItemIds.value
    if (ids.length !== 1) return false
    const id = ids[0]!
    const item = readItem(comp, id)
    if (!item || item.type !== 'group') return false
    // The group must currently be sitting on a layer (otherwise we can't pick
    // a target layer to demote children into).
    return findItemLayer(comp, id) !== null
  })

  async function group(): Promise<void> {
    const comp = options.getComposition()
    if (!comp) return
    const ids = options.selection.selectedItemIds.value.slice()
    if (ids.length < 2) {
      toasts.info('Select 2 or more items to group.', { dedupeKey: 'group:too-few' })
      return
    }
    let layerId: string | null = null
    for (const id of ids) {
      const lid = findItemLayer(comp, id)
      if (lid === null) {
        toasts.error('Cannot group — selection includes an item that is not directly on a layer.', {
          dedupeKey: 'group:nested',
        })
        return
      }
      if (layerId === null) layerId = lid
      else if (layerId !== lid) {
        toasts.error('Cannot group items across different layers.', {
          dedupeKey: 'group:cross-layer',
        })
        return
      }
    }
    if (!layerId) return
    // Group transform stays at the origin so children keep their world
    // positions unchanged (the group's identity transform composes trivially
    // with each child's existing local transform). Users can later move the
    // group via the Inspector / Stage drag.
    await options.apply({
      kind: 'add_group',
      payload: {
        layerId,
        x: 0,
        y: 0,
        childItemIds: ids,
      },
      source: 'ui',
    })
    // After the command resolves, the bus has hydrated the new composition
    // and `affectedItemIds` recorded the new group's id, but we don't know
    // it client-side (the bus doesn't expose `toolResult` directly). The
    // most useful follow-up is clearing the multi-selection — the user can
    // click the freshly-rendered group ring to keep working on it.
    options.selection.setMultiSelection([])
  }

  async function ungroup(): Promise<void> {
    const comp = options.getComposition()
    if (!comp) return
    const ids = options.selection.selectedItemIds.value
    if (ids.length !== 1) {
      toasts.info('Select a single group to ungroup.', { dedupeKey: 'ungroup:single' })
      return
    }
    const groupId = ids[0]!
    const groupItem = readItem(comp, groupId)
    if (!groupItem || groupItem.type !== 'group') {
      toasts.info('Selected item is not a group.', { dedupeKey: 'ungroup:not-group' })
      return
    }
    const targetLayerId = findItemLayer(comp, groupId)
    if (!targetLayerId) {
      toasts.error('Cannot ungroup — the group is not on a layer.', {
        dedupeKey: 'ungroup:no-layer',
      })
      return
    }
    const children: ReadonlyArray<string> = Array.isArray(groupItem.items) ? groupItem.items : []
    const parentT = readTransform(groupItem)
    const uniformScale = Math.abs(parentT.scaleX - parentT.scaleY) < 1e-9
    const hasRotation = Math.abs(parentT.rotation) > 1e-9
    if (!uniformScale && hasRotation) {
      // Non-uniform scale combined with rotation introduces shear that can't
      // be represented by a TRS-only child transform. Refuse rather than
      // silently mangling positions.
      toasts.error(
        'Cannot ungroup a group with non-uniform scale and rotation — the child transforms would be approximate.',
        { dedupeKey: 'ungroup:shear' },
      )
      return
    }
    // Clear the selection up front: once we start dispatching, the group's
    // id is about to disappear from `composition.items`. Leaving it selected
    // would render the Inspector against a stale id.
    options.selection.setMultiSelection([])
    for (const childId of children) {
      const childItem = readItem(comp, childId)
      if (!childItem) continue
      const childT = readTransform(childItem)
      const composed = composeTransforms(parentT, childT)
      const props = transformDiff(childT, composed)
      if (Object.keys(props).length > 0) {
        await options.apply({
          kind: 'update_item',
          payload: { id: childId, props },
          source: 'ui',
        })
      }
      await options.apply({
        kind: 'move_item_to_layer',
        payload: { itemId: childId, targetLayerId },
        source: 'ui',
      })
    }
    await options.apply({
      kind: 'remove_item',
      payload: { id: groupId },
      source: 'ui',
    })
  }

  return { canGroup, canUngroup, group, ungroup }
}

// ──────────────── Transform math ────────────────
//
// Compose `parent ∘ child` as a single TRS transform. Anchors don't apply
// to group items (the engine's `anchorWidth/Height` returns 0 for groups),
// so we only need translation, rotation, and scale.
//
// For uniform parent scale OR zero parent rotation, the composition is
// closed under TRS:
//   newT  = parent.T  +  R(parent.rot) * S(parent.scale) * child.T
//   newR  = parent.rot + child.rot
//   newS  = parent.scale * child.scale
//
// The non-uniform-scale + rotation case introduces shear and is caught by
// `ungroup()` above before we ever reach this function.
function composeTransforms(parent: Transform, child: Transform): Transform {
  const cos = Math.cos(parent.rotation)
  const sin = Math.sin(parent.rotation)
  const sx = parent.scaleX
  const sy = parent.scaleY
  // Translate the child's origin into the parent's frame.
  const px = child.x * sx
  const py = child.y * sy
  const tx = parent.x + cos * px - sin * py
  const ty = parent.y + sin * px + cos * py
  return {
    x: tx,
    y: ty,
    scaleX: parent.scaleX * child.scaleX,
    scaleY: parent.scaleY * child.scaleY,
    rotation: parent.rotation + child.rotation,
    // Anchors are a child-local concept; preserve them.
    anchorX: child.anchorX,
    anchorY: child.anchorY,
    opacity: clamp01(parent.opacity * child.opacity),
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 1
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}

/**
 * Diff two transforms; emit only the fields that actually changed. Keeps
 * the `update_item` payload tight (the Inspector + source-map readers
 * appreciate not rewriting fields that didn't move).
 */
function transformDiff(before: Transform, after: Transform): Record<string, number> {
  const out: Record<string, number> = {}
  const EPS = 1e-9
  const cmp = (k: keyof Transform): void => {
    if (Math.abs((after[k] as number) - (before[k] as number)) > EPS) {
      out[k as string] = after[k] as number
    }
  }
  cmp('x')
  cmp('y')
  cmp('rotation')
  cmp('scaleX')
  cmp('scaleY')
  cmp('opacity')
  return out
}
