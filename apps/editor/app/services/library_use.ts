// A library card dropped (docs/asset-library-plan.md E2): the asset library's
// `use_asset`, run by the editor itself.
//
// A card dropped on the stage or the timeline, or a record picked in the
// Inspector's asset picker, names an asset library record. `use_asset` (D3)
// registers it — `register_asset` with the record's pinned `asset:<id>@<sha12>`
// src and its credit and licence — and places it with the tool its kind takes
// (`add_sprite`, `add_video`, `add_audio_track`; a font is only registered).
// Each of those calls goes through the CommandBus as a `ui` command, exactly as
// an agent's go through it as `mcp` ones (mcp_bridge), and they share one
// `coalesceKey`, so the drop is one undo step.

import { randomUUID } from 'node:crypto'
import { TOOLS, dispatchTool } from 'davidup/mcp'
import type { Composition } from 'davidup/schema'

import commandBus, { type CommandBus } from '#services/command_bus'
import projectStore, { type ProjectStore } from '#services/project_store'
import { buildDeps, buildRouter } from '#services/mcp_bridge'

const USE_ASSET = TOOLS.find((t) => t.name === 'use_asset')

export interface UseAssetResult {
  /** use_asset's own result: `{ as, assetId, src, registered, record, itemId | audioTrackId, ... }`. */
  result: Record<string, unknown>
  composition: Composition
  undoStackSize: number
  redoStackSize: number
}

export class UseAssetError extends Error {
  readonly code: string
  readonly hint: string | undefined
  readonly status: number
  readonly issues: unknown
  constructor(code: string, message: string, status: number, hint?: string, issues?: unknown) {
    super(message)
    this.name = 'UseAssetError'
    this.code = code
    this.status = status
    this.hint = hint
    this.issues = issues
  }
}

/** HTTP status of a use_asset failure: bad arguments 400, no such record 404, a refused edit 409. */
function statusOf(code: string): number {
  if (code === 'E_INVALID_VALUE' || code === 'E_INVALID_PROPERTY') return 400
  if (code === 'E_ASSET_MISSING') return 404
  return 409
}

/**
 * Run `use_asset` with `args` (its own input: `id`, `as`, `assetId`, `place`,
 * `replace`) against the open project, through the bus as one `ui` undo step.
 */
export async function useLibraryAsset(
  args: Record<string, unknown>,
  opts: { bus?: CommandBus; store?: ProjectStore } = {}
): Promise<UseAssetResult> {
  const bus = opts.bus ?? commandBus
  const store = opts.store ?? projectStore
  if (!store.isLoaded) {
    throw new UseAssetError('E_NO_PROJECT', 'No project loaded.', 404, 'Open a project first.')
  }
  if (!USE_ASSET)
    throw new UseAssetError('E_FEATURE_UNAVAILABLE', 'This davidup has no use_asset tool.', 501)
  // use_asset acts on the open composition; a `compositionId` is not the page's to pick.
  const own = { ...args }
  delete own.compositionId
  const router = buildRouter(bus, store, { source: 'ui', coalesceKey: `use_asset:${randomUUID()}` })
  const out = await dispatchTool(USE_ASSET, own, buildDeps(store), router)
  if (!out.ok) {
    throw new UseAssetError(
      out.error.code,
      out.error.message,
      statusOf(out.error.code),
      out.error.hint,
      out.error.issues
    )
  }
  return {
    result: out.result as Record<string, unknown>,
    composition: store.composition as Composition,
    undoStackSize: bus.undoStackSize,
    redoStackSize: bus.redoStackSize,
  }
}
