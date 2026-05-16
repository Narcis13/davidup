// `useSelection` — tracks the editor's current item selection.
//
// Step 09 introduces the Inspector, which renders typed inputs for the
// currently selected item. Stage hit-testing (step 16) and source maps
// (step 15) will replace the placeholder selection UI later; until then
// the Inspector exposes a dropdown listing every item id and feeds it
// through this composable.
//
// The selection is shared via an app-level injection key so future panels
// (Timeline tracks, Library cards, Stage hit-test) can read and write the
// same id without prop drilling.

import { computed, inject, provide, ref, type InjectionKey, type Ref } from 'vue'

export interface SelectionApi {
  /** Currently selected item id, or null. */
  selectedItemId: Ref<string | null>
  /** Set the selection. Passing null clears it. */
  setSelection: (id: string | null) => void
  /** Convenience boolean — true while an item is selected. */
  hasSelection: Ref<boolean>
}

const SELECTION_KEY: InjectionKey<SelectionApi> = Symbol('davidup.selection')

export function provideSelection(initialId: string | null = null): SelectionApi {
  const selectedItemId = ref<string | null>(initialId)
  const api: SelectionApi = {
    selectedItemId,
    setSelection(id: string | null) {
      selectedItemId.value = id
    },
    hasSelection: computed(() => selectedItemId.value !== null) as Ref<boolean>,
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
