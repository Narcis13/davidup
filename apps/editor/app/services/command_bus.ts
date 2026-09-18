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
// v1.1 S26 — how long after the last coalesced apply a matching
// `coalesceKey` still folds into the same undo step. Long enough for held
// arrow-key repeat and deliberate tap-tap-tap nudging; short enough that a
// nudge a few seconds later is its own step.
const DEFAULT_COALESCE_WINDOW_MS = 1000

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
  redoStackSize: number
  /**
   * True when this event was produced by `undo()` rather than a forward
   * `apply()`. The `command` and `source` fields carry the *original*
   * command being reverted — so a subscriber that tracks "most recent
   * change source per item" treats the undo of an MCP edit as another
   * MCP-attributed change.
   */
  undo: boolean
  /** True when this event was produced by `redo()` re-applying a previously-undone command. */
  redo: boolean
}

export interface ApplyResult {
  composition: Composition
  command: Command
  undoStackSize: number
  redoStackSize: number
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
// not get rewritten to 'ui' (the F5 bug this step closes). `command` is null
// for an external on-disk edit (v1.1 S25) — there is no command to attribute,
// so undo/redo of that step restores the snapshot without emitting.
interface UndoEntry {
  snapshot: Composition
  command: Command | null
  /** v1.1 S26 — the command's `coalesceKey`, if any. */
  coalesceKey?: string
  /** Wall-clock ms of the most recent apply folded into this entry. */
  at?: number
}

// Redo entry — produced when `undo()` pops a snapshot. We keep the *forward*
// (post-apply) composition so we can restore it on redo, plus the command
// that produced it so subscribers still see the original `source`. A fresh
// forward `apply()` clears the redo stack (linear history; no branching).
interface RedoEntry {
  snapshot: Composition
  command: Command | null
}

export class CommandBus {
  readonly #projectStore: ProjectStore
  readonly #undoDepth: number
  readonly #coalesceWindowMs: number
  readonly #undoStack: UndoEntry[] = []
  readonly #redoStack: RedoEntry[] = []
  readonly #subscribers = new Set<Subscriber>()
  // Serialization chain: each apply() splices itself onto the tail. Reading
  // `#projectStore.composition` and writing it back straddles an `await`, so
  // two interleaved calls would otherwise both read the same baseline and
  // the second would clobber the first. The chain guarantees one apply runs
  // to completion (success or failure) before the next reads composition.
  #queue: Promise<unknown> = Promise.resolve()

  constructor(
    opts: { projectStore?: ProjectStore; undoDepth?: number; coalesceWindowMs?: number } = {}
  ) {
    this.#projectStore = opts.projectStore ?? projectStoreSingleton
    this.#undoDepth = opts.undoDepth ?? DEFAULT_UNDO_DEPTH
    this.#coalesceWindowMs = opts.coalesceWindowMs ?? DEFAULT_COALESCE_WINDOW_MS
  }

  /** Number of snapshots currently available for undo (max = undoDepth). */
  get undoStackSize(): number {
    return this.#undoStack.length
  }

  /** Number of snapshots currently available for redo. Cleared by any forward apply(). */
  get redoStackSize(): number {
    return this.#redoStack.length
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

    this.#pushOrCoalesceUndo(current, command)
    // A new forward edit makes the previously-undone branch unreachable —
    // linear history (FR-09). Clearing here keeps undo/redo semantics simple
    // and matches user expectation from every other editor on the planet.
    this.#redoStack.length = 0
    this.#projectStore.update(next)

    const event: ChangeEvent = {
      command,
      source: command.source,
      prev: current,
      next,
      undoStackSize: this.#undoStack.length,
      redoStackSize: this.#redoStack.length,
      undo: false,
      redo: false,
    }
    this.#emit(event)

    return {
      composition: next,
      command,
      undoStackSize: this.#undoStack.length,
      redoStackSize: this.#redoStack.length,
      toolResult,
    }
  }

