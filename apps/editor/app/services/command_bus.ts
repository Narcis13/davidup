/*
|--------------------------------------------------------------------------
| CommandBus — single mutation gateway for the loaded composition (step 06)
|--------------------------------------------------------------------------
|
| Every mutation — UI panel, keyboard shortcut, MCP-bridged agent — funnels
| through `CommandBus.apply()`. That guarantees the D4 invariant: byte-equal
| UI and MCP edit sequences produce byte-equal composition.json. Source-of-
| truth is the engine's Composition schema; the CommandBus does the work of
|   1. Zod-validating the incoming command,
|   2. running applyCommand against the in-memory composition,
|   3. re-validating the next composition with the engine's schema validator,
|   4. snapshotting the previous composition onto a bounded undo stack,
|   5. emitting a change event to subscribers (Inertia push, SSE relay, MCP
|      bridge — none of those exist yet; the emit API is the seam).
|
| Persistence is the ProjectStore's job (debounced write). The CommandBus
| just calls `projectStore.update(next)` and lets the store handle disk.
*/

import { validateComposition, type Composition, type ValidationResult } from 'davidup/schema'

import { ProjectStore, ProjectLoadError } from '#services/project_store'
import projectStoreSingleton from '#services/project_store'
import {
  CommandSchema,
  type Command,
  type CommandSource,
} from '#types/commands'
import { applyCommandWithResult, ApplyCommandError } from '#services/apply_command'

const DEFAULT_UNDO_DEPTH = 50

export class CommandValidationError extends Error {
  readonly code = 'E_INVALID_COMMAND'
  readonly issues: ReadonlyArray<{ path: string; message: string }>
  constructor(issues: ReadonlyArray<{ path: string; message: string }>) {
    super(issues[0]?.message ?? 'Invalid command')
    this.name = 'CommandValidationError'
    this.issues = issues
  }
}

export class CommandRejectedError extends Error {
  readonly code: string
  readonly hint: string | undefined
  constructor(code: string, message: string, hint?: string) {
    super(message)
    this.name = 'CommandRejectedError'
    this.code = code
    this.hint = hint
  }
}

export class PostValidationError extends Error {
  readonly code = 'E_POST_VALIDATION'
  readonly result: ValidationResult
  constructor(result: ValidationResult) {
    super(
      `Command produced an invalid composition (${result.errors.length} error(s)).`
    )
    this.name = 'PostValidationError'
    this.result = result
  }
}

export interface ChangeEvent {
  command: Command
  source: CommandSource
  prev: Composition
  next: Composition
  undoStackSize: number
  /**
   * True when this event was produced by `undo()` rather than a forward
   * `apply()`. The `command` and `source` fields carry the *original*
   * command being reverted — so a subscriber that tracks "most recent
   * change source per item" treats the undo of an MCP edit as another
   * MCP-attributed change.
   */
  undo: boolean
}

export interface ApplyResult {
  composition: Composition
  command: Command
  undoStackSize: number
  /**
   * The payload the underlying MCP tool would have returned (e.g. `{ itemId }`
   * for `add_sprite`, `{ tweenIds }` for `apply_behavior`). Surfaced for the
   * MCP bridge so it can return what a direct MCP call would have produced.
   */
  toolResult: unknown
}

type Subscriber = (event: ChangeEvent) => void

// One entry per applied command. We snapshot the *pre*-apply composition so
// undo can restore it, and we carry the command that produced the post-state.
// That command's source is what `undo()` reports to subscribers — undoing an
// MCP edit must look like an MCP-attributed change to the Inspector pill,
// not get rewritten to 'ui' (the F5 bug this step closes).
interface UndoEntry {
  snapshot: Composition
  command: Command
}

export class CommandBus {
  readonly #projectStore: ProjectStore
  readonly #undoDepth: number
  readonly #undoStack: UndoEntry[] = []
  readonly #subscribers = new Set<Subscriber>()
  // Serialization chain: each apply() splices itself onto the tail. Reading
  // `#projectStore.composition` and writing it back straddles an `await`, so
  // two interleaved calls would otherwise both read the same baseline and
  // the second would clobber the first. The chain guarantees one apply runs
  // to completion (success or failure) before the next reads composition.
  #queue: Promise<unknown> = Promise.resolve()

  constructor(opts: { projectStore?: ProjectStore; undoDepth?: number } = {}) {
    this.#projectStore = opts.projectStore ?? projectStoreSingleton
    this.#undoDepth = opts.undoDepth ?? DEFAULT_UNDO_DEPTH
  }

