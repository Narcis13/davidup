// `useSelection` — tracks the editor's current item selection.
//
// Step 09 introduces the Inspector, which renders typed inputs for the
// currently selected item. Step 16 (stage hit-testing) adds a click handler
// to the canvas that pipes pickItemAt's result through `setSelection`, and
// — when the browser driver was attached with `emitSourceMap: true` — also
// stores the source-map entry of the picked item in `lastPickSource` so
// future "reveal in source" UI (step 17) can read it without re-hitting
// the picker.
//
// The selection is shared via an app-level injection key so panels
// (Timeline tracks, Library cards, Stage hit-test) can read and write the
// same id without prop drilling.

import { computed, inject, provide, ref, type InjectionKey, type Ref } from 'vue'

export interface PickSourceInfo {
  file: string
  jsonPointer: string
  originKind: 'literal' | 'ref' | 'template' | 'behavior' | 'scene' | 'background'
}

export interface SelectionApi {
  /** Currently selected item id, or null. */
  selectedItemId: Ref<string | null>
  /**
   * Currently selected *tween* id, or null. Set when the user clicks a
   * Timeline bar (step 20.24); cleared by any item-only selection change
   * (dropdown, row click, stage pick) so a stale tween id never lingers
   * behind a new item edit context.
   */
  selectedTweenId: Ref<string | null>
  /** Set the selection. Passing null clears it. */
  setSelection: (id: string | null) => void
  /**
   * Set the selection AND record where the picked item was authored. Used by
   * the Stage's hit-test handler. Passing `null` clears both.
   */
  setSelectionFromPick: (id: string | null, source?: PickSourceInfo | null) => void
  /**
   * Step 20.24: select a Timeline bar. Sets `selectedTweenId` to the bar's
   * tween id and `selectedItemId` to the bar's target. The Inspector reads
   * `selectedTweenId` and renders the tween editor in place of the item
   * editor while it's non-null.
   */
  setTweenSelection: (tweenId: string | null, itemId?: string | null) => void
  /** Convenience boolean — true while an item is selected. */
  hasSelection: Ref<boolean>
  /**
   * Source-map info for the most recent pick, or null. Stays untouched when
   * selection is set through the inspector dropdown (which has no source-map
   * info) so step-17 "reveal in source" can still resolve from `composition`
   * via the selected id.
   */
  lastPickSource: Ref<PickSourceInfo | null>
}

const SELECTION_KEY: InjectionKey<SelectionApi> = Symbol('davidup.selection')

export function provideSelection(initialId: string | null = null): SelectionApi {
  const selectedItemId = ref<string | null>(initialId)
  const selectedTweenId = ref<string | null>(null)
  const lastPickSource = ref<PickSourceInfo | null>(null)
  // Tracks the id `lastPickSource` was captured for, so a later
  // `setSelection(otherId)` (Inspector dropdown, Timeline click) can detect
  // that the pick info is now stale and clear it. Reaffirming the SAME id
  // keeps the source — that's the case the comment block above describes.
  let pickedForId: string | null = null
  const api: SelectionApi = {
    selectedItemId,
    selectedTweenId,
    setSelection(id: string | null) {
      selectedItemId.value = id
      selectedTweenId.value = null
      if (id === null) {
        lastPickSource.value = null
        pickedForId = null
        return
      }
      if (id !== pickedForId) {
        lastPickSource.value = null
        pickedForId = null
      }
    },
    setSelectionFromPick(id: string | null, source?: PickSourceInfo | null) {
      selectedItemId.value = id
      selectedTweenId.value = null
      lastPickSource.value = id === null ? null : source ?? null
      pickedForId = id
    },
    setTweenSelection(tweenId: string | null, itemId?: string | null) {
      selectedTweenId.value = tweenId
      if (itemId !== undefined) {
        selectedItemId.value = itemId
        // Tween-driven selection doesn't carry source-map info; drop any
        // stale pick capture so the provenance line doesn't lie about
        // where the bar was picked from.
        if (itemId !== pickedForId) {
          lastPickSource.value = null
          pickedForId = null
        }
      }
    },
    hasSelection: computed(() => selectedItemId.value !== null) as Ref<boolean>,
    lastPickSource,
  }
  provide(SELECTION_KEY, api)
  return api
}

export function useSelection(): SelectionApi {
  const api = inject(SELECTION_KEY, null)
  if (!api) {
    throw new Error(
      'useSelection(): no SelectionApi provided. Call provideSelection() in the editor page.',
    )
  }
  return api
}
