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
 * when called against an already-loaded server. Inertia's editor page
 * subscribes and calls `router.reload()` so the new composition prop arrives
 * without a full navigation.
 */
import { EventEmitter } from 'node:events'

export type ProjectEventName = 'changed'

export interface ProjectChangedPayload {
  type: 'changed'
  /** Resolved on-disk root of the now-current project. */
  root: string
  /** Server-time wall clock for ordering on the client side. */
  at: number
}

export class ProjectEvents extends EventEmitter {
  emitChanged(root: string): void {
    const payload: ProjectChangedPayload = { type: 'changed', root, at: Date.now() }
    this.emit('changed', payload)
  }
}

const projectEvents = new ProjectEvents()
// SSE subscribers can pile up if a client reconnects many times; keep the
// listener cap generous so the warning doesn't fire under normal use.
projectEvents.setMaxListeners(64)
export default projectEvents
