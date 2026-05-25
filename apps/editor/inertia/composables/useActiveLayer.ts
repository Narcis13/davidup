// useActiveLayer — UX_GAPS section B: layer selection shared across panels.
//
// LayersPanel writes the active layer id; ItemToolbar (and Stage's
// place-mode click handler) read it to decide which layer a newly-placed
// primitive lands in. Falls back to the topmost layer when no active layer
// is set or the active id no longer exists in the composition — matches the
// pre-existing `layerForDropId` behaviour so projects opened before the
// panel landed keep working.
//
// Module-singleton (same pattern as useItemToolbar) so the toolbar, Stage,
// and panel all see the same id without prop drilling. `resolveTargetLayer`
// is exposed as a helper that takes the current composition and returns the
// layer id a placement should target.

import { computed, reactive, type ComputedRef } from 'vue'

interface State {
  /** Layer id explicitly selected by the user, or null for "auto (topmost)". */
  activeLayerId: string | null
}

const state = reactive<State>({ activeLayerId: null })

type CompositionLike = {
  layers: ReadonlyArray<{ id?: unknown }>
}

function topmostLayerId(composition: CompositionLike | null | undefined): string | null {
  const layers = composition?.layers
  if (!Array.isArray(layers)) return null
  // Layers are stored low-z → high-z; the last one wins (rendered on top),
  // matching Stage.vue's drop-zone heuristic.
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const l = layers[i] as { id?: unknown } | undefined
    if (l && typeof l.id === 'string') return l.id
  }
  return null
}

export function resolveTargetLayer(
  composition: CompositionLike | null | undefined,
): string | null {
  const active = state.activeLayerId
  if (active) {
    const exists = composition?.layers?.some(
      (l) => typeof (l as { id?: unknown }).id === 'string' && (l as { id: string }).id === active,
    )
    if (exists) return active
  }
  return topmostLayerId(composition)
}

export function useActiveLayer() {
  return {
    activeLayerId: computed(() => state.activeLayerId) as ComputedRef<string | null>,
    setActiveLayer(id: string | null): void {
      state.activeLayerId = id
    },
    /**
     * Read the target layer id (active or topmost fallback). Use this from
     * place-mode handlers instead of recomputing the topmost-layer rule.
     */
    resolveTarget(composition: CompositionLike | null | undefined): string | null {
      return resolveTargetLayer(composition)
    },
  }
}

// Test-only escape hatch so the singleton can be reset between cases.
export function __resetActiveLayerForTests(): void {
  state.activeLayerId = null
}