  /**
   * Pop the most recent snapshot off the undo stack and make it the current
   * composition. Returns the restored composition or `null` if the stack is
   * empty. The forward state is pushed onto the redo stack so `redo()` can
   * re-apply it without re-running the command (linear history per FR-09).
   *
   * The emitted ChangeEvent carries the *original* command's source — undoing
   * an MCP edit reports `source: 'mcp'` so per-item "AI edit" attribution
   * stays correct (closes F5).
   */
  undo(): Composition | null {
    const entry = this.#undoStack.pop()
    if (!entry) return null
    const current = this.#projectStore.composition as Composition | null
    if (current) {
      // Stash the forward state on the redo stack so redo() can restore it.
      // We snapshot here too — `current` may be mutated by future apply()s
      // that don't see this branch (the next forward apply() will clear redo
      // anyway, but we want safety until then).
      this.#redoStack.push({ snapshot: deepClone(current), command: entry.command })
    }
    this.#projectStore.update(entry.snapshot)
    if (current && entry.command) {
      const event: ChangeEvent = {
        command: entry.command,
        source: entry.command.source,
        prev: current,
        next: entry.snapshot,
        undoStackSize: this.#undoStack.length,
        redoStackSize: this.#redoStack.length,
        undo: true,
        redo: false,
      }
      this.#emit(event)
    }
    return entry.snapshot
  }

  /**
   * Pop the most recent snapshot off the redo stack and make it the current
   * composition. Mirror of `undo()` — pushes the pre-redo state back onto
   * the undo stack so the user can yo-yo without losing history. Returns
   * the restored composition or `null` if the redo stack is empty (no
   * undone command to replay).
   */
  redo(): Composition | null {
    const entry = this.#redoStack.pop()
    if (!entry) return null
    const current = this.#projectStore.composition as Composition | null
    if (current) {
      // Move the current state (which is the pre-redo / undone snapshot)
      // back onto the undo stack so a follow-up undo restores it.
      this.#undoStack.push({ snapshot: deepClone(current), command: entry.command })
      while (this.#undoStack.length > this.#undoDepth) {
        this.#undoStack.shift()
      }
    }
    this.#projectStore.update(entry.snapshot)
    if (current && entry.command) {
      const event: ChangeEvent = {
        command: entry.command,
        source: entry.command.source,
        prev: current,
        next: entry.snapshot,
        undoStackSize: this.#undoStack.length,
        redoStackSize: this.#redoStack.length,
        undo: false,
        redo: true,
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

  /** Drop every subscriber and clear the undo + redo stacks. Used in tests. */
  reset(): void {
    this.#subscribers.clear()
    this.#undoStack.length = 0
    this.#redoStack.length = 0
    this.#queue = Promise.resolve()
  }

  /**
   * Clear the undo + redo stacks without touching subscribers or the
   * serialization queue. Called by `ProjectStore#load()` on a project switch
   * — history is project-scoped (FR-09), so reverting into the prior
   * project's snapshots after switching would corrupt the new composition.
   */
  resetUndo(): void {
    this.#undoStack.length = 0
    this.#redoStack.length = 0
  }

  /**
   * Run `fn` on the serialization queue, so it cannot interleave with an
   * in-flight `apply()`. Used by the composition.json watcher (v1.1 S25):
   * an external reload that landed mid-apply would otherwise be clobbered
   * when the apply writes back its post-state.
   */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(fn, fn)
    this.#queue = next.catch(() => undefined)
    return next
  }

  /**
   * Record an external on-disk edit (agent, `git checkout`, text editor) as
   * one undo step: `prev` is the in-memory composition the external state
   * replaced, so ⌘Z restores it. Clears redo like any forward edit.
   */
  recordExternalChange(prev: Composition): void {
    this.#pushUndo(prev, null)
    this.#redoStack.length = 0
  }

  // v1.1 S26 — a forward apply whose `coalesceKey` matches the top undo
  // entry's (within the window, nothing undone in between) extends that
  // entry instead of pushing a new one: the entry keeps its pre-burst
  // snapshot, so one undo reverts the whole burst.
  #pushOrCoalesceUndo(snapshot: Composition, command: Command): void {
    const key = 'coalesceKey' in command ? command.coalesceKey : undefined
    const now = Date.now()
    const top = this.#undoStack[this.#undoStack.length - 1]
    if (
      key !== undefined &&
      top?.coalesceKey === key &&
      top.at !== undefined &&
      now - top.at <= this.#coalesceWindowMs &&
      this.#redoStack.length === 0
    ) {
      top.command = command
      top.at = now
      return
    }
    this.#pushUndo(snapshot, command)
    if (key !== undefined) {
      const entry = this.#undoStack[this.#undoStack.length - 1]!
      entry.coalesceKey = key
      entry.at = now
    }
  }

  #pushUndo(snapshot: Composition, command: Command | null): void {
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
