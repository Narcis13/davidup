import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import logger from '@adonisjs/core/services/logger'
import { validateComposition, type ValidationResult } from 'davidup/schema'

export type LoadedProject = {
  root: string
  compositionPath: string
  libraryIndexPath: string | null
  assetsDir: string | null
  composition: unknown
  loadedAt: number
}

export type ProjectLoadErrorCode =
  | 'E_PROJECT_NOT_FOUND'
  | 'E_COMPOSITION_MISSING'
  | 'E_COMPOSITION_PARSE'
  | 'E_COMPOSITION_INVALID'
  | 'E_NO_PROJECT'

export class ProjectLoadError extends Error {
  code: ProjectLoadErrorCode
  details?: unknown
  constructor(code: ProjectLoadErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'ProjectLoadError'
    this.code = code
    this.details = details
  }
}

const DEFAULT_DEBOUNCE_MS = 500

/**
 * Single in-memory composition with a debounced disk writer.
 *
 * Source of truth: the in-memory `composition` object. `update()` mutates it
 * synchronously and schedules a write; multiple updates within the debounce
 * window coalesce into one atomic file rewrite (write tmp + rename).
 */
export class ProjectStore {
  #project: LoadedProject | null = null
  #debounceMs: number

  #writeTimer: NodeJS.Timeout | null = null
  #writePending = false
  #writeInFlight: Promise<void> | null = null

  constructor(opts: { debounceMs?: number } = {}) {
    this.#debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
  }

  get isLoaded(): boolean {
    return this.#project !== null
  }

  get project(): LoadedProject | null {
    return this.#project
  }

  get composition(): unknown {
    return this.#project ? this.#project.composition : null
  }

  /**
   * Load a project from disk:
   *  - require `<dir>/composition.json` (parsed + schema-validated)
   *  - optionally locate `<dir>/library/index.json` and `<dir>/assets/`
   *
   * Throws `ProjectLoadError` on failure. On success the project becomes the
   * current in-memory composition; any pending writes for the prior project
   * are flushed first.
   */
  async load(directory: string): Promise<LoadedProject> {
    await this.flush()

    const root = resolve(directory)
    const rootStat = await fs.stat(root).catch(() => null)
    if (!rootStat || !rootStat.isDirectory()) {
      throw new ProjectLoadError('E_PROJECT_NOT_FOUND', `Project directory not found: ${root}`)
    }

    const compositionPath = join(root, 'composition.json')
    const compStat = await fs.stat(compositionPath).catch(() => null)
    if (!compStat || !compStat.isFile()) {
      throw new ProjectLoadError(
        'E_COMPOSITION_MISSING',
        `Missing composition.json at ${compositionPath}`
      )
    }

    const raw = await fs.readFile(compositionPath, 'utf8')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      throw new ProjectLoadError(
        'E_COMPOSITION_PARSE',
        `composition.json is not valid JSON: ${(err as Error).message}`
      )
    }

    const result: ValidationResult = validateComposition(parsed)
    if (!result.valid) {
      throw new ProjectLoadError(
        'E_COMPOSITION_INVALID',
        `composition.json failed validation (${result.errors.length} error(s))`,
        result
      )
    }

    const libraryIndexPath = join(root, 'library', 'index.json')
    const hasLibrary = await fs
      .stat(libraryIndexPath)
      .then((s) => s.isFile())
      .catch(() => false)

    const assetsDir = join(root, 'assets')
    const hasAssets = await fs
      .stat(assetsDir)
      .then((s) => s.isDirectory())
      .catch(() => false)

    this.#project = {
      root,
      compositionPath,
      libraryIndexPath: hasLibrary ? libraryIndexPath : null,
      assetsDir: hasAssets ? assetsDir : null,
      composition: parsed,
      loadedAt: Date.now(),
    }

    logger.info(
      {
        root,
        hasLibrary,
        hasAssets,
        warnings: result.warnings.length,
      },
      'project_store: loaded'
    )

    return this.#project
  }

  /**
   * Replace the in-memory composition and schedule a debounced write.
   * Throws if no project is loaded.
   */
  update(composition: unknown): void {
    if (!this.#project) {
      throw new ProjectLoadError('E_NO_PROJECT', 'No project loaded')
    }
    this.#project = { ...this.#project, composition }
    this.#scheduleWrite()
  }

  #scheduleWrite(): void {
    this.#writePending = true
    if (this.#writeTimer) clearTimeout(this.#writeTimer)
    this.#writeTimer = setTimeout(() => {
      this.#writeTimer = null
      this.#writeInFlight = this.#flushOnce()
        .catch((err) => {
          logger.error({ err }, 'project_store: failed to persist composition.json')
        })
        .finally(() => {
          this.#writeInFlight = null
        })
    }, this.#debounceMs)
    // Keep the event loop alive only if we explicitly request it. The default
    // here matches Node's normal timer behaviour; tests that need fast exit
    // can call `flush()` then `unload()`.
  }

  async #flushOnce(): Promise<void> {
    if (!this.#project || !this.#writePending) return
    this.#writePending = false
    const { compositionPath, composition } = this.#project
    const tmp = `${compositionPath}.tmp`
    const json = `${JSON.stringify(composition, null, 2)}\n`
    await fs.writeFile(tmp, json, 'utf8')
    await fs.rename(tmp, compositionPath)
  }

  /** Force any pending writes to complete. Safe to call when nothing is pending. */
  async flush(): Promise<void> {
    if (this.#writeTimer) {
      clearTimeout(this.#writeTimer)
      this.#writeTimer = null
    }
    if (this.#writeInFlight) {
      await this.#writeInFlight.catch(() => {})
    }
    if (this.#writePending) {
      const p = this.#flushOnce()
      this.#writeInFlight = p.finally(() => {
        this.#writeInFlight = null
      })
      await p
    }
  }

  /** Drop the in-memory project. Flushes pending writes first. */
  async unload(): Promise<void> {
    await this.flush()
    this.#project = null
  }
}

const projectStore = new ProjectStore()
export default projectStore