  /** Number of snapshots currently available for undo (max = undoDepth). */
  get undoStackSize(): number {
    return this.#undoStack.length
  }

  /**
   * Validate, apply, persist, emit.
   *
   * `rawCommand` is anything that came over the wire — typically the JSON
   * body of POST /api/command, or an in-process object from the MCP bridge.
   * It's run through `CommandSchema` (the same schema both clients use)
   * before anything else happens, so callers cannot bypass validation by
   * pre-typing the input.
   *
   * Concurrent callers are serialized in call order via `#queue`, so a UI
   * edit fired at the same microtask as an MCP edit will see the UI's
   * post-state before it runs (or vice versa, depending on which was
   * scheduled first). Without that, both would read the same baseline and
   * the loser would silently overwrite the winner — D11 in the audit.
   */
  async apply(rawCommand: unknown): Promise<ApplyResult> {
    const run = (): Promise<ApplyResult> => this.#applyNow(rawCommand)
    const next = this.#queue.then(run, run)
    // `#queue` must never reject — a thrown apply would poison every queued
    // call after it. Swallow failures on the chain itself; the original
    // rejection still surfaces through the returned promise to the caller.
    this.#queue = next.catch(() => undefined)
    return next
  }

  async #applyNow(rawCommand: unknown): Promise<ApplyResult> {
    const parsed = CommandSchema.safeParse(rawCommand)
    if (!parsed.success) {
      throw new CommandValidationError(
        parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        }))
      )
    }
    const command = parsed.data

    const current = this.#projectStore.composition as Composition | null
    if (!current) {
      throw new ProjectLoadError('E_NO_PROJECT', 'No project loaded')
    }

    let next: Composition
    let toolResult: unknown
    try {
      const applied = await applyCommandWithResult(current, command)
      next = applied.next
      toolResult = applied.toolResult
    } catch (err) {
      if (err instanceof ApplyCommandError) {
        throw new CommandRejectedError(err.code, err.message, err.hint)
      }
      throw err
    }

    const result = validateComposition(next)
    if (!result.valid) {
      throw new PostValidationError(result)
    }

    this.#pushUndo(current, command)
    this.#projectStore.update(next)

    const event: ChangeEvent = {
      command,
      source: command.source,
      prev: current,
      next,
      undoStackSize: this.#undoStack.length,
      undo: false,
    }
    this.#emit(event)

    return {
      composition: next,
      command,
      undoStackSize: this.#undoStack.length,
      toolResult,
    }
  }

  /**
   * Pop the most recent snapshot off the undo stack and make it the current
   * composition. Returns the restored composition or `null` if the stack is
   * empty. The redo stack is intentionally not implemented — the PRD calls
   * for a linear, project-scoped undo (FR-09); redo lands in a later step.
   *
   * The emitted ChangeEvent carries the *original* command's source — undoing
   * an MCP edit reports `source: 'mcp'` so per-item "AI edit" attribution
   * stays correct (closes F5).
   */
  undo(): Composition | null {
    const entry = this.#undoStack.pop()
    if (!entry) return null
    const current = this.#projectStore.composition as Composition | null
    this.#projectStore.update(entry.snapshot)
    if (current) {
      const event: ChangeEvent = {
        command: entry.command,
        source: entry.command.source,
        prev: current,
        next: entry.snapshot,
        undoStackSize: this.#undoStack.length,
        undo: true,
      }
      this.#emit(event)
    }
    return entry.snapshot
  }

  /** Subscribe to change events. Returns an unsubscribe function. */
  on(subscriber: Subscriber): () => void {
    this.#subscribers.add(subscriber)
    return () => {
      this.#subscribers.delete(subscriber)
    }
  }

  /** Drop every subscriber and clear the undo stack. Used in tests. */
  reset(): void {
    this.#subscribers.clear()
    this.#undoStack.length = 0
    this.#queue = Promise.resolve()
  }

  #pushUndo(snapshot: Composition, command: Command): void {
    this.#undoStack.push({ snapshot: deepClone(snapshot), command })
    while (this.#undoStack.length > this.#undoDepth) {
      this.#undoStack.shift()
    }
  }

  #emit(event: ChangeEvent): void {
    for (const sub of this.#subscribers) {
      try {
        sub(event)
      } catch {
        // A subscriber's error must not abort the bus. Logging is the host
        // app's responsibility; we just swallow here.
      }
    }
  }
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const commandBus = new CommandBus()
export default commandBus
