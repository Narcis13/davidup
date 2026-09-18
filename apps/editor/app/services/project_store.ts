import { createHash } from 'node:crypto'
import { promises as fs, watch, type FSWatcher } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import logger from '@adonisjs/core/services/logger'
import { precompile, type SourceMap } from 'davidup/compose'
import { validateComposition, type Composition, type ValidationResult } from 'davidup/schema'
import libraryIndex from '#services/library_index'
import recents from '#services/recents'
import projectEvents from '#services/project_events'
import renderJobs from '../workers/render_worker.js'

export type LoadedProject = {
  root: string
  compositionPath: string
  libraryIndexPath: string | null
  assetsDir: string | null
  composition: unknown
  /**
   * Snapshot of the freshly-precompiled composition, captured once at load
   * time. Mirrors the canonical form that comes out of the precompile
   * pipeline (template/scene/$ref/behavior expansion), before any in-session
   * `update()` has touched it. Used by the editor as the "template/scene
   * default" reference for the Inspector's override-detection dot — see
   * polish_plan §20.25. Stays stable across edits *within* a server session
   * even though the on-disk composition.json keeps drifting toward the
   * canonical form on each save.
   */
  defaults: unknown
  /**
   * Authorship trail emitted by the precompile pipeline (PRD step 15). Keyed
   * by resolved item / tween id → `{ file, jsonPointer, originKind }`. Used
   * by the editor's Timeline to colour bars by their *true* origin
   * (literal / template / scene / behavior / background) instead of the
   * earlier id-string heuristic — see polish_plan §20.26. Captured once on
   * load; entries for tweens added during the session via commands won't be
   * present, and the Timeline falls back to its heuristic for those.
   */
  sourceMap: SourceMap
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

/**
 * Parse, precompile and validate the raw text of a composition.json. Shared
 * by `load()` and the external-edit watcher. Throws `ProjectLoadError`.
 */
async function compileComposition(
  raw: string,
  compositionPath: string
): Promise<{ compiled: unknown; sourceMap: SourceMap; result: ValidationResult }> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new ProjectLoadError(
      'E_COMPOSITION_PARSE',
      `composition.json is not valid JSON: ${(err as Error).message}`
    )
  }

  // Lower authoring-form constructs ($ref / $template / type:"scene" / $behavior)
  // into the canonical form the engine + validator + editor commands expect.
  // For canonical-v0.1 input every pass short-circuits, returning the same
  // object reference — so this is a near-zero-cost no-op.
  //
  // `emitSourceMap: true` returns the same canonical JSON plus an
  // authorship trail (PRD step 15). The Timeline reads `originKind` from
  // this map to colour bars by their true origin (literal / template /
  // scene / behavior / background).
  let compiled: unknown
  let sourceMap: SourceMap
  try {
    const out = await precompile(parsed, {
      sourcePath: compositionPath,
      emitSourceMap: true,
    })
    compiled = out.resolved
    sourceMap = out.sourceMap
  } catch (err) {
    throw new ProjectLoadError(
      'E_COMPOSITION_INVALID',
      `composition.json failed to precompile: ${(err as Error).message}`,
      { precompileError: (err as Error).message }
    )
  }

  const result: ValidationResult = validateComposition(compiled)
  if (!result.valid) {
    throw new ProjectLoadError(
      'E_COMPOSITION_INVALID',
      `composition.json failed validation (${result.errors.length} error(s))`,
      result
    )
  }
  return { compiled, sourceMap, result }
}

function hashText(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}

const DEFAULT_DEBOUNCE_MS = 500
const DEFAULT_WATCH_DEBOUNCE_MS = 100

/**
 * Single in-memory composition with a debounced disk writer.
 *
 * Source of truth: the in-memory `composition` object. `update()` mutates it
 * synchronously and schedules a write; multiple updates within the debounce
 * window coalesce into one atomic file rewrite (write tmp + rename).
 *
 * External edits (v1.1 S25): the project root is watched for changes to
 * composition.json. A SHA-1 of the last text we loaded or wrote lets the
 * watcher skip our own writes; any other content is re-compiled, swapped in
 * as one undo step, and broadcast as `changed` (`reason: 'external'`).
 */
