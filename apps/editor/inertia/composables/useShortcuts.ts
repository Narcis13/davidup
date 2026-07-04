// `useShortcuts` — central keyboard registry (step 20.20, closes FR-16).
//
// Step 20.19 introduced this composable with a single shortcut (Space →
// play/pause). 20.20 expands it into the registry the PRD calls for:
//
//   Space      → play/pause
//   Backspace  → delete current selection
//   ⌘0  / Ctrl+0 → fit timeline (seek to t=0; the timeline already
//                  auto-fits the panel width, so "fit" collapses to the
//                  canonical reset action — playhead to start)
//   ⌘J  / Ctrl+J → toggle the source drawer (previously lived in
//                  editor.vue; moved here so the editor has exactly
//                  one keydown listener)
//   ⌘R  / Ctrl+R → kick off a render (we intercept the browser's
//                  page-reload default — preventDefault must run on
//                  keydown for that to stick)
//   ⌘S  / Ctrl+S → force flush (every command already round-trips
//                  through the server; this is the explicit "save now"
//                  affordance — handler decides what observable
//                  acknowledgement to show)
//   ?         → toggle the help overlay (step 20.21). `?` is normally
//                  produced as Shift+/ on US layouts, so we accept both
//                  the resolved character (`event.key === '?'`) and the
//                  Shift+/ chord without other modifiers. Pressing `?`
//                  *while the overlay is open* still routes through the
//                  same handler — the overlay toggles itself shut.
//
// The S-split shortcut is deliberately omitted: PRD marks it as P2 and
// the polish plan defers it to v1.1 ("split — defer to v1.1 if too big").
//
// SSR-safe: registration happens inside `onMounted`, the listener is
// torn down on unmount, and every handler is a no-op when the caller
// didn't supply one — so consumers can wire whichever subset they need.

import { onBeforeUnmount, onMounted } from 'vue'

export interface UseShortcutsOptions {
  /** Space — toggle stage play/pause. */
  togglePlay?: () => void | Promise<void>
  /** Backspace — delete the active selection (item, tween, etc). */
  deleteSelection?: () => void | Promise<void>
  /** ⌘0 / Ctrl+0 — reset the timeline view (seek to start). */
  fitTimeline?: () => void | Promise<void>
  /** ⌘J / Ctrl+J — toggle the reveal-in-source drawer. */
  toggleSourceDrawer?: () => void | Promise<void>
  /** ⌘R / Ctrl+R — start a render. Intercepts page reload. */
  render?: () => void | Promise<void>
  /** ⌘S / Ctrl+S — explicit save / force flush. Intercepts "Save Page As…". */
  forceFlush?: () => void | Promise<void>
  /** `?` — toggle the help overlay (shortcuts, drag-and-drop, MCP cheat-sheet). */
  toggleHelp?: () => void | Promise<void>
  /** ⌘Z / Ctrl+Z — undo the most recent forward edit. */
  undo?: () => void | Promise<void>
  /** ⌘⇧Z / Ctrl+Shift+Z — redo the most recently undone edit. */
  redo?: () => void | Promise<void>
  /** ⌘G / Ctrl+G — group the current multi-selection. */
  group?: () => void | Promise<void>
  /** ⌘⇧G / Ctrl+Shift+G — ungroup the selected group. */
  ungroup?: () => void | Promise<void>
  /** U8 — `V` (no modifier) opens the "Add Video…" asset picker. */
  addVideo?: () => void | Promise<void>
  /** U8 — `A` (no modifier) opens the "Add Audio Track…" asset picker. */
  addAudioTrack?: () => void | Promise<void>
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '')
}

