// `useNudge` — arrow-key nudge for the stage selection (v1.1 S26).
//
// ←↑→↓ move every selected, unlocked item with a numeric transform by 1 px
// (⇧ = 10 px) through plain `update_item` commands — the same mutation path
// the stage drag and the Inspector use.
//
// Two problems a naive "read position, add delta, apply" loop has:
//
//   1. Held-key repeat fires faster than /api/command round-trips, so every
//      press would read the same stale composition and the item would move
//      one step instead of N. We keep a per-item *target* that presses add
//      to, and allow ONE flush in flight at a time: presses that land while
//      a flush is running just grow the target, and the next flush sends the
//      latest value (latest-wins, never out of order).
//   2. Each command would be its own undo step. Every nudge command carries
//      the same `coalesceKey` for the current selection, and the server's
//      CommandBus folds a burst of those into one undo entry.

import type { Command, Composition } from './useCommandBus.js'

export interface UseNudgeOptions {
  getComposition: () => Composition | null
  getSelectedIds: () => ReadonlyArray<string>
  apply: (command: Command) => Promise<void>
}

export interface UseNudgeReturn {
  /**
   * Nudge the selection by (dx, dy) composition pixels. Returns true when at
   * least one item will move — the shortcut layer only claims the key
   * (preventDefault) in that case, so arrows still scroll panels otherwise.
   */
  nudge: (dx: number, dy: number) => boolean
  /** Resolves once every queued nudge has been sent. Test seam. */
  settled: () => Promise<void>
}

/** Arrow key → unit direction, or null for any other key. */
export function arrowDelta(key: string): { dx: number; dy: number } | null {
  switch (key) {
    case 'ArrowLeft':
      return { dx: -1, dy: 0 }
    case 'ArrowRight':
      return { dx: 1, dy: 0 }
    case 'ArrowUp':
      return { dx: 0, dy: -1 }
    case 'ArrowDown':
      return { dx: 0, dy: 1 }
    default:
      return null
  }
}

/** 1 px per press, 10 px with Shift. */
export function nudgeStep(shiftKey: boolean): number {
  return shiftKey ? 10 : 1
}

function nudgePosition(comp: Composition | null, id: string): { x: number; y: number } | null {
  const item = comp?.items?.[id] as
    | { locked?: unknown; transform?: { x?: unknown; y?: unknown } }
    | undefined
  if (!item || item.locked === true) return null
  const x = item.transform?.x
  const y = item.transform?.y
  if (typeof x !== 'number' || typeof y !== 'number') return null
  return { x, y }
}

/** Undo coalescing key for a selection — order-independent. */
export function nudgeCoalesceKey(ids: ReadonlyArray<string>): string {
  return `nudge:${[...ids].sort().join(',')}`
}

export function useNudge(options: UseNudgeOptions): UseNudgeReturn {
  // Per-item target position not yet confirmed by a flush. Presses add to
  // the target; the composition is only consulted for ids with no target.
  const targets = new Map<string, { x: number; y: number }>()
  let coalesceKey = ''
  let flushing: Promise<void> | null = null

  async function flushLoop(): Promise<void> {
    while (targets.size > 0) {
      const batch = [...targets.entries()]
      const key = coalesceKey
      for (const [id, pos] of batch) {
        try {
          await options.apply({
            kind: 'update_item',
            payload: { id, props: { x: pos.x, y: pos.y } },
            source: 'ui',
            coalesceKey: key,
          })
        } catch {
          /* bus.apply surfaces failures as toasts; keep draining */
        }
        // Drop the target only if no press grew it while we were awaiting —
        // otherwise the next loop iteration sends the newer value.
        const latest = targets.get(id)
        if (latest && latest.x === pos.x && latest.y === pos.y) targets.delete(id)
      }
    }
  }

  function nudge(dx: number, dy: number): boolean {
    const ids = options.getSelectedIds()
    if (ids.length === 0) return false
    const comp = options.getComposition()
    let moved = false
    for (const id of ids) {
      const base = targets.get(id) ?? nudgePosition(comp, id)
      if (!base) continue
      targets.set(id, { x: base.x + dx, y: base.y + dy })
      moved = true
    }
    if (!moved) return false
    coalesceKey = nudgeCoalesceKey(ids)
    if (!flushing) {
      flushing = flushLoop().finally(() => {
        flushing = null
      })
    }
    return true
  }

  return {
    nudge,
    settled: () => flushing ?? Promise.resolve(),
  }
}