export class ProjectStore {
  #project: LoadedProject | null = null
  #debounceMs: number

  #writeTimer: NodeJS.Timeout | null = null
  #writePending = false
  #writeInFlight: Promise<void> | null = null

  #watchDebounceMs: number
  #watcher: FSWatcher | null = null
  #watchTimer: NodeJS.Timeout | null = null
  /** Hash of the composition.json text last loaded from or written to disk. */
  #diskHash: string | null = null

  constructor(opts: { debounceMs?: number; watchDebounceMs?: number } = {}) {
    this.#debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.#watchDebounceMs = opts.watchDebounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS
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
    const wasAlreadyLoaded = this.#project !== null
    const priorRoot = this.#project?.root ?? null

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
    const { compiled, sourceMap, result } = await compileComposition(raw, compositionPath)

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

    // Project switch — full reset (polish_plan 20.11). When a different
    // project is loaded against an already-running server, drop every piece
    // of in-memory state tied to the old project before swapping the
    // composition. The order matters: clear undo first (cheap, can't fail),
    // abort renders (synchronous), then detach the library (async I/O). We
    // do this only after the new composition has parsed + validated, so a
    // failed switch leaves the prior project untouched.
    if (wasAlreadyLoaded && priorRoot !== root) {
      try {
        const { default: commandBus } = await import('#services/command_bus')
        commandBus.resetUndo()
      } catch (err) {
        logger.warn({ err }, 'project_store: failed to reset command-bus undo on switch')
      }
      try {
        const n = renderJobs.abortInFlight('Render aborted: project switched')
        if (n > 0) logger.info({ aborted: n }, 'project_store: aborted in-flight renders')
      } catch (err) {
        logger.warn({ err }, 'project_store: failed to abort in-flight renders on switch')
      }
      try {
        await libraryIndex.detachProject()
      } catch (err) {
        logger.warn({ err }, 'project_store: failed to detach library on switch')
      }
    }

    // Deep-clone so subsequent in-place mutations to `composition` (Inspector
    // edits, MCP tool calls) cannot leak back into the defaults snapshot.
    // This is the "template/scene default" reference the editor compares
    // against to draw the override dot — must never drift after load.
    const defaults = JSON.parse(JSON.stringify(compiled)) as unknown

    this.#project = {
      root,
      compositionPath,
      libraryIndexPath: hasLibrary ? libraryIndexPath : null,
      assetsDir: hasAssets ? assetsDir : null,
      composition: compiled,
      defaults,
      sourceMap,
      loadedAt: Date.now(),
    }
    this.#diskHash = hashText(raw)
    this.#startWatcher(root)

    logger.info(
      {
        root,
        hasLibrary,
        hasAssets,
        warnings: result.warnings.length,
      },
      'project_store: loaded'
    )

    if (hasLibrary) {
      await libraryIndex.attach(dirname(libraryIndexPath)).catch((err) => {
        logger.warn({ err }, 'project_store: library_index attach failed')
      })
    } else {
      await libraryIndex.detach()
    }

    // Best-effort recents bump. A failure to update ~/.davidup/recents.json
    // must not block the load — the editor stays usable even if the picker's
    // history can't be persisted.
    await recents.touch(root).catch((err) => {
      logger.warn({ err, root }, 'project_store: failed to bump recents')
    })

