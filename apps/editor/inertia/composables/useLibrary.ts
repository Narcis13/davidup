// useLibrary — step 13 of the editor build plan.
//
// Thin reactive wrapper around the `/api/library` endpoint. The Library
// panel uses this to fetch the catalog, filter by kind + search term, and
// refresh after the watcher picks up a file change on disk. The composable
// owns its fetch state so a hot-reloaded panel doesn't drop in-flight
// requests on the floor — successive calls supersede one another via an
// AbortController.
//
// Refresh strategy:
//   - first mount: fetch immediately
//   - filter change (kind / q): refetch (debounced 150ms for `q`)
//   - manual refresh(): explicit, used by a tiny ⟳ button + tests

import { computed, ref, shallowRef, watch, onMounted, onBeforeUnmount } from 'vue'

export type LibraryItemKind = 'template' | 'behavior' | 'scene' | 'asset' | 'font'

export interface LibraryItem {
  kind: LibraryItemKind
  id: string
  name?: string
  description?: string
  source: string
  params?: unknown[]
  emits?: string[]
  duration?: number
  url?: string
  thumbnail?: string
  raw?: unknown
}

export interface LibraryResponse {
  root: string | null
  loadedAt: number
  attached: boolean
  projectRoot: string | null
  count: number
  total: number
  query: { q: string | null; kind: string | null }
  items: LibraryItem[]
  errors: { file: string; message: string }[]
}

export type LibraryTab = LibraryItemKind | 'all'
export const LIBRARY_TABS: LibraryTab[] = [
  'template',
  'behavior',
  'scene',
  'asset',
  'font',
]

export interface UseLibraryOptions {
  /** Initial tab. */
  initialTab?: LibraryTab
  /** Override the default `/api/library` base path (used in tests). */
  endpoint?: string
  /** Disable the polling refresh used to pick up file-watcher changes. */
  disablePolling?: boolean
  /** Polling interval in ms (default 2000). */
  pollIntervalMs?: number
}

const DEFAULT_POLL_MS = 2000
const Q_DEBOUNCE_MS = 150

export function useLibrary(opts: UseLibraryOptions = {}) {
  const endpoint = opts.endpoint ?? '/api/library'
  const tab = ref<LibraryTab>(opts.initialTab ?? 'template')
  const query = ref('')
  const response = shallowRef<LibraryResponse | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const generation = ref(0)

  let abortController: AbortController | null = null
  let qTimer: ReturnType<typeof setTimeout> | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null

  async function fetchCatalog(): Promise<void> {
    if (abortController) abortController.abort()
    abortController = new AbortController()
    loading.value = true
    error.value = null
    try {
      const params = new URLSearchParams()
      if (tab.value !== 'all') params.set('kind', tab.value)
      if (query.value) params.set('q', query.value)
      const url = params.toString().length > 0 ? `${endpoint}?${params}` : endpoint
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: abortController.signal,
      })
      if (!res.ok) {
        let message = `HTTP ${res.status}`
        try {
          const body = (await res.json()) as { error?: { message?: string } }
          if (body?.error?.message) message = body.error.message
        } catch {
          /* ignore */
        }
        throw new Error(message)
      }
      const body = (await res.json()) as LibraryResponse
      const prev = response.value
      response.value = body
      if (!prev || prev.loadedAt !== body.loadedAt) {
        // Bump generation so thumbnail URLs invalidate when the catalog
        // changes on disk (watcher reloaded).
        generation.value = body.loadedAt
      }
    } catch (err: unknown) {
      if ((err as DOMException)?.name === 'AbortError') return
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      loading.value = false
    }
  }

  function scheduleQueryFetch(): void {
    if (qTimer) clearTimeout(qTimer)
    qTimer = setTimeout(() => {
      qTimer = null
      void fetchCatalog()
    }, Q_DEBOUNCE_MS)
  }

  watch(tab, () => {
    void fetchCatalog()
  })

  watch(query, () => {
    scheduleQueryFetch()
  })

  onMounted(() => {
    void fetchCatalog()
    if (!opts.disablePolling) {
      pollTimer = setInterval(() => {
        void fetchCatalog()
      }, opts.pollIntervalMs ?? DEFAULT_POLL_MS)
    }
  })

  onBeforeUnmount(() => {
    if (abortController) abortController.abort()
    if (qTimer) clearTimeout(qTimer)
    if (pollTimer) clearInterval(pollTimer)
    abortController = null
    qTimer = null
    pollTimer = null
  })

  const items = computed(() => response.value?.items ?? [])
  const attached = computed(() => response.value?.attached ?? false)
  const total = computed(() => response.value?.total ?? 0)
  const root = computed(() => response.value?.root ?? null)
  const errors = computed(() => response.value?.errors ?? [])

  return {
    tab,
    query,
    items,
    attached,
    total,
    root,
    errors,
    loading,
    error,
    generation,
    refresh: fetchCatalog,
    response,
  }
}
