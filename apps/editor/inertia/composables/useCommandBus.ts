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

import { ref, type Ref } from 'vue'

// The server (`app/types/commands.ts`) is the single source of truth for
// the Command discriminated union. The client only needs the wire shape;
// the server's Zod schema validates the payload on every POST.
export interface Command {
  kind: string
  payload: Record<string, unknown>
  source?: 'ui' | 'mcp'
}

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
}

export function useCommandBus(options: UseCommandBusOptions): UseCommandBusReturn {
  const composition = ref<Composition | null>(options.initial) as Ref<Composition | null>
  const baseline = ref<Composition | null>(
    options.initial ? (JSON.parse(JSON.stringify(options.initial)) as Composition) : null,
  ) as Ref<Composition | null>
  const pending = ref(false)
  const error = ref<string | null>(null)

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
      const data = (await res.json()) as { composition: Composition }
      composition.value = rewriteAssetsForBrowser(data.composition)
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
export { rewriteAssetsForBrowser }
