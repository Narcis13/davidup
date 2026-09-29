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
//   - filter change (kind / q / a facet): refetch (debounced 150ms for `q`)
//   - manual refresh(): explicit, used by a tiny ⟳ button + tests
//
// The Assets and Fonts tabs also list the asset library's records (asset
// library E1); their search is assetlib's, and the response's `facets` are
// the chips that narrow it (`toggleFacet`). The facet filters reset when the
// tab changes.

import { computed, ref, shallowRef, watch, onMounted, onBeforeUnmount } from 'vue'
import { useToasts } from './useToasts.js'

export type LibraryItemKind = 'template' | 'behavior' | 'scene' | 'asset' | 'font'

export type LibraryScope = 'project' | 'global'

export interface LibraryItem {
  kind: LibraryItemKind
  id: string
  name?: string
  description?: string
  source: string
  /** Which root the entry came from. */
  scope: LibraryScope
  /**
   * True only on the loser of an id collision (the global copy when a
   * project entry shadows it). The winning copy omits this flag.
   */
  overridden?: boolean
  params?: unknown[]
  emits?: string[]
  duration?: number
  url?: string
  thumbnail?: string
  /** What davidup takes an asset / font item as (the server reads it off the record or entry). */
  assetType?: 'image' | 'video' | 'audio' | 'font'
  /** The asset library shelf a record is on; absent on index.json items. */
  shelf?: string
  /** Later shelves holding a record of the same id, which this one hides. */
  shadowed?: string[]
  /** The record's own kind (`cutout`, `stock`, `sample`, ...). */
  assetKind?: string
  licence?: string
  credit?: string
  tags?: string[]
  /** The field hits a search matched the record on. */
  why?: string[]
  raw?: unknown
}

/** The facet groups the chips come from (assetlib's search facets). */
export type FacetGroup = 'kind' | 'shelf' | 'licence' | 'tags'
export const FACET_GROUPS: FacetGroup[] = ['kind', 'shelf', 'licence', 'tags']

export type LibraryFacets = Record<FacetGroup | 'media', Record<string, number>>

/** The query parameter each facet group filters by. */
const FACET_PARAM: Record<FacetGroup, string> = {
  kind: 'assetKind',
  shelf: 'shelf',
  licence: 'licence',
  tags: 'tag',
}

export interface LibraryResponse {
  root: string | null
  loadedAt: number
  attached: boolean
  globalAttached?: boolean
  projectRoot: string | null
  count: number
  total: number
  query: { q: string | null; kind: string | null; scope?: string | null }
  items: LibraryItem[]
  /** The shelves' facets for an asset / font search; null for the other tabs. */
  facets?: LibraryFacets | null
  /** 'all' when nothing matched and the facets count everything listed. */
  facetsOf?: 'hits' | 'all' | null
  shelves?: { name: string; root: string }[]
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

export type LibraryScopeFilter = LibraryScope | 'all'
export const LIBRARY_SCOPES: LibraryScopeFilter[] = ['project', 'global', 'all']

export interface UseLibraryOptions {
  /** Initial tab. */
  initialTab?: LibraryTab
  /** Initial scope filter (default `'all'`). */
  initialScope?: LibraryScopeFilter
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
  const scope = ref<LibraryScopeFilter>(opts.initialScope ?? 'all')
  const query = ref('')
  const facetFilters = ref<Record<FacetGroup, string[]>>(emptyFacetFilters())
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
      if (scope.value !== 'all') params.set('scope', scope.value)
      if (query.value) params.set('q', query.value)
      for (const group of FACET_GROUPS) {
        const values = facetFilters.value[group]
        if (values.length > 0) params.set(FACET_PARAM[group], values.join(','))
      }
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
      const msg = err instanceof Error ? err.message : String(err)
      error.value = msg
      useToasts().warning('Library refresh failed', {
        message: msg,
        dedupeKey: 'library:refresh',
      })
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
    // A chip names a record kind or shelf of the tab it was picked on.
    facetFilters.value = emptyFacetFilters()
    void fetchCatalog()
  })

  watch(facetFilters, () => {
    void fetchCatalog()
  })

  /** Add a facet value to the filters, or take it off when it is on. */
  function toggleFacet(group: FacetGroup, value: string): void {
    const on = facetFilters.value[group]
    facetFilters.value = {
      ...facetFilters.value,
      [group]: on.includes(value) ? on.filter((v) => v !== value) : [...on, value],
    }
  }

  function clearFacets(): void {
    facetFilters.value = emptyFacetFilters()
  }

  watch(scope, () => {
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
  const facets = computed(() => response.value?.facets ?? null)
  const facetsOf = computed(() => response.value?.facetsOf ?? null)
  const facetCount = computed(() => FACET_GROUPS.reduce((n, g) => n + facetFilters.value[g].length, 0))

  return {
    tab,
    scope,
    query,
    facetFilters,
    facets,
    facetsOf,
    facetCount,
    toggleFacet,
    clearFacets,
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

function emptyFacetFilters(): Record<FacetGroup, string[]> {
  return { kind: [], shelf: [], licence: [], tags: [] }
}
