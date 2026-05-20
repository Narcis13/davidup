// useItemToolbar — UX_GAPS section A: item creation toolbar place-mode state.
//
// The toolbar component sets an `activeTool` which the Stage reads inside its
// click handler. Module-singleton so any consumer (Stage, the toolbar itself,
// the Escape shortcut) sees the same value without prop drilling.
//
// Lifecycle:
//   1. user clicks a toolbar button → setTool({ kind: 'rect' })
//   2. (for text/sprite the toolbar collects additional input first)
//   3. user clicks the Stage → Stage reads activeTool, dispatches the
//      matching add_* command, calls clearTool()
//   4. Escape from anywhere also calls clearTool()

import { computed, reactive, readonly, type ComputedRef } from 'vue'

export type PlaceTool =
  | { kind: 'shape-rect' }
  | { kind: 'shape-circle' }
  | { kind: 'text'; text: string }
  | { kind: 'sprite'; asset: string }

interface State {
  tool: PlaceTool | null
}

const state = reactive<State>({ tool: null })

export function useItemToolbar() {
  return {
    state: readonly(state) as Readonly<State>,
    activeTool: computed(() => state.tool) as ComputedRef<PlaceTool | null>,
    isActive: computed(() => state.tool !== null) as ComputedRef<boolean>,
    setTool(tool: PlaceTool): void {
      state.tool = tool
    },
    clearTool(): void {
      state.tool = null
    },
  }
}

// Test-only escape hatch so the test suite can drive the singleton between
// cases. Production code goes through `setTool` / `clearTool`.
export function __resetItemToolbarForTests(): void {
  state.tool = null
}
