// Library index reader — step 12 of the editor build plan.
//
// Watches `<project>/library/index.json` + `<project>/library/**/*.{behavior,template,scene}.json`
// and builds an in-memory catalog the Library panel can render. Changes on
// disk propagate to the catalog within ~1s (debounce + fs.watch).
//
// The catalog is intentionally schema-loose: each file is parsed as JSON,
// summary fields are extracted for indexing/search, and the raw object is
// preserved for clients that need full data. Parse/IO errors are recorded
// per-file but do not abort the whole reload.

import { promises as fs } from 'node:fs'
import { watch, type FSWatcher } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import logger from '@adonisjs/core/services/logger'
import {
  readSceneDefinition,
  registerBehavior,
  registerScene,
  registerTemplate,
  type BehaviorDescriptor,
  type BehaviorParamDescriptor,
  type BehaviorParamType,
  type TemplateDefinition,
  type TemplateParamDescriptor,
  type TemplateParamType,
} from 'davidup/compose'

export type LibraryItemKind = 'template' | 'behavior' | 'scene' | 'asset' | 'font'

export interface LibraryItem {
  kind: LibraryItemKind
  id: string
  name?: string
  description?: string
  /** Path relative to the library root, or `'index.json'` for inline entries. */
  source: string
  /** Summary fields used by the Library panel; kind-specific. */
  params?: unknown[]
  emits?: string[]
  duration?: number
  url?: string
  thumbnail?: string
  /** Raw JSON object as authored. Clients can introspect further if needed. */
  raw?: unknown
}

export interface LibraryCatalog {
  root: string | null
  loadedAt: number
  items: LibraryItem[]
  errors: { file: string; message: string }[]
}

export interface LibrarySearch {
  q?: string
  kind?: LibraryItemKind
}

const DEFAULT_DEBOUNCE_MS = 100

const FILE_KIND_BY_SUFFIX: Record<string, LibraryItemKind> = {
  '.behavior.json': 'behavior',
  '.template.json': 'template',
  '.scene.json': 'scene',
}

function detectKindFromFilename(filename: string): LibraryItemKind | null {
  const base = basename(filename).toLowerCase()
  for (const suffix of Object.keys(FILE_KIND_BY_SUFFIX)) {
    if (base.endsWith(suffix)) return FILE_KIND_BY_SUFFIX[suffix]!
  }
  return null
}

function isLibraryFile(filename: string): boolean {
  const base = basename(filename).toLowerCase()
  if (base === 'index.json') return true
  return detectKindFromFilename(filename) !== null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function emitsOf(raw: Record<string, unknown>): string[] | undefined {
  const items = asObject(raw.items)
  if (!items) return undefined
  return Object.keys(items).sort()
}

function readDefinitionItem(
  raw: unknown,
  kind: LibraryItemKind,
  source: string,
  fallbackId: string,
): LibraryItem | null {
  const obj = asObject(raw)
  if (!obj) return null
  const id = asString(obj.id) ?? asString(obj.name) ?? fallbackId
  const item: LibraryItem = {
    kind,
    id,
    source,
    raw: obj,
  }
  const name = asString(obj.name)
  if (name) item.name = name
  const description = asString(obj.description)
  if (description) item.description = description
  const params = asArray(obj.params)
  if (params.length > 0) item.params = params
  const emits = emitsOf(obj)
  if (emits && emits.length > 0) item.emits = emits
  const duration = asNumber(obj.duration)
  if (duration !== undefined) item.duration = duration
  return item
}

function readAssetItem(raw: unknown, source: string): LibraryItem | null {
  const obj = asObject(raw)
  if (!obj) return null
  const id = asString(obj.id) ?? asString(obj.name) ?? asString(obj.url)
  if (!id) return null
  const item: LibraryItem = { kind: 'asset', id, source, raw: obj }
  const name = asString(obj.name)
  if (name) item.name = name
  const description = asString(obj.description)
  if (description) item.description = description
  const url = asString(obj.url) ?? asString(obj.src) ?? asString(obj.path)
  if (url) item.url = url
  const thumbnail = asString(obj.thumbnail) ?? asString(obj.preview)
  if (thumbnail) item.thumbnail = thumbnail
  return item
}

function readFontItem(raw: unknown, source: string): LibraryItem | null {
  const obj = asObject(raw)
  if (!obj) return null
  const id =
    asString(obj.id) ?? asString(obj.family) ?? asString(obj.name) ?? asString(obj.url)
  if (!id) return null
  const item: LibraryItem = { kind: 'font', id, source, raw: obj }
  const name = asString(obj.name) ?? asString(obj.family)
  if (name) item.name = name
  const description = asString(obj.description)
  if (description) item.description = description
  const url = asString(obj.url) ?? asString(obj.src) ?? asString(obj.path)
  if (url) item.url = url
  return item
}

async function walkLibrary(root: string): Promise<string[]> {
  const out: string[] = []
  async function visit(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await visit(full)
      } else if (entry.isFile() && detectKindFromFilename(entry.name) !== null) {
        out.push(full)
      }
    }
  }
  await visit(root)
  return out
}

