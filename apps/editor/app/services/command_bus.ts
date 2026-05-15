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
import { applyCommand, ApplyCommandError } from '#services/apply_command'

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
}

export interface ApplyResult {
  composition: Composition
  command: Command
  undoStackSize: number
}

type Subscriber = (event: ChangeEvent) => void

export class CommandBus {
  readonly #projectStore: ProjectStore
  readonly #undoDepth: number
  readonly #undoStack: Composition[] = []
  readonly #subscribers = new Set<Subscriber>()

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
   */
  async apply(rawCommand: unknown): Promise<ApplyResult> {
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
    try {
      next = await applyCommand(current, command)
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

    this.#pushUndo(current)
    this.#projectStore.update(next)

    const event: ChangeEvent = {
      command,
      source: command.source,
      prev: current,
      next,
      undoStackSize: this.#undoStack.length,
    }
    this.#emit(event)

    return {
      composition: next,
      command,
      undoStackSize: this.#undoStack.length,
    }
  }

  /**
   * Pop the most recent snapshot off the undo stack and make it the current
   * composition. Returns the restored composition or `null` if the stack is
   * empty. The redo stack is intentionally not implemented — the PRD calls
   * for a linear, project-scoped undo (FR-09); redo lands in a later step.
   */
  undo(): Composition | null {
    const prev = this.#undoStack.pop()
    if (!prev) return null
    const current = this.#projectStore.composition as Composition | null
    this.#projectStore.update(prev)
    if (current) {
      const event: ChangeEvent = {
        command: {
          kind: 'set_composition_property',
          payload: { property: 'duration', value: prev.composition.duration },
          source: 'ui',
        } satisfies Command,
        source: 'ui',
        prev: current,
        next: prev,
        undoStackSize: this.#undoStack.length,
      }
      // Don't emit a fake command event for undo — subscribers shouldn't
      // confuse it with a forward command. A future step adds a dedicated
      // 'undo' event channel.
      void event
    }
    return prev
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
  }

  #pushUndo(snapshot: Composition): void {
    this.#undoStack.push(deepClone(snapshot))
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
