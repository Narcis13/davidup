// Library index reader — step 12, extended for step 20.6 (two-root pool).
//
// Watches up to two library roots in parallel:
//   * the **global** pool at `$DAVIDUP_LIBRARY` (default `~/.davidup/library`),
//     attached once at server boot and never replaced;
//   * the **project** pool at `<project>/library/`, rebound every time a
//     different project is loaded.
//
// The merged catalog the Library panel renders includes every item from both
// roots. When the same `(kind, id)` appears in both, the project entry wins:
// the project copy carries `scope: 'project'` (no `overridden` flag), and the
// global copy is emitted with `scope: 'global', overridden: true` so the UI
// can show a strike-through provenance hint.
//
// Changes on disk in either root propagate to the catalog within ~1s
// (debounce + per-root `fs.watch`). The engine REGISTRY is updated to reflect
// the *winning* definition for each id — i.e. project beats global, and a
// `detachProject()` re-registers the global definition that was previously
// shadowed.

import { promises as fs } from 'node:fs'
import { watch, type FSWatcher } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'
import logger from '@adonisjs/core/services/logger'
import {
  readSceneDefinition,
  registerBehavior,
  registerScene,
  registerTemplate,
  unregisterBehavior,
  unregisterScene,
  unregisterTemplate,
  type BehaviorDescriptor,
  type BehaviorParamDescriptor,
  type BehaviorParamType,
  type TemplateDefinition,
  type TemplateParamDescriptor,
  type TemplateParamType,
} from 'davidup/compose'

export type LibraryItemKind = 'template' | 'behavior' | 'scene' | 'asset' | 'font'

export type LibraryScope = 'project' | 'global'

export interface LibraryItem {
  kind: LibraryItemKind
  id: string
  name?: string
  description?: string
  /** Path relative to the owning root, or `'index.json'` for inline entries. */
  source: string
  /** Which root the entry came from. */
  scope: LibraryScope
  /**
   * True only on the *loser* of an id collision (always the `global` copy
   * today, since project wins). The winning copy omits this flag.
   */
  overridden?: boolean
  /** Summary fields used by the Library panel; kind-specific. */
  params?: unknown[]
  emits?: string[]
  duration?: number
  url?: string
  thumbnail?: string
  /** Raw JSON object as authored. Clients can introspect further if needed. */
  raw?: unknown
}

export interface LibraryRootInfo {
  scope: LibraryScope
  path: string
}

export interface LibraryCatalog {
  /** Project root path, kept for backward compatibility. `null` when detached. */
  root: string | null
  /** Every currently-attached root, in scope order (`global`, then `project`). */
  roots: LibraryRootInfo[]
  loadedAt: number
  items: LibraryItem[]
  errors: { file: string; message: string; scope: LibraryScope }[]
}

