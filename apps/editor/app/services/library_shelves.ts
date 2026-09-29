// The asset library half of the Library panel (docs/asset-library-plan.md E1).
//
// The Assets and Fonts tabs list the records on the three asset shelves — the
// open project's `assets/`, the user's pool (`$DAVIDUP_ASSETS`, else
// ~/.davidup/assets) and the house shelf (`$DAVIDUP_HOUSE`) — next to the
// `index.json` entries `LibraryIndex` has always read. A record is listed when
// davidup can take it (image, cutout, stock, video, audio, sample, font); a
// puppet, hand, clip or motif is hdf's alone and stays out of the panel.
//
// Each shelf's `catalogue.json` is watched by stat polling (`fs.watchFile`,
// every 250 ms): it sees assetlib's temp + rename and a shelf that does not
// exist yet, and it leaves alone the FSEvents stream libuv shares between a
// process's `fs.watch`ers on macOS, which restarts (dropping events for the
// library directories' watchers) whenever a watcher is added or closed. A
// change calls back into the index, which re-reads on its usual debounce. One
// shelf whose catalogue cannot be read is reported and skipped; the others
// still list.
//
// Search is assetlib's (A3): ranked, filtered, faceted, with the field hits
// that matched as `why`.

import { unwatchFile, watchFile, type Stats } from 'node:fs'
import { join } from 'node:path'
import {
  DAVIDUP_TYPE,
  assetSrc,
  facetsOf,
  openLibrary,
  readShelf,
  standardShelves,
  type AssetRecord,
  type Facets,
  type Kind,
  type Library,
  type Licence,
  type ShelfSpec,
} from 'davidup/assetlib'
import type { LibraryItem, LibraryScope } from '#services/library_index'

/** Record fields too long to repeat on every card (a cutout's silhouette, a sample's timing); the record drawer (E4) reads them. */
const BULKY = ['sil', 'align', 'mouth'] as const

/** The record kinds the panel lists: every kind davidup takes. */
export const PANEL_KINDS: Kind[] = (Object.keys(DAVIDUP_TYPE) as Kind[]).filter(
  (k) => DAVIDUP_TYPE[k] !== null
)

/** What narrows the shelves' half of a search, beyond the panel's kind / scope / q. */
export interface ShelfFilters {
  /** Record kinds (`cutout`, `sample`, ...). */
  assetKind?: string[]
  /** Shelf names (`project`, `user`, `house`). */
  shelf?: string[]
  licence?: string[]
  /** Every tag must be on the record. */
  tags?: string[]
}

export interface ShelfQuery extends ShelfFilters {
  q?: string
  kind?: 'asset' | 'font'
  scope?: LibraryScope
}

export interface ShelfSearch {
  items: LibraryItem[]
  /** Records matching (items is all of them). */
  count: number
  /** The facets of the matches, or of every listed record when nothing matched (`facetsOf: 'all'`). */
  facets: Facets
  facetsOf: 'hits' | 'all'
}

/** How often a shelf's catalogue is stat'ed. */
const POLL_MS = 250

interface Watched {
  file: string
  listener: (curr: Stats, prev: Stats) => void
}

function shelfItem(lib: Library, id: string): LibraryItem | null {
  const r = lib.get(id)
  const type = DAVIDUP_TYPE[r.kind]
  if (!type) return null
  const raw: Record<string, unknown> = { ...r }
  for (const k of BULKY) delete raw[k]
  const item: LibraryItem = {
    kind: type === 'font' ? 'font' : 'asset',
    id,
    source: lib.locate(id).path,
    scope: r.shelf === 'project' ? 'project' : 'global',
    url: assetSrc(r),
    shelf: r.shelf,
    assetKind: r.kind,
    assetType: type,
    licence: r.licence,
    tags: [...(r.tags ?? [])],
    raw,
  }
  if (r.name) item.name = r.name
  if (r.desc) item.description = r.desc
  if (r.credit) item.credit = r.credit
  if (r.shadowed.length > 0) item.shadowed = [...r.shadowed]
  if (typeof r.sec === 'number') item.duration = r.sec
  return item
}

function byKindThenId(a: LibraryItem, b: LibraryItem): number {
  if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
  return a.id.localeCompare(b.id)
}

export class LibraryShelves {
  #lib: Library | null = null
  #items: LibraryItem[] = []
  #byId = new Map<string, LibraryItem>()
  #watched = new Map<string, Watched>()
  #onChange: () => void

  constructor(onChange: () => void) {
    this.#onChange = onChange
  }

  /** The records listed, winners only, by kind then id. */
  get items(): LibraryItem[] {
    return this.#items
  }

