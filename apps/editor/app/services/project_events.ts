/**
 * Project lifecycle event bus — step 20.11.
 *
 * A tiny in-process broadcaster the editor uses to notify connected clients
 * that the loaded project has changed. The polish_plan names this channel
 * "/projects/changed via Transmit"; @adonisjs/transmit isn't installed (see
 * `renders_controller.ts` for the version-mismatch context), so the channel
 * is exposed via a native SSE endpoint that follows the same wire shape.
 *
 * Today there is one event type — `changed` — emitted by `ProjectStore#load`
 * when called against an already-loaded server (`reason: 'switch'`), and by
 * the composition.json watcher when the file is edited out-of-band
 * (`reason: 'external'`, v1.1 S25). Inertia's editor page subscribes and
 * calls `router.reload()` so the new composition prop arrives without a full
 * navigation.
 */
import { EventEmitter } from 'node:events'

export type ProjectEventName = 'changed'

export type ProjectChangeReason = 'switch' | 'external'

export interface ProjectChangedPayload {
  type: 'changed'
  /** Why the composition changed: a project switch, or an out-of-band file edit. */
  reason: ProjectChangeReason
  /** Resolved on-disk root of the now-current project. */
  root: string
  /** Server-time wall clock for ordering on the client side. */
  at: number
  /** Undo/redo stack sizes after the change, so the client can resync its buttons. */
  undoStackSize?: number
  redoStackSize?: number
}

export class ProjectEvents extends EventEmitter {
  emitChanged(
    root: string,
    reason: ProjectChangeReason = 'switch',
    stacks: { undoStackSize?: number; redoStackSize?: number } = {}
  ): void {
    const payload: ProjectChangedPayload = {
      type: 'changed',
      reason,
      root,
      at: Date.now(),
      ...stacks,
    }
    this.emit('changed', payload)
  }
}

const projectEvents = new ProjectEvents()
// SSE subscribers can pile up if a client reconnects many times; keep the
// listener cap generous so the warning doesn't fire under normal use.
projectEvents.setMaxListeners(64)
export default projectEvents