/** True when the platform "command" modifier is held (⌘ on macOS, Ctrl elsewhere). */
function hasPlatformMod(event: KeyboardEvent): boolean {
  return isMac() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

function invoke(fn: (() => void | Promise<void>) | undefined): void {
  if (!fn) return
  try {
    const result = fn()
    if (result && typeof (result as Promise<void>).catch === 'function') {
      ;(result as Promise<void>).catch(() => {
        /* swallow — a failed handler must not break key handling */
      })
    }
  } catch {
    /* same — never let one shortcut take down the rest of the page */
  }
}

export function useShortcuts(options: UseShortcutsOptions): void {
  function onKeydown(event: KeyboardEvent): void {
    // Bail early for anyone typing into a field — none of these shortcuts
    // should pre-empt text entry (Space is a literal space, Backspace deletes
    // a character, ⌘S inside a textarea is rare but not ours to steal).
    if (isEditableTarget(event.target)) return

    // ── Space ── modifier-free toggle. Accept the legacy `Spacebar` alias
    // for the IE/Edge era just in case.
    if (event.key === ' ' || event.key === 'Spacebar') {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (!options.togglePlay) return
      event.preventDefault()
      invoke(options.togglePlay)
      return
    }

    // ── Backspace ── modifier-free delete. Plain Delete is left alone so
    // platform-native behaviours (e.g. macOS "forward delete") aren't claimed.
    if (event.key === 'Backspace') {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (!options.deleteSelection) return
      event.preventDefault()
      invoke(options.deleteSelection)
      return
    }

    // ── `?` ── help overlay (step 20.21). On US layouts `?` is Shift+/,
    // so we accept both the resolved character and the Shift+/ chord —
    // platforms / IMEs that produce `?` without Shift (e.g. some non-US
    // layouts) still register. We refuse Ctrl/Alt/Meta variants so the
    // chord stays single-purpose.
    if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (!options.toggleHelp) return
      event.preventDefault()
      invoke(options.toggleHelp)
      return
    }

    // ── U8: `V` / `A` (no modifier) ── open the "Add Video…" / "Add Audio
    // Track…" pickers. Neither letter is claimed elsewhere in this registry
    // (all other letter chords require the platform modifier below), so
    // these are free to bind bare like Space/Backspace/`?` above.
    if (event.key === 'v' || event.key === 'V') {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (!options.addVideo) return
      event.preventDefault()
      invoke(options.addVideo)
      return
    }
    if (event.key === 'a' || event.key === 'A') {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (!options.addAudioTrack) return
      event.preventDefault()
      invoke(options.addAudioTrack)
      return
    }

    // ── Platform-mod chords ── ⌘ on macOS, Ctrl elsewhere. Alt always
    // disqualifies (those map to OS-level shortcuts). Shift is accepted only
    // for the explicit redo chord below; every other chord refuses it so the
    // user can still hit ⌘⇧R (hard refresh) etc.
    if (!hasPlatformMod(event)) return
    if (event.altKey) return

    // ⌘Z / Ctrl+Z (no Shift) → undo. ⌘⇧Z / Ctrl+Shift+Z → redo. We branch
    // on `event.key` (capital `Z` when Shift is held, lowercase `z`
    // otherwise) and on `event.shiftKey` so both layouts route correctly.
    if (event.key === 'z' || event.key === 'Z') {
      if (event.shiftKey) {
        if (!options.redo) return
        event.preventDefault()
        invoke(options.redo)
      } else {
        if (!options.undo) return
        event.preventDefault()
        invoke(options.undo)
      }
      return
    }

    // ⌘G / Ctrl+G → group; ⌘⇧G / Ctrl+Shift+G → ungroup. Same letter, the
    // Shift modifier flips the verb (matches Figma / Illustrator / Sketch).
    // We must claim this chord *before* the generic "reject Shift" gate
    // below so the ungroup variant isn't silently dropped.
    if (event.key === 'g' || event.key === 'G') {
      if (event.shiftKey) {
        if (!options.ungroup) return
        event.preventDefault()
        invoke(options.ungroup)
      } else {
        if (!options.group) return
        event.preventDefault()
        invoke(options.group)
      }
      return
    }

    // The remaining chords reject Shift (see hard-refresh note above).
    if (event.shiftKey) return

    // `event.key` for letters is the *lowercase* form when no Shift is held,
    // matching the UI Events spec. The digit row reports the digit itself.
    switch (event.key) {
      case '0':
        if (!options.fitTimeline) return
        event.preventDefault()
        invoke(options.fitTimeline)
        return
      case 'j':
      case 'J':
        if (!options.toggleSourceDrawer) return
        event.preventDefault()
        invoke(options.toggleSourceDrawer)
        return
      case 'r':
      case 'R':
        if (!options.render) return
        event.preventDefault()
        invoke(options.render)
        return
      case 's':
      case 'S':
        if (!options.forceFlush) return
        event.preventDefault()
        invoke(options.forceFlush)
        return
      default:
        return
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
