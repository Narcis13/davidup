// `useCommandBus` — client-side dispatcher for POST /api/command.
//
// Step 09 wires the Inspector's typed inputs into the engine. Each edit
// becomes one `updateItem` command. The server validates, applies, and
// returns the next composition; this composable surfaces that as a
// reactive ref so `useStage` re-attaches with the updated state.
//
// The composition asset srcs come from the page payload already rewritten
// to `/project-files/...` URLs (EditorController#show). The mutation
// response from /api/command, however, returns canonical on-disk paths
// like `./ball.png`. We re-apply the same rewrite on the client so the
// stage keeps rendering after a command — otherwise the loader 404s on
// the relative path.

import { ref, shallowRef, triggerRef, type Ref, type ShallowRef } from 'vue'

// The server (`app/types/commands.ts`) is the single source of truth for
// the Command discriminated union. The client only needs the wire shape;
// the server's Zod schema validates the payload on every POST.
export interface Command {
  kind: string
  payload: Record<string, unknown>
  source?: 'ui' | 'mcp'
}

export type CommandSource = 'ui' | 'mcp'

type Composition = {
  composition: { width: number; height: number; duration: number; background?: string }
  assets: ReadonlyArray<{ src?: unknown; [k: string]: unknown }>
  items: Record<string, { type: string; [k: string]: unknown }>
  layers: ReadonlyArray<{ id: string; items: ReadonlyArray<string> }>
  tweens: ReadonlyArray<{ id: string; [k: string]: unknown }>
  [k: string]: unknown
}

const PROJECT_FILES_PREFIX = '/project-files'

function rewriteAssetsForBrowser(comp: Composition): Composition {
  const cloned = JSON.parse(JSON.stringify(comp)) as Composition
  if (!Array.isArray(cloned.assets)) return cloned
  for (const asset of cloned.assets as Array<{ src?: unknown }>) {
    if (typeof asset.src !== 'string') continue
    const src = asset.src
    if (/^(?:[a-z]+:)?\/\//i.test(src) || src.startsWith('data:')) continue
    if (src.startsWith(PROJECT_FILES_PREFIX)) continue
    const trimmed = src.replace(/^(?:\.\/)+/, '').replace(/^\/+/, '')
    asset.src = `${PROJECT_FILES_PREFIX}/${trimmed}`
  }
  return cloned
}

export interface UseCommandBusOptions {
  /** Initial composition (already rewritten for browser asset URLs). */
  initial: Composition | null
}

export interface UseCommandBusReturn {
  composition: Ref<Composition | null>
  /** Snapshot of the composition at load time — used by the Inspector
   *  to draw the orange "overridden" dot. */
  baseline: Ref<Composition | null>
  pending: Ref<boolean>
  error: Ref<string | null>
  apply: (command: Command) => Promise<void>
  /**
   * Source of the most recent mutation that touched each item id. The
   * Inspector reads this to render the "AI edit" pill when the selected
   * item's last change came from MCP. Built foundation for FR-13.
   */
  itemLastSource: ShallowRef<ReadonlyMap<string, CommandSource>>
}

/**
 * Items affected by a command. Used to attribute the command's source to
 * specific items in `itemLastSource`. Generated ids (when payload.id is
 * omitted on add_*) come back in `toolResult` — we pull them out there.
 */
function affectedItemIds(command: Command, toolResult: unknown): string[] {
  const payload = command.payload as Record<string, unknown>
  switch (command.kind) {
    case 'update_item':
    case 'remove_item':
      return typeof payload.id === 'string' ? [payload.id] : []
    case 'move_item_to_layer':
      return typeof payload.itemId === 'string' ? [payload.itemId] : []
    case 'add_sprite':
    case 'add_text':
    case 'add_shape':
    case 'add_group': {
      // Prefer the server-confirmed id from toolResult; fall back to the
      // payload.id the caller supplied. Tools return `{ itemId }`.
      const tr = toolResult as { itemId?: unknown } | null | undefined
      if (tr && typeof tr.itemId === 'string') return [tr.itemId]
      return typeof payload.id === 'string' ? [payload.id] : []
    }
    case 'apply_behavior':
      return typeof payload.target === 'string' ? [payload.target] : []
    default:
      return []
  }
}

export function useCommandBus(options: UseCommandBusOptions): UseCommandBusReturn {
  const composition = ref<Composition | null>(options.initial) as Ref<Composition | null>
  const baseline = ref<Composition | null>(
    options.initial ? (JSON.parse(JSON.stringify(options.initial)) as Composition) : null,
  ) as Ref<Composition | null>
  const pending = ref(false)
  const error = ref<string | null>(null)
  // Per-item last-edit attribution. shallowRef + manual triggerRef avoids
  // wrapping every Map mutation in a reactive proxy — the Inspector only
  // reads .get() and never iterates, so deep reactivity buys nothing.
  const itemLastSource = shallowRef<Map<string, CommandSource>>(new Map())

  async function apply(command: Command): Promise<void> {
    pending.value = true
    error.value = null
    try {
      const res = await fetch('/api/command', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(command),
      })
      if (!res.ok) {
        let detail = ''
        try {
          const body = (await res.json()) as { error?: { message?: string } }
          detail = body?.error?.message ?? ''
        } catch {
          /* response not JSON */
        }
        throw new Error(detail || `HTTP ${res.status}`)
      }
      const data = (await res.json()) as {
        composition: Composition
        command: Command
        toolResult?: unknown
      }
      composition.value = rewriteAssetsForBrowser(data.composition)

      // The server echoes the parsed command (with `source` defaulted). Use
      // that — not the outgoing `command` — so any server-side normalisation
      // (currently just the Zod default) reaches the attribution map.
      const echoed = data.command ?? command
      const source: CommandSource = echoed.source === 'mcp' ? 'mcp' : 'ui'
      const affected = affectedItemIds(echoed, data.toolResult)
      if (affected.length > 0) {
        for (const id of affected) itemLastSource.value.set(id, source)
        triggerRef(itemLastSource)
      }
    } catch (err) {
      error.value = (err as Error).message ?? String(err)
    } finally {
      pending.value = false
    }
  }

  return {
    composition,
    baseline,
    pending,
    error,
    apply,
    itemLastSource,
  }
}

// Helper: read the path inside a JS object via a dotted string (e.g.
// "transform.opacity"). Returns undefined if any segment is missing.
export function readPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined
  const parts = path.split('.')
  let cur: unknown = obj
  for (const part of parts) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

export type { Composition }
export { rewriteAssetsForBrowser, affectedItemIds }