    // Broadcast a project-switch event so connected editor tabs can refetch
    // their Inertia props. Emitted only when the load swapped a previously
    // loaded project for a different one — the first-load case is handled by
    // the initial GET /editor render.
    if (wasAlreadyLoaded && priorRoot !== root) {
      projectEvents.emitChanged(root)
    }

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
    // Record the hash before the rename lands so the watcher event it
    // triggers is recognised as our own write.
    this.#diskHash = hashText(json)
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
    this.#stopWatcher()
    this.#project = null
    this.#diskHash = null
    await libraryIndex.detach()
  }

  #startWatcher(root: string): void {
    this.#stopWatcher()
    try {
      // Watch the directory, not the file: the atomic writer (and most
      // editors / git) replace composition.json via rename, which orphans a
      // watch bound to the old inode.
      const watcher = watch(root, (_event, filename) => {
        if (filename && filename.toString() !== 'composition.json') return
        this.#scheduleExternalCheck()
      })
      watcher.on('error', (err) => {
        logger.warn({ err, root }, 'project_store: composition watcher error')
      })
      // Never keep the process alive just for the watcher.
      watcher.unref()
      this.#watcher = watcher
    } catch (err) {
      logger.warn({ err, root }, 'project_store: failed to watch composition.json')
    }
  }

  #stopWatcher(): void {
    if (this.#watchTimer) {
      clearTimeout(this.#watchTimer)
      this.#watchTimer = null
    }
    if (this.#watcher) {
      try {
        this.#watcher.close()
      } catch {
        // already closed
      }
      this.#watcher = null
    }
  }

  #scheduleExternalCheck(): void {
    if (this.#watchTimer) clearTimeout(this.#watchTimer)
    this.#watchTimer = setTimeout(() => {
      this.#watchTimer = null
      this.checkExternalChange().catch((err) => {
        logger.error({ err }, 'project_store: external reload failed')
      })
    }, this.#watchDebounceMs)
    this.#watchTimer.unref()
  }

  /**
   * Re-read composition.json and, if its text differs from what we last
   * loaded or wrote, swap it in: recompile, record the replaced in-memory
   * state as one undo step, drop any pending (now superseded) write, and
   * broadcast `changed` with `reason: 'external'`. Returns true when the
   * disk state was adopted. Invalid or half-written files are logged and
   * ignored — the in-memory composition stays authoritative until the file
   * is valid again. Called by the watcher; public for tests.
   */
  async checkExternalChange(): Promise<boolean> {
    const { default: commandBus } = await import('#services/command_bus')
    return commandBus.exclusive(async () => {
      // Let our own in-flight write land (and set #diskHash) first.
      if (this.#writeInFlight) await this.#writeInFlight.catch(() => {})
      const project = this.#project
      if (!project) return false

      const raw = await fs.readFile(project.compositionPath, 'utf8').catch(() => null)
      if (raw === null) return false
      const hash = hashText(raw)
      if (hash === this.#diskHash) return false

      let compiled: unknown
      let sourceMap: SourceMap
      try {
        ;({ compiled, sourceMap } = await compileComposition(raw, project.compositionPath))
      } catch (err) {
        logger.warn(
          { err, path: project.compositionPath },
          'project_store: ignoring external composition.json edit that does not load'
        )
        return false
      }
      // A project switch or unload may have happened while we compiled.
      if (this.#project !== project) return false

      // The external file supersedes any edits still waiting on the
      // debounced writer; those edits survive in the undo snapshot below.
      if (this.#writeTimer) {
        clearTimeout(this.#writeTimer)
        this.#writeTimer = null
      }
      this.#writePending = false

      const prev = project.composition
      this.#project = {
        ...project,
        composition: compiled,
        defaults: JSON.parse(JSON.stringify(compiled)) as unknown,
        sourceMap,
        loadedAt: Date.now(),
      }
      this.#diskHash = hash
      commandBus.recordExternalChange(prev as Composition)

      logger.info({ root: project.root }, 'project_store: reloaded external composition.json edit')
      projectEvents.emitChanged(project.root, 'external', {
        undoStackSize: commandBus.undoStackSize,
        redoStackSize: commandBus.redoStackSize,
      })
      return true
    })
  }
}

const projectStore = new ProjectStore()
export default projectStore