  /** The shelves read, in search order. */
  get shelves(): { name: string; root: string }[] {
    return this.#lib?.shelves.map((s) => ({ name: s.name, root: s.root })) ?? []
  }

  /**
   * Read the standard shelves for `project` (null: no project shelf) and
   * watch their catalogues. A shelf that cannot be read is reported in
   * `errors` and left out.
   */
  read(
    project: string | null,
    errors: { file: string; message: string; scope: LibraryScope }[]
  ): LibraryItem[] {
    const specs = standardShelves(project ? { project } : {})
    const good: ShelfSpec[] = []
    for (const spec of specs) {
      try {
        readShelf(spec.root, { name: spec.name })
        good.push(spec)
      } catch (err) {
        errors.push({
          file: `${spec.root}/catalogue.json`,
          message: (err as Error).message,
          scope: spec.name === 'project' ? 'project' : 'global',
        })
      }
    }
    this.#watch(specs)
    const lib = openLibrary({ shelves: good })
    const items: LibraryItem[] = []
    for (const id of lib.ids) {
      const item = shelfItem(lib, id)
      if (item) items.push(item)
    }
    items.sort(byKindThenId)
    this.#lib = lib
    this.#items = items
    this.#byId = new Map(items.map((i) => [i.id, i]))
    return items
  }

  /** Drop the library and stop watching. */
  close(): void {
    for (const w of this.#watched.values()) unwatchFile(w.file, w.listener)
    this.#watched.clear()
    this.#lib = null
    this.#items = []
    this.#byId = new Map()
  }

  /** The library as last read, for previews; null before the first read. */
  get library(): Library | null {
    return this.#lib
  }

  /**
   * assetlib's search over the listed records: ranked by `q` (else by kind
   * then id), filtered by the panel's kind and scope and by the facet filters.
   */
  search(query: ShelfQuery): ShelfSearch {
    const lib = this.#lib
    const kinds = PANEL_KINDS.filter((k) => {
      if (query.kind === 'font' && k !== 'font') return false
      if (query.kind === 'asset' && k === 'font') return false
      return !query.assetKind?.length || query.assetKind.includes(k)
    })
    const names = lib?.shelves.map((s) => s.name) ?? []
    const shelves = names.filter((n) => {
      if (query.scope === 'project' && n !== 'project') return false
      if (query.scope === 'global' && n === 'project') return false
      return !query.shelf?.length || query.shelf.includes(n)
    })
    if (!lib || kinds.length === 0 || shelves.length === 0) {
      return { items: [], count: 0, facets: facetsOf([]), facetsOf: 'all' }
    }
    const out = lib.search({
      kind: kinds,
      shelf: shelves,
      ...(query.q ? { q: query.q } : {}),
      ...(query.licence?.length ? { licence: query.licence as Licence[] } : {}),
      ...(query.tags?.length ? { tags: query.tags } : {}),
      limit: 10_000,
      facets: true,
    })
    const items: LibraryItem[] = []
    for (const hit of out.hits) {
      const item = this.#byId.get(hit.id)
      if (!item) continue
      items.push(query.q ? { ...item, why: hit.why } : item)
    }
    if (!query.q) items.sort(byKindThenId)
    if (out.count > 0 && out.facets) {
      return { items, count: out.count, facets: out.facets, facetsOf: 'hits' }
    }
    // Nothing matched: the facets of what the panel lists under its kind and
    // scope, so the chips say what is there (assetlib's own 'all' counts
    // puppets and clips the panel never shows).
    const listed = this.#items
      .filter((i) => kinds.includes(i.assetKind as Kind) && shelves.includes(i.shelf!))
      .map((i) => i.raw as Partial<AssetRecord>)
    return { items, count: 0, facets: facetsOf(listed), facetsOf: 'all' }
  }

  #watch(specs: ShelfSpec[]): void {
    const want = new Map(specs.map((s) => [s.name, join(s.root, 'catalogue.json')]))
    for (const [name, w] of this.#watched) {
      if (want.get(name) === w.file) continue
      unwatchFile(w.file, w.listener)
      this.#watched.delete(name)
    }
    for (const [name, file] of want) {
      if (this.#watched.has(name)) continue
      const listener = (curr: Stats, prev: Stats) => {
        if (curr.mtimeMs === prev.mtimeMs && curr.ino === prev.ino && curr.size === prev.size)
          return
        this.#onChange()
      }
      // Not persistent: the HTTP server keeps the process alive, and a test
      // runner must be able to exit with a shelf still watched.
      watchFile(file, { interval: POLL_MS, persistent: false }, listener)
      this.#watched.set(name, { file, listener })
    }
  }
}