export interface LibrarySearch {
  q?: string
  kind?: LibraryItemKind
  scope?: LibraryScope
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
  scope: LibraryScope,
  fallbackId: string,
): LibraryItem | null {
  const obj = asObject(raw)
  if (!obj) return null
  const id = asString(obj.id) ?? asString(obj.name) ?? fallbackId
  const item: LibraryItem = {
    kind,
    id,
    source,
    scope,
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

function readAssetItem(raw: unknown, source: string, scope: LibraryScope): LibraryItem | null {
  const obj = asObject(raw)
  if (!obj) return null
  const id = asString(obj.id) ?? asString(obj.name) ?? asString(obj.url)
  if (!id) return null
  const item: LibraryItem = { kind: 'asset', id, source, scope, raw: obj }
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

function readFontItem(raw: unknown, source: string, scope: LibraryScope): LibraryItem | null {
  const obj = asObject(raw)
  if (!obj) return null
  const id =
    asString(obj.id) ?? asString(obj.family) ?? asString(obj.name) ?? asString(obj.url)
  if (!id) return null
  const item: LibraryItem = { kind: 'font', id, source, scope, raw: obj }
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

interface ScopeState {
  scope: LibraryScope
  path: string
  watcher: FSWatcher | null
}

/**
 * Two-root watch-and-index service.
 *
 * Usage:
 *   * `attachGlobal(path)` — call once at server boot. Permanent.
 *   * `attach(projectDir)` / `attachProject(projectDir)` — rebind whenever a
 *     project loads; detaches any prior project pool first.
 *   * `detach()` / `detachProject()` — drop the project pool only; global
 *     stays attached.
 *   * `detachGlobal()` — drop the global pool (used by tests).
 *
 * `getCatalog()` and `search()` return the merged view of every attached root.
 */
export class LibraryIndex {
  #projectState: ScopeState | null = null
  #globalState: ScopeState | null = null
  #catalog: LibraryCatalog
  #debounceMs: number

  #reloadTimer: NodeJS.Timeout | null = null
  #reloadInFlight: Promise<void> | null = null

  /**
   * Engine-registry registrations performed by this index, keyed by
   * `${kind}::${id}`. Only the *winner* of an id collision is registered:
   * project beats global, so if both roots define `card`, the project's
   * definition lands in REGISTRY and the global one is suppressed. On
   * `detachProject()` the next reload re-registers the surviving global
   * definition (last-write-wins).
   */
  #registered = new Map<string, { scope: LibraryScope; unregister: () => boolean }>()

  constructor(opts: { debounceMs?: number } = {}) {
    this.#debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.#catalog = emptyCatalog()
  }

  /** Project root path, or `null` if no project is attached. */
  get root(): string | null {
    return this.#projectState?.path ?? null
  }

  /** Global root path, or `null` if the global pool has not been attached. */
  get globalRoot(): string | null {
    return this.#globalState?.path ?? null
  }

  /** True iff a project root is currently attached. */
  get isAttached(): boolean {
    return this.#projectState !== null
  }

  /** True iff the global root is currently attached. */
  get isGlobalAttached(): boolean {
    return this.#globalState !== null
  }

  getCatalog(): LibraryCatalog {
    return this.#catalog
  }

  /**
   * Attach the project library directory. Replaces any prior project
   * attachment. The global pool (if attached) is untouched.
   */
  async attach(libraryDir: string): Promise<LibraryCatalog> {
    return this.attachProject(libraryDir)
  }

  /** Alias of {@link attach} that names its intent explicitly. */
  async attachProject(libraryDir: string): Promise<LibraryCatalog> {
    await this.#detachState('project')
    const stat = await fs.stat(libraryDir).catch(() => null)
    if (!stat || !stat.isDirectory()) {
      logger.warn(
        { libraryDir },
        'library_index: project directory not found, catalog continues with global only',
      )
      await this.#reload()
      return this.#catalog
    }
    this.#projectState = { scope: 'project', path: libraryDir, watcher: null }
    this.#startWatcher(this.#projectState)
    await this.#reload()
    return this.#catalog
  }

  /**
   * Attach the global library directory. Intended to be called once at boot.
   * Re-calling is allowed and will rebind to a new path (used by tests).
   */
  async attachGlobal(libraryDir: string): Promise<LibraryCatalog> {
    await this.#detachState('global')
    const stat = await fs.stat(libraryDir).catch(() => null)
    if (!stat || !stat.isDirectory()) {
      logger.warn(
        { libraryDir },
        'library_index: global directory not found, catalog continues with project only',
      )
      await this.#reload()
      return this.#catalog
    }
    this.#globalState = { scope: 'global', path: libraryDir, watcher: null }
    this.#startWatcher(this.#globalState)
    await this.#reload()
    return this.#catalog
  }

  /**
   * Detach the project root (used when switching projects). Global stays.
   *
   * Kept as `detach()` for backward compatibility with existing call sites
   * (`projectStore.unload()` and tests). To fully reset the singleton, call
   * `detachGlobal()` in addition.
   */
  async detach(): Promise<void> {
    await this.detachProject()
  }

  async detachProject(): Promise<void> {
    await this.#detachState('project')
    await this.#reload()
  }

  async detachGlobal(): Promise<void> {
    await this.#detachState('global')
    await this.#reload()
  }

  async #detachState(scope: LibraryScope): Promise<void> {
    if (this.#reloadTimer) {
      clearTimeout(this.#reloadTimer)
      this.#reloadTimer = null
    }
    const state = scope === 'project' ? this.#projectState : this.#globalState
    if (state?.watcher) {
      try {
        state.watcher.close()
      } catch {
        /* ignore */
      }
      state.watcher = null
    }
    if (this.#reloadInFlight) {
      await this.#reloadInFlight.catch(() => {})
    }
    this.#reloadInFlight = null
    // Drop registry entries owned by this scope only; the surviving scope's
    // registrations will be re-decided in the next #reload().
    for (const [key, entry] of this.#registered) {
      if (entry.scope !== scope) continue
      try {
        entry.unregister()
      } catch {
        /* ignore */
      }
      this.#registered.delete(key)
    }
    if (scope === 'project') this.#projectState = null
    else this.#globalState = null
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

  /** Filtered view over the merged catalog. Filters are AND-combined. */
  search(opts: LibrarySearch = {}): LibraryItem[] {
    let items = this.#catalog.items
    if (opts.kind) items = items.filter((i) => i.kind === opts.kind)
    if (opts.scope) items = items.filter((i) => i.scope === opts.scope)
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

  #startWatcher(state: ScopeState): void {
    try {
      state.watcher = watch(state.path, { recursive: true }, (_event, filename) => {
        if (filename && !isLibraryFile(filename)) return
        this.#scheduleReload()
      })
      state.watcher.on('error', (err) => {
        logger.warn({ err, root: state.path, scope: state.scope }, 'library_index: watcher error')
      })
    } catch (err) {
      logger.warn(
        { err, root: state.path, scope: state.scope },
        'library_index: failed to start watcher',
      )
    }
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
    const errors: { file: string; message: string; scope: LibraryScope }[] = []

    // Walk each attached root independently, producing per-scope item lists
    // whose `source` field is relative to that scope's root.
    const perScope: Record<LibraryScope, LibraryItem[]> = {
      global: [],
      project: [],
    }
    if (this.#globalState) {
      await readRoot(this.#globalState, perScope.global, errors)
    }
    if (this.#projectState) {
      await readRoot(this.#projectState, perScope.project, errors)
    }

    // Merge with project-wins override: if (kind,id) appears in both scopes,
    // the project entry is the winner; the global entry is flagged
    // `overridden: true` so the panel can render a strike-through hint.
    const projectKeys = new Set<string>()
    for (const item of perScope.project) projectKeys.add(`${item.kind}::${item.id}`)

    const merged: LibraryItem[] = []
    for (const item of perScope.global) {
      const key = `${item.kind}::${item.id}`
      if (projectKeys.has(key)) merged.push({ ...item, overridden: true })
      else merged.push(item)
    }
    for (const item of perScope.project) merged.push(item)

    merged.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
      if (a.id !== b.id) return a.id.localeCompare(b.id)
      // Stable scope order: global before project, so an overridden global
      // appears just above its project shadow.
      return a.scope.localeCompare(b.scope)
    })

    // Pick the winning definition per (kind, id) and (re-)register it with
    // the engine. The winner is the project entry when present; otherwise
    // the global entry. Items that didn't survive this reload have their
    // prior registration dropped — that's the watcher-delete diff (step 20.4).
    const winners = new Map<string, LibraryItem>()
    for (const item of merged) {
      if (item.kind !== 'template' && item.kind !== 'scene' && item.kind !== 'behavior') continue
      if (item.overridden) continue
      winners.set(`${item.kind}::${item.id}`, item)
    }

    const nextRegistered = new Map<string, { scope: LibraryScope; unregister: () => boolean }>()
    for (const [key, item] of winners) {
      try {
        if (item.kind === 'template') {
          const def = libraryTemplateToDefinition(item.id, item.raw)
          if (def) {
            registerTemplate(def)
            nextRegistered.set(key, {
              scope: item.scope,
              unregister: () => unregisterTemplate(item.id),
            })
          }
        } else if (item.kind === 'scene') {
          const raw = item.raw as Record<string, unknown> | undefined
          if (raw && typeof raw === 'object') {
            const def = readSceneDefinition(item.id, raw)
            registerScene(def)
            nextRegistered.set(key, {
              scope: item.scope,
              unregister: () => unregisterScene(item.id),
            })
          }
        } else if (item.kind === 'behavior') {
          const desc = libraryBehaviorToDescriptor(item.id, item.raw)
          if (desc) {
            registerBehavior(desc)
            nextRegistered.set(key, {
              scope: item.scope,
              unregister: () => unregisterBehavior(item.id),
            })
          }
        }
      } catch (err) {
        errors.push({ file: item.source, message: (err as Error).message, scope: item.scope })
      }
    }

    for (const [key, entry] of this.#registered) {
      if (nextRegistered.has(key)) continue
      try {
        entry.unregister()
      } catch {
        /* ignore */
      }
    }
    this.#registered = nextRegistered

    this.#catalog = {
      root: this.#projectState?.path ?? null,
      roots: this.#rootsInfo(),
      loadedAt: Date.now(),
      items: merged,
      errors,
    }
  }

  #rootsInfo(): LibraryRootInfo[] {
    const out: LibraryRootInfo[] = []
    if (this.#globalState) out.push({ scope: 'global', path: this.#globalState.path })
    if (this.#projectState) out.push({ scope: 'project', path: this.#projectState.path })
    return out
  }
}

function emptyCatalog(): LibraryCatalog {
  return { root: null, roots: [], loadedAt: 0, items: [], errors: [] }
}

async function readRoot(
  state: ScopeState,
  out: LibraryItem[],
  errors: { file: string; message: string; scope: LibraryScope }[],
): Promise<void> {
  const root = state.path
  const scope = state.scope
  const seen = new Set<string>()
  const push = (item: LibraryItem | null): void => {
    if (!item) return
    const key = `${item.kind}::${item.id}::${item.source}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(item)
  }

  // 1. index.json — inline catalog (assets, fonts, optional inline defs).
  const indexPath = join(root, 'index.json')
  const indexRaw = await fs.readFile(indexPath, 'utf8').catch((err) => {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    errors.push({ file: 'index.json', message: (err as Error).message, scope })
    return null
  })
  if (indexRaw !== null) {
    try {
      const idx = JSON.parse(indexRaw) as Record<string, unknown>
      for (const a of asArray(idx.assets)) push(readAssetItem(a, 'index.json', scope))
      for (const f of asArray(idx.fonts)) push(readFontItem(f, 'index.json', scope))
      for (const t of asArray(idx.templates))
        push(readDefinitionItem(t, 'template', 'index.json', scope, `template:${out.length}`))
      for (const b of asArray(idx.behaviors))
        push(readDefinitionItem(b, 'behavior', 'index.json', scope, `behavior:${out.length}`))
      for (const s of asArray(idx.scenes))
        push(readDefinitionItem(s, 'scene', 'index.json', scope, `scene:${out.length}`))
    } catch (err) {
      errors.push({ file: 'index.json', message: (err as Error).message, scope })
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
      errors.push({ file: rel, message: (err as Error).message, scope })
      continue
    }
    const fallbackId = basename(file, extname(file)).replace(/\.(behavior|template|scene)$/i, '')
    const item = readDefinitionItem(parsed, kind, rel, scope, fallbackId)
    if (item) push(item)
    else errors.push({ file: rel, message: 'Definition must be a JSON object', scope })
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