/**
 * Watch-and-index service. Use `attach(libraryDir)` after a project loads;
 * call `detach()` before switching projects. `getCatalog()` and `search()`
 * read the current in-memory catalog.
 */
export class LibraryIndex {
  #root: string | null = null
  #watcher: FSWatcher | null = null
  #catalog: LibraryCatalog
  #debounceMs: number

  #reloadTimer: NodeJS.Timeout | null = null
  #reloadInFlight: Promise<void> | null = null

  constructor(opts: { debounceMs?: number } = {}) {
    this.#debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.#catalog = { root: null, loadedAt: 0, items: [], errors: [] }
  }

  get root(): string | null {
    return this.#root
  }

  get isAttached(): boolean {
    return this.#root !== null
  }

  getCatalog(): LibraryCatalog {
    return this.#catalog
  }

  /**
   * Attach to a library directory. Reads the initial catalog synchronously
   * with respect to the caller (awaited), then starts a recursive watcher.
   * Replaces any previous attachment.
   */
  async attach(libraryDir: string): Promise<LibraryCatalog> {
    await this.detach()
    const stat = await fs.stat(libraryDir).catch(() => null)
    if (!stat || !stat.isDirectory()) {
      this.#root = null
      this.#catalog = { root: null, loadedAt: Date.now(), items: [], errors: [] }
      logger.warn({ libraryDir }, 'library_index: directory not found, catalog is empty')
      return this.#catalog
    }
    this.#root = libraryDir
    await this.#reload()
    try {
      this.#watcher = watch(libraryDir, { recursive: true }, (_event, filename) => {
        if (filename && !isLibraryFile(filename)) return
        this.#scheduleReload()
      })
      this.#watcher.on('error', (err) => {
        logger.warn({ err, libraryDir }, 'library_index: watcher error')
      })
    } catch (err) {
      logger.warn({ err, libraryDir }, 'library_index: failed to start watcher')
    }
    return this.#catalog
  }

  /** Detach from the current library directory and drop the catalog. */
  async detach(): Promise<void> {
    if (this.#reloadTimer) {
      clearTimeout(this.#reloadTimer)
      this.#reloadTimer = null
    }
    if (this.#watcher) {
      try {
        this.#watcher.close()
      } catch {
        /* ignore */
      }
      this.#watcher = null
    }
    if (this.#reloadInFlight) {
      await this.#reloadInFlight.catch(() => {})
    }
    this.#reloadInFlight = null
    this.#root = null
    this.#catalog = { root: null, loadedAt: Date.now(), items: [], errors: [] }
  }

  /** Force any pending debounced reload to run to completion. */
  async flush(): Promise<void> {
    if (this.#reloadTimer) {
      clearTimeout(this.#reloadTimer)
      this.#reloadTimer = null
      const p = this.#reload()
      this.#reloadInFlight = p.finally(() => {
        this.#reloadInFlight = null
      })
      await p
    }
    if (this.#reloadInFlight) await this.#reloadInFlight.catch(() => {})
  }

  /** Filtered view over the catalog. Both filters are AND-combined. */
  search(opts: LibrarySearch = {}): LibraryItem[] {
    let items = this.#catalog.items
    if (opts.kind) items = items.filter((i) => i.kind === opts.kind)
    if (opts.q) {
      const q = opts.q.toLowerCase()
      items = items.filter((i) => {
        if (i.id.toLowerCase().includes(q)) return true
        if (i.name && i.name.toLowerCase().includes(q)) return true
        if (i.description && i.description.toLowerCase().includes(q)) return true
        return false
      })
    }
    return items
  }

  #scheduleReload(): void {
    if (this.#reloadTimer) clearTimeout(this.#reloadTimer)
    this.#reloadTimer = setTimeout(() => {
      this.#reloadTimer = null
      const p = this.#reload().catch((err) => {
        logger.error({ err }, 'library_index: reload failed')
      })
      this.#reloadInFlight = p.finally(() => {
        this.#reloadInFlight = null
      })
    }, this.#debounceMs)
  }

  async #reload(): Promise<void> {
    const root = this.#root
    if (!root) return
    const errors: { file: string; message: string }[] = []
    const items: LibraryItem[] = []
    const seen = new Set<string>()

    const push = (item: LibraryItem | null): void => {
      if (!item) return
      const key = `${item.kind}::${item.id}::${item.source}`
      if (seen.has(key)) return
      seen.add(key)
      items.push(item)
    }

    // 1. index.json — inline catalog (assets, fonts, optional inline defs).
    const indexPath = join(root, 'index.json')
    const indexRaw = await fs.readFile(indexPath, 'utf8').catch((err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      errors.push({ file: 'index.json', message: (err as Error).message })
      return null
    })
    if (indexRaw !== null) {
      try {
        const idx = JSON.parse(indexRaw) as Record<string, unknown>
        for (const a of asArray(idx.assets)) push(readAssetItem(a, 'index.json'))
        for (const f of asArray(idx.fonts)) push(readFontItem(f, 'index.json'))
        for (const t of asArray(idx.templates))
          push(readDefinitionItem(t, 'template', 'index.json', `template:${items.length}`))
        for (const b of asArray(idx.behaviors))
          push(readDefinitionItem(b, 'behavior', 'index.json', `behavior:${items.length}`))
        for (const s of asArray(idx.scenes))
          push(readDefinitionItem(s, 'scene', 'index.json', `scene:${items.length}`))
      } catch (err) {
        errors.push({ file: 'index.json', message: (err as Error).message })
      }
    }

    // 2. *.{behavior,template,scene}.json — one definition per file.
    const files = await walkLibrary(root)
    for (const file of files) {
      const rel = relative(root, file).split('\\').join('/')
      const kind = detectKindFromFilename(file)
      if (!kind) continue
      let parsed: unknown
      try {
        const raw = await fs.readFile(file, 'utf8')
        parsed = JSON.parse(raw)
      } catch (err) {
        errors.push({ file: rel, message: (err as Error).message })
        continue
      }
      const fallbackId = basename(file, extname(file)).replace(/\.(behavior|template|scene)$/i, '')
      const item = readDefinitionItem(parsed, kind, rel, fallbackId)
      if (item) push(item)
      else errors.push({ file: rel, message: 'Definition must be a JSON object' })
    }

    // Stable order: by kind then id for deterministic responses.
    items.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
      return a.id.localeCompare(b.id)
    })

    // Surface library templates and scenes to the engine registry so the
    // drag-from-library flow (step 14) can dispatch `apply_template` /
    // `add_scene_instance` against them by id. Built-in templates registered
    // at import time are not overwritten unless the library defines the same
    // id — that mirrors the "last write wins" semantics of MCP
    // define_user_template / define_scene.
    for (const item of items) {
      if (item.kind === 'template') {
        try {
          const def = libraryTemplateToDefinition(item.id, item.raw)
          if (def) registerTemplate(def)
        } catch (err) {
          errors.push({ file: item.source, message: (err as Error).message })
        }
      } else if (item.kind === 'scene') {
        try {
          const raw = item.raw as Record<string, unknown> | undefined
          if (raw && typeof raw === 'object') {
            const def = readSceneDefinition(item.id, raw)
            registerScene(def)
          }
        } catch (err) {
          errors.push({ file: item.source, message: (err as Error).message })
        }
      } else if (item.kind === 'behavior') {
        try {
          const desc = libraryBehaviorToDescriptor(item.id, item.raw)
          if (desc) registerBehavior(desc)
        } catch (err) {
          errors.push({ file: item.source, message: (err as Error).message })
        }
      }
    }

    this.#catalog = {
      root,
      loadedAt: Date.now(),
      items,
      errors,
    }
  }
}

