// `useShortcuts` — step 20.19 of the editor build plan.
//
// Single-purpose for now: bind Space to play/pause. Future shortcuts
// (Backspace = delete selection, ⌘0 = fit timeline, ?, …) will route
// through the same registry per step 20.20 — keeping all keyboard
// surface in one composable means we only ever attach one window-level
// keydown listener and the editor-on-vs-input-focused logic lives in
// exactly one place.
//
// SSR-safe: registration happens inside `onMounted` and the listener is
// torn down on unmount, so the composable is also safe to call from a
// component that may re-render or be unmounted/remounted (e.g. the
// editor page during HMR).

import { onBeforeUnmount, onMounted } from 'vue'

export interface UseShortcutsOptions {
  /**
   * Called when the user presses Space outside of an editable target.
   * Errors thrown by the handler are swallowed — a misbehaving shortcut
   * must not break the rest of the page's key handling.
   */
  togglePlay?: () => void | Promise<void>
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export function useShortcuts(options: UseShortcutsOptions): void {
  function onKeydown(event: KeyboardEvent): void {
    // Space — the only modifier-free key we claim. Letting it through to
    // text inputs is non-negotiable (it's a literal space); we also bail on
    // contenteditable nodes so the Inspector's JSON textareas stay typeable.
    // `event.key === ' '` is the canonical match per UI Events; we also
    // accept `Spacebar` for the (Edge/IE-era) legacy alias just in case.
    if (event.key !== ' ' && event.key !== 'Spacebar') return
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (isEditableTarget(event.target)) return
    if (!options.togglePlay) return
    event.preventDefault()
    try {
      const result = options.togglePlay()
      if (result && typeof (result as Promise<void>).catch === 'function') {
        ;(result as Promise<void>).catch(() => {
          /* swallow — a failed pause/resume must not break key handling */
        })
      }
    } catch {
      /* same */
    }
  }

  onMounted(() => {
    if (typeof window === 'undefined') return
    window.addEventListener('keydown', onKeydown)
  })

  onBeforeUnmount(() => {
    if (typeof window === 'undefined') return
    window.removeEventListener('keydown', onKeydown)
  })
}