const TEMPLATE_PARAM_TYPES: ReadonlySet<TemplateParamType> = new Set([
  'number',
  'string',
  'color',
  'boolean',
])

function libraryTemplateToDefinition(
  id: string,
  raw: unknown,
): TemplateDefinition | null {
  const obj = asObject(raw)
  if (!obj) return null
  const params: TemplateParamDescriptor[] = []
  const rawParams = asArray(obj.params)
  for (const p of rawParams) {
    const po = asObject(p)
    if (!po) continue
    const name = asString(po.name)
    const type = asString(po.type)
    if (!name || !type) continue
    if (!TEMPLATE_PARAM_TYPES.has(type as TemplateParamType)) continue
    const desc: TemplateParamDescriptor = { name, type: type as TemplateParamType }
    if (po.required === true) desc.required = true
    if (Object.prototype.hasOwnProperty.call(po, 'default')) desc.default = po.default
    const description = asString(po.description)
    if (description) desc.description = description
    params.push(desc)
  }
  const items = asObject(obj.items)
  if (!items) return null
  const tweensRaw = asArray(obj.tweens)
  const def: TemplateDefinition = {
    id,
    params,
    items: items as Record<string, unknown>,
    tweens: tweensRaw,
  }
  const description = asString(obj.description)
  if (description) def.description = description
  return def
}

const BEHAVIOR_PARAM_TYPES: ReadonlySet<BehaviorParamType> = new Set([
  'number',
  'string',
  'color',
  'colorArray',
  'axis',
])

function libraryBehaviorToDescriptor(
  name: string,
  raw: unknown,
): BehaviorDescriptor | null {
  const obj = asObject(raw)
  if (!obj) return null
  const params: BehaviorParamDescriptor[] = []
  for (const p of asArray(obj.params)) {
    const po = asObject(p)
    if (!po) continue
    const pname = asString(po.name)
    const ptype = asString(po.type)
    if (!pname || !ptype) continue
    if (!BEHAVIOR_PARAM_TYPES.has(ptype as BehaviorParamType)) continue
    const desc: BehaviorParamDescriptor = {
      name: pname,
      type: ptype as BehaviorParamType,
      required: po.required === true,
      description: asString(po.description) ?? '',
    }
    if (Object.prototype.hasOwnProperty.call(po, 'default')) desc.default = po.default
    params.push(desc)
  }
  return {
    name,
    description: asString(obj.description) ?? '',
    params,
    produces: 'dynamic',
  }
}

const libraryIndex = new LibraryIndex()
export default libraryIndex
